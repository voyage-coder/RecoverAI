"""
RecoverAI LLM service — natural-language generation only.

Provider: Google Gemini

ML ranks strategies. Safety Engine approves them.
This service only drafts customer communication copy.

It must never:
- select strategies
- bypass Safety Engine
- change retry_count / contact_count / RecoveryResult / case status
- execute payments or call Razorpay
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


# ============================================================
# CONFIG
# ============================================================

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-2.0-flash",
).strip()
GEMINI_TIMEOUT_SECONDS = float(
    os.getenv("GEMINI_TIMEOUT_SECONDS", "20")
)

COMMUNICATION_STRATEGIES = {
    "SEND_PAYMENT_LINK",
    "SEND_EMAIL_REMINDER",
    "SEND_SMS_REMINDER",
    "SEND_WHATSAPP_MESSAGE",
    "OFFER_ALT_PAYMENT_METHOD",
}

CHANNEL_BY_STRATEGY = {
    "SEND_PAYMENT_LINK": "EMAIL",
    "SEND_EMAIL_REMINDER": "EMAIL",
    "SEND_SMS_REMINDER": "SMS",
    "SEND_WHATSAPP_MESSAGE": "WHATSAPP",
    "OFFER_ALT_PAYMENT_METHOD": "EMAIL",
}

VALID_TONES = {
    "empathetic",
    "professional",
    "urgent",
    "friendly",
    "neutral",
}

VALID_CHANNELS = {
    "EMAIL",
    "SMS",
    "WHATSAPP",
}


# ============================================================
# RESULT
# ============================================================

@dataclass
class LLMMessageResult:
    message: str
    tone: str
    suggested_channel: str
    source: str = "llm"  # llm | fallback
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "message": self.message,
            "tone": self.tone,
            "suggested_channel": self.suggested_channel,
            "source": self.source,
            "error": self.error,
        }


# ============================================================
# HELPERS
# ============================================================

def is_llm_configured() -> bool:
    return bool(GEMINI_API_KEY)


def _strategy_value(strategy: Any) -> str:
    if strategy is None:
        return ""
    if hasattr(strategy, "value"):
        return str(strategy.value)
    return str(strategy)


def _format_amount_inr(paise: int | None) -> str:
    if paise is None:
        return "your outstanding amount"

    try:
        rupees = int(paise) / 100
    except (TypeError, ValueError):
        return "your outstanding amount"

    return f"₹{rupees:,.0f}"


def _customer_name(case: Any) -> str:
    customer = getattr(case, "customer", None)
    name = getattr(customer, "name", None) if customer else None
    return name or "there"


def _failure_category(case: Any) -> str:
    category = getattr(case, "failure_category", None)
    if category is None:
        return "PAYMENT_FAILURE"
    if hasattr(category, "value"):
        return str(category.value)
    return str(category)


def build_fallback_message(
    case: Any,
    strategy: Any,
) -> LLMMessageResult:
    """
    Deterministic copy used when the LLM is unavailable.
    Keeps recovery flowing without crashing.
    """

    strategy_name = _strategy_value(strategy)
    channel = CHANNEL_BY_STRATEGY.get(strategy_name, "EMAIL")
    name = _customer_name(case)
    amount = _format_amount_inr(
        getattr(case, "amount_at_risk", None)
    )
    failure = _failure_category(case).replace("_", " ").title()

    if strategy_name == "SEND_PAYMENT_LINK":
        message = (
            f"Hi {name}, we couldn't complete your recent payment "
            f"({failure}) for {amount}. Please use the secure payment "
            f"link to finish the payment at your convenience."
        )
    elif strategy_name == "OFFER_ALT_PAYMENT_METHOD":
        message = (
            f"Hi {name}, your recent payment of {amount} could not be "
            f"processed due to {failure}. You can complete it using an "
            f"alternative payment method."
        )
    elif strategy_name == "SEND_EMAIL_REMINDER":
        message = (
            f"Hi {name}, this is a reminder that your payment of {amount} "
            f"could not be completed ({failure}). Please retry when ready."
        )
    elif strategy_name == "SEND_SMS_REMINDER":
        message = (
            f"Hi {name}, reminder: payment of {amount} is still pending "
            f"({failure}). Please complete it when ready."
        )
    elif strategy_name == "SEND_WHATSAPP_MESSAGE":
        message = (
            f"Hi {name}, quick reminder about your pending payment of "
            f"{amount}. Reason noted: {failure}. Reply if you need help."
        )
    else:
        message = (
            f"Hi {name}, we were unable to complete your recent payment "
            f"of {amount}. Please try again when convenient."
        )

    return LLMMessageResult(
        message=message,
        tone="professional",
        suggested_channel=channel,
        source="fallback",
    )


def _build_prompt_context(
    case: Any,
    strategy: Any,
) -> dict[str, Any]:
    strategy_name = _strategy_value(strategy)

    # Customer-facing context only.
    # Do not include AI confidence, recovery probability,
    # safety rules, ranking scores, or database IDs.
    return {
        "customer_name": _customer_name(case),
        "failure_category": _failure_category(case),
        "failure_reason": getattr(case, "failure_reason", None),
        "amount_display": _format_amount_inr(
            getattr(case, "amount_at_risk", None)
        ),
        "selected_strategy": strategy_name,
        "communication_channel": CHANNEL_BY_STRATEGY.get(
            strategy_name,
            "EMAIL",
        ),
    }


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Parse JSON from Gemini text, including fenced code blocks."""

    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        payload = json.loads(cleaned)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        return None

    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    if isinstance(payload, dict):
        return payload

    return None


def _validate_llm_payload(
    payload: dict[str, Any],
    strategy_name: str,
) -> LLMMessageResult | None:
    message = payload.get("message")
    tone = str(payload.get("tone", "professional")).strip().lower()
    channel = str(
        payload.get(
            "suggested_channel",
            CHANNEL_BY_STRATEGY.get(strategy_name, "EMAIL"),
        )
    ).strip().upper()

    if not isinstance(message, str) or not message.strip():
        return None

    if tone not in VALID_TONES:
        tone = "professional"

    if channel not in VALID_CHANNELS:
        channel = CHANNEL_BY_STRATEGY.get(strategy_name, "EMAIL")

    return LLMMessageResult(
        message=message.strip(),
        tone=tone,
        suggested_channel=channel,
        source="llm",
    )


# ============================================================
# PUBLIC API
# ============================================================

def generate_customer_message(
    case: Any,
    strategy: Any,
) -> LLMMessageResult:
    """
    Generate personalized customer communication copy via Gemini.

    Returns a structured result. On any failure, returns a safe
    fallback message so the recovery pipeline can continue.
    """

    strategy_name = _strategy_value(strategy)

    if strategy_name not in COMMUNICATION_STRATEGIES:
        fallback = build_fallback_message(case, strategy)
        fallback.error = (
            f"Strategy {strategy_name} is not a communication strategy."
        )
        return fallback

    if not is_llm_configured():
        fallback = build_fallback_message(case, strategy)
        fallback.error = "GEMINI_API_KEY is missing."
        return fallback

    context = _build_prompt_context(case, strategy)

    prompt = (
        "You write concise, professional payment-recovery messages "
        "for RecoverAI.\n"
        "You only generate message text.\n"
        "You must not choose payment strategies, approve actions, "
        "mention internal risk scores bluntly, threaten the customer, "
        "or invent payment links/URLs.\n"
        "Return strict JSON only with keys: "
        "message, tone, suggested_channel.\n"
        "tone must be one of: empathetic, professional, urgent, "
        "friendly, neutral.\n"
        "suggested_channel must be one of: EMAIL, SMS, WHATSAPP.\n\n"
        "Create a short customer message for this recovery context:\n"
        f"{json.dumps(context, ensure_ascii=True)}\n\n"
        "Keep SMS/WhatsApp under 280 characters when those channels "
        "are preferred. Be polite and clear."
    )

    try:
        from google import genai
        from google.genai import types

        timeout_ms = int(GEMINI_TIMEOUT_SECONDS * 1000)

        client = genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=types.HttpOptions(
                timeout=timeout_ms,
            ),
        )

        # Plain content generation only.
        # Disable automatic function calling (AFC) / tools —
        # RecoverAI does not use function calling for messages.
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.4,
                response_mime_type="application/json",
                tools=None,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True,
                ),
            ),
        )

        content = getattr(response, "text", None)

        if not content:
            fallback = build_fallback_message(case, strategy)
            fallback.error = "Gemini returned an empty response."
            return fallback

        payload = _extract_json_object(content)

        if payload is None:
            fallback = build_fallback_message(case, strategy)
            fallback.error = "Gemini returned invalid JSON."
            return fallback

        validated = _validate_llm_payload(payload, strategy_name)

        if validated is None:
            fallback = build_fallback_message(case, strategy)
            fallback.error = "Gemini response failed validation."
            return fallback

        return validated

    except Exception as exc:
        # Covers missing package, auth errors, timeouts (e.g. 504),
        # quota exhaustion (429 RESOURCE_EXHAUSTED), and other API
        # failures. Single attempt only — no aggressive retries.
        logger.warning(
            "Gemini generation failed; using fallback. error=%s",
            exc,
        )
        fallback = build_fallback_message(case, strategy)
        fallback.error = str(exc)
        return fallback
