"""
Merchant integration status, Razorpay TEST onboarding, connection test.

Never returns API secrets or webhook secrets.
"""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.api_schemas import (
    ConnectionTestResponse,
    MerchantPolicyUpdateRequest,
    MerchantSettingsResponse,
    RazorpayCredentialsRequest,
)
from app.services.payment_gateway_service import (
    is_razorpay_configured,
    is_webhook_secret_configured,
    get_gateway_mode,
    get_razorpay_public_key_id,
)
from app.services.merchant_settings_service import (
    get_or_create_settings,
    public_settings_payload,
    store_razorpay_credentials,
    update_policy,
)
from app.services.recovery_mode_service import (
    run_automatic_recovery_queue_job,
)


router = APIRouter(
    prefix="/api/integrations",
    tags=["Integrations"],
)


def _safe_status(db: Session) -> dict:
    settings = get_or_create_settings(db)
    public = public_settings_payload(settings)
    public_base = os.getenv("PUBLIC_BACKEND_URL", "").strip() or None
    credentials = is_razorpay_configured()
    webhook_secret = is_webhook_secret_configured()

    return {
        "provider": "Razorpay",
        "environment": "TEST",
        "test_mode": True,
        "credentials_configured": credentials,
        "webhook_secret_configured": webhook_secret,
        "webhook_dashboard_configured": None,
        "webhook_path": "/api/webhooks/razorpay",
        "public_base_url": public_base,
        "failure_ingestion_path": "/api/events/payment",
        "supported_webhook_events": [
            "payment.failed",
            "payment.captured",
        ],
        "razorpay_key_id_hint": public.get("razorpay_key_id_hint"),
        "gateway_mode": get_gateway_mode(),
        "recovery_mode": public.get("recovery_mode"),
        "notes": (
            "Secrets are never returned. "
            "payment.captured is the only event that can mark RECOVERED. "
            "payment.failed starts recovery through the existing pipeline."
        ),
        "merchant_settings": public,
    }


@router.get("/status")
def get_integration_status(db: Session = Depends(get_db)):
    return _safe_status(db)


@router.get(
    "/settings",
    response_model=MerchantSettingsResponse,
)
def get_merchant_settings(db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    return public_settings_payload(settings)


@router.put(
    "/settings",
    response_model=MerchantSettingsResponse,
)
def put_merchant_settings(
    body: MerchantPolicyUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    try:
        settings = update_policy(db, body.model_dump(exclude_unset=True))
        db.commit()
        payload = public_settings_payload(settings)
        auto_on = (
            str(payload.get("recovery_mode") or "").upper() == "AUTOMATIC"
            and bool(payload.get("automatic_recovery_enabled"))
        )
        if auto_on:
            background_tasks.add_task(run_automatic_recovery_queue_job)
            payload["automatic_run"] = {
                "ran": True,
                "queued": True,
            }
        else:
            payload["automatic_run"] = {
                "ran": False,
                "queued": False,
            }
        return payload
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/razorpay-credentials",
    response_model=MerchantSettingsResponse,
)
def save_razorpay_credentials(
    body: RazorpayCredentialsRequest,
    db: Session = Depends(get_db),
):
    try:
        settings = store_razorpay_credentials(
            db, body.model_dump(exclude_unset=True)
        )
        db.commit()
        payload = public_settings_payload(settings)
        for forbidden in (
            "key_secret",
            "webhook_secret",
            "razorpay_key_secret",
            "razorpay_webhook_secret",
        ):
            if forbidden in payload:
                raise HTTPException(
                    status_code=500,
                    detail="Refusing to return secrets.",
                )
        return payload
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/test-connection",
    response_model=ConnectionTestResponse,
)
def test_razorpay_connection(db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    if not is_razorpay_configured():
        settings.credentials_last_tested_at = datetime.utcnow()
        settings.credentials_last_test_ok = False
        settings.credentials_last_test_detail = (
            "Razorpay TEST credentials are not configured."
        )
        db.add(settings)
        db.commit()
        return {
            "ok": False,
            "mode": get_gateway_mode(),
            "detail": settings.credentials_last_test_detail,
            "secrets_returned": False,
        }

    key_id = get_razorpay_public_key_id()
    if key_id.startswith("rzp_live_"):
        return {
            "ok": False,
            "mode": "REJECTED_LIVE",
            "detail": "Live keys are not allowed.",
            "secrets_returned": False,
        }

    try:
        from app.services.payment_gateway_service import _get_razorpay_client

        client = _get_razorpay_client()
        client.order.all({"count": 1})
        detail = "Razorpay TEST API accepted the stored credentials."
        ok = True
    except Exception as exc:
        detail = f"Connection test failed: {type(exc).__name__}"
        ok = False

    settings.credentials_last_tested_at = datetime.utcnow()
    settings.credentials_last_test_ok = ok
    settings.credentials_last_test_detail = detail[:240]
    db.add(settings)
    db.commit()

    return {
        "ok": ok,
        "mode": get_gateway_mode(),
        "detail": detail,
        "secrets_returned": False,
    }
