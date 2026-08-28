"""
Razorpay webhook routes.

POST /api/webhooks/razorpay receives the raw body for signature verification.
"""

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.razorpay_webhook_service import (
    process_razorpay_webhook,
)


router = APIRouter(
    prefix="/api/webhooks",
    tags=["Webhooks"],
)


@router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_razorpay_signature: str | None = Header(
        default=None,
        alias="X-Razorpay-Signature",
    ),
):
    """
    Razorpay TEST MODE webhook endpoint.

    Signature verification uses the exact raw request body.
    Do not parse/re-serialize before verification.
    """

    raw_body = await request.body()

    result = process_razorpay_webhook(
        db,
        raw_body=raw_body,
        signature=x_razorpay_signature,
    )

    payload = {
        "status": result.status,
        "detail": result.detail,
        "event": result.event,
        "idempotent": result.idempotent,
        "case_id": result.case_id,
        "payment_id": result.payment_id,
    }

    if not result.accepted:
        status_code = 400
        if result.status in {
            "invalid_signature",
            "missing_signature",
        }:
            status_code = 401
        elif result.status == "misconfigured":
            status_code = 503

        return JSONResponse(
            status_code=status_code,
            content=payload,
        )

    if result.modified:
        db.commit()
    else:
        db.rollback()

    return payload
