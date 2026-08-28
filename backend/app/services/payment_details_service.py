"""
Read-only payment / gateway details for a recovery case.

Sanitizes PaymentAttempt.gateway_response so secrets never leave the API.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    Payment,
    PaymentAttempt,
    RecoveryCase,
)


# Allowlist of safe operational fields for frontend/gateway display.
SAFE_GATEWAY_KEYS = frozenset(
    {
        "mode",
        "operation",
        "order_id",
        "payment_id",
        "razorpay_payment_id",
        "payment_link_id",
        "amount",
        "currency",
        "status",
        "awaiting_webhook",
        "linked_case_number",
        "verified",
        "simulated",
        "reason",
        "receipt",
        "executor",
        "gateway_mode",
        "source",
        "outcome",
        "error_type",
    }
)

BLOCKED_KEY_TOKENS = (
    "secret",
    "key_id",
    "key_secret",
    "webhook_secret",
    "authorization",
    "auth",
    "password",
    "credential",
    "api_key",
    "card",
    "cvv",
    "cvc",
    "upi",
    "pin",
    "bank",
    "account_number",
)


def sanitize_gateway_response(
    gateway_response: dict | None,
) -> dict[str, Any]:
    """
    Build a sanitized gateway object for API responses.

    Never returns raw gateway_response.
    Never returns secrets, credentials, or card data.
    """

    if not isinstance(gateway_response, dict):
        return {}

    safe: dict[str, Any] = {}

    for key, value in gateway_response.items():
        key_str = str(key)
        key_l = key_str.lower()

        if any(token in key_l for token in BLOCKED_KEY_TOKENS):
            continue

        if key_str not in SAFE_GATEWAY_KEYS and key_l not in {
            k.lower() for k in SAFE_GATEWAY_KEYS
        }:
            # Only allowlisted keys; skip unknown nested blobs.
            continue

        if isinstance(value, dict):
            nested = sanitize_gateway_response(value)
            if nested:
                safe[key_str] = nested
        elif isinstance(value, (str, int, float, bool)) or value is None:
            # Reject values that look like secrets even under safe keys.
            if isinstance(value, str):
                lower = value.lower()
                if (
                    lower.startswith("rzp_live_")
                    or "key_secret" in lower
                    or value.startswith("rzp_test_")
                    and "secret" in key_l
                ):
                    continue
                # Never echo full webhook/API secrets if somehow stored.
                if len(value) > 80 and any(
                    t in key_l for t in ("token", "secret", "key")
                ):
                    continue
            safe[key_str] = value

    return safe


def build_payment_details_payload(
    case: RecoveryCase,
    payment: Payment,
    attempts: list[PaymentAttempt],
) -> dict[str, Any]:
    attempt_payloads = []

    for attempt in attempts:
        gateway = sanitize_gateway_response(attempt.gateway_response)
        attempt_payloads.append(
            {
                "id": attempt.id,
                "attempt_number": attempt.attempt_number,
                "status": attempt.status,
                "error_code": attempt.error_code,
                "error_description": attempt.error_description,
                "error_source": attempt.error_source,
                "created_at": attempt.created_at,
                "gateway": gateway,
            }
        )

    latest = attempt_payloads[-1] if attempt_payloads else None
    latest_gateway = (latest or {}).get("gateway") or {}

    return {
        "case_id": case.id,
        "case_number": case.case_number,
        "payment": {
            "payment_id": payment.id,
            "amount": payment.amount,
            "currency": payment.currency,
            "payment_type": payment.payment_type,
            "status": payment.status,
            "failure_code": payment.failure_code,
            "failure_reason": payment.failure_reason,
            "created_at": payment.created_at,
        },
        "attempts": attempt_payloads,
        "gateway_summary": {
            "mode": latest_gateway.get("mode")
            or latest_gateway.get("gateway_mode"),
            "order_id": latest_gateway.get("order_id"),
            "razorpay_payment_id": latest_gateway.get(
                "razorpay_payment_id"
            )
            or latest_gateway.get("payment_id"),
            "status": latest_gateway.get("status")
            or (latest or {}).get("status"),
            "awaiting_webhook": latest_gateway.get("awaiting_webhook"),
            "attempt_number": (latest or {}).get("attempt_number"),
            "error_code": (latest or {}).get("error_code"),
            "error_source": (latest or {}).get("error_source"),
        },
    }


def get_case_payment_details(
    db: Session,
    case_id: str,
) -> dict[str, Any] | None:
    """
    Load case + payment + attempts (read-only).

    Returns None if case is missing.
    Raises ValueError("payment_not_found") if case exists but payment does not.
    """

    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == case_id)
    )

    if case is None:
        return None

    payment = db.scalar(
        select(Payment).where(Payment.id == case.payment_id)
    )

    if payment is None:
        raise ValueError("payment_not_found")

    attempts = list(
        db.scalars(
            select(PaymentAttempt)
            .where(PaymentAttempt.payment_id == payment.id)
            .order_by(PaymentAttempt.attempt_number.asc())
        ).all()
    )

    return build_payment_details_payload(case, payment, attempts)
