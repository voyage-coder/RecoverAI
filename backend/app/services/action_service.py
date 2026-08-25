from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    StrategyType,
    ActionStatus,
    CaseStatus,
)

from app.services.safety_service import (
    check_action_safety,
)


def _next_attempt_number(
    db: Session,
    case: RecoveryCase,
) -> int:
    """
    Sequential recovery-action number for this case.

    attempt_number is NOT based on case.retry_count.
    retry_count tracks payment retries only.
    """

    previous_action_count = db.scalar(
        select(
            func.count(RecoveryAction.id)
        ).where(
            RecoveryAction.case_id == case.id
        )
    )

    return (previous_action_count or 0) + 1


# ============================================================
# CREATE RECOVERY ACTION
# ============================================================

def create_recovery_action(
    db: Session,
    case: RecoveryCase,
    strategy: RecoveryStrategy,
):
    """
    Create one recovery action for a selected strategy.

    Flow:

    Strategy
        ↓
    Safety Engine
        ↓
    Action
    """

    strategy_type = strategy.strategy_type

    # --------------------------------------------------------
    # SAFETY CHECK
    # --------------------------------------------------------

    allowed, reason = check_action_safety(
        db=db,
        case=case,
        strategy=strategy_type,
    )

    # --------------------------------------------------------
    # BLOCKED
    # --------------------------------------------------------

    if not allowed:

        action = RecoveryAction(
            id=str(uuid4()),
            case_id=case.id,
            action_type=strategy_type,
            status=ActionStatus.BLOCKED,
            attempt_number=_next_attempt_number(
                db=db,
                case=case,
            ),
            result_text=reason,
        )

        db.add(action)

        return action

    # --------------------------------------------------------
    # STOP RECOVERY
    # --------------------------------------------------------

    if strategy_type == StrategyType.STOP_RECOVERY:

        action = RecoveryAction(
            id=str(uuid4()),
            case_id=case.id,
            action_type=strategy_type,
            status=ActionStatus.EXECUTED,
            attempt_number=_next_attempt_number(
                db=db,
                case=case,
            ),
            executed_at=datetime.utcnow(),
            result_text=reason,
        )

        db.add(action)

        case.status = CaseStatus.CLOSED
        case.current_step = "Recovery Stopped"

        return action

    # --------------------------------------------------------
    # PREVENT DUPLICATE ACTIVE ACTION
    # --------------------------------------------------------

    existing_action = db.scalar(
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

    if existing_action:

        return existing_action

    # --------------------------------------------------------
    # SCHEDULE ACTION
    # --------------------------------------------------------

    scheduled_at = None

    if strategy_type == StrategyType.IMMEDIATE_RETRY:

        scheduled_at = datetime.utcnow()

    elif strategy_type == StrategyType.RETRY_AFTER_DELAY:

        scheduled_at = (
            datetime.utcnow()
            + timedelta(minutes=30)
        )

    elif strategy_type in [
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.SEND_SMS_REMINDER,
        StrategyType.SEND_WHATSAPP_MESSAGE,
        StrategyType.OFFER_ALT_PAYMENT_METHOD,
    ]:

        scheduled_at = (
            datetime.utcnow()
            + timedelta(hours=1)
        )

    elif strategy_type == StrategyType.HUMAN_ESCALATION:

        scheduled_at = datetime.utcnow()

    # --------------------------------------------------------
    # CALCULATE RECOVERY ACTION ATTEMPT NUMBER
    # --------------------------------------------------------
    #
    # attempt_number = count(existing RecoveryAction rows) + 1
    #
    # Example:
    #
    # Action 1 → OFFER_ALT_PAYMENT_METHOD → attempt 1
    # Action 2 → RETRY_AFTER_DELAY        → attempt 2
    # Action 3 → SEND_PAYMENT_LINK        → attempt 3
    #
    # --------------------------------------------------------

    attempt_number = _next_attempt_number(
        db=db,
        case=case,
    )

    # --------------------------------------------------------
    # CREATE ACTION
    # --------------------------------------------------------

    action = RecoveryAction(
        id=str(uuid4()),
        case_id=case.id,
        action_type=strategy_type,
        status=ActionStatus.PENDING,
        attempt_number=attempt_number,
        scheduled_at=scheduled_at,
    )

    db.add(action)

    # --------------------------------------------------------
    # UPDATE CASE
    # --------------------------------------------------------

    case.status = CaseStatus.IN_PROGRESS
    case.current_step = "Action Scheduled"

    return action


# ============================================================
# CREATE ACTIONS FOR ACTIVE CASES
# ============================================================

def create_actions(
    db: Session,
):
    """
    Create actions for active recovery cases
    that already have a selected strategy.

    This function does not select the strategy itself.
    Strategy selection is handled by the orchestrator /
    ML + Safety pipeline.
    """

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status == CaseStatus.ACTIVE
        )
    ).all()

    actions = []

    for case in cases:

        strategy = db.scalar(
            select(RecoveryStrategy).where(
                RecoveryStrategy.case_id == case.id,
                RecoveryStrategy.is_selected.is_(True),
            )
            .order_by(
                RecoveryStrategy.created_at.desc()
            )
        )

        if not strategy:
            continue

        action = create_recovery_action(
            db=db,
            case=case,
            strategy=strategy,
        )

        actions.append(action)

    db.commit()

    return actions