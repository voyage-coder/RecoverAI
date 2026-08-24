import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    RecoveryResultStatus,
    ActionStatus,
)

from app.services.result_service import (
    update_recovery_result,
)


random.seed(42)


def simulate_recovery_outcome(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction,
):
    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if not result:
        raise ValueError(
            "RecoveryResult does not exist."
        )

    # Don't simulate an already recovered case
    if result.status == RecoveryResultStatus.FULLY_RECOVERED:
        return result

    probability = case.recovery_probability

    random_value = random.randint(1, 100)

    if random_value <= probability:

        # Full recovery
        recovered_amount = case.amount_at_risk

    elif random_value <= probability + 15:

        # Partial recovery
        recovered_amount = int(
            case.amount_at_risk * 0.5
        )

    else:

        # No recovery
        recovered_amount = 0

    update_recovery_result(
        db=db,
        case=case,
        action=action,
        recovered_amount=recovered_amount,
    )

    db.commit()

    return result