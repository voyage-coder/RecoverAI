from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    Payment,
    RecoveryCase,
    FailureCategory,
)


# ============================================================
# FAILURE CATEGORY MAPPING
# ============================================================

FAILURE_CATEGORY_MAP = {
    "INSUFFICIENT_FUNDS": FailureCategory.INSUFFICIENT_FUNDS,
    "CARD_DECLINED": FailureCategory.CARD_DECLINED,
    "EXPIRED_CARD": FailureCategory.EXPIRED_CARD,
    "GATEWAY_TIMEOUT": FailureCategory.GATEWAY_TIMEOUT,
    "TECHNICAL_FAILURE": FailureCategory.TECHNICAL_FAILURE,
    "AUTHENTICATION_FAILED": FailureCategory.AUTHENTICATION_FAILED,
}


# ============================================================
# CREATE RECOVERY CASE
# ============================================================

def create_recovery_case(
    db: Session,
    payment: Payment,
    case_number: str,
) -> RecoveryCase:

    # --------------------------------------------------------
    # Check whether this payment already has a recovery case
    # --------------------------------------------------------

    existing_case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.payment_id == payment.id
        )
    )

    if existing_case:
        return existing_case

    # --------------------------------------------------------
    # Determine failure category
    # --------------------------------------------------------

    failure_category = FAILURE_CATEGORY_MAP.get(
        payment.failure_code,
        FailureCategory.TECHNICAL_FAILURE,
    )

    # --------------------------------------------------------
    # Create recovery case
    # --------------------------------------------------------

    recovery_case = RecoveryCase(
        id=str(uuid4()),

        case_number=case_number,

        payment_id=payment.id,

        customer_id=payment.order.customer_id,

        amount_at_risk=payment.amount,

        status="ACTIVE",

        failure_category=failure_category,

        failure_reason=(
            payment.failure_reason
            or "Unknown payment failure."
        ),

        current_step="Case Created",

        retry_count=0,

        contact_count=0,
    )

    db.add(recovery_case)

    return recovery_case


# ============================================================
# CREATE CASES FOR FAILED PAYMENTS
# ============================================================

def create_recovery_cases(db: Session):

    failed_payments = db.scalars(
        select(Payment).where(
            Payment.status == "FAILED"
        )
    ).all()

    created_cases = []

    # Start after existing cases
    existing_count = db.query(
        RecoveryCase
    ).count()

    case_number = existing_count + 1

    for payment in failed_payments:

        # ----------------------------------------------------
        # Skip payments that already have a case
        # ----------------------------------------------------

        existing_case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.payment_id == payment.id
            )
        )

        if existing_case:
            created_cases.append(existing_case)
            continue

        case_number_string = (
            f"RC-{case_number:06d}"
        )

        recovery_case = create_recovery_case(
            db=db,
            payment=payment,
            case_number=case_number_string,
        )

        created_cases.append(recovery_case)

        case_number += 1

    db.commit()

    return created_cases