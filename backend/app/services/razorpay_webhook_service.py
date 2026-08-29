"""
RecoverAI Razorpay webhook verification and recovery confirmation.

Only a signature-verified Razorpay success event may mark a payment recovered.

Does not trust frontend callbacks or unsigned request bodies.
Does not log webhook secrets, API secrets, or card/bank credentials.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    ActionStatus,
    CaseStatus,
    Payment,
    PaymentAttempt,
    RecoveryAction,
    RecoveryCase,
    RecoveryResult,
    RecoveryResultStatus,
    StrategyType,
)
from app.services.payment_gateway_service import (
    RAZORPAY_WEBHOOK_SECRET,
    SOURCE_RAZORPAY,
    is_webhook_secret_configured,
)
from app.services.result_service import (
    create_initial_result,
    update_recovery_result,
)


logger = logging.getLogger(__name__)


# Successful payment confirmation events only.
SUPPORTED_SUCCESS_EVENTS = frozenset(
    {
        "payment.captured",
        "payment_link.paid",
    }
)

# Non-success payment events we acknowledge without recovering.
SUPPORTED_NON_SUCCESS_EVENTS = frozenset(
    {
        "payment.failed",
        "payment.authorized",
        "order.paid",
    }
)

# Business rule (explicit):
# A signature-verified Razorpay capture means money was received.
# RecoverAI may mark the matched case RECOVERED even if it was
# previously ESCALATED. Unmatched payments must never recover
# an unrelated case.
ALLOW_RECOVERY_WHEN_ESCALATED = True


@dataclass
class WebhookProcessResult:
    accepted: bool
    status: str
    detail: str
    case_id: str | None = None
    payment_id: str | None = None
    idempotent: bool = False
    modified: bool = False
    event: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


# ============================================================
# SIGNATURE VERIFICATION
# ============================================================

def verify_webhook_signature(
    raw_body: bytes | str,
    signature: str | None,
    *,
    secret: str | None = None,
) -> bool:
    """
    Verify X-Razorpay-Signature using HMAC-SHA256 over the raw body.

    Uses the official Razorpay utility when available; falls back to
    constant-time HMAC comparison.
    """

    webhook_secret = (
        secret
        if secret is not None
        else RAZORPAY_WEBHOOK_SECRET
    )

    if not webhook_secret:
        return False

    if not signature:
        return False

    if isinstance(raw_body, bytes):
        body_str = raw_body.decode("utf-8")
    else:
        body_str = raw_body

    try:
        import razorpay

        client = razorpay.Client(auth=("", ""))
        client.utility.verify_webhook_signature(
            body_str,
            signature,
            webhook_secret,
        )
        return True
    except Exception:
        # Official utility raises on mismatch / bad input.
        # Also try direct HMAC in case SDK auth quirks appear.
        pass

    expected = hmac.new(
        webhook_secret.encode("utf-8"),
        body_str.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)


def sign_webhook_body(
    raw_body: bytes | str,
    *,
    secret: str,
) -> str:
    """Test helper: produce a valid Razorpay-style webhook signature."""

    if isinstance(raw_body, bytes):
        body_str = raw_body.decode("utf-8")
    else:
        body_str = raw_body

    return hmac.new(
        secret.encode("utf-8"),
        body_str.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


# ============================================================
# PAYLOAD HELPERS (safe — no secrets / PAN / CVV)
# ============================================================

def _entity(payload: dict[str, Any], key: str) -> dict[str, Any]:
    block = payload.get(key) or {}
    if isinstance(block, dict):
        entity = block.get("entity")
        if isinstance(entity, dict):
            return entity
    return {}


def _safe_notes(notes: Any) -> dict[str, Any]:
    if not isinstance(notes, dict):
        return {}
    return {
        str(k): str(v)[:100]
        for k, v in notes.items()
        if str(k).lower()
        not in {
            "secret",
            "key_secret",
            "card",
            "cvv",
            "cvc",
            "pin",
            "password",
        }
    }


def extract_payment_success_fields(
    event_name: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """
    Extract recoverable fields from a supported success event.

    Returns None when the event is not a verified payment success shape.
    """

    if event_name not in SUPPORTED_SUCCESS_EVENTS:
        return None

    payment = _entity(payload, "payment")
    payment_link = _entity(payload, "payment_link")
    order = _entity(payload, "order")

    status = str(payment.get("status") or "").lower()

    # Only captured payments confirm recovery for payment.captured.
    if event_name == "payment.captured" and status != "captured":
        return None

    amount = payment.get("amount")
    if amount is None and payment_link:
        amount = payment_link.get("amount_paid") or payment_link.get(
            "amount"
        )

    if amount is None:
        return None

    notes = _safe_notes(
        payment.get("notes")
        or payment_link.get("notes")
        or order.get("notes")
        or {}
    )

    razorpay_payment_id = payment.get("id")
    if not razorpay_payment_id and event_name == "payment_link.paid":
        razorpay_payment_id = payment_link.get("id")

    return {
        "razorpay_payment_id": razorpay_payment_id,
        "razorpay_order_id": payment.get("order_id") or order.get("id"),
        "razorpay_payment_link_id": payment_link.get("id"),
        "amount": int(amount),
        "currency": payment.get("currency")
        or payment_link.get("currency")
        or "INR",
        "status": status or "captured",
        "notes": notes,
        "case_number": notes.get("case_number"),
    }


# ============================================================
# LOOKUP / IDEMPOTENCY (no schema migration)
# ============================================================

def _gateway_field_matches(
    gateway_response: dict | None,
    field: str,
    value: str | None,
) -> bool:
    if not value or not isinstance(gateway_response, dict):
        return False
    return str(gateway_response.get(field) or "") == str(value)


def find_attempt_for_razorpay_ids(
    db: Session,
    *,
    razorpay_payment_id: str | None,
    razorpay_order_id: str | None,
    razorpay_payment_link_id: str | None,
) -> PaymentAttempt | None:
    """
    Locate an existing attempt using gateway_response JSON fields.

    Limitation: without a dedicated unique column for Razorpay payment IDs,
    lookup scans recent attempts. Duplicate concurrent deliveries could race;
    application-level checks below reduce duplicate SUCCESS writes.
    """

    attempts = db.scalars(
        select(PaymentAttempt).order_by(
            PaymentAttempt.created_at.desc()
        )
    ).all()

    if razorpay_payment_id:
        for attempt in attempts:
            if _gateway_field_matches(
                attempt.gateway_response,
                "razorpay_payment_id",
                razorpay_payment_id,
            ):
                return attempt

    if razorpay_order_id:
        for attempt in attempts:
            if _gateway_field_matches(
                attempt.gateway_response,
                "order_id",
                razorpay_order_id,
            ):
                return attempt

    if razorpay_payment_link_id:
        for attempt in attempts:
            if _gateway_field_matches(
                attempt.gateway_response,
                "payment_link_id",
                razorpay_payment_link_id,
            ):
                return attempt

    return None


def find_case_for_webhook(
    db: Session,
    fields: dict[str, Any],
) -> tuple[RecoveryCase | None, Payment | None, PaymentAttempt | None]:
    attempt = find_attempt_for_razorpay_ids(
        db,
        razorpay_payment_id=fields.get("razorpay_payment_id"),
        razorpay_order_id=fields.get("razorpay_order_id"),
        razorpay_payment_link_id=fields.get(
            "razorpay_payment_link_id"
        ),
    )

    payment: Payment | None = None
    case: RecoveryCase | None = None

    if attempt is not None:
        payment = db.scalar(
            select(Payment).where(Payment.id == attempt.payment_id)
        )

    case_number = fields.get("case_number")
    if case_number:
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.case_number == str(case_number)
            )
        )
        if case is not None and payment is None:
            payment = db.scalar(
                select(Payment).where(Payment.id == case.payment_id)
            )

    if payment is not None and case is None:
        case = db.scalar(
            select(RecoveryCase)
            .where(RecoveryCase.payment_id == payment.id)
            .order_by(RecoveryCase.created_at.desc())
        )

    return case, payment, attempt


def _already_recovered(
    case: RecoveryCase | None,
    payment: Payment | None,
    attempt: PaymentAttempt | None,
    razorpay_payment_id: str | None,
) -> bool:
    if payment is not None and payment.status == "RECOVERED":
        return True

    if case is not None and case.status == CaseStatus.RECOVERED:
        return True

    if (
        attempt is not None
        and attempt.status == "SUCCESS"
        and _gateway_field_matches(
            attempt.gateway_response,
            "razorpay_payment_id",
            razorpay_payment_id,
        )
    ):
        return True

    return False


# ============================================================
# APPLY VERIFIED SUCCESS
# ============================================================

def _latest_action(
    db: Session,
    case: RecoveryCase,
) -> RecoveryAction | None:
    return db.scalar(
        select(RecoveryAction)
        .where(RecoveryAction.case_id == case.id)
        .order_by(RecoveryAction.created_at.desc())
    )


def _mark_open_action_executed(
    db: Session,
    case: RecoveryCase,
) -> None:
    """
    Mark PENDING/PROCESSING payment-related actions as EXECUTED.
    Does not re-touch already EXECUTED/FAILED/BLOCKED actions.
    """

    open_actions = db.scalars(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case.id,
            RecoveryAction.status.in_(
                [ActionStatus.PENDING, ActionStatus.PROCESSING]
            ),
            RecoveryAction.action_type.in_(
                [
                    StrategyType.IMMEDIATE_RETRY,
                    StrategyType.RETRY_AFTER_DELAY,
                    StrategyType.SEND_PAYMENT_LINK,
                ]
            ),
        )
    ).all()

    now = datetime.utcnow()
    for action in open_actions:
        action.status = ActionStatus.EXECUTED
        action.executed_at = now
        action.result_text = (
            "Payment recovered via verified Razorpay webhook."
        )
        db.add(action)


def apply_verified_payment_recovery(
    db: Session,
    *,
    case: RecoveryCase,
    payment: Payment,
    attempt: PaymentAttempt | None,
    fields: dict[str, Any],
) -> WebhookProcessResult:
    """
    Transition payment/case/result to recovered after signature verification.

    Never increments retry_count or contact_count.
    """

    razorpay_payment_id = fields.get("razorpay_payment_id")
    recovered_amount = int(fields["amount"])

    if (
        case.status == CaseStatus.ESCALATED
        and not ALLOW_RECOVERY_WHEN_ESCALATED
    ):
        logger.info(
            "webhook_skip reason=escalated_blocked event=payment "
            "case_number=%s case_status=%s razorpay_order_id=%s "
            "razorpay_payment_id=%s",
            case.case_number,
            case.status.value
            if hasattr(case.status, "value")
            else case.status,
            fields.get("razorpay_order_id"),
            razorpay_payment_id,
        )
        return WebhookProcessResult(
            accepted=True,
            status="skipped_escalated",
            detail=(
                "Verified payment matched an ESCALATED case; "
                "business rule blocks automatic recovery."
            ),
            case_id=case.id,
            payment_id=payment.id,
            modified=False,
            meta={
                "case_number": case.case_number,
                "case_status": (
                    case.status.value
                    if hasattr(case.status, "value")
                    else str(case.status)
                ),
            },
        )

    if case.status == CaseStatus.ESCALATED:
        logger.info(
            "webhook_recover_escalated case_number=%s "
            "razorpay_order_id=%s razorpay_payment_id=%s "
            "rule=ALLOW_RECOVERY_WHEN_ESCALATED",
            case.case_number,
            fields.get("razorpay_order_id"),
            razorpay_payment_id,
        )

    if _already_recovered(
        case,
        payment,
        attempt,
        razorpay_payment_id,
    ):
        return WebhookProcessResult(
            accepted=True,
            status="idempotent",
            detail="Payment already recovered; webhook ignored.",
            case_id=case.id,
            payment_id=payment.id,
            idempotent=True,
            modified=False,
            event="payment.captured",
        )

    existing_result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )
    if (
        existing_result is not None
        and existing_result.status
        == RecoveryResultStatus.FULLY_RECOVERED
    ):
        return WebhookProcessResult(
            accepted=True,
            status="idempotent",
            detail="RecoveryResult already fully recovered; webhook ignored.",
            case_id=case.id,
            payment_id=payment.id,
            idempotent=True,
            modified=False,
            event="payment.captured",
        )

    # Snapshot counters to prove webhook does not mutate them.
    prior_retry = case.retry_count
    prior_contact = case.contact_count

    payment.status = "RECOVERED"
    if payment.order is not None:
        payment.order.status = "RECOVERED"

    case.status = CaseStatus.RECOVERED
    case.current_step = "Payment Recovered (Razorpay Webhook)"

    # Preserve counters exactly.
    case.retry_count = prior_retry
    case.contact_count = prior_contact

    safe_gateway = {
        "mode": "RAZORPAY_TEST",
        "source": "webhook",
        "razorpay_payment_id": razorpay_payment_id,
        "order_id": fields.get("razorpay_order_id"),
        "payment_link_id": fields.get("razorpay_payment_link_id"),
        "amount": recovered_amount,
        "currency": fields.get("currency"),
        "verified": True,
    }

    if attempt is not None:
        # Update existing attempt instead of creating a duplicate.
        attempt.status = "SUCCESS"
        attempt.error_code = None
        attempt.error_description = None
        attempt.error_source = SOURCE_RAZORPAY
        existing = (
            attempt.gateway_response
            if isinstance(attempt.gateway_response, dict)
            else {}
        )
        attempt.gateway_response = {
            **existing,
            **safe_gateway,
        }
        db.add(attempt)
    else:
        # No prior attempt row (e.g. payment-link path) — create one SUCCESS.
        next_number = (
            db.scalar(
                select(PaymentAttempt.attempt_number)
                .where(PaymentAttempt.payment_id == payment.id)
                .order_by(PaymentAttempt.attempt_number.desc())
            )
            or 0
        ) + 1

        attempt = PaymentAttempt(
            id=str(uuid4()),
            payment_id=payment.id,
            attempt_number=next_number,
            status="SUCCESS",
            error_code=None,
            error_description=None,
            error_source=SOURCE_RAZORPAY,
            gateway_response=safe_gateway,
            created_at=datetime.utcnow(),
        )
        db.add(attempt)

    action = _latest_action(db, case)

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )
    if result is None:
        result = create_initial_result(db, case)
        db.flush()

    if action is not None:
        # Set absolute recovered amount via update helper without double-count
        # when prior recovered_amount is already 0 (normal failed-retry path).
        delta = max(
            0,
            min(
                recovered_amount,
                result.original_amount,
            )
            - int(result.recovered_amount or 0),
        )
        update_recovery_result(
            db=db,
            case=case,
            action=action,
            recovered_amount=delta,
        )
    else:
        result.recovered_amount = min(
            recovered_amount,
            result.original_amount,
        )
        result.status = RecoveryResultStatus.FULLY_RECOVERED
        result.recovery_method = "RAZORPAY_WEBHOOK"
        result.recovered_at = datetime.utcnow()
        case.status = CaseStatus.RECOVERED
        case.current_step = "Recovery Complete"
        db.add(result)
        db.add(case)

    _mark_open_action_executed(db, case)

    db.add(payment)
    db.add(case)

    return WebhookProcessResult(
        accepted=True,
        status="recovered",
        detail="Verified Razorpay payment applied.",
        case_id=case.id,
        payment_id=payment.id,
        idempotent=False,
        modified=True,
        meta={
            "retry_count": case.retry_count,
            "contact_count": case.contact_count,
            "razorpay_payment_id": razorpay_payment_id,
        },
    )


# ============================================================
# MAIN PROCESSOR
# ============================================================

def process_razorpay_webhook(
    db: Session,
    *,
    raw_body: bytes,
    signature: str | None,
) -> WebhookProcessResult:
    """
    Verify signature, then apply only supported success events.
    """

    if not is_webhook_secret_configured():
        logger.warning(
            "Razorpay webhook rejected: RAZORPAY_WEBHOOK_SECRET missing."
        )
        return WebhookProcessResult(
            accepted=False,
            status="misconfigured",
            detail="Webhook secret is not configured.",
        )

    if not signature:
        return WebhookProcessResult(
            accepted=False,
            status="missing_signature",
            detail="X-Razorpay-Signature header is required.",
        )

    if not verify_webhook_signature(raw_body, signature):
        logger.warning("Razorpay webhook rejected: invalid signature.")
        return WebhookProcessResult(
            accepted=False,
            status="invalid_signature",
            detail="Webhook signature verification failed.",
        )

    try:
        event_doc = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return WebhookProcessResult(
            accepted=False,
            status="invalid_payload",
            detail="Webhook body is not valid JSON.",
        )

    if not isinstance(event_doc, dict):
        return WebhookProcessResult(
            accepted=False,
            status="invalid_payload",
            detail="Webhook body must be a JSON object.",
        )

    event_name = str(event_doc.get("event") or "")
    payload = event_doc.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}

    logger.info("webhook_event type=%s", event_name or "unknown")

    if event_name in SUPPORTED_NON_SUCCESS_EVENTS:
        logger.info(
            "webhook_skip reason=non_success_event event=%s",
            event_name,
        )
        return WebhookProcessResult(
            accepted=True,
            status="ignored",
            detail="Non-success event acknowledged; no recovery update.",
            event=event_name,
            modified=False,
        )

    if event_name not in SUPPORTED_SUCCESS_EVENTS:
        logger.info(
            "webhook_skip reason=unknown_event event=%s",
            event_name or "unknown",
        )
        return WebhookProcessResult(
            accepted=True,
            status="ignored",
            detail="Unknown event acknowledged; no recovery update.",
            event=event_name or None,
            modified=False,
        )

    fields = extract_payment_success_fields(event_name, payload)
    if not fields:
        logger.info(
            "webhook_skip reason=missing_payment_fields event=%s",
            event_name,
        )
        return WebhookProcessResult(
            accepted=True,
            status="ignored",
            detail="Success event missing recoverable payment fields.",
            event=event_name,
            modified=False,
        )

    logger.info(
        "webhook_ids event=%s razorpay_order_id=%s "
        "razorpay_payment_id=%s case_number_note=%s",
        event_name,
        fields.get("razorpay_order_id"),
        fields.get("razorpay_payment_id"),
        fields.get("case_number"),
    )

    case, payment, attempt = find_case_for_webhook(db, fields)

    if case is None or payment is None:
        logger.info(
            "webhook_skip reason=unmatched event=%s "
            "razorpay_order_id=%s razorpay_payment_id=%s "
            "case_number_note=%s attempt_found=%s",
            event_name,
            fields.get("razorpay_order_id"),
            fields.get("razorpay_payment_id"),
            fields.get("case_number"),
            attempt is not None,
        )
        return WebhookProcessResult(
            accepted=True,
            status="unmatched",
            detail=(
                "Verified webhook had no matching RecoverAI case/payment. "
                "Order/payment must be created through RecoverAI with "
                "case_number notes and/or a PaymentAttempt.gateway_response "
                "order_id linkage."
            ),
            event=event_name,
            modified=False,
            meta={
                "razorpay_payment_id": fields.get("razorpay_payment_id"),
                "razorpay_order_id": fields.get("razorpay_order_id"),
                "case_number_note": fields.get("case_number"),
            },
        )

    logger.info(
        "webhook_match event=%s case_number=%s case_status=%s "
        "recoverai_payment_id=%s razorpay_order_id=%s "
        "razorpay_payment_id=%s",
        event_name,
        case.case_number,
        case.status.value if hasattr(case.status, "value") else case.status,
        payment.id,
        fields.get("razorpay_order_id"),
        fields.get("razorpay_payment_id"),
    )

    result = apply_verified_payment_recovery(
        db,
        case=case,
        payment=payment,
        attempt=attempt,
        fields=fields,
    )
    result.event = event_name
    logger.info(
        "webhook_result status=%s modified=%s idempotent=%s "
        "case_number=%s",
        result.status,
        result.modified,
        result.idempotent,
        case.case_number,
    )
    return result
