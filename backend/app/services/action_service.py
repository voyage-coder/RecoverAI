from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    StrategyType,
    ActionStatus,
    CaseStatus
)

from app.services.safety_service import (
    check_action_safety,
)


def create_recovery_action(
    db: Session,
    case: RecoveryCase,
    strategy: RecoveryStrategy,
):

    strategy_type = strategy.strategy_type

    # --------------------------------------------------------
    # SAFETY CHECK
    # --------------------------------------------------------

    allowed, reason = check_action_safety(
        db,
        case,
        strategy_type,
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
    # CREATE ACTION
    # --------------------------------------------------------

    action = RecoveryAction(
        id=str(uuid4()),
        case_id=case.id,
        action_type=strategy_type,
        status=ActionStatus.PENDING,
        attempt_number=case.retry_count + 1,
        scheduled_at=scheduled_at,
    )

    db.add(action)

    # --------------------------------------------------------
    # UPDATE CASE
    # --------------------------------------------------------

    case.status = CaseStatus.IN_PROGRESS
    case.current_step = "Action Scheduled"

    return action


def create_actions(db: Session):

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