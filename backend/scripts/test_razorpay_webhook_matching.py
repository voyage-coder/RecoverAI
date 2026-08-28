"""
Regression tests for Razorpay webhook matching / recovery.

LABEL: UNIT/INTEGRATION TEST (locally signed payloads — not live Dashboard).

Covers:
  A. valid payment.captured + matched payment → FULLY_RECOVERED
  B. invalid signature → rejected, no DB changes
  C. duplicate payment.captured → idempotent, no duplicate SUCCESS
  D. unmatched Razorpay payment → ack, does not recover another case
  E. ESCALATED + matched → recovered only under explicit business rule
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schema import (
    ActionStatus,
    CaseStatus,
    RecoveryResultStatus,
    StrategyType,
)
from app.services.razorpay_webhook_service import (
    ALLOW_RECOVERY_WHEN_ESCALATED,
    process_razorpay_webhook,
    sign_webhook_body,
)


TEST_WEBHOOK_SECRET = "recoverai_regression_webhook_secret"


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        suffix = f" — {detail}" if detail else ""
        print(f"[{status}] {name}{suffix}")
        return passed

    def summary(self):
        print("\n" + "=" * 72)
        print("SUMMARY")
        print("=" * 72)
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
    order_id: str,
    payment_id: str,
    amount: int,
    case_number: str | None = None,
) -> bytes:
    notes = {"source": "RecoverAI"}
    if case_number:
        notes["case_number"] = case_number
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
                    "notes": notes,
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _graph(
    *,
    case_number: str,
    case_status: CaseStatus,
    order_id: str,
    amount: int = 199900,
):
    order = SimpleNamespace(status="FAILED")
    payment = SimpleNamespace(
        id=f"pay_{case_number}",
        amount=amount,
        status="FAILED",
        order=order,
    )
    case = SimpleNamespace(
        id=f"case_{case_number}",
        case_number=case_number,
        payment_id=payment.id,
        amount_at_risk=amount,
        retry_count=2,
        contact_count=3,
        status=case_status,
        current_step="Escalated" if case_status == CaseStatus.ESCALATED else "Retry",
    )
    attempt = SimpleNamespace(
        id=f"att_{case_number}",
        payment_id=payment.id,
        attempt_number=3,
        status="FAILED",
        error_code="AWAITING_CUSTOMER_PAYMENT",
        error_description="awaiting",
        error_source="RAZORPAY_TEST",
        gateway_response={
            "mode": "RAZORPAY_TEST",
            "order_id": order_id,
            "awaiting_webhook": True,
        },
    )
    action = SimpleNamespace(
        id=f"act_{case_number}",
        case_id=case.id,
        action_type=StrategyType.RETRY_AFTER_DELAY,
        status=ActionStatus.EXECUTED,
        executed_at=None,
        result_text="awaiting",
    )
    result = SimpleNamespace(
        id=str(uuid4()),
        case_id=case.id,
        original_amount=amount,
        recovered_amount=0,
        status=RecoveryResultStatus.NOT_RECOVERED,
        recovery_method=None,
        recovered_at=None,
    )
    return order, payment, case, attempt, action, result


def _run_with_match(
    *,
    raw: bytes,
    signature: str | None,
    case,
    payment,
    attempt,
    action,
    result,
    secret: str = TEST_WEBHOOK_SECRET,
):
    db = MagicMock()
    db.scalar.return_value = result

    def update_result(db, case, action, recovered_amount=0):
        result.recovered_amount += recovered_amount
        if result.recovered_amount >= result.original_amount:
            result.status = RecoveryResultStatus.FULLY_RECOVERED
            result.recovery_method = (
                action.action_type.value
                if hasattr(action.action_type, "value")
                else str(action.action_type)
            )
            case.status = CaseStatus.RECOVERED
            case.current_step = "Recovery Complete"
        return result

    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        secret,
    ), patch(
        "app.services.razorpay_webhook_service.is_webhook_secret_configured",
        return_value=True,
    ), patch(
        "app.services.razorpay_webhook_service.find_case_for_webhook",
        return_value=(case, payment, attempt),
    ), patch(
        "app.services.razorpay_webhook_service._latest_action",
        return_value=action,
    ), patch(
        "app.services.razorpay_webhook_service._mark_open_action_executed",
    ), patch(
        "app.services.razorpay_webhook_service.update_recovery_result",
        side_effect=update_result,
    ):
        return process_razorpay_webhook(
            db,
            raw_body=raw,
            signature=signature,
        )


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Razorpay Webhook Matching Regression")
    print("LABEL: UNIT/INTEGRATION TEST")
    print("=" * 72)

    order_id = "order_reg_match_001"
    rzp_pay_id = "pay_reg_match_001"
    amount = 199900

    # ----------------------------------------------------------
    # A. matched success → FULLY_RECOVERED
    # ----------------------------------------------------------
    order, payment, case, attempt, action, result = _graph(
        case_number="RC-REG-A",
        case_status=CaseStatus.IN_PROGRESS,
        order_id=order_id,
        amount=amount,
    )
    raw = _captured_body(
        order_id=order_id,
        payment_id=rzp_pay_id,
        amount=amount,
        case_number="RC-REG-A",
    )
    sig = sign_webhook_body(raw, secret=TEST_WEBHOOK_SECRET)
    out_a = _run_with_match(
        raw=raw,
        signature=sig,
        case=case,
        payment=payment,
        attempt=attempt,
        action=action,
        result=result,
    )
    report.check(
        "A. valid payment.captured + matched → FULLY_RECOVERED",
        out_a.accepted
        and out_a.modified
        and payment.status == "RECOVERED"
        and order.status == "RECOVERED"
        and case.status == CaseStatus.RECOVERED
        and result.status == RecoveryResultStatus.FULLY_RECOVERED
        and attempt.status == "SUCCESS",
        out_a.status,
    )

    # ----------------------------------------------------------
    # B. invalid signature → no DB changes
    # ----------------------------------------------------------
    order_b, payment_b, case_b, attempt_b, action_b, result_b = _graph(
        case_number="RC-REG-B",
        case_status=CaseStatus.IN_PROGRESS,
        order_id="order_reg_b",
    )
    find_calls = {"n": 0}

    def find_side_effect(*args, **kwargs):
        find_calls["n"] += 1
        return case_b, payment_b, attempt_b

    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        TEST_WEBHOOK_SECRET,
    ), patch(
        "app.services.razorpay_webhook_service.is_webhook_secret_configured",
        return_value=True,
    ), patch(
        "app.services.razorpay_webhook_service.find_case_for_webhook",
        side_effect=find_side_effect,
    ):
        out_b = process_razorpay_webhook(
            MagicMock(),
            raw_body=raw,
            signature="invalid_signature_value",
        )
    report.check(
        "B. invalid signature → rejected, no match/DB apply",
        out_b.accepted is False
        and out_b.status == "invalid_signature"
        and find_calls["n"] == 0
        and payment_b.status == "FAILED"
        and case_b.status == CaseStatus.IN_PROGRESS
        and result_b.status == RecoveryResultStatus.NOT_RECOVERED,
        out_b.status,
    )

    # ----------------------------------------------------------
    # C. duplicate → idempotent, single SUCCESS attempt
    # ----------------------------------------------------------
    out_c1 = _run_with_match(
        raw=raw,
        signature=sig,
        case=case,
        payment=payment,
        attempt=attempt,
        action=action,
        result=result,
    )
    # Already recovered from A; duplicate must be idempotent.
    success_before = attempt.status
    out_c2 = _run_with_match(
        raw=raw,
        signature=sig,
        case=case,
        payment=payment,
        attempt=attempt,
        action=action,
        result=result,
    )
    report.check(
        "C. duplicate payment.captured → idempotent, no re-apply",
        out_c2.accepted
        and out_c2.idempotent
        and out_c2.modified is False
        and success_before == "SUCCESS"
        and attempt.status == "SUCCESS"
        and case.retry_count == 2
        and case.contact_count == 3,
        out_c2.status,
    )

    # ----------------------------------------------------------
    # D. unmatched → ack, does not recover another case
    # ----------------------------------------------------------
    other_order, other_pay, other_case, other_att, other_act, other_res = (
        _graph(
            case_number="RC-OTHER",
            case_status=CaseStatus.IN_PROGRESS,
            order_id="order_other_only",
        )
    )
    unmatched_raw = _captured_body(
        order_id="order_orphan_xyz",
        payment_id="pay_orphan_xyz",
        amount=1000,
        case_number=None,
    )
    unmatched_sig = sign_webhook_body(
        unmatched_raw, secret=TEST_WEBHOOK_SECRET
    )
    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        TEST_WEBHOOK_SECRET,
    ), patch(
        "app.services.razorpay_webhook_service.is_webhook_secret_configured",
        return_value=True,
    ), patch(
        "app.services.razorpay_webhook_service.find_case_for_webhook",
        return_value=(None, None, None),
    ), patch(
        "app.services.razorpay_webhook_service.apply_verified_payment_recovery",
    ) as apply_mock:
        out_d = process_razorpay_webhook(
            MagicMock(),
            raw_body=unmatched_raw,
            signature=unmatched_sig,
        )
    report.check(
        "D. unmatched Razorpay payment → ack, no recovery apply",
        out_d.accepted
        and out_d.status == "unmatched"
        and out_d.modified is False
        and apply_mock.call_count == 0
        and other_pay.status == "FAILED"
        and other_case.status == CaseStatus.IN_PROGRESS
        and other_res.status == RecoveryResultStatus.NOT_RECOVERED,
        out_d.detail[:80],
    )

    # ----------------------------------------------------------
    # E. ESCALATED + matched under explicit business rule
    # ----------------------------------------------------------
    report.check(
        "E0. business rule ALLOW_RECOVERY_WHEN_ESCALATED is explicit",
        ALLOW_RECOVERY_WHEN_ESCALATED is True,
        f"ALLOW_RECOVERY_WHEN_ESCALATED={ALLOW_RECOVERY_WHEN_ESCALATED}",
    )

    order_e, payment_e, case_e, attempt_e, action_e, result_e = _graph(
        case_number="RC-REG-E",
        case_status=CaseStatus.ESCALATED,
        order_id="order_reg_e",
        amount=amount,
    )
    raw_e = _captured_body(
        order_id="order_reg_e",
        payment_id="pay_reg_e",
        amount=amount,
        case_number="RC-REG-E",
    )
    sig_e = sign_webhook_body(raw_e, secret=TEST_WEBHOOK_SECRET)
    out_e = _run_with_match(
        raw=raw_e,
        signature=sig_e,
        case=case_e,
        payment=payment_e,
        attempt=attempt_e,
        action=action_e,
        result=result_e,
    )
    if ALLOW_RECOVERY_WHEN_ESCALATED:
        report.check(
            "E. ESCALATED + matched → RECOVERED (rule allows)",
            out_e.accepted
            and out_e.modified
            and case_e.status == CaseStatus.RECOVERED
            and payment_e.status == "RECOVERED"
            and result_e.status == RecoveryResultStatus.FULLY_RECOVERED,
            out_e.status,
        )
    else:
        report.check(
            "E. ESCALATED + matched → skipped (rule blocks)",
            out_e.accepted
            and out_e.modified is False
            and out_e.status == "skipped_escalated"
            and case_e.status == CaseStatus.ESCALATED
            and payment_e.status == "FAILED",
            out_e.status,
        )

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
