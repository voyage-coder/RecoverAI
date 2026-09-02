"""
RecoverAI payment gateway abstraction.

Supports:
- Razorpay TEST MODE when credentials are configured
- SIMULATED_GATEWAY fallback when credentials are missing

Never hardcodes secrets.
Never marks a payment recovered without a genuine gateway success outcome.
Never uses Razorpay LIVE credentials.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


# ============================================================
# CONFIG
# ============================================================

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
# Webhook signing secret (Dashboard → Webhooks). Not the API key secret.
RAZORPAY_WEBHOOK_SECRET = os.getenv(
    "RAZORPAY_WEBHOOK_SECRET",
    "",
).strip()

MODE_RAZORPAY_TEST = "RAZORPAY_TEST"
MODE_SIMULATED = "SIMULATED_GATEWAY"

SOURCE_RAZORPAY = "RAZORPAY_TEST"
SOURCE_SIMULATED = "SIMULATED_GATEWAY"


def is_webhook_secret_configured() -> bool:
    if RAZORPAY_WEBHOOK_SECRET:
        return True
    try:
        from app.database import SessionLocal
        from app.services.merchant_settings_service import stored_credentials

        db = SessionLocal()
        try:
            _, _, webhook = stored_credentials(db)
            return bool(webhook)
        finally:
            db.close()
    except Exception:
        return False


def _stored_api_keys() -> tuple[str, str]:
    try:
        from app.database import SessionLocal
        from app.services.merchant_settings_service import stored_credentials

        db = SessionLocal()
        try:
            key_id, key_secret, _ = stored_credentials(db)
            return key_id, key_secret
        finally:
            db.close()
    except Exception:
        return "", ""


def _active_key_id() -> str:
    stored_id, _ = _stored_api_keys()
    return stored_id or RAZORPAY_KEY_ID


def _active_key_secret() -> str:
    _, stored_secret = _stored_api_keys()
    return stored_secret or RAZORPAY_KEY_SECRET


# ============================================================
# RESULT TYPES
# ============================================================

@dataclass
class GatewayRetryResult:
    success: bool
    status: str  # SUCCESS | FAILED
    error_code: str | None = None
    error_description: str | None = None
    error_source: str = SOURCE_SIMULATED
    mode: str = MODE_SIMULATED
    gateway_response: dict[str, Any] = field(default_factory=dict)


@dataclass
class GatewayPaymentLinkResult:
    success: bool
    payment_link_url: str | None = None
    error_code: str | None = None
    error_description: str | None = None
    error_source: str = SOURCE_SIMULATED
    mode: str = MODE_SIMULATED
    gateway_response: dict[str, Any] = field(default_factory=dict)


# ============================================================
# CONFIG HELPERS
# ============================================================

def is_razorpay_configured() -> bool:
    """True when both TEST credentials are present (env or merchant store)."""

    key_id = _active_key_id()
    key_secret = _active_key_secret()

    if not key_id or not key_secret:
        return False

    # Refuse live credentials — RecoverAI uses TEST MODE only.
    if key_id.startswith("rzp_live_"):
        logger.warning(
            "RAZORPAY_KEY_ID looks like a LIVE key. "
            "RecoverAI will use SIMULATED_GATEWAY instead."
        )
        return False

    return True


def get_gateway_mode() -> str:
    if is_razorpay_configured():
        return MODE_RAZORPAY_TEST
    return MODE_SIMULATED


def _safe_gateway_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """
    Keep only non-sensitive gateway metadata for storage/debug.
    Never persist secrets, cards, CVV, UPI PIN, or bank credentials.
    """

    if not payload:
        return {}

    blocked = {
        "card",
        "cvv",
        "cvc",
        "upi",
        "pin",
        "password",
        "secret",
        "key_secret",
        "bank_account",
        "account_number",
    }

    safe: dict[str, Any] = {}

    for key, value in payload.items():
        key_l = str(key).lower()
        if any(token in key_l for token in blocked):
            continue
        if isinstance(value, dict):
            safe[key] = _safe_gateway_payload(value)
        else:
            safe[key] = value

    return safe


def get_razorpay_public_key_id() -> str:
    """TEST key id only — never the secret."""
    return _active_key_id()


def _get_razorpay_client():
    import razorpay

    return razorpay.Client(
        auth=(_active_key_id(), _active_key_secret())
    )


# ============================================================
# PAYMENT RETRY
# ============================================================

def attempt_payment_retry(
    *,
    amount: int,
    currency: str = "INR",
    receipt: str | None = None,
    notes: dict[str, Any] | None = None,
    failure_code: str | None = None,
    failure_reason: str | None = None,
) -> GatewayRetryResult:
    """
    Attempt a recovery payment retry through the gateway.

    Razorpay TEST MODE:
      Creates a Razorpay Order. Order creation proves the gateway
      connection, but does NOT mean the customer payment succeeded.
      Without a customer checkout / verified webhook, the attempt
      remains FAILED and Recovery Loop may continue.

    SIMULATED_GATEWAY:
      Deterministic failed retry (never a silent fake success).

    Webhook verification for marking RECOVERED is the next step
    and is intentionally not faked here.
    """

    receipt = receipt or f"recoverai_{uuid4().hex[:12]}"
    notes = notes or {}

    if not is_razorpay_configured():
        return GatewayRetryResult(
            success=False,
            status="FAILED",
            error_code=failure_code or "SIMULATED_DECLINE",
            error_description=(
                failure_reason
                or "Simulated payment retry failed (no Razorpay credentials)."
            ),
            error_source=SOURCE_SIMULATED,
            mode=MODE_SIMULATED,
            gateway_response={
                "mode": MODE_SIMULATED,
                "simulated": True,
                "reason": "RAZORPAY_CREDENTIALS_MISSING",
                "receipt": receipt,
            },
        )

    try:
        client = _get_razorpay_client()

        order = client.order.create(
            {
                "amount": int(amount),
                "currency": currency or "INR",
                "receipt": receipt[:40],
                "payment_capture": 1,
                "notes": {
                    "source": "RecoverAI",
                    "purpose": "payment_retry",
                    **{
                        str(k): str(v)[:100]
                        for k, v in notes.items()
                    },
                },
            }
        )

        # Honest outcome: order created ≠ payment captured.
        return GatewayRetryResult(
            success=False,
            status="FAILED",
            error_code="AWAITING_CUSTOMER_PAYMENT",
            error_description=(
                "Razorpay TEST order created. Payment is not recovered "
                "until the customer completes checkout and a verified "
                "webhook confirms capture."
            ),
            error_source=SOURCE_RAZORPAY,
            mode=MODE_RAZORPAY_TEST,
            gateway_response={
                "mode": MODE_RAZORPAY_TEST,
                "operation": "order.create",
                "order_id": order.get("id"),
                "amount": order.get("amount"),
                "currency": order.get("currency"),
                "status": order.get("status"),
                "receipt": order.get("receipt"),
                "awaiting_webhook": True,
            },
        )

    except Exception as exc:
        # Do not convert Razorpay API failures into fake successes.
        logger.warning(
            "Razorpay retry failed; recording FAILED attempt. error=%s",
            type(exc).__name__,
        )
        return GatewayRetryResult(
            success=False,
            status="FAILED",
            error_code="RAZORPAY_API_ERROR",
            error_description=str(exc)[:300],
            error_source=SOURCE_RAZORPAY,
            mode=MODE_RAZORPAY_TEST,
            gateway_response={
                "mode": MODE_RAZORPAY_TEST,
                "operation": "order.create",
                "error_type": type(exc).__name__,
            },
        )


# ============================================================
# PAYMENT LINK
# ============================================================

def create_payment_link(
    *,
    amount: int,
    currency: str = "INR",
    description: str | None = None,
    customer_name: str | None = None,
    customer_email: str | None = None,
    customer_contact: str | None = None,
    notes: dict[str, Any] | None = None,
    expire_by: int | None = None,
) -> GatewayPaymentLinkResult:
    """
    Create a payment link for SEND_PAYMENT_LINK strategies.

    Razorpay owns the URL. Gemini only writes surrounding copy.
    """

    notes = notes or {}
    description = description or "RecoverAI payment recovery"

    if not is_razorpay_configured():
        simulated_id = uuid4().hex[:10]
        return GatewayPaymentLinkResult(
            success=True,
            payment_link_url=(
                f"https://simulated.recoverai.local/pay/{simulated_id}"
            ),
            error_source=SOURCE_SIMULATED,
            mode=MODE_SIMULATED,
            gateway_response={
                "mode": MODE_SIMULATED,
                "simulated": True,
                "reason": "RAZORPAY_CREDENTIALS_MISSING",
                "payment_link_id": f"plink_sim_{simulated_id}",
            },
        )

    try:
        client = _get_razorpay_client()

        payload: dict[str, Any] = {
            "amount": int(amount),
            "currency": currency or "INR",
            "accept_partial": False,
            "description": description[:255],
            "notify": {
                "sms": False,
                "email": False,
            },
            "reminder_enable": False,
            "notes": {
                "source": "RecoverAI",
                "purpose": "send_payment_link",
                **{
                    str(k): str(v)[:100]
                    for k, v in notes.items()
                },
            },
        }

        customer: dict[str, str] = {}
        if customer_name:
            customer["name"] = customer_name[:100]
        if customer_email:
            customer["email"] = customer_email[:100]
        if customer_contact:
            customer["contact"] = str(customer_contact)[:15]
        if customer:
            payload["customer"] = customer

        if expire_by:
            payload["expire_by"] = int(expire_by)

        try:
            link = client.payment_link.create(payload)
        except Exception:
            payload.pop("customer", None)
            payload.pop("expire_by", None)
            link = client.payment_link.create(payload)

        return GatewayPaymentLinkResult(
            success=True,
            payment_link_url=link.get("short_url") or link.get("url"),
            error_source=SOURCE_RAZORPAY,
            mode=MODE_RAZORPAY_TEST,
            gateway_response=_safe_gateway_payload(
                {
                    "mode": MODE_RAZORPAY_TEST,
                    "operation": "payment_link.create",
                    "payment_link_id": link.get("id"),
                    "amount": link.get("amount"),
                    "currency": link.get("currency"),
                    "status": link.get("status"),
                }
            ),
        )

    except Exception as exc:
        logger.warning(
            "Razorpay payment link failed. error=%s",
            type(exc).__name__,
        )
        return GatewayPaymentLinkResult(
            success=False,
            payment_link_url=None,
            error_code="RAZORPAY_API_ERROR",
            error_description=str(exc)[:300],
            error_source=SOURCE_RAZORPAY,
            mode=MODE_RAZORPAY_TEST,
            gateway_response={
                "mode": MODE_RAZORPAY_TEST,
                "operation": "payment_link.create",
                "error_type": type(exc).__name__,
            },
        )


# ============================================================
# TEST HELPERS (explicit, never silent)
# ============================================================

def build_test_retry_result(
    *,
    success: bool,
    mode: str = MODE_SIMULATED,
) -> GatewayRetryResult:
    """
    Explicit test helper for unit tests.

    Must never be used to fabricate a real Razorpay success claim.
    """

    if success:
        return GatewayRetryResult(
            success=True,
            status="SUCCESS",
            error_source=(
                SOURCE_RAZORPAY
                if mode == MODE_RAZORPAY_TEST
                else SOURCE_SIMULATED
            ),
            mode=mode,
            gateway_response={
                "mode": mode,
                "test_helper": True,
                "outcome": "SUCCESS",
            },
        )

    return GatewayRetryResult(
        success=False,
        status="FAILED",
        error_code="TEST_DECLINE",
        error_description="Explicit test failure outcome.",
        error_source=(
            SOURCE_RAZORPAY
            if mode == MODE_RAZORPAY_TEST
            else SOURCE_SIMULATED
        ),
        mode=mode,
        gateway_response={
            "mode": mode,
            "test_helper": True,
            "outcome": "FAILED",
        },
    )
