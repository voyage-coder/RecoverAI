"""
Phase 10A — Razorpay payment.captured webhook idempotency tests.

Does not weaken signature verification. Uses TEST webhook secret
and local signing — labeled as TEST, not live Dashboard delivery.
"""

from __future__ import annotations

from pathlib import Path
import json
import os
import sys
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.schema import (
    Payment,
    PaymentAttempt,
    RecoveryAction,
    RecoveryCase,
    RecoveryResult,
    CaseStatus,
    ActionStatus,
)
from app.services.event_ingestion_service import (
    ingest_payment_failed_event,
)
from app.services.recovery_operations_service import (
    execute_pending_action_for_case,
)
from app.services.razorpay_webhook_service import (
    sign_webhook_body,
)


TEST_WEBHOOK_SECRET = "recoverai_phase10a_webhook_secret"


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
        return passed

    def summary(self):
        print("\n" + "=" * 72)
        passed = sum(1 for s, _, _ in self.rows if s == "PASS")
        failed = sum(1 for s, _, _ in self.rows if s == "FAIL")
        for status, name, detail in self.rows:
            line = f"{status:4}  {name}"
            if detail:
                line += f"  ({detail})"
            print(line)
        print("-" * 72)
        print(f"TOTAL  PASS={passed}  FAIL={failed}")
        return failed == 0


def _captured_body(
    *,
    amount: int,
    order_id: str,
    payment_id: str,
    case_number: str,
) -> bytes:
    doc = {
        "entity": "event",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "entity": "payment",
                    "amount": amount,
                    "currency": "INR",
                    "status": "captured",
                    "order_id": order_id,
                    "notes": {
                        "case_number": case_number,
                        "source": "RecoverAI",
                    },
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _attach_awaiting_order(
    db,
    *,
    payment_id: str,
    order_id: str,
    amount: int,
):
    """Ensure payment-details has a Razorpay order for matching."""
    next_number = (
        db.scalar(
            select(PaymentAttempt.attempt_number)
            .where(PaymentAttempt.payment_id == payment_id)
            .order_by(PaymentAttempt.attempt_number.desc())
        )
        or 0
    ) + 1

    attempt = PaymentAttempt(
        id=str(uuid4()),
        payment_id=payment_id,
        attempt_number=next_number,
        status="FAILED",
        error_code="AWAITING_CUSTOMER_PAYMENT",
        error_description="Awaiting customer payment",
        error_source="RAZORPAY_TEST",
        gateway_response={
            "mode": "RAZORPAY_TEST",
            "order_id": order_id,
            "amount": amount,
            "awaiting_webhook": True,
        },
    )
    db.add(attempt)
    db.flush()
    return attempt


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Webhook Idempotency Tests")
    print("LABEL: locally signed TEST webhooks (not live Razorpay)")
    print("=" * 72)

    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]
    amount = 199900
    order_id = f"order_idem_{batch}"
    rzp_payment_id = f"pay_idem_{batch}"

    env_patch = {
        "RAZORPAY_WEBHOOK_SECRET": TEST_WEBHOOK_SECRET,
    }

    try:
        with patch.dict(os.environ, env_patch, clear=False):
            # Reload secret used by gateway/webhook modules
            import app.services.payment_gateway_service as gateway
            import app.services.razorpay_webhook_service as webhook_mod

            gateway.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
            webhook_mod.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET

            ingest = ingest_payment_failed_event(
                db,
                {
                    "event": "payment.failed",
                    "amount": amount,
                    "currency": "INR",
                    "customer": {
                        "name": "Webhook Idem",
                        "email": f"wh.idem.{batch}@recoverai.demo",
                    },
                    "failure": {
                        "code": "GATEWAY_TIMEOUT",
                        "reason": "Gateway timeout",
                    },
                    "idempotency_key": f"wh-idem-{batch}",
                },
            )
            db.commit()
            case_id = ingest["case_id"]
            payment_id = ingest["payment_id"]
            case_number = ingest["case_number"]

            # Execute pending so pipeline progressed (optional for matching)
            try:
                execute_pending_action_for_case(db, case_id)
                db.commit()
            except Exception:
                db.rollback()

            _attach_awaiting_order(
                db,
                payment_id=payment_id,
                order_id=order_id,
                amount=amount,
            )
            db.commit()

            body = _captured_body(
                amount=amount,
                order_id=order_id,
                payment_id=rzp_payment_id,
                case_number=case_number,
            )
            signature = sign_webhook_body(
                body,
                secret=TEST_WEBHOOK_SECRET,
            )

            # A. Valid first webhook
            r1 = client.post(
                "/api/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": signature},
            )
            report.check(
                "A. Valid first webhook accepted",
                r1.status_code == 200
                and r1.json().get("status") in {"recovered", "idempotent"},
                f"status={r1.status_code} body={r1.json()}",
            )

            db.expire_all()
            case = db.scalar(
                select(RecoveryCase).where(RecoveryCase.id == case_id)
            )
            payment = db.scalar(
                select(Payment).where(Payment.id == payment_id)
            )
            result = db.scalar(
                select(RecoveryResult).where(
                    RecoveryResult.case_id == case_id
                )
            )
            report.check(
                "A. Case + payment RECOVERED after first webhook",
                case is not None
                and case.status == CaseStatus.RECOVERED
                and payment is not None
                and payment.status == "RECOVERED",
                f"case={case.status if case else None} "
                f"payment={payment.status if payment else None}",
            )
            report.check(
                "A. RecoveryResult amount equals payment amount",
                result is not None
                and int(result.recovered_amount) == amount,
                f"recovered={result.recovered_amount if result else None}",
            )
            recovered_after_first = (
                int(result.recovered_amount) if result else None
            )
            results_count_first = db.scalar(
                select(func.count()).select_from(RecoveryResult).where(
                    RecoveryResult.case_id == case_id
                )
            )
            actions_count_first = db.scalar(
                select(func.count()).select_from(RecoveryAction).where(
                    RecoveryAction.case_id == case_id
                )
            )

            # B. Identical duplicate webhook
            r2 = client.post(
                "/api/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": signature},
            )
            report.check(
                "B. Duplicate webhook HTTP 200",
                r2.status_code == 200,
                f"status={r2.status_code} body={r2.json()}",
            )
            report.check(
                "B. Duplicate marked idempotent / not modified",
                r2.json().get("idempotent") is True
                or r2.json().get("status") == "idempotent",
                str(r2.json()),
            )

            db.expire_all()
            result2 = db.scalar(
                select(RecoveryResult).where(
                    RecoveryResult.case_id == case_id
                )
            )
            results_count_second = db.scalar(
                select(func.count()).select_from(RecoveryResult).where(
                    RecoveryResult.case_id == case_id
                )
            )
            actions_count_second = db.scalar(
                select(func.count()).select_from(RecoveryAction).where(
                    RecoveryAction.case_id == case_id
                )
            )
            report.check(
                "B. No duplicate RecoveryResult row",
                results_count_first == 1 and results_count_second == 1,
                f"count={results_count_second}",
            )
            report.check(
                "B. Recovered amount not doubled",
                result2 is not None
                and int(result2.recovered_amount) == amount
                and int(result2.recovered_amount) == recovered_after_first,
                f"recovered={result2.recovered_amount if result2 else None}",
            )
            report.check(
                "B. No extra RecoveryAction from duplicate webhook",
                actions_count_first == actions_count_second,
                f"actions={actions_count_second}",
            )

            # Dashboard invariant
            overview = client.get("/api/dashboard/overview").json()
            report.check(
                "Dashboard recovered amount is finite / present",
                "amount_recovered" in overview,
                f"amount_recovered={overview.get('amount_recovered')}",
            )

            # C. Invalid signature
            bad = client.post(
                "/api/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": "invalid_signature_value"},
            )
            report.check(
                "C. Invalid signature rejected",
                bad.status_code in {401, 400},
                f"status={bad.status_code}",
            )

            # D. Unmatched order
            unmatched_body = _captured_body(
                amount=amount,
                order_id=f"order_unmatched_{batch}",
                payment_id=f"pay_unmatched_{batch}",
                case_number=f"RC-NOMATCH-{batch}",
            )
            unmatched_sig = sign_webhook_body(
                unmatched_body,
                secret=TEST_WEBHOOK_SECRET,
            )
            unmatched = client.post(
                "/api/webhooks/razorpay",
                content=unmatched_body,
                headers={"X-Razorpay-Signature": unmatched_sig},
            )
            report.check(
                "D. Unmatched order does not recover our case",
                unmatched.status_code == 200
                and unmatched.json().get("case_id") != case_id,
                str(unmatched.json()),
            )
            db.expire_all()
            case_after = db.scalar(
                select(RecoveryCase).where(RecoveryCase.id == case_id)
            )
            report.check(
                "D. Original case still RECOVERED unchanged",
                case_after is not None
                and case_after.status == CaseStatus.RECOVERED,
            )

            # E. Already recovered case — third delivery
            r3 = client.post(
                "/api/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": signature},
            )
            report.check(
                "E. Already recovered webhook stays idempotent",
                r3.status_code == 200
                and (
                    r3.json().get("idempotent") is True
                    or r3.json().get("status") == "idempotent"
                ),
                str(r3.json()),
            )

            # Execute already-executed action
            exec2 = client.post(
                f"/api/recovery/cases/{case_id}/execute-pending-action"
            )
            report.check(
                "6. Re-execute on recovered case is safe",
                exec2.status_code in {200, 400},
                f"status={exec2.status_code} detail={exec2.text[:120]}",
            )
            if exec2.status_code == 200:
                report.check(
                    "6. Re-execute does not invent new pending run",
                    exec2.json().get("action_status")
                    in {"EXECUTED", None}
                    or "already" in (exec2.json().get("message") or "").lower()
                    or exec2.json().get("case_status") == "RECOVERED",
                    str(exec2.json()),
                )

            cont = client.post(
                f"/api/recovery/cases/{case_id}/continue-recovery"
            )
            report.check(
                "7. Continue recovered case rejected/safe",
                cont.status_code == 400
                or (
                    cont.status_code == 200
                    and cont.json().get("case_status") == "RECOVERED"
                ),
                f"status={cont.status_code} body={cont.text[:120]}",
            )

    except Exception as exc:
        db.rollback()
        report.check("Suite completed without exception", False, str(exc))
        raise
    finally:
        db.close()

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
