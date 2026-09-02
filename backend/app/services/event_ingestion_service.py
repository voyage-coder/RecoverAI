"""
Simulated payment-provider event ingestion.

Accepts demo payment.failed events and records them in RecoverAI
before handing off to the existing recovery orchestrator.

This is NOT a Razorpay webhook and does NOT fake payment success.
"""

from __future__ import annotations

import hashlib
import logging
import re
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.schema import (
    Customer,
    Order,
    Payment,
    Product,
    RecoveryCase,
    CaseStatus,
)
from app.services.orchestrator_service import (
    process_payment,
)

logger = logging.getLogger(__name__)

SUPPORTED_EVENT = "payment.failed"
SUPPORTED_CURRENCIES = frozenset({"INR"})
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Events that may appear in a real provider feed but are NOT state-mutating
# through RecoverAI's demo event console. Captured recovery remains webhook-only.
NON_MUTATING_PROVIDER_EVENTS = {
    "payment.captured": (
        "payment.captured must arrive via verified POST /api/webhooks/razorpay "
        "with signature verification. The Event Console cannot mark a case RECOVERED."
    ),
    "payment.authorized": (
        "Not supported by current backend state model. Payments are tracked as "
        "FAILED or RECOVERED; there is no AUTHORIZED payment status or workflow."
    ),
    "payment.expired": (
        "Not supported by current backend state model. There is no payment.expired "
        "handler or EXPIRED payment status distinct from case CLOSED / link expiry."
    ),
    "payment.refunded": (
        "Not supported by current backend state model. RecoverAI has no refund "
        "ingestion path or refunded recovery-state transitions."
    ),
}


def _payment_id_from_idempotency_key(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return (
        f"{digest[0:8]}-{digest[8:12]}-"
        f"{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"
    )


def _validate_event_payload(payload: dict) -> None:
    event = str(payload.get("event") or "").strip()
    if event != SUPPORTED_EVENT:
        raise ValueError(
            f"Unsupported event type '{event}'. "
            f"Only '{SUPPORTED_EVENT}' is accepted."
        )

    amount = payload.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise ValueError("amount must be a positive integer (paise).")
    if amount <= 0:
        raise ValueError("amount must be greater than zero.")

    currency = str(payload.get("currency") or "INR").strip().upper()
    if currency not in SUPPORTED_CURRENCIES:
        raise ValueError(
            f"Unsupported currency '{currency}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_CURRENCIES))}."
        )

    customer = payload.get("customer")
    if not isinstance(customer, dict):
        raise ValueError("customer object is required.")

    name = str(customer.get("name") or "").strip()
    email = str(customer.get("email") or "").strip().lower()
    if not name:
        raise ValueError("customer.name is required.")
    if not email or not EMAIL_PATTERN.match(email):
        raise ValueError("customer.email must be a valid email address.")

    failure = payload.get("failure")
    if not isinstance(failure, dict):
        raise ValueError("failure object is required.")

    failure_code = str(failure.get("code") or "").strip()
    failure_reason = str(failure.get("reason") or "").strip()
    if not failure_code:
        raise ValueError("failure.code is required.")
    if not failure_reason:
        raise ValueError("failure.reason is required.")


def _get_or_create_customer(
    db: Session,
    *,
    name: str,
    email: str,
    phone: str | None,
) -> Customer:
    existing = db.scalar(
        select(Customer).where(Customer.email == email)
    )
    if existing is not None:
        return existing

    customer = Customer(
        id=str(uuid4()),
        name=name[:100],
        email=email[:255],
        phone=(phone or "9999999999")[:20],
        risk_tier="MEDIUM",
        payment_history_score=75,
    )
    db.add(customer)
    db.flush()
    return customer


def _get_or_create_event_product(db: Session) -> Product:
    product = db.scalar(select(Product).limit(1))
    if product is not None:
        return product

    product = Product(
        id=str(uuid4()),
        name="RecoverAI Event Product",
        description="Default product for simulated payment events.",
        price_in_paise=10000,
        category="Software",
    )
    db.add(product)
    db.flush()
    return product


def ingest_payment_failed_event(
    db: Session,
    payload: dict,
    *,
    event_source: str = "DEMO_EVENT",
) -> dict:
    """
    Record a simulated payment.failed event and start recovery.

    Reuses orchestrator_service.process_payment — no duplicate pipeline.
    """

    _validate_event_payload(payload)

    customer_data = payload["customer"]
    failure_data = payload["failure"]
    amount = int(payload["amount"])
    currency = str(payload.get("currency") or "INR").upper()
    idempotency_key = str(payload.get("idempotency_key") or "").strip()

    customer = _get_or_create_customer(
        db,
        name=str(customer_data["name"]).strip(),
        email=str(customer_data["email"]).strip().lower(),
        phone=(
            str(customer_data.get("phone") or "").strip() or None
        ),
    )

    product = _get_or_create_event_product(db)

    payment_id = (
        _payment_id_from_idempotency_key(idempotency_key)
        if idempotency_key
        else str(uuid4())
    )

    # Idempotency check BEFORE creating Order/Payment — avoids orphan rows
    # when providers replay the same payment.failed event.
    existing_payment = db.scalar(
        select(Payment).where(Payment.id == payment_id)
    )
    if existing_payment is not None:
        logger.info(
            "event_ingest idempotent replay payment_id=%s status=%s",
            existing_payment.id,
            existing_payment.status,
        )
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.payment_id == existing_payment.id
            )
        )
        if case is None:
            case = process_payment(db, existing_payment)
            db.flush()
        return {
            "message": "Simulated payment event replayed (idempotent).",
            "event": SUPPORTED_EVENT,
            "simulated": True,
            "idempotent": True,
            "payment_id": existing_payment.id,
            "order_id": existing_payment.order_id,
            "case_id": case.id if case else None,
            "case_number": case.case_number if case else None,
            "case_status": (
                case.status.value
                if case and hasattr(case.status, "value")
                else (str(case.status) if case else None)
            ),
            "payment_status": existing_payment.status,
        }

    order = Order(
        id=str(uuid4()),
        customer_id=customer.id,
        product_id=product.id,
        total_amount=amount,
        status="FAILED",
    )
    db.add(order)
    db.flush()

    payment = Payment(
        id=payment_id,
        order_id=order.id,
        amount=amount,
        currency=currency,
        payment_type="ONE_TIME",
        status="FAILED",
        failure_code=str(failure_data["code"]).strip()[:100],
        failure_reason=str(failure_data["reason"]).strip(),
        event_source=(
            "LIVE_PROVIDER"
            if str(event_source).upper() == "LIVE_PROVIDER"
            else "DEMO_EVENT"
        ),
    )
    db.add(payment)
    db.flush()

    payment.order = order
    order.customer = customer

    logger.info(
        "event_ingest payment.failed amount=%s currency=%s "
        "failure_code=%s customer_email=%s",
        amount,
        currency,
        payment.failure_code,
        customer.email,
    )

    case = process_payment(db, payment)
    db.flush()

    if case is None:
        raise RuntimeError(
            "Recovery pipeline did not start for failed payment."
        )

    case_status = (
        case.status.value
        if hasattr(case.status, "value")
        else str(case.status)
    )

    if case.status == CaseStatus.RECOVERED:
        logger.warning(
            "event_ingest unexpected RECOVERED on ingest "
            "case_number=%s",
            case.case_number,
        )

    return {
        "message": (
            "Simulated payment.failed event accepted. "
            "Recovery pipeline started."
        ),
        "event": SUPPORTED_EVENT,
        "simulated": True,
        "idempotent": False,
        "payment_id": payment.id,
        "order_id": order.id,
        "case_id": case.id,
        "case_number": case.case_number,
        "case_status": case_status,
        "payment_status": payment.status,
        "failure_code": payment.failure_code,
        "failure_reason": payment.failure_reason,
        "event_source": getattr(payment, "event_source", "DEMO_EVENT"),
    }


def _mask_email(email: str | None) -> str:
    value = str(email or "").strip().lower()
    if not value or "@" not in value:
        return "customer***"
    local, _, domain = value.partition("@")
    visible = (local[:1] if local else "*") + "***"
    return f"{visible}@{domain}"


def get_provider_event_capabilities() -> dict:
    """Describe which provider events the demo console can safely handle."""
    capabilities = [
        {
            "event": SUPPORTED_EVENT,
            "supported": True,
            "state_mutating": True,
            "ingestion_path": "/api/events/payment",
            "note": (
                "Creates a failed Payment and RecoveryCase, then runs the "
                "existing recovery orchestrator. Idempotent when replayed "
                "with the same idempotency_key."
            ),
        },
        {
            "event": "payment.captured",
            "supported": False,
            "state_mutating": False,
            "ingestion_path": "/api/webhooks/razorpay",
            "note": NON_MUTATING_PROVIDER_EVENTS["payment.captured"],
        },
    ]
    for event_name in (
        "payment.authorized",
        "payment.expired",
        "payment.refunded",
    ):
        capabilities.append(
            {
                "event": event_name,
                "supported": False,
                "state_mutating": False,
                "ingestion_path": None,
                "note": NON_MUTATING_PROVIDER_EVENTS[event_name],
            }
        )

    return {
        "environment": "DEMO",
        "label": "Provider Event Console",
        "capabilities": capabilities,
    }


def acknowledge_unsupported_provider_event(payload: dict) -> dict:
    """
    Explicitly reject non-mutating / unsupported provider events.

    Never changes Payment or RecoveryCase state. Used by the Event Console
    so demos can show the limitation without faking recovery.
    """
    event = str(payload.get("event") or "").strip()
    if event == SUPPORTED_EVENT:
        raise ValueError(
            "payment.failed must use POST /api/events/payment — "
            "do not acknowledge it as unsupported."
        )

    required = NON_MUTATING_PROVIDER_EVENTS.get(event)
    if required is None:
        raise ValueError(
            f"Unknown event type '{event}'. "
            f"Supported mutating event: '{SUPPORTED_EVENT}'."
        )

    if event == "payment.captured":
        required_path = (
            "Verified Razorpay webhook at POST /api/webhooks/razorpay "
            "with matching payment/order and valid signature."
        )
    else:
        required_path = (
            "Domain model extensions for this payment lifecycle state, "
            "plus a dedicated ingestion path with idempotency and audit logging."
        )

    return {
        "message": (
            f"Event '{event}' received as simulation only. "
            "RecoverAI did not mutate payment or recovery state."
        ),
        "event": event,
        "simulated": True,
        "simulation_only": True,
        "mutates_state": False,
        "supported": False,
        "required": required_path,
    }


def list_recent_provider_events(
    db: Session,
    *,
    limit: int = 40,
) -> dict:
    """
    Recent payment-provider-like events from existing Payment + Case rows.

    Not a separate event store — reads RecoverAI domain tables only.
    Idempotency outcome is evaluated at ingest time and is not persisted
    as a plaintext key, so history reports that limitation.
    """
    capped = max(1, min(int(limit or 40), 100))

    payments = db.scalars(
        select(Payment)
        .options(
            joinedload(Payment.order).joinedload(Order.customer),
        )
        .where(Payment.failure_code.is_not(None))
        .order_by(Payment.created_at.desc())
        .limit(capped)
    ).unique().all()

    events = []
    for payment in payments:
        case = db.scalar(
            select(RecoveryCase)
            .where(RecoveryCase.payment_id == payment.id)
            .order_by(RecoveryCase.created_at.desc())
            .limit(1)
        )
        customer_email = None
        if payment.order is not None and payment.order.customer is not None:
            customer_email = payment.order.customer.email

        case_status = None
        if case is not None:
            case_status = (
                case.status.value
                if hasattr(case.status, "value")
                else str(case.status)
            )

        events.append(
            {
                "event": SUPPORTED_EVENT,
                "timestamp": payment.created_at,
                "amount": payment.amount,
                "currency": payment.currency,
                "customer_ref": _mask_email(customer_email),
                "payment_id": payment.id,
                "case_id": case.id if case else None,
                "case_number": case.case_number if case else None,
                "case_status": case_status,
                "payment_status": payment.status,
                "failure_code": payment.failure_code,
                "failure_reason": payment.failure_reason,
                "event_source": getattr(payment, "event_source", "DEMO_EVENT"),
                "event_source_label": (
                    "Verified Webhook"
                    if case_status == "RECOVERED"
                    else (
                        "Live Provider Event"
                        if getattr(payment, "event_source", None)
                        == "LIVE_PROVIDER"
                        else "Demo Event"
                    )
                ),
                "idempotency_state": (
                    "evaluated_at_ingest"
                    " — keys are not stored; use Replay in the console "
                    "with the same key to demonstrate idempotent=true"
                ),
            }
        )

    return {
        "events": events,
        "source": "payments+recovery_cases",
        "note": (
            "History lists failed payments that started recovery. "
            "Replay the same demo event with the same key to show it is not duplicated."
        ),
    }
