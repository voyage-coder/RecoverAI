"""
Phase 15 — Production readiness and demo-hardening tests.
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.schema import (
    ActionStatus,
    CaseStatus,
    Payment,
    PaymentAttempt,
    RecoveryAction,
    RecoveryCase,
    RecoveryMode,
    RecoveryResult,
    StrategyType,
)
from app.services.demo_service import RESET_CONFIRMATION, demo_inventory
from app.services.event_ingestion_service import ingest_payment_failed_event
from app.services.executor_service import execute_action
from app.services.merchant_settings_service import (
    classify_approval,
    enrich_case_operations,
    get_or_create_settings,
)
from app.services.razorpay_webhook_service import sign_webhook_body


TEST_WEBHOOK_SECRET = "recoverai_phase15_webhook_secret"


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
        return passed

    def summary(self):
        passed = sum(1 for s, _, _ in self.rows if s == "PASS")
        failed = sum(1 for s, _, _ in self.rows if s == "FAIL")
        print("-" * 72)
        print(f"TOTAL  PASS={passed}  FAIL={failed}")
        return failed == 0


def _set_manual(db):
    settings = get_or_create_settings(db)
    settings.recovery_mode = RecoveryMode.MANUAL
    settings.automatic_recovery_enabled = False
    db.add(settings)
    db.commit()


def _ingest(db, *, amount, email, key):
    return ingest_payment_failed_event(
        db,
        {
            "event": "payment.failed",
            "amount": amount,
            "currency": "INR",
            "customer": {"name": "P15 Tester", "email": email},
            "failure": {"code": "GATEWAY_TIMEOUT", "reason": "Gateway timeout"},
            "idempotency_key": key,
        },
    )


def _failed_body(payment_id, amount, email):
    doc = {
        "entity": "event",
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "amount": amount,
                    "currency": "INR",
                    "status": "failed",
                    "email": email,
                    "error_code": "BAD_REQUEST_ERROR",
                    "error_description": "Payment failed",
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _captured_body(amount, order_id, payment_id, case_number):
    doc = {
        "entity": "event",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "amount": amount,
                    "currency": "INR",
                    "status": "captured",
                    "order_id": order_id,
                    "notes": {"case_number": case_number, "source": "RecoverAI"},
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _attach_order(db, payment_id, order_id, amount):
    attempt = PaymentAttempt(
        id=str(uuid4()),
        payment_id=payment_id,
        attempt_number=1,
        status="FAILED",
        error_code="AWAITING_CUSTOMER_PAYMENT",
        error_description="Awaiting customer",
        error_source="RAZORPAY_TEST",
        gateway_response={
            "order_id": order_id,
            "amount": amount,
            "awaiting_webhook": True,
        },
    )
    db.add(attempt)
    db.flush()


def main():
    report = Report()
    print("RecoverAI Production Readiness Tests (Phase 15)")
    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]
    snap = None

    try:
        settings = get_or_create_settings(db)
        snap = {
            "recovery_mode": settings.recovery_mode,
            "automatic_recovery_enabled": settings.automatic_recovery_enabled,
            "max_automatic_recovery_amount": settings.max_automatic_recovery_amount,
            "max_retry_attempts": settings.max_retry_attempts,
            "high_value_approval_threshold": settings.high_value_approval_threshold,
            "razorpay_webhook_secret": settings.razorpay_webhook_secret,
        }
        _set_manual(db)
        settings = get_or_create_settings(db)
        settings.razorpay_webhook_secret = None
        db.add(settings)
        db.commit()

        health = client.get("/api/demo/health")
        inv = client.get("/api/demo/inventory")
        report.check(
            "Demo health omits secrets",
            health.status_code == 200
            and health.json().get("secrets_returned") is False
            and "razorpay_key_secret" not in health.json()
            and "razorpay_webhook_secret" not in health.json(),
        )
        report.check(
            "Demo inventory is available",
            inv.status_code == 200
            and inv.json().get("can_safely_delete_demo") is True,
        )
        report.check(
            "Reset without confirmation is rejected",
            client.post(
                "/api/demo/reset", json={"confirmation": "nope"}
            ).status_code
            == 400,
        )

        demo = _ingest(
            db,
            amount=199900,
            email=f"p15.demo.{batch}@recoverai.demo",
            key=f"p15-demo-{batch}",
        )
        db.commit()
        demo_payment = db.get(Payment, demo["payment_id"])
        demo_case = db.get(RecoveryCase, demo["case_id"])
        report.check(
            "Demo event is DEMO_EVENT and not RECOVERED",
            demo_payment.event_source == "DEMO_EVENT"
            and demo_case.status != CaseStatus.RECOVERED,
        )
        report.check(
            "Duplicate demo event is idempotent",
            _ingest(
                db,
                amount=199900,
                email=f"p15.demo.{batch}@recoverai.demo",
                key=f"p15-demo-{batch}",
            ).get("idempotent")
            is True,
        )
        db.commit()

        enriched = enrich_case_operations(db, demo_case)
        report.check(
            "Guidance fields are populated",
            enriched.get("next_step_code")
            and enriched.get("event_source_label") == "Demo Event"
            and enriched.get("outcome_kind") == "PREDICTED_RECOVERY",
        )

        link = client.post(
            f"/api/recovery/cases/{demo_case.id}/customer-recovery-link"
        )
        report.check(
            "Customer recovery link can be created",
            link.status_code == 200 and link.json().get("token"),
            str(link.status_code),
        )

        pending = db.scalar(
            select(RecoveryAction).where(
                RecoveryAction.case_id == demo_case.id
            )
        )
        if pending is not None:
            pending.status = ActionStatus.EXECUTED
            db.add(pending)
            db.commit()
            try:
                execute_action(db, pending)
                terminal_ok = False
            except ValueError as exc:
                terminal_ok = str(exc) == "action_already_terminal"
            report.check(
                "Terminal actions cannot execute twice",
                terminal_ok,
            )
        else:
            report.check("Terminal actions cannot execute twice", False, "no action")

        settings = get_or_create_settings(db)
        settings.recovery_mode = RecoveryMode.APPROVAL_REQUIRED
        settings.automatic_recovery_enabled = True
        db.add(settings)
        db.commit()
        approval = _ingest(
            db,
            amount=149900,
            email=f"p15.appr.{batch}@recoverai.demo",
            key=f"p15-appr-{batch}",
        )
        db.commit()
        case_a = db.get(RecoveryCase, approval["case_id"])
        action_a = db.scalar(
            select(RecoveryAction)
            .where(RecoveryAction.case_id == case_a.id)
            .order_by(RecoveryAction.created_at.desc())
        )
        report.check(
            "Approval mode does not auto-execute",
            action_a.status == ActionStatus.PENDING
            and action_a.requires_approval
            and case_a.status != CaseStatus.RECOVERED,
        )

        settings.recovery_mode = RecoveryMode.AUTOMATIC
        settings.max_automatic_recovery_amount = 50_000
        settings.high_value_approval_threshold = 10_000_000
        db.add(settings)
        db.commit()
        over = _ingest(
            db,
            amount=199900,
            email=f"p15.cap.{batch}@recoverai.demo",
            key=f"p15-cap-{batch}",
        )
        db.commit()
        case_cap = db.get(RecoveryCase, over["case_id"])
        report.check(
            "Retry amount limit requires approval; payment link stays agent-eligible",
            classify_approval(
                db,
                case_cap,
                SimpleNamespace(
                    action_type=StrategyType.IMMEDIATE_RETRY,
                    status=ActionStatus.PENDING,
                ),
            ).get("approval_state")
            == "AWAITING_APPROVAL"
            and classify_approval(
                db,
                case_cap,
                SimpleNamespace(
                    action_type=StrategyType.SEND_PAYMENT_LINK,
                    status=ActionStatus.PENDING,
                ),
            ).get("auto_eligible")
            is True
            and case_cap.status != CaseStatus.RECOVERED,
        )

        retry_policy = classify_approval(
            db,
            case_cap,
            SimpleNamespace(
                action_type=StrategyType.IMMEDIATE_RETRY,
                status=ActionStatus.PENDING,
            ),
        )
        settings.max_retry_attempts = 0
        db.add(settings)
        db.commit()
        retry_policy = classify_approval(
            db,
            case_cap,
            SimpleNamespace(
                action_type=StrategyType.IMMEDIATE_RETRY,
                status=ActionStatus.PENDING,
            ),
        )
        report.check(
            "Retry limit blocks automatic retry",
            retry_policy.get("requires_approval") is True
            and retry_policy.get("auto_eligible") is False,
        )

        settings.recovery_mode = RecoveryMode.MANUAL
        settings.automatic_recovery_enabled = False
        settings.max_automatic_recovery_amount = 5_000_000
        settings.max_retry_attempts = 3
        db.add(settings)
        db.commit()

        with patch(
            "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
            TEST_WEBHOOK_SECRET,
        ):
            fail_body = _failed_body(f"pay_live_{batch}", 329900, f"p15.live.{batch}@x.com")
            fail_sig = sign_webhook_body(fail_body, secret=TEST_WEBHOOK_SECRET)
            r1 = client.post(
                "/api/webhooks/razorpay",
                content=fail_body,
                headers={"X-Razorpay-Signature": fail_sig},
            )
            r2 = client.post(
                "/api/webhooks/razorpay",
                content=fail_body,
                headers={"X-Razorpay-Signature": fail_sig},
            )
            bad = client.post(
                "/api/webhooks/razorpay",
                content=fail_body,
                headers={"X-Razorpay-Signature": "invalid"},
            )
        report.check(
            "Live payment.failed webhook ingested",
            r1.status_code == 200 and r1.json().get("status") == "ingested",
            r1.json().get("status"),
        )
        live_payment = db.get(Payment, r1.json().get("payment_id"))
        live_case_id = r1.json().get("case_id")
        report.check(
            "Live failed event is LIVE_PROVIDER and not RECOVERED",
            live_payment is not None
            and live_payment.event_source == "LIVE_PROVIDER"
            and db.get(RecoveryCase, live_case_id).status
            != CaseStatus.RECOVERED,
        )
        report.check(
            "Duplicate live failed webhook is idempotent",
            r2.status_code == 200 and r2.json().get("idempotent") is True,
        )
        report.check(
            "Invalid webhook signature rejected",
            bad.status_code in {400, 401},
            str(bad.status_code),
        )

        unmatched_body = _captured_body(
            111100, f"order_none_{batch}", f"pay_none_{batch}", "RC-NONE"
        )
        unmatched_sig = sign_webhook_body(
            unmatched_body, secret=TEST_WEBHOOK_SECRET
        )
        with patch(
            "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
            TEST_WEBHOOK_SECRET,
        ):
            unmatched = client.post(
                "/api/webhooks/razorpay",
                content=unmatched_body,
                headers={"X-Razorpay-Signature": unmatched_sig},
            )
        report.check(
            "Unmatched captured webhook does not recover",
            unmatched.status_code == 200
            and unmatched.json().get("status") == "unmatched"
            and db.get(RecoveryCase, live_case_id).status
            != CaseStatus.RECOVERED,
            unmatched.json().get("status"),
        )

        cap_amount = 199900
        rzp_order = f"order_p15_{batch}"
        rzp_pay = f"pay_p15_{batch}"
        _attach_order(db, demo["payment_id"], rzp_order, cap_amount)
        db.commit()
        captured = _captured_body(
            cap_amount, rzp_order, rzp_pay, demo["case_number"]
        )
        cap_sig = sign_webhook_body(captured, secret=TEST_WEBHOOK_SECRET)
        with patch(
            "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
            TEST_WEBHOOK_SECRET,
        ):
            c1 = client.post(
                "/api/webhooks/razorpay",
                content=captured,
                headers={"X-Razorpay-Signature": cap_sig},
            )
            c2 = client.post(
                "/api/webhooks/razorpay",
                content=captured,
                headers={"X-Razorpay-Signature": cap_sig},
            )
        db.expire_all()
        recovered_case = db.get(RecoveryCase, demo["case_id"])
        result = db.scalar(
            select(RecoveryResult).where(
                RecoveryResult.case_id == demo["case_id"]
            )
        )
        report.check(
            "Successful captured webhook marks RECOVERED",
            c1.status_code == 200
            and recovered_case.status == CaseStatus.RECOVERED,
            c1.json().get("status"),
        )
        report.check(
            "Duplicate captured webhook is idempotent",
            c2.status_code == 200 and c2.json().get("idempotent") is True,
        )
        report.check(
            "Recovered amount cannot exceed original payment",
            result is not None
            and int(result.recovered_amount) <= int(result.original_amount)
            and int(result.recovered_amount) <= cap_amount,
            f"{getattr(result, 'recovered_amount', None)}/{getattr(result, 'original_amount', None)}",
        )
        results = db.scalars(
            select(RecoveryResult).where(
                RecoveryResult.case_id == demo["case_id"]
            )
        ).all()
        report.check("No duplicate recovery results", len(results) == 1)

        blocked_action = RecoveryAction(
            id=str(uuid4()),
            case_id=case_a.id,
            action_type=StrategyType.IMMEDIATE_RETRY,
            status=ActionStatus.BLOCKED,
            attempt_number=9,
            result_text="Maximum payment retry limit reached.",
        )
        db.add(blocked_action)
        db.commit()
        report.check(
            "Safety block is visible in guidance",
            enrich_case_operations(db, case_a).get("next_step_code")
            == "SAFETY_BLOCKED",
        )

        live_before = demo_inventory(db)["live_payments_preserved"]
        reset = client.post(
            "/api/demo/reset",
            json={"confirmation": RESET_CONFIRMATION},
        )
        report.check("Demo reset accepted", reset.status_code == 200, str(reset.status_code))
        db.expire_all()
        report.check(
            "Demo reset keeps LIVE_PROVIDER payment",
            db.get(Payment, live_payment.id) is not None
            and db.get(Payment, live_payment.id).event_source
            == "LIVE_PROVIDER",
        )
        report.check(
            "Demo recovered case was removable as DEMO_EVENT",
            db.get(RecoveryCase, demo["case_id"]) is None,
        )
        report.check(
            "Live payment count not reduced below prior live rows",
            demo_inventory(db)["live_payments_preserved"] >= 1
            and demo_inventory(db)["live_payments_preserved"] >= live_before - 0,
        )

    except Exception as exc:
        report.check("Suite crashed", False, str(exc))
        raise
    finally:
        try:
            if snap:
                settings = get_or_create_settings(db)
                for key, value in snap.items():
                    setattr(settings, key, value)
                db.add(settings)
                db.commit()
        finally:
            db.close()

    return 0 if report.summary() else 1


if __name__ == "__main__":
    raise SystemExit(main())
