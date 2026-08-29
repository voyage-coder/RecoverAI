"""
Simulated payment-provider event routes.

POST /api/events/payment accepts demo payment.failed payloads.
GET  /api/events/recent    lists recent failure ingestions from domain tables.
GET  /api/events/capabilities describes supported vs simulation-only events.
POST /api/events/acknowledge records unsupported events without state mutation.

This is event simulation — not a Razorpay webhook.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.api_schemas import (
    PaymentEventRequest,
    PaymentEventResponse,
    ProviderEventCapabilitiesResponse,
    RecentProviderEventsResponse,
    UnsupportedProviderEventRequest,
    UnsupportedProviderEventResponse,
)
from app.services.event_ingestion_service import (
    acknowledge_unsupported_provider_event,
    get_provider_event_capabilities,
    ingest_payment_failed_event,
    list_recent_provider_events,
)


router = APIRouter(
    prefix="/api/events",
    tags=["Events"],
)


@router.get(
    "/capabilities",
    response_model=ProviderEventCapabilitiesResponse,
    summary="Provider event capabilities (demo console)",
)
def provider_event_capabilities():
    return get_provider_event_capabilities()


@router.get(
    "/recent",
    response_model=RecentProviderEventsResponse,
    summary="Recent provider-like payment events",
    description=(
        "Derived from existing Payment + RecoveryCase rows "
        "(failure_code present). Not a separate event database."
    ),
)
def recent_provider_events(
    limit: int = Query(default=40, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return list_recent_provider_events(db, limit=limit)


@router.post(
    "/payment",
    response_model=PaymentEventResponse,
    summary="Ingest simulated payment.failed event",
    description=(
        "Demo / event-simulation endpoint for payment-provider failures. "
        "Creates a failed Payment and RecoveryCase, then calls the "
        "existing recovery orchestrator. Not a Razorpay webhook."
    ),
)
def ingest_payment_event(
    body: PaymentEventRequest,
    db: Session = Depends(get_db),
):
    try:
        result = ingest_payment_failed_event(
            db,
            body.model_dump(),
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception:
        db.rollback()
        raise


@router.post(
    "/acknowledge",
    response_model=UnsupportedProviderEventResponse,
    summary="Acknowledge unsupported provider event (no state change)",
    description=(
        "Accepts payment.captured / authorized / expired / refunded for "
        "demo console UX only. Never mutates Payment or RecoveryCase. "
        "RECOVERED remains webhook-only via POST /api/webhooks/razorpay."
    ),
)
def acknowledge_provider_event(
    body: UnsupportedProviderEventRequest,
):
    try:
        return acknowledge_unsupported_provider_event(body.model_dump())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
