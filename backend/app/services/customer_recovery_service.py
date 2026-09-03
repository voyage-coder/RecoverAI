"""
Customer recovery link service.

Creates hashed, expiring tokens that map to recovery cases.
Does not mark payments recovered — checkout + webhook only.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    CaseStatus,
    CustomerRecoveryLink,
    Payment,
    RecoveryCase,
    RecoveryResult,
    RecoveryResultStatus,
)
from app.services.payment_details_service import get_case_payment_details
from app.services.payment_gateway_service import (
    is_razorpay_configured,
)
from app.services.recovery_operations_service import (
    get_checkout_config_for_case,
)

logger = logging.getLogger(__name__)

DEFAULT_TTL_HOURS = int(os.getenv("CUSTOMER_RECOVERY_TOKEN_TTL_HOURS", "72"))


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.utcnow()


def _get_case(db: Session, case_id: str) -> RecoveryCase:
    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == case_id)
    )
    if case is None:
        raise ValueError("case_not_found")
    return case


def _active_link_for_case(
    db: Session,
    case_id: str,
) -> CustomerRecoveryLink | None:
    now = _now()
    return db.scalar(
        select(CustomerRecoveryLink)
        .where(
            CustomerRecoveryLink.case_id == case_id,
            CustomerRecoveryLink.revoked_at.is_(None),
            CustomerRecoveryLink.expires_at > now,
        )
        .order_by(CustomerRecoveryLink.created_at.desc())
    )


def _link_by_token(
    db: Session,
    raw_token: str,
) -> CustomerRecoveryLink | None:
    token_hash = _hash_token(raw_token.strip())
    return db.scalar(
        select(CustomerRecoveryLink).where(
            CustomerRecoveryLink.token_hash == token_hash
        )
    )


def _is_awaiting(details: dict | None) -> bool:
    if not details:
        return False
    payment = details.get("payment") or {}
    if str(payment.get("status") or "").upper() == "RECOVERED":
        return False
    gateway = details.get("gateway_summary") or {}
    if gateway.get("awaiting_webhook") is True:
        return True
    for attempt in details.get("attempts") or []:
        code = str(attempt.get("error_code") or "").upper()
        if "AWAITING" in code:
            return True
        if (attempt.get("gateway") or {}).get("awaiting_webhook") is True:
            return True
    return False


def _is_backend_recovered(
    case: RecoveryCase,
    payment: Payment | None,
    result: RecoveryResult | None,
) -> bool:
    case_ok = case.status == CaseStatus.RECOVERED
    payment_ok = payment is not None and payment.status == "RECOVERED"
    result_ok = (
        result is not None
        and result.status == RecoveryResultStatus.FULLY_RECOVERED
    )
    return case_ok and (payment_ok or result_ok)


def merchant_link_status(
    db: Session,
    case_id: str,
) -> dict:
    case = _get_case(db, case_id)
    link = _active_link_for_case(db, case_id)
    latest_any = db.scalar(
        select(CustomerRecoveryLink)
        .where(CustomerRecoveryLink.case_id == case_id)
        .order_by(CustomerRecoveryLink.created_at.desc())
    )

    try:
        details = get_case_payment_details(db, case_id)
    except ValueError:
        details = None

    payment = None
    if details:
        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )
    else:
        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )

    result = db.scalar(
        select(RecoveryResult).where(RecoveryResult.case_id == case_id)
    )
    recovered = _is_backend_recovered(case, payment, result)
    awaiting = _is_awaiting(details)

    if recovered:
        status = "Recovered"
    elif latest_any is None:
        status = "Not generated"
    elif latest_any.revoked_at is not None:
        status = "Expired"
    elif latest_any.expires_at <= _now():
        status = "Expired"
    elif awaiting:
        status = "Payment pending"
    elif latest_any.first_opened_at is not None:
        status = "Customer opened"
    else:
        status = "Ready"

    return {
        "status": status,
        "has_active_link": link is not None and not recovered,
        "expires_at": (
            link.expires_at.isoformat() + "Z"
            if link is not None
            else (
                latest_any.expires_at.isoformat() + "Z"
                if latest_any is not None
                else None
            )
        ),
        "first_opened_at": (
            (link or latest_any).first_opened_at.isoformat() + "Z"
            if (link or latest_any) and (link or latest_any).first_opened_at
            else None
        ),
        "created_at": (
            (link or latest_any).created_at.isoformat() + "Z"
            if (link or latest_any)
            else None
        ),
        "case_status": (
            case.status.value
            if hasattr(case.status, "value")
            else str(case.status)
        ),
        "amount_at_risk": case.amount_at_risk,
        # Raw token is never returned on GET.
        "recovery_path": None,
        "note": (
            "Generate a link to obtain a one-time recoverable URL. "
            "Raw tokens are not stored and cannot be reconstructed."
        ),
    }


def create_customer_recovery_link(
    db: Session,
    case_id: str,
    *,
    ttl_hours: int | None = None,
    revoke_previous: bool = False,
) -> dict:
    case = _get_case(db, case_id)

    if case.status == CaseStatus.CLOSED:
        raise ValueError("case_closed")

    if case.status == CaseStatus.RECOVERED:
        raise ValueError("already_recovered")

    payment = db.scalar(
        select(Payment).where(Payment.id == case.payment_id)
    )
    result = db.scalar(
        select(RecoveryResult).where(RecoveryResult.case_id == case_id)
    )
    if _is_backend_recovered(case, payment, result):
        raise ValueError("already_recovered")

    now = _now()
    # Merchant "Regenerate" revokes old /recover/ URLs (they 410).
    # Executor fallbacks must not revoke — that broke Pay as customer mid-demo.
    if revoke_previous:
        prior = db.scalars(
            select(CustomerRecoveryLink).where(
                CustomerRecoveryLink.case_id == case_id,
                CustomerRecoveryLink.revoked_at.is_(None),
            )
        ).all()
        for item in prior:
            item.revoked_at = now
            db.add(item)

    raw_token = secrets.token_urlsafe(32)
    hours = ttl_hours if ttl_hours is not None else DEFAULT_TTL_HOURS
    expires_at = now + timedelta(hours=max(1, hours))

    link = CustomerRecoveryLink(
        case_id=case.id,
        token_hash=_hash_token(raw_token),
        expires_at=expires_at,
        created_at=now,
    )
    db.add(link)
    db.flush()

    recovery_path = f"/recover/{raw_token}"
    logger.info(
        "customer_recovery_link_created case_number=%s expires_at=%s",
        case.case_number,
        expires_at.isoformat(),
    )

    return {
        "status": "Ready",
        "has_active_link": True,
        "expires_at": expires_at.isoformat() + "Z",
        "created_at": now.isoformat() + "Z",
        "first_opened_at": None,
        "case_status": (
            case.status.value
            if hasattr(case.status, "value")
            else str(case.status)
        ),
        "amount_at_risk": case.amount_at_risk,
        "recovery_path": recovery_path,
        "token": raw_token,
        "note": (
            "Copy this recovery link now. The raw token is shown once "
            "and only its hash is stored."
        ),
    }


def resolve_customer_recovery(
    db: Session,
    raw_token: str,
    *,
    mark_opened: bool = True,
) -> dict:
    """
    Resolve a customer recovery token to a customer-safe payload.
    """

    token = (raw_token or "").strip()
    if not token or len(token) < 16:
        raise ValueError("invalid_token")

    link = _link_by_token(db, token)
    if link is None:
        raise ValueError("invalid_token")

    # Revoked links still pay until TTL — regenerating used to 410 Click here.
    if link.expires_at <= _now():
        raise ValueError("expired_token")

    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == link.case_id)
    )
    if case is None:
        raise ValueError("case_not_found")

    if mark_opened:
        now = _now()
        if link.first_opened_at is None:
            link.first_opened_at = now
        link.last_opened_at = now
        db.add(link)

    payment = db.scalar(
        select(Payment).where(Payment.id == case.payment_id)
    )
    result = db.scalar(
        select(RecoveryResult).where(RecoveryResult.case_id == case.id)
    )

    try:
        details = get_case_payment_details(db, case.id)
    except ValueError:
        details = None

    recovered = _is_backend_recovered(case, payment, result)
    awaiting = _is_awaiting(details)

    amount = (
        (details or {}).get("payment", {}) or {}
    ).get("amount")
    if amount is None:
        amount = case.amount_at_risk
    currency = (
        (details or {}).get("payment", {}) or {}
    ).get("currency") or "INR"

    recovered_amount = None
    if recovered:
        if result and result.recovered_amount is not None:
            recovered_amount = int(result.recovered_amount)
        else:
            recovered_amount = int(amount)

    # Customer-facing status (no AI / Safety / internal jargon)
    if recovered:
        customer_status = "recovered"
        headline = "Payment recovered successfully"
        message = "Your payment has been successfully completed."
        payment_action_available = False
    elif case.status == CaseStatus.CLOSED:
        customer_status = "stopped"
        headline = "Payment action unavailable"
        message = (
            "This payment recovery is no longer available. "
            "Please contact support if you need help."
        )
        payment_action_available = False
    elif case.status == CaseStatus.ESCALATED and not awaiting:
        customer_status = "unavailable"
        headline = "Payment action unavailable"
        message = (
            "We could not complete this payment automatically. "
            "Please contact support for assistance."
        )
        payment_action_available = False
    else:
        customer_status = "action_required"
        headline = "Complete your payment"
        message = "Your previous payment could not be completed."
        payment_action_available = True

    checkout = {
        "available": False,
        "order_id": None,
        "amount": amount,
        "currency": currency,
        "razorpay_key_id": None,
        "payment_link_url": None,
        "test_mode": True,
    }

    if payment_action_available:
        try:
            cfg = get_checkout_config_for_case(db, case.id)
            checkout = {
                "available": bool(cfg.get("available")),
                "order_id": cfg.get("order_id"),
                "amount": cfg.get("amount") or amount,
                "currency": cfg.get("currency") or currency,
                # Public TEST key only — never secret.
                "razorpay_key_id": (
                    cfg.get("razorpay_key_id")
                    if is_razorpay_configured()
                    else None
                ),
                "payment_link_url": cfg.get("payment_link_url"),
                "test_mode": bool(cfg.get("test_mode", True)),
            }
            if not checkout["available"]:
                payment_action_available = False
                if awaiting:
                    customer_status = "payment_pending"
                    headline = "Payment pending confirmation"
                    message = (
                        "We are confirming your payment. "
                        "This page will update when confirmation completes."
                    )
                else:
                    customer_status = "pending"
                    headline = "Payment action not ready"
                    message = (
                        "A secure payment action is not ready yet. "
                        "Please try again in a moment."
                    )
            elif awaiting:
                # Order exists — customer may still need to pay
                customer_status = "action_required"
        except ValueError:
            payment_action_available = False
            customer_status = "pending"
            headline = "Payment action not ready"
            message = (
                "A secure payment action is not ready yet. "
                "Please try again in a moment."
            )

    # Never include case id, AI fields, secrets, or gateway dump.
    return {
        "customer_status": customer_status,
        "headline": headline,
        "message": message,
        "amount": int(amount),
        "currency": currency,
        "recovered_amount": recovered_amount,
        "payment_action_available": payment_action_available,
        "expires_at": link.expires_at.isoformat() + "Z",
        "test_mode": True,
        "checkout": checkout,
    }
