from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    RecoveryResult,
    RecoveryResultStatus,
    ActionStatus,
    CaseStatus,
)

from app.services.escalation_service import (
    create_next_strategy,
)

from app.services.action_service import (
    create_recovery_action,
)


# ============================================================
# PROCESS ONE RECOVERY CASE
# ============================================================

def process_recovery_loop(
    db: Session,
    case: RecoveryCase,
):
    """
    Continue recovery after an unsuccessful outcome.
    """

    # --------------------------------------------------------
    # Get recovery result
    # --------------------------------------------------------

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if not result:
        return None

    # --------------------------------------------------------
    # Stop if fully recovered
    # --------------------------------------------------------

    if result.status == (
        RecoveryResultStatus.FULLY_RECOVERED
    ):
        case.status = CaseStatus.RECOVERED
        case.current_step = "Recovery Complete"

        return None

    # --------------------------------------------------------
    # Stop if case is closed
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ]:
        return None

    # --------------------------------------------------------
    # Find existing pending action
    # --------------------------------------------------------

    pending_action = db.scalar(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case.id,
            RecoveryAction.status.in_([
                ActionStatus.PENDING,
                ActionStatus.PROCESSING,
            ]),
        )
    )

    if pending_action:
        return pending_action

    # --------------------------------------------------------
    # Select next strategy
    # --------------------------------------------------------

    strategy = create_next_strategy(
        db=db,
        case=case,
    )

    if not strategy:

        case.status = CaseStatus.ESCALATED
        case.current_step = (
            "No Further Automated Recovery Available"
        )

        return None

    db.flush()

    # --------------------------------------------------------
    # Create action
    # --------------------------------------------------------

    action = create_recovery_action(
        db=db,
        case=case,
        strategy=strategy,
    )

    db.flush()

    return action


# ============================================================
# PROCESS ALL ELIGIBLE CASES
# ============================================================

def process_recovery_loops(db: Session):

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status.in_([
                CaseStatus.ACTIVE,
                CaseStatus.IN_PROGRESS,
            ])
        )
    ).all()

    actions = []

    for case in cases:

        action = process_recovery_loop(
            db=db,
            case=case,
        )

        if action:
            actions.append(action)

    db.commit()

    return actions