"""
Demo inventory, health, and safe reset.

Deletes only payments with event_source=DEMO_EVENT and related rows.
Never deletes LIVE_PROVIDER payments, their cases, or merchant settings.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schema import (
    AuditLog,
    CaseStatus,
    Communication,
    Customer,
    CustomerRecoveryLink,
    MerchantSettings,
    Order,
    Payment,
    PaymentAttempt,
    RecoveryAction,
    RecoveryCase,
    RecoveryResult,
    RecoveryStrategy,
)
from app.services.merchant_settings_service import (
    get_or_create_settings,
    public_settings_payload,
)
from app.services.payment_gateway_service import (
    get_gateway_mode,
    is_razorpay_configured,
    is_webhook_secret_configured,
)


RESET_CONFIRMATION = "CLEAR_DEMO_DATA"


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _demo_payment_ids(db: Session) -> list[str]:
    return list(
        db.scalars(
            select(Payment.id).where(Payment.event_source == "DEMO_EVENT")
        ).all()
    )


def _live_payment_ids(db: Session) -> list[str]:
    return list(
        db.scalars(
            select(Payment.id).where(Payment.event_source == "LIVE_PROVIDER")
        ).all()
    )


def demo_inventory(db: Session) -> dict:
    demo_ids = _demo_payment_ids(db)
    live_ids = _live_payment_ids(db)
    demo_cases = []
    if demo_ids:
        demo_cases = db.scalars(
            select(RecoveryCase).where(
                RecoveryCase.payment_id.in_(demo_ids)
            )
        ).all()
    live_recovered = 0
    if live_ids:
        live_recovered = db.scalar(
            select(func.count(RecoveryCase.id)).where(
                RecoveryCase.payment_id.in_(live_ids),
                RecoveryCase.status == CaseStatus.RECOVERED,
            )
        ) or 0

    return {
        "can_safely_delete_demo": True,
        "discriminator": "payments.event_source",
        "confirmation_phrase": RESET_CONFIRMATION,
        "demo_payments": len(demo_ids),
        "demo_cases": len(demo_cases),
        "live_payments_preserved": len(live_ids),
        "live_verified_recoveries_preserved": int(live_recovered),
        "merchant_settings_preserved": True,
        "will_remove": {
            "event_source": "DEMO_EVENT",
            "includes_demo_cases_even_if_later_TEST_captured": True,
            "excludes": "LIVE_PROVIDER payments and their recovery cases",
        },
        "note": (
            "Demo Reset removes simulator / Event Console failures and their "
            "cases. Razorpay LIVE_PROVIDER webhook ingestions are kept."
        ),
    }


def reset_demo_data(db: Session, confirmation: str) -> dict:
    if str(confirmation or "").strip() != RESET_CONFIRMATION:
        raise ValueError("confirmation_required")

    inventory_before = demo_inventory(db)
    demo_ids = _demo_payment_ids(db)
    if not demo_ids:
        return {
            "removed_payments": 0,
            "removed_cases": 0,
            "preserved_live_payments": inventory_before[
                "live_payments_preserved"
            ],
            "detail": "No DEMO_EVENT records to remove.",
        }

    case_ids = list(
        db.scalars(
            select(RecoveryCase.id).where(
                RecoveryCase.payment_id.in_(demo_ids)
            )
        ).all()
    )
    order_ids = list(
        db.scalars(
            select(Payment.order_id).where(Payment.id.in_(demo_ids))
        ).all()
    )
    customer_ids = []
    if order_ids:
        customer_ids = list(
            db.scalars(
                select(Order.customer_id).where(Order.id.in_(order_ids))
            ).all()
        )

    if case_ids:
        for model in (
            CustomerRecoveryLink,
            AuditLog,
            Communication,
            RecoveryAction,
            RecoveryStrategy,
            RecoveryResult,
        ):
            rows = db.scalars(
                select(model).where(model.case_id.in_(case_ids))
            ).all()
            for row in rows:
                db.delete(row)
        cases = db.scalars(
            select(RecoveryCase).where(RecoveryCase.id.in_(case_ids))
        ).all()
        for case in cases:
            db.delete(case)

    attempts = db.scalars(
        select(PaymentAttempt).where(
            PaymentAttempt.payment_id.in_(demo_ids)
        )
    ).all()
    for attempt in attempts:
        db.delete(attempt)

    payments = db.scalars(
        select(Payment).where(Payment.id.in_(demo_ids))
    ).all()
    for payment in payments:
        db.delete(payment)

    if order_ids:
        remaining_on_orders = set(
            db.scalars(
                select(Payment.order_id).where(
                    Payment.order_id.in_(order_ids)
                )
            ).all()
        )
        for order in db.scalars(
            select(Order).where(Order.id.in_(order_ids))
        ).all():
            if order.id not in remaining_on_orders:
                db.delete(order)

    if customer_ids:
        still_used = set(
            db.scalars(
                select(Order.customer_id).where(
                    Order.customer_id.in_(customer_ids)
                )
            ).all()
        )
        for customer in db.scalars(
            select(Customer).where(Customer.id.in_(customer_ids))
        ).all():
            if customer.id not in still_used:
                db.delete(customer)

    db.flush()
    # Prove merchant settings still present.
    get_or_create_settings(db)

    return {
        "removed_payments": len(demo_ids),
        "removed_cases": len(case_ids),
        "preserved_live_payments": inventory_before[
            "live_payments_preserved"
        ],
        "preserved_live_verified_recoveries": inventory_before[
            "live_verified_recoveries_preserved"
        ],
        "merchant_settings_preserved": db.get(
            MerchantSettings, "default"
        )
        is not None,
        "detail": "DEMO_EVENT records removed. LIVE_PROVIDER data kept.",
    }


def demo_health(db: Session) -> dict:
    settings = get_or_create_settings(db)
    public = public_settings_payload(settings)
    database_ok = True
    try:
        db.scalar(select(func.count(RecoveryCase.id)))
    except Exception:
        database_ok = False

    active = db.scalar(
        select(func.count(RecoveryCase.id)).where(
            RecoveryCase.status.in_(
                [CaseStatus.ACTIVE, CaseStatus.IN_PROGRESS]
            )
        )
    ) or 0

    last_payment = db.scalar(
        select(Payment).order_by(Payment.created_at.desc())
    )
    last_verified = db.scalar(
        select(RecoveryCase)
        .where(RecoveryCase.status == CaseStatus.RECOVERED)
        .order_by(RecoveryCase.updated_at.desc())
    )

    last_event = None
    if last_payment is not None:
        last_event = {
            "payment_id": last_payment.id,
            "event_source": getattr(
                last_payment, "event_source", "DEMO_EVENT"
            ),
            "status": last_payment.status,
            "created_at": (
                last_payment.created_at.isoformat()
                if last_payment.created_at
                else None
            ),
            "label": (
                "LIVE_PROVIDER"
                if getattr(last_payment, "event_source", None)
                == "LIVE_PROVIDER"
                else "DEMO / SIMULATED"
            ),
        }

    last_webhook = None
    if last_verified is not None:
        last_webhook = {
            "case_id": last_verified.id,
            "case_number": last_verified.case_number,
            "updated_at": (
                last_verified.updated_at.isoformat()
                if last_verified.updated_at
                else None
            ),
            "label": "VERIFIED WEBHOOK / CONFIRMED RECOVERY",
        }

    return {
        "backend_connected": True,
        "database_connected": database_ok,
        "environment": "TEST",
        "razorpay_credentials_configured": is_razorpay_configured(),
        "razorpay_connection_test_ok": settings.credentials_last_test_ok,
        "razorpay_connection_tested_at": (
            settings.credentials_last_tested_at.isoformat()
            if settings.credentials_last_tested_at
            else None
        ),
        "webhook_secret_configured": is_webhook_secret_configured(),
        "webhook_path": "/api/webhooks/razorpay",
        "gateway_mode": get_gateway_mode(),
        "recovery_mode": public.get("recovery_mode"),
        "automatic_recovery_enabled": public.get(
            "automatic_recovery_enabled"
        ),
        "max_automatic_recovery_amount": public.get(
            "max_automatic_recovery_amount"
        ),
        "active_recoveries": int(active),
        "last_provider_event": last_event,
        "last_verified_webhook": last_webhook,
        "secrets_returned": False,
        "razorpay_key_id_hint": public.get("razorpay_key_id_hint"),
    }
