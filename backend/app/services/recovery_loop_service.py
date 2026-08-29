from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    RecoveryResultStatus,
    ActionStatus,
    CaseStatus,
)

from app.services.ai.safe_strategy_selector import (
    select_safe_strategy,
)

from app.services.action_service import (
    create_recovery_action,
)
from app.services.strategy_evaluation_service import (
    persist_strategy_evaluation,
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

    Flow:

    Recovery Result
        ↓
    ML Strategy Ranking
        ↓
    Safety Engine
        ↓
    Next Safe Strategy
        ↓
    Recovery Action
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
    # Stop if case is closed / escalated
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
        CaseStatus.ESCALATED,
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
        .order_by(
            RecoveryAction.created_at.desc()
        )
    )

    if pending_action:

        return pending_action

    # ========================================================
    # ML + SAFETY — SELECT NEXT STRATEGY
    # ========================================================

    selection = select_safe_strategy(
        db=db,
        case=case,
    )

    strategy = persist_strategy_evaluation(
        db=db,
        case=case,
        selection=selection,
    )

    # --------------------------------------------------------
    # No safe strategy available
    # --------------------------------------------------------

    if not selection or not selection["strategy"]:

        case.status = CaseStatus.ESCALATED

        case.current_step = (
            "No Safe Recovery Strategy"
        )

        return None

    # --------------------------------------------------------
    # Selected strategy
    # --------------------------------------------------------

    selected_strategy = selection["strategy"]

    probability = selection["probability"]

    if strategy is None:
        return None

    # --------------------------------------------------------
    # Update case
    # --------------------------------------------------------

    case.selected_strategy = selected_strategy

    case.recovery_probability = round(
        probability
    )

    case.current_step = (
        "Next ML Strategy Selected"
    )

    db.add(case)

    db.flush()

    # ========================================================
    # CREATE NEXT ACTION
    # ========================================================

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

def process_recovery_loops(
    db: Session,
):

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