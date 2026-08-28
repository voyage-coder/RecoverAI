"""
Test RecoverAI LLM service (natural-language generation only).

Uses a simulated recovery case — does not send real messages.
"""

from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.ai import llm_service
from app.services.ai.llm_service import (
    generate_customer_message,
    is_llm_configured,
    build_fallback_message,
)


def build_simulated_case():
    customer = SimpleNamespace(
        name="Asha Verma",
        risk_tier="MEDIUM",
        payment_history_score=72,
    )

    return SimpleNamespace(
        customer=customer,
        failure_category=SimpleNamespace(value="INSUFFICIENT_FUNDS"),
        failure_reason="Not enough balance at the time of charge.",
        amount_at_risk=199900,
        selected_strategy=SimpleNamespace(value="SEND_EMAIL_REMINDER"),
    )


def assert_valid_structure(result, label: str):
    assert result is not None, f"{label}: result is None"
    assert isinstance(result.message, str) and result.message.strip(), (
        f"{label}: message missing"
    )
    assert result.tone in {
        "empathetic",
        "professional",
        "urgent",
        "friendly",
        "neutral",
    }, f"{label}: invalid tone {result.tone}"
    assert result.suggested_channel in {
        "EMAIL",
        "SMS",
        "WHATSAPP",
    }, f"{label}: invalid channel {result.suggested_channel}"
    payload = result.to_dict()
    assert set(payload.keys()) >= {
        "message",
        "tone",
        "suggested_channel",
    }
    print(f"[PASS] {label}")
    print(f"       source={result.source} tone={result.tone} "
          f"channel={result.suggested_channel}")
    print(f"       message={result.message[:120]}...")
    if result.error:
        print(f"       note={result.error}")


def main():
    print("=" * 70)
    print("RecoverAI LLM Service Test")
    print("=" * 70)

    # 1. Service initializes / imports
    assert hasattr(llm_service, "generate_customer_message")
    print("[PASS] 1. LLM service initializes")
    print(f"       configured={is_llm_configured()}")
    print(f"       model={llm_service.GEMINI_MODEL}")

    case = build_simulated_case()

    # 2 + 3. Generate for a sample strategy and validate structure
    result = generate_customer_message(
        case=case,
        strategy="SEND_EMAIL_REMINDER",
    )
    assert_valid_structure(
        result,
        "2/3. Sample recovery case message structure",
    )

    # Extra: other communication strategies also return structure
    for strategy in [
        "SEND_PAYMENT_LINK",
        "SEND_SMS_REMINDER",
        "SEND_WHATSAPP_MESSAGE",
        "OFFER_ALT_PAYMENT_METHOD",
    ]:
        item = generate_customer_message(case=case, strategy=strategy)
        assert_valid_structure(item, f"Strategy {strategy}")

    # 4. Missing API key handled safely
    original_key = llm_service.GEMINI_API_KEY
    try:
        llm_service.GEMINI_API_KEY = ""
        missing = generate_customer_message(
            case=case,
            strategy="SEND_SMS_REMINDER",
        )
        assert missing.source == "fallback"
        assert missing.error
        assert "GEMINI_API_KEY" in missing.error
        assert_valid_structure(
            missing,
            "4. Missing API key handled safely",
        )
    finally:
        llm_service.GEMINI_API_KEY = original_key

    # Fallback builder itself is usable
    fallback = build_fallback_message(case, "SEND_PAYMENT_LINK")
    assert_valid_structure(fallback, "Fallback builder")

    print("=" * 70)
    print("ALL LLM SERVICE CHECKS PASSED")
    print("=" * 70)


if __name__ == "__main__":
    main()
