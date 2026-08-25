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

from app.services.ai.safe_strategy_selector import (
    select_safe_strategy,
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

    safety_reason = selection["safety_reason"]

    # ========================================================
    # CREATE / REUSE STRATEGY RECORD
    # ========================================================

    strategy = db.scalar(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.strategy_type
            == selected_strategy,
        )
        .order_by(
            RecoveryStrategy.created_at.desc()
        )
    )

    if strategy:

        strategy.is_selected = True

    else:

        strategy = RecoveryStrategy(
            id=str(__import__("uuid").uuid4()),

            case_id=case.id,

            strategy_type=selected_strategy,

            rationale=(
                f"ML model predicted "
                f"{probability:.2f}% recovery probability. "
                f"Safety Engine approved the strategy. "
                f"{safety_reason}"
            ),

            expected_probability=round(
                probability
            ),

            stopping_rules=(
                "Stop recovery if payment is successfully "
                "recovered or safety policy blocks further "
                "attempts."
            ),

            is_selected=True,
        )

        db.add(strategy)

    # --------------------------------------------------------
    # Deselect other strategies
    # --------------------------------------------------------

    other_strategies = db.scalars(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.id != strategy.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    ).all()

    for other in other_strategies:

        other.is_selected = False

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