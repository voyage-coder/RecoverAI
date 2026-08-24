from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryResult,
    RecoveryResultStatus,
    RecoveryAction,
    ActionStatus,
    CaseStatus,
)


# ============================================================
# CREATE INITIAL RESULT
# ============================================================

def create_initial_result(
    db: Session,
    case: RecoveryCase,
):
    """
    Create the overall recovery result for a case.
    """

    existing_result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if existing_result:
        return existing_result

    result = RecoveryResult(
        id=str(uuid4()),

        case_id=case.id,

        original_amount=case.amount_at_risk,

        recovered_amount=0,

        status=RecoveryResultStatus.PENDING,

        recovery_method=None,

        recovered_at=None,
    )

    db.add(result)

    return result


# ============================================================
# UPDATE RECOVERY RESULT
# ============================================================

def update_recovery_result(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction,
    recovered_amount: int = 0,
):
    """
    Update recovery outcome after an action executes.
    """

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    # --------------------------------------------------------
    # Create result if it doesn't exist
    # --------------------------------------------------------

    if not result:

        result = create_initial_result(
            db,
            case,
        )

        db.flush()

    # --------------------------------------------------------
    # Add recovered amount
    # --------------------------------------------------------

    result.recovered_amount += recovered_amount

    # Never allow recovery above original amount

    if result.recovered_amount > result.original_amount:

        result.recovered_amount = (
            result.original_amount
        )

    # --------------------------------------------------------
    # FULL RECOVERY
    # --------------------------------------------------------

    if (
        result.recovered_amount
        >= result.original_amount
    ):

        result.status = (
            RecoveryResultStatus.FULLY_RECOVERED
        )

        result.recovery_method = (
            action.action_type.value
            if hasattr(
                action.action_type,
                "value"
            )
            else str(action.action_type)
        )

        result.recovered_at = datetime.utcnow()

        case.status = CaseStatus.RECOVERED

        case.current_step = "Recovery Complete"

    # --------------------------------------------------------
    # PARTIAL RECOVERY
    # --------------------------------------------------------

    elif result.recovered_amount > 0:

        result.status = (
            RecoveryResultStatus.PARTIALLY_RECOVERED
        )

        result.recovery_method = (
            action.action_type.value
            if hasattr(
                action.action_type,
                "value"
            )
            else str(action.action_type)
        )

        case.status = CaseStatus.IN_PROGRESS

        case.current_step = "Partial Recovery"

    # --------------------------------------------------------
    # NO RECOVERY
    # --------------------------------------------------------

    else:

        result.status = (
            RecoveryResultStatus.NOT_RECOVERED
        )

        result.recovery_method = (
            action.action_type.value
            if hasattr(
                action.action_type,
                "value"
            )
            else str(action.action_type)
        )

        case.current_step = "Recovery Attempt Failed"

    db.add(result)
    db.add(case)

    return result


# ============================================================
# INITIALIZE RESULTS FOR ALL CASES
# ============================================================

def initialize_results(db: Session):

    cases = db.scalars(
        select(RecoveryCase)
    ).all()

    results = []

    for case in cases:

        result = create_initial_result(
            db,
            case,
        )

        results.append(result)

    db.commit()

    return results