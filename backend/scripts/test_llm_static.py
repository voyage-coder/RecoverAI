"""
Static checks for Gemini LLM wiring.

Does NOT call the live Gemini API.
"""

from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.genai import types

from app.services.ai import llm_service
from app.services.ai.llm_service import (
    generate_customer_message,
)


def main():
    print("=" * 70)
    print("RecoverAI LLM static checks (no live Gemini calls)")
    print("=" * 70)

    # 1. No deprecated SDK imports in llm_service source
    source = Path(llm_service.__file__).read_text(encoding="utf-8")
    deprecated = "google" + ".generativeai"
    deprecated_pkg = "google" + "-generativeai"
    assert deprecated not in source
    assert deprecated_pkg not in source
    assert "from google import genai" in source
    print("[PASS] Deprecated Gemini SDK import absent from llm_service.py")

    # 2. Missing key uses fallback without calling Client
    original_key = llm_service.GEMINI_API_KEY
    try:
        llm_service.GEMINI_API_KEY = ""
        with patch("google.genai.Client") as client_cls:
            result = generate_customer_message(
                case=SimpleNamespace(
                    customer=SimpleNamespace(name="Asha"),
                    failure_category=SimpleNamespace(value="CARD_DECLINED"),
                    failure_reason="Card declined",
                    amount_at_risk=50000,
                ),
                strategy="SEND_EMAIL_REMINDER",
            )
            assert client_cls.call_count == 0
            assert result.source == "fallback"
            assert "GEMINI_API_KEY" in (result.error or "")
        print("[PASS] Missing GEMINI_API_KEY uses fallback (no Client call)")
    finally:
        llm_service.GEMINI_API_KEY = original_key

    # 3. Non-communication strategy never creates Client
    with patch("google.genai.Client") as client_cls:
        llm_service.GEMINI_API_KEY = original_key or "dummy"
        try:
            result = generate_customer_message(
                case=SimpleNamespace(
                    customer=SimpleNamespace(name="Asha"),
                    failure_category=SimpleNamespace(value="GATEWAY_TIMEOUT"),
                    failure_reason="Timeout",
                    amount_at_risk=10000,
                ),
                strategy="RETRY_AFTER_DELAY",
            )
        finally:
            llm_service.GEMINI_API_KEY = original_key

        assert client_cls.call_count == 0
        assert result.source == "fallback"
        print("[PASS] RETRY_AFTER_DELAY does not create Gemini Client")

    # 4. When Gemini path is taken, AFC is explicitly disabled
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = (
        '{"message":"Hi Asha, please retry your payment.",'
        '"tone":"professional","suggested_channel":"EMAIL"}'
    )
    mock_client.models.generate_content.return_value = mock_response

    with patch("google.genai.Client", return_value=mock_client) as client_cls:
        llm_service.GEMINI_API_KEY = original_key or "dummy"
        try:
            result = generate_customer_message(
                case=SimpleNamespace(
                    customer=SimpleNamespace(name="Asha"),
                    failure_category=SimpleNamespace(value="INSUFFICIENT_FUNDS"),
                    failure_reason="Low balance",
                    amount_at_risk=199900,
                ),
                strategy="SEND_PAYMENT_LINK",
            )
        finally:
            llm_service.GEMINI_API_KEY = original_key

        assert client_cls.call_count == 1
        assert mock_client.models.generate_content.call_count == 1
        kwargs = mock_client.models.generate_content.call_args.kwargs
        config = kwargs["config"]
        assert isinstance(config, types.GenerateContentConfig)
        assert config.tools is None
        assert config.automatic_function_calling is not None
        assert config.automatic_function_calling.disable is True
        assert result.source == "llm"
        assert result.message
        print("[PASS] generate_content uses AFC disable=True and tools=None")

    # 5. Simulated 429 RESOURCE_EXHAUSTED -> single fallback, no retry
    mock_client_429 = MagicMock()
    mock_client_429.models.generate_content.side_effect = Exception(
        "429 RESOURCE_EXHAUSTED"
    )

    with patch("google.genai.Client", return_value=mock_client_429):
        llm_service.GEMINI_API_KEY = original_key or "dummy"
        try:
            result = generate_customer_message(
                case=SimpleNamespace(
                    customer=SimpleNamespace(name="Asha"),
                    failure_category=SimpleNamespace(value="CARD_DECLINED"),
                    failure_reason="Declined",
                    amount_at_risk=25000,
                ),
                strategy="SEND_SMS_REMINDER",
            )
        finally:
            llm_service.GEMINI_API_KEY = original_key

        assert mock_client_429.models.generate_content.call_count == 1
        assert result.source == "fallback"
        assert "429" in (result.error or "")
        print("[PASS] 429 RESOURCE_EXHAUSTED falls back once (no retries)")

    print("=" * 70)
    print("ALL STATIC CHECKS PASSED")
    print("=" * 70)


if __name__ == "__main__":
    main()
