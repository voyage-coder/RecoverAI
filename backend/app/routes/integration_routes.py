"""
Read-only merchant integration status.

Does not expose secrets, modify recovery logic, or change webhook verification.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

from app.services.payment_gateway_service import (
    is_razorpay_configured,
    is_webhook_secret_configured,
)


router = APIRouter(
    prefix="/api/integrations",
    tags=["Integrations"],
)


@router.get("/status")
def get_integration_status():
    """
    Safe integration flags for the merchant Integrations UI.

    Why this endpoint exists:
    - Existing checkout-config requires a case id and does not report
      webhook-secret presence.
    - Returning only booleans avoids exposing RAZORPAY_KEY_SECRET /
      RAZORPAY_WEBHOOK_SECRET while still showing Configured / Not configured.
    """

    public_base = os.getenv("PUBLIC_BACKEND_URL", "").strip() or None
    credentials = is_razorpay_configured()
    webhook_secret = is_webhook_secret_configured()

    return {
        "provider": "Razorpay",
        "environment": "TEST",
        "test_mode": True,
        "credentials_configured": credentials,
        "webhook_secret_configured": webhook_secret,
        # Whether Razorpay Dashboard has subscribed to this URL is unknown.
        "webhook_dashboard_configured": None,
        "webhook_path": "/api/webhooks/razorpay",
        "public_base_url": public_base,
        "failure_ingestion_path": "/api/events/payment",
        "supported_webhook_events": ["payment.captured"],
        "notes": (
            "Secrets are never returned. "
            "Webhook Dashboard subscription status cannot be detected "
            "from RecoverAI — configure payment.captured in Razorpay."
        ),
    }
