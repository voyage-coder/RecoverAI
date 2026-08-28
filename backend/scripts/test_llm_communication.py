"""
RecoverAI LLM ↔ communication executor integration tests.

Simulated case only. Does not send real customer messages.
Does not modify database recovery data.
"""

from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schema import (
    StrategyType,
    CommunicationChannel,
)
from app.services.ai import llm_service
from app.services.ai.llm_service import (
    COMMUNICATION_STRATEGIES,
    generate_customer_message,
)
from app.services.executor_service import (
    execute_communication,
)


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name: str, passed: bool, detail: str = ""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        suffix = f" — {detail}" if detail else ""
        print(f"[{status}] {name}{suffix}")
        return passed

    def summary(self):
        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)
        passed = sum(1 for s, _, _ in self.rows if s == "PASS")
        failed = sum(1 for s, _, _ in self.rows if s == "FAIL")
        for status, name, detail in self.rows:
            line = f"{status:4}  {name}"
            if detail:
                line += f"  ({detail})"
            print(line)
        print("-" * 70)
        print(f"TOTAL  PASS={passed}  FAIL={failed}")
        return failed == 0


def build_simulated_case():
    customer = SimpleNamespace(
        name="Asha Verma",
        risk_tier="MEDIUM",
        payment_history_score=72,
    )

    return SimpleNamespace(
        id="sim-case-001",
        customer=customer,
        failure_category=SimpleNamespace(value="INSUFFICIENT_FUNDS"),
        failure_reason="Not enough balance at the time of charge.",
        amount_at_risk=199900,
        selected_strategy=SimpleNamespace(value="SEND_EMAIL_REMINDER"),
        contact_count=0,
        retry_count=1,
        current_step="Action Scheduled",
        recovery_probability=81,
        ai_confidence=77,
    )


def build_action(strategy: StrategyType):
    return SimpleNamespace(
        id="sim-action-001",
        case_id="sim-case-001",
        action_type=strategy,
        status="PENDING",
        attempt_number=1,
    )


def main():
    report = Report()
    case = build_simulated_case()

    print("=" * 70)
    print("RecoverAI LLM Communication Integration Test")
    print("=" * 70)

    communication_strategies = [
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.SEND_SMS_REMINDER,
        StrategyType.SEND_WHATSAPP_MESSAGE,
        StrategyType.OFFER_ALT_PAYMENT_METHOD,
    ]

    # ----------------------------------------------------------
    # 1-5. Communication strategies generate messages
    # ----------------------------------------------------------

    for strategy in communication_strategies:
        result = generate_customer_message(
            case=case,
            strategy=strategy,
        )

        sensitive_leaks = any(
            token in result.message.lower()
            for token in [
                "ai confidence",
                "recovery_probability",
                "sim-case-001",
                "safety engine",
                "ranking",
            ]
        )

        report.check(
            f"{strategy.value} generates a message",
            bool(result.message)
            and result.suggested_channel in {"EMAIL", "SMS", "WHATSAPP"}
            and strategy.value in COMMUNICATION_STRATEGIES
            and not sensitive_leaks,
            f"source={result.source} channel={result.suggested_channel}",
        )

    # ----------------------------------------------------------
    # 6. RETRY_AFTER_DELAY must NOT call Gemini
    # ----------------------------------------------------------

    with patch(
        "google.genai.Client",
        create=True,
    ) as client_mock:
        # Force configured=True so a bug would attempt Gemini.
        original_key = llm_service.GEMINI_API_KEY
        llm_service.GEMINI_API_KEY = original_key or "test-key-should-not-call"

        try:
            retry_result = generate_customer_message(
                case=case,
                strategy=StrategyType.RETRY_AFTER_DELAY,
            )
        finally:
            llm_service.GEMINI_API_KEY = original_key

        report.check(
            "RETRY_AFTER_DELAY does NOT call Gemini",
            client_mock.call_count == 0
            and retry_result.source == "fallback",
            retry_result.error or "no Gemini call",
        )

    # Also ensure other non-communication strategies skip Gemini
    for strategy in [
        StrategyType.IMMEDIATE_RETRY,
        StrategyType.HUMAN_ESCALATION,
        StrategyType.STOP_RECOVERY,
    ]:
        with patch(
            "google.genai.Client",
            create=True,
        ) as client_mock:
            original_key = llm_service.GEMINI_API_KEY
            llm_service.GEMINI_API_KEY = original_key or "test-key"
            try:
                generate_customer_message(case=case, strategy=strategy)
            finally:
                llm_service.GEMINI_API_KEY = original_key

            report.check(
                f"{strategy.value} does NOT call Gemini",
                client_mock.call_count == 0,
            )

    # ----------------------------------------------------------
    # 7. Missing GEMINI_API_KEY uses fallback
    # ----------------------------------------------------------

    original_key = llm_service.GEMINI_API_KEY
    try:
        llm_service.GEMINI_API_KEY = ""
        missing = generate_customer_message(
            case=case,
            strategy=StrategyType.SEND_SMS_REMINDER,
        )
        report.check(
            "Missing GEMINI_API_KEY uses fallback",
            missing.source == "fallback"
            and "GEMINI_API_KEY" in (missing.error or "")
            and bool(missing.message),
            missing.error,
        )
    finally:
        llm_service.GEMINI_API_KEY = original_key

    # ----------------------------------------------------------
    # 8. Executor continues successfully when Gemini fails
    # ----------------------------------------------------------

    db = MagicMock()
    action = build_action(StrategyType.SEND_EMAIL_REMINDER)
    case.contact_count = 0

    with patch(
        "app.services.executor_service.generate_customer_message",
        side_effect=RuntimeError("simulated Gemini outage"),
    ):
        result_text = execute_communication(
            db=db,
            case=case,
            action=action,
        )

    report.check(
        "Executor continues successfully when Gemini fails",
        isinstance(result_text, str)
        and "communication sent" in result_text.lower()
        and case.contact_count == 1
        and case.current_step == "Customer Contacted"
        and db.add.called,
        result_text,
    )

    # Communication content was still created (fallback text)
    communication_obj = db.add.call_args[0][0]
    report.check(
        "Executor stores fallback communication content",
        hasattr(communication_obj, "content")
        and bool(communication_obj.content)
        and communication_obj.channel == CommunicationChannel.EMAIL,
        f"channel={communication_obj.channel.value}",
    )

    # ----------------------------------------------------------
    # Bonus: happy-path executor with mocked LLM success
    # ----------------------------------------------------------

    db2 = MagicMock()
    case2 = build_simulated_case()
    action2 = build_action(StrategyType.SEND_WHATSAPP_MESSAGE)

    fake_llm = SimpleNamespace(
        message="Hi Asha, please complete your pending payment.",
        tone="friendly",
        suggested_channel="WHATSAPP",
        source="llm",
        error=None,
    )

    with patch(
        "app.services.executor_service.generate_customer_message",
        return_value=fake_llm,
    ):
        text = execute_communication(
            db=db2,
            case=case2,
            action=action2,
        )

    stored = db2.add.call_args[0][0]
    report.check(
        "Executor uses LLM message for communication strategies",
        stored.content == fake_llm.message
        and stored.channel == CommunicationChannel.WHATSAPP
        and "WHATSAPP" in text,
        text,
    )

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
