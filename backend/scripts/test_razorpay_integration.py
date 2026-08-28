"""
RecoverAI Razorpay TEST MODE integration checks.

Uses Razorpay TEST credentials when present.
Otherwise runs an explicit SIMULATED TEST path.

Does not charge real customers.
Does not fabricate a Razorpay API success and call it real.
Does not send real customer communications.
"""

from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schema import (
    StrategyType,
    CaseStatus,
    ActionStatus,
    RecoveryResultStatus,
)
from app.services import payment_gateway_service as gateway
from app.services.payment_gateway_service import (
    MODE_RAZORPAY_TEST,
    MODE_SIMULATED,
    SOURCE_SIMULATED,
    attempt_payment_retry,
    create_payment_link,
    build_test_retry_result,
    get_gateway_mode,
    is_razorpay_configured,
)
from app.services.executor_service import (
    execute_retry,
    execute_communication,
)
from app.services.result_service import (
    update_recovery_result,
)


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


def _assert_no_secrets(payload) -> bool:
    text = str(payload).lower()
    secret = (gateway.RAZORPAY_KEY_SECRET or "").lower()
    blocked = ["key_secret", "rzp_test_secret", "cvv", "upi pin"]
    if secret and secret in text:
        return False
    return not any(token in text for token in blocked)


def main():
    report = Report()

    print("=" * 72)
    print("RecoverAI Razorpay Integration Test")
    print("=" * 72)

    configured = is_razorpay_configured()
    mode = get_gateway_mode()
    test_kind = (
        "REAL RAZORPAY TEST"
        if configured
        else "SIMULATED TEST"
    )
    print(f"Gateway mode: {mode}")
    print(f"Test kind:    {test_kind}")

    # ----------------------------------------------------------
    # 1. Configuration detection
    # ----------------------------------------------------------
    report.check(
        "1. Razorpay configuration detection",
        mode in {MODE_RAZORPAY_TEST, MODE_SIMULATED},
        f"configured={configured} mode={mode}",
    )

    # ----------------------------------------------------------
    # 2. Missing credentials handled safely
    # ----------------------------------------------------------
    original_id = gateway.RAZORPAY_KEY_ID
    original_secret = gateway.RAZORPAY_KEY_SECRET
    try:
        gateway.RAZORPAY_KEY_ID = ""
        gateway.RAZORPAY_KEY_SECRET = ""
        missing = attempt_payment_retry(
            amount=199900,
            receipt="missing_creds_test",
        )
        report.check(
            "2. Missing credentials handled safely",
            missing.mode == MODE_SIMULATED
            and missing.success is False
            and missing.status == "FAILED"
            and missing.error_source == SOURCE_SIMULATED,
            missing.error_description,
        )
    finally:
        gateway.RAZORPAY_KEY_ID = original_id
        gateway.RAZORPAY_KEY_SECRET = original_secret

    # ----------------------------------------------------------
    # 3. Client initialization (mocked — no live charge)
    # ----------------------------------------------------------
    with patch(
        "app.services.payment_gateway_service._get_razorpay_client"
    ) as client_factory:
        mock_client = MagicMock()
        mock_client.order.create.return_value = {
            "id": "order_test_123",
            "amount": 199900,
            "currency": "INR",
            "status": "created",
            "receipt": "rc_test",
        }
        client_factory.return_value = mock_client

        gateway.RAZORPAY_KEY_ID = "rzp_test_dummy"
        gateway.RAZORPAY_KEY_SECRET = "dummy_secret"
        try:
            init_result = attempt_payment_retry(
                amount=199900,
                receipt="client_init_test",
            )
        finally:
            gateway.RAZORPAY_KEY_ID = original_id
            gateway.RAZORPAY_KEY_SECRET = original_secret

        report.check(
            "3. Razorpay client initialization",
            client_factory.call_count == 1
            and init_result.mode == MODE_RAZORPAY_TEST,
            f"order_id={init_result.gateway_response.get('order_id')}",
        )

        # Honest: order create ≠ payment success.
        # AWAITING_CUSTOMER_PAYMENT is a non-success intermediate state.
        report.check(
            "3b. Order create does not fake payment success",
            init_result.success is False
            and init_result.status != "SUCCESS"
            and init_result.error_code == "AWAITING_CUSTOMER_PAYMENT"
            and init_result.gateway_response.get("awaiting_webhook") is True,
            init_result.error_code,
        )

    # ----------------------------------------------------------
    # 4-6. Retry gateway call success/failure (explicit helpers)
    # ----------------------------------------------------------
    success_result = build_test_retry_result(
        success=True,
        mode=MODE_SIMULATED,
    )
    fail_result = build_test_retry_result(
        success=False,
        mode=MODE_SIMULATED,
    )

    report.check(
        "4. Payment retry gateway call (success helper)",
        success_result.success is True
        and success_result.status == "SUCCESS",
        success_result.mode,
    )
    report.check(
        "5. Successful test/simulated result",
        success_result.gateway_response.get("test_helper") is True
        and success_result.mode == MODE_SIMULATED,
        "explicit SIMULATED helper — not a fabricated Razorpay claim",
    )
    report.check(
        "6. Failed test/simulated result",
        fail_result.success is False
        and fail_result.status == "FAILED",
        fail_result.error_code,
    )

    # ----------------------------------------------------------
    # 7-10. Executor + PaymentAttempt + RecoveryResult + retry_count
    # ----------------------------------------------------------
    db = MagicMock()
    order = SimpleNamespace(status="FAILED")
    payment = SimpleNamespace(
        id="pay_sim_1",
        amount=199900,
        currency="INR",
        failure_code="GATEWAY_TIMEOUT",
        failure_reason="Timeout",
        status="FAILED",
        order=order,
    )
    case = SimpleNamespace(
        id="case_sim_1",
        case_number="RC-SIM-001",
        payment_id=payment.id,
        amount_at_risk=199900,
        retry_count=0,
        contact_count=0,
        status=CaseStatus.IN_PROGRESS,
        current_step="Action Scheduled",
        customer=SimpleNamespace(
            name="Asha Verma",
            email="asha@example.com",
            phone="9999999999",
        ),
    )
    action = SimpleNamespace(
        id="act_sim_1",
        action_type=StrategyType.RETRY_AFTER_DELAY,
        case_id=case.id,
        status=ActionStatus.PROCESSING,
    )

    db.scalar.return_value = payment

    with patch(
        "app.services.executor_service.attempt_payment_retry",
        return_value=fail_result,
    ):
        text = execute_retry(db=db, case=case, action=action)

    attempt_obj = db.add.call_args[0][0]
    report.check(
        "7. PaymentAttempt creation",
        attempt_obj.status == "FAILED"
        and attempt_obj.payment_id == payment.id
        and attempt_obj.attempt_number == 1
        and attempt_obj.error_source == SOURCE_SIMULATED,
        f"status={attempt_obj.status}",
    )

    # RecoveryResult update via result_service with in-memory objects
    result_holder = SimpleNamespace(
        id=str(uuid4()),
        case_id=case.id,
        original_amount=case.amount_at_risk,
        recovered_amount=0,
        status=RecoveryResultStatus.PENDING,
        recovery_method=None,
        recovered_at=None,
    )

    def fake_scalar(stmt):
        return result_holder

    db2 = MagicMock()
    db2.scalar.side_effect = fake_scalar
    updated = update_recovery_result(
        db=db2,
        case=case,
        action=action,
        recovered_amount=0,
    )
    report.check(
        "8. RecoveryResult update",
        updated.status == RecoveryResultStatus.NOT_RECOVERED
        and updated.recovered_amount == 0,
        updated.status.value,
    )

    report.check(
        "9. retry_count increments only for payment retries",
        case.retry_count == 1
        and case.contact_count == 0
        and "failed" in text.lower(),
        f"retry_count={case.retry_count} contact_count={case.contact_count}",
    )

    # Recovery loop continuation after failure is owned by execute_action.
    # Verify the branch condition remains valid for NOT_RECOVERED + IN_PROGRESS.
    report.check(
        "10. Recovery Loop can continue after failure",
        case.status == CaseStatus.IN_PROGRESS
        and updated.status == RecoveryResultStatus.NOT_RECOVERED,
        "case still IN_PROGRESS after failed retry",
    )

    # ----------------------------------------------------------
    # 11. No secrets in gateway payloads / logs
    # ----------------------------------------------------------
    report.check(
        "11. No Razorpay secrets in gateway payloads",
        _assert_no_secrets(attempt_obj.gateway_response)
        and _assert_no_secrets(fail_result.gateway_response)
        and _assert_no_secrets(success_result.gateway_response),
    )

    # ----------------------------------------------------------
    # 12. Communication strategies do NOT call Razorpay retry
    # ----------------------------------------------------------
    db3 = MagicMock()
    case3 = SimpleNamespace(
        id="case_sim_2",
        case_number="RC-SIM-002",
        payment_id="pay_sim_2",
        amount_at_risk=50000,
        retry_count=2,
        contact_count=0,
        status=CaseStatus.IN_PROGRESS,
        current_step="Action Scheduled",
        customer=SimpleNamespace(
            name="Asha",
            email="asha@example.com",
            phone="9999999999",
        ),
    )
    action3 = SimpleNamespace(
        action_type=StrategyType.SEND_EMAIL_REMINDER,
    )
    fake_llm = SimpleNamespace(
        message="Please complete your payment.",
        tone="professional",
        suggested_channel="EMAIL",
        source="fallback",
        error=None,
    )

    with patch(
        "app.services.executor_service.generate_customer_message",
        return_value=fake_llm,
    ), patch(
        "app.services.executor_service.attempt_payment_retry"
    ) as retry_mock, patch(
        "app.services.executor_service.create_payment_link"
    ) as link_mock:
        execute_communication(db=db3, case=case3, action=action3)
        report.check(
            "12. Communication strategies do NOT call Razorpay retry",
            retry_mock.call_count == 0
            and link_mock.call_count == 0
            and case3.retry_count == 2
            and case3.contact_count == 1,
            f"contact_count={case3.contact_count}",
        )

    # ----------------------------------------------------------
    # 13. Gemini communication path unchanged + payment link append
    # ----------------------------------------------------------
    db4 = MagicMock()
    payment4 = SimpleNamespace(
        id="pay_sim_3",
        amount=199900,
        currency="INR",
    )
    case4 = SimpleNamespace(
        id="case_sim_3",
        case_number="RC-SIM-003",
        payment_id=payment4.id,
        amount_at_risk=199900,
        retry_count=0,
        contact_count=0,
        status=CaseStatus.IN_PROGRESS,
        current_step="Action Scheduled",
        customer=SimpleNamespace(
            name="Asha",
            email="asha@example.com",
            phone="9999999999",
        ),
    )
    action4 = SimpleNamespace(
        action_type=StrategyType.SEND_PAYMENT_LINK,
    )

    def scalar_side_effect(stmt):
        return payment4

    db4.scalar.side_effect = scalar_side_effect

    link = create_payment_link(
        amount=199900,
        description="test",
        customer_name="Asha",
    )

    with patch(
        "app.services.executor_service.generate_customer_message",
        return_value=fake_llm,
    ), patch(
        "app.services.executor_service.create_payment_link",
        return_value=link,
    ) as link_mock, patch(
        "app.services.executor_service.attempt_payment_retry"
    ) as retry_mock:
        text4 = execute_communication(
            db=db4,
            case=case4,
            action=action4,
        )
        stored = db4.add.call_args[0][0]
        report.check(
            "13. Gemini communication path remains unchanged",
            retry_mock.call_count == 0
            and link_mock.call_count == 1
            and fake_llm.message in stored.content
            and (link.payment_link_url or "") in stored.content
            and "communication sent" in text4.lower(),
            f"link_mode={link.mode}",
        )

    # ----------------------------------------------------------
    # Bonus: default retry must never fabricate SUCCESS.
    # Distinguish:
    #   FAILED                  — simulated / API decline
    #   AWAITING_CUSTOMER_PAYMENT — order created, not paid yet
    #   SUCCESS / RECOVERED     — only after verified webhook
    # No live Razorpay calls here when credentials exist.
    # ----------------------------------------------------------
    if configured:
        with patch(
            "app.services.payment_gateway_service._get_razorpay_client"
        ) as client_factory:
            mock_client = MagicMock()
            mock_client.order.create.return_value = {
                "id": "order_default_bonus",
                "amount": 1000,
                "currency": "INR",
                "status": "created",
                "receipt": "default_retry_bonus",
            }
            client_factory.return_value = mock_client
            default_retry = attempt_payment_retry(
                amount=1000,
                receipt="default_retry_bonus",
            )

        non_success_ok = (
            default_retry.success is False
            and default_retry.status != "SUCCESS"
            and default_retry.error_code == "AWAITING_CUSTOMER_PAYMENT"
            and default_retry.gateway_response.get("awaiting_webhook")
            is True
            and default_retry.mode == MODE_RAZORPAY_TEST
        )
        detail = (
            f"mode={default_retry.mode} "
            f"success={default_retry.success} "
            f"status={default_retry.status} "
            f"error_code={default_retry.error_code}"
        )
    else:
        default_retry = attempt_payment_retry(
            amount=1000,
            receipt="default_retry_bonus",
        )
        non_success_ok = (
            default_retry.success is False
            and default_retry.status == "FAILED"
            and default_retry.mode == MODE_SIMULATED
            and default_retry.error_code == "SIMULATED_DECLINE"
        )
        detail = (
            f"mode={default_retry.mode} "
            f"error_code={default_retry.error_code}"
        )

    report.check(
        "Bonus: default retry does not fake payment success",
        non_success_ok,
        detail,
    )

    # Intermediate awaiting must not be treated as recovered.
    awaiting_not_recovered = (
        default_retry.success is False
        and default_retry.status != "SUCCESS"
        and default_retry.error_code
        in {"AWAITING_CUSTOMER_PAYMENT", "SIMULATED_DECLINE"}
    )
    report.check(
        "Bonus: awaiting/failed retry is not RECOVERED without webhook",
        awaiting_not_recovered,
        (
            "RECOVERED requires verified Razorpay webhook; "
            "order create alone is non-success"
        ),
    )

    print("\n" + "=" * 72)
    print(f"TEST KIND: {test_kind}")
    if configured:
        print(
            "Credentials detected. Live order/link calls were still "
            "mocked in this script to avoid accidental charges."
        )
        print(
            "AWAITING_CUSTOMER_PAYMENT is a valid non-success "
            "intermediate state. Only a verified webhook may mark "
            "RECOVERED."
        )
    else:
        print(
            "No Razorpay TEST credentials in env. "
            "Ran SIMULATED TEST path only."
        )
    print("=" * 72)

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
