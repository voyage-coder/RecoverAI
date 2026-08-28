"""
RecoverAI Razorpay webhook verification tests.

These are unit/integration tests. Signatures are generated locally with a
TEST webhook secret. This is clearly labeled — not a live Razorpay Dashboard
delivery unless credentials + tunneling are configured separately.
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
from app.services import payment_gateway_service as gateway
from app.services.payment_gateway_service import (
    MODE_SIMULATED,
    attempt_payment_retry,
    get_gateway_mode,
)
from app.services.razorpay_webhook_service import (
    apply_verified_payment_recovery,
    process_razorpay_webhook,
    sign_webhook_body,
    verify_webhook_signature,
)


TEST_WEBHOOK_SECRET = "recoverai_test_webhook_secret_only"


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


def _payment_captured_body(
    *,
    amount: int = 199900,
    order_id: str = "order_test_abc",
    payment_id: str = "pay_test_abc",
    case_number: str = "RC-WH-001",
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


def _unknown_event_body() -> bytes:
    doc = {
        "entity": "event",
        "event": "refund.created",
        "payload": {"refund": {"entity": {"id": "rfnd_x"}}},
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _build_case_graph(
    *,
    case_number: str = "RC-WH-001",
    retry_count: int = 2,
    contact_count: int = 1,
    order_id: str = "order_test_abc",
):
    order = SimpleNamespace(status="FAILED")
    payment = SimpleNamespace(
        id="pay_local_1",
        amount=199900,
        status="FAILED",
        order=order,
    )
    case = SimpleNamespace(
        id="case_local_1",
        case_number=case_number,
        payment_id=payment.id,
        amount_at_risk=199900,
        retry_count=retry_count,
        contact_count=contact_count,
        status=CaseStatus.IN_PROGRESS,
        current_step="Retry Executed",
    )
    attempt = SimpleNamespace(
        id="att_local_1",
        payment_id=payment.id,
        attempt_number=2,
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
        id="act_local_1",
        case_id=case.id,
        action_type=StrategyType.RETRY_AFTER_DELAY,
        status=ActionStatus.EXECUTED,
        executed_at=None,
        result_text="Payment retry failed.",
    )
    result = SimpleNamespace(
        id=str(uuid4()),
        case_id=case.id,
        original_amount=199900,
        recovered_amount=0,
        status=RecoveryResultStatus.NOT_RECOVERED,
        recovery_method=None,
        recovered_at=None,
    )
    return order, payment, case, attempt, action, result


def _mock_db_for_graph(payment, case, attempt, action, result):
    db = MagicMock()

    def scalar(stmt):
        text = str(stmt)
        # Heuristic routing for unit tests without compiling SQL.
        if "payment_attempts" in text.lower() or "PaymentAttempt" in text:
            if "attempt_number" in text.lower():
                return attempt.attempt_number
            return attempt
        if "payments" in text.lower() or "Payment" in text:
            return payment
        if "recovery_cases" in text.lower() or "RecoveryCase" in text:
            return case
        if "recovery_results" in text.lower() or "RecoveryResult" in text:
            return result
        if "recovery_actions" in text.lower() or "RecoveryAction" in text:
            return action
        return None

    db.scalar.side_effect = scalar
    db.scalars.return_value.all.return_value = [attempt]
    return db


def main():
    report = Report()

    print("=" * 72)
    print("RecoverAI Razorpay Webhook Test")
    print("LABEL: UNIT/INTEGRATION TEST (locally signed payloads)")
    print("=" * 72)

    raw = _payment_captured_body()
    good_sig = sign_webhook_body(raw, secret=TEST_WEBHOOK_SECRET)

    # ----------------------------------------------------------
    # 1. Valid signature accepted
    # ----------------------------------------------------------
    report.check(
        "1. Valid signature accepted",
        verify_webhook_signature(
            raw,
            good_sig,
            secret=TEST_WEBHOOK_SECRET,
        )
        is True,
    )

    # ----------------------------------------------------------
    # 2. Invalid signature rejected
    # ----------------------------------------------------------
    report.check(
        "2. Invalid signature rejected",
        verify_webhook_signature(
            raw,
            "deadbeef" * 8,
            secret=TEST_WEBHOOK_SECRET,
        )
        is False,
    )

    # ----------------------------------------------------------
    # 3. Missing signature rejected
    # ----------------------------------------------------------
    report.check(
        "3. Missing signature rejected",
        verify_webhook_signature(
            raw,
            None,
            secret=TEST_WEBHOOK_SECRET,
        )
        is False,
    )

    # ----------------------------------------------------------
    # Patch webhook secret for process_* tests
    # ----------------------------------------------------------
    order, payment, case, attempt, action, result = _build_case_graph()
    db = _mock_db_for_graph(payment, case, attempt, action, result)

    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        TEST_WEBHOOK_SECRET,
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
    ) as update_result_mock:

        def _apply_update(db, case, action, recovered_amount=0):
            result.recovered_amount += recovered_amount
            if result.recovered_amount >= result.original_amount:
                result.status = RecoveryResultStatus.FULLY_RECOVERED
                result.recovery_method = action.action_type.value
                case.status = CaseStatus.RECOVERED
                case.current_step = "Recovery Complete"
            return result

        update_result_mock.side_effect = _apply_update

        # 4. Valid successful payment updates recovery state
        prior_retry = case.retry_count
        prior_contact = case.contact_count
        out = process_razorpay_webhook(
            db,
            raw_body=raw,
            signature=good_sig,
        )
        report.check(
            "4. Valid successful payment updates recovery state",
            out.accepted
            and out.modified
            and payment.status == "RECOVERED"
            and order.status == "RECOVERED"
            and case.status == CaseStatus.RECOVERED
            and attempt.status == "SUCCESS"
            and result.status == RecoveryResultStatus.FULLY_RECOVERED,
            out.status,
        )

        # 8 / 9 counters
        report.check(
            "8. No retry_count increment from webhook",
            case.retry_count == prior_retry,
            f"retry_count={case.retry_count}",
        )
        report.check(
            "9. No contact_count increment from webhook",
            case.contact_count == prior_contact,
            f"contact_count={case.contact_count}",
        )

        # 10. FULLY_RECOVERED only after verified success
        report.check(
            "10. RecoveryResult becomes FULLY_RECOVERED only after verified success",
            result.status == RecoveryResultStatus.FULLY_RECOVERED
            and result.recovered_amount == 199900,
            f"recovered_amount={result.recovered_amount}",
        )

        # 5. Duplicate webhook is idempotent
        out2 = process_razorpay_webhook(
            db,
            raw_body=raw,
            signature=good_sig,
        )
        report.check(
            "5. Duplicate webhook is idempotent",
            out2.accepted
            and out2.idempotent
            and out2.modified is False
            and case.retry_count == prior_retry
            and case.contact_count == prior_contact,
            out2.status,
        )

    # ----------------------------------------------------------
    # 6. Invalid webhook does not modify DB state
    # ----------------------------------------------------------
    order_b, payment_b, case_b, attempt_b, action_b, result_b = (
        _build_case_graph(case_number="RC-WH-002")
    )
    db_b = _mock_db_for_graph(
        payment_b, case_b, attempt_b, action_b, result_b
    )
    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        TEST_WEBHOOK_SECRET,
    ), patch(
        "app.services.razorpay_webhook_service.is_webhook_secret_configured",
        return_value=True,
    ), patch(
        "app.services.razorpay_webhook_service.find_case_for_webhook",
        return_value=(case_b, payment_b, attempt_b),
    ) as find_mock:
        bad = process_razorpay_webhook(
            db_b,
            raw_body=raw,
            signature="totally_invalid_signature_value",
        )
        report.check(
            "6. Invalid webhook does not modify DB state",
            bad.accepted is False
            and bad.status == "invalid_signature"
            and payment_b.status == "FAILED"
            and case_b.status == CaseStatus.IN_PROGRESS
            and result_b.status == RecoveryResultStatus.NOT_RECOVERED
            and find_mock.call_count == 0,
            bad.status,
        )

    # ----------------------------------------------------------
    # 7. Unknown event safely handled
    # ----------------------------------------------------------
    unknown = _unknown_event_body()
    unknown_sig = sign_webhook_body(
        unknown, secret=TEST_WEBHOOK_SECRET
    )
    with patch(
        "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
        TEST_WEBHOOK_SECRET,
    ), patch(
        "app.services.razorpay_webhook_service.is_webhook_secret_configured",
        return_value=True,
    ):
        out_u = process_razorpay_webhook(
            MagicMock(),
            raw_body=unknown,
            signature=unknown_sig,
        )
        report.check(
            "7. Unknown event is safely handled",
            out_u.accepted
            and out_u.status == "ignored"
            and out_u.modified is False
            and out_u.event == "refund.created",
            out_u.detail,
        )

    # ----------------------------------------------------------
    # 11. Secrets do not appear in logs / safe gateway payload
    # ----------------------------------------------------------
    _, payment_c, case_c, attempt_c, action_c, result_c = (
        _build_case_graph(case_number="RC-WH-003")
    )
    fields = {
        "razorpay_payment_id": "pay_test_abc",
        "razorpay_order_id": "order_test_abc",
        "razorpay_payment_link_id": None,
        "amount": 199900,
        "currency": "INR",
        "status": "captured",
        "notes": {"case_number": "RC-WH-003"},
        "case_number": "RC-WH-003",
    }
    db_c = MagicMock()
    db_c.scalar.return_value = result_c

    with patch(
        "app.services.razorpay_webhook_service._latest_action",
        return_value=action_c,
    ), patch(
        "app.services.razorpay_webhook_service._mark_open_action_executed",
    ), patch(
        "app.services.razorpay_webhook_service.update_recovery_result",
        side_effect=lambda db, case, action, recovered_amount=0: (
            setattr(
                result_c,
                "status",
                RecoveryResultStatus.FULLY_RECOVERED,
            )
            or setattr(result_c, "recovered_amount", recovered_amount)
            or result_c
        ),
    ):
        apply_verified_payment_recovery(
            db_c,
            case=case_c,
            payment=payment_c,
            attempt=attempt_c,
            fields=fields,
        )

    dumped = json.dumps(attempt_c.gateway_response)
    secret_leak = (
        TEST_WEBHOOK_SECRET in dumped
        or (gateway.RAZORPAY_KEY_SECRET or "___") in dumped
        or "key_secret" in dumped.lower()
        or "cvv" in dumped.lower()
    )
    report.check(
        "11. Secrets do not appear in gateway payloads",
        not secret_leak
        and attempt_c.gateway_response.get("verified") is True,
    )

    # ----------------------------------------------------------
    # 12. Simulated gateway still works without Razorpay credentials
    # ----------------------------------------------------------
    original_id = gateway.RAZORPAY_KEY_ID
    original_secret = gateway.RAZORPAY_KEY_SECRET
    try:
        gateway.RAZORPAY_KEY_ID = ""
        gateway.RAZORPAY_KEY_SECRET = ""
        sim = attempt_payment_retry(amount=1000, receipt="wh_sim")
        report.check(
            "12. Existing simulated gateway behavior still works without Razorpay credentials",
            get_gateway_mode() == MODE_SIMULATED
            and sim.success is False
            and sim.mode == MODE_SIMULATED,
            sim.error_code,
        )
    finally:
        gateway.RAZORPAY_KEY_ID = original_id
        gateway.RAZORPAY_KEY_SECRET = original_secret

    print("\n" + "=" * 72)
    print("REAL RAZORPAY WEBHOOK (optional local wiring)")
    print("=" * 72)
    print(
        "1. Set RAZORPAY_WEBHOOK_SECRET in backend/.env "
        "(Dashboard → Webhooks → Secret)."
    )
    print("2. Run API: uvicorn app.main:app --reload --port 8000")
    print(
        "3. Expose locally (only if needed): "
        "ngrok http 8000  → https://<id>.ngrok.io"
    )
    print(
        "4. Razorpay TEST webhook URL: "
        "https://<id>.ngrok.io/api/webhooks/razorpay"
    )
    print(
        "5. Subscribe to payment.captured and payment_link.paid "
        "in TEST MODE only."
    )
    print(
        "Do not use live/production credentials. "
        "Do not expose secrets in logs."
    )
    print("=" * 72)

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
