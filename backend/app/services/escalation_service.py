from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryStrategy,
    RecoveryAction,
    RecoveryResult,
    StrategyType,
    RecoveryResultStatus,
    CaseStatus,
)

from app.services.safety_service import (
    check_action_safety,
)


# ============================================================
# STRATEGY SEQUENCES
# ============================================================

STRATEGY_SEQUENCES = {

    "INSUFFICIENT_FUNDS": [
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_WHATSAPP_MESSAGE,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.HUMAN_ESCALATION,
    ],

    "CARD_DECLINED": [
        StrategyType.OFFER_ALT_PAYMENT_METHOD,
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.HUMAN_ESCALATION,
    ],

    "EXPIRED_CARD": [
        StrategyType.OFFER_ALT_PAYMENT_METHOD,
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.HUMAN_ESCALATION,
    ],

    "GATEWAY_TIMEOUT": [
        StrategyType.RETRY_AFTER_DELAY,
        StrategyType.RETRY_AFTER_DELAY,
        StrategyType.HUMAN_ESCALATION,
    ],

    "TECHNICAL_FAILURE": [
        StrategyType.RETRY_AFTER_DELAY,
        StrategyType.RETRY_AFTER_DELAY,
        StrategyType.HUMAN_ESCALATION,
    ],

    "AUTHENTICATION_FAILED": [
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.OFFER_ALT_PAYMENT_METHOD,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.HUMAN_ESCALATION,
    ],
}


# ============================================================
# GET PREVIOUS STRATEGIES
# ============================================================

def get_used_strategies(
    db: Session,
    case_id: str,
):
    """
    Return strategies already attempted for this case.
    """

    strategies = db.scalars(
        select(RecoveryStrategy)
        .where(
            RecoveryStrategy.case_id == case_id
        )
        .order_by(
            RecoveryStrategy.created_at
        )
    ).all()

    return [
        strategy.strategy_type
        for strategy in strategies
    ]


# ============================================================
# SELECT NEXT STRATEGY
# ============================================================

def select_next_strategy(
    db: Session,
    case: RecoveryCase,
):
    """
    Decide the next strategy after an unsuccessful
    recovery attempt.
    """

    # --------------------------------------------------------
    # Get recovery result
    # --------------------------------------------------------

    recovery_result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if not recovery_result:
        return None, "Recovery result not found."

    # --------------------------------------------------------
    # Already fully recovered
    # --------------------------------------------------------

    if (
        recovery_result.status
        == RecoveryResultStatus.FULLY_RECOVERED
    ):
        return None, "Payment already fully recovered."

    # --------------------------------------------------------
    # Case no longer active
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ]:
        return None, "Case is already closed."

    # --------------------------------------------------------
    # Get strategy sequence
    # --------------------------------------------------------

    failure_code = case.failure_category.value

    sequence = STRATEGY_SEQUENCES.get(
        failure_code,
        [],
    )

    if not sequence:
        return None, "No recovery strategy sequence available."

    # --------------------------------------------------------
    # Find strategies already attempted
    # --------------------------------------------------------

    used_strategies = get_used_strategies(
        db,
        case.id,
    )

    # --------------------------------------------------------
    # Find next strategy
    # --------------------------------------------------------

    for strategy in sequence:

        # For retry strategies we allow repetition
        if strategy in [
            StrategyType.RETRY_AFTER_DELAY,
            StrategyType.IMMEDIATE_RETRY,
        ]:
            retry_count = used_strategies.count(
                strategy
            )

            if retry_count < sequence.count(strategy):
                return strategy, "Next retry strategy selected."

        else:

            if strategy not in used_strategies:
                return strategy, "Next recovery strategy selected."

    # --------------------------------------------------------
    # No strategies remaining
    # --------------------------------------------------------

    return (
        StrategyType.HUMAN_ESCALATION,
        "All automated recovery strategies exhausted.",
    )


# ============================================================
# CREATE NEXT STRATEGY
# ============================================================

def create_next_strategy(
    db: Session,
    case: RecoveryCase,
):
    """
    Create and select the next strategy.
    """

    strategy_type, reason = select_next_strategy(
        db,
        case,
    )

    if strategy_type is None:
        return None

    # --------------------------------------------------------
    # Safety check
    # --------------------------------------------------------

    allowed, safety_reason = check_action_safety(
        db,
        case,
        strategy_type,
    )

    if not allowed:

        case.status = CaseStatus.ESCALATED

        case.current_step = (
            "Recovery Blocked by Safety Engine"
        )

        db.add(case)

        return None

    # --------------------------------------------------------
    # Create strategy
    # --------------------------------------------------------

    strategy = RecoveryStrategy(
        id=str(__import__("uuid").uuid4()),

        case_id=case.id,

        strategy_type=strategy_type,

        rationale=reason,

        expected_probability=(
            case.recovery_probability
        ),

        stopping_rules=(
            "Stop when payment is recovered, "
            "safety limits are reached, or "
            "automated strategies are exhausted."
        ),

        is_selected=True,
    )

    # --------------------------------------------------------
    # Deselect previous strategies
    # --------------------------------------------------------

    previous_strategies = db.scalars(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    ).all()

    for previous in previous_strategies:
        previous.is_selected = False

    db.add(strategy)

    case.selected_strategy = strategy_type

    case.current_step = "Next Strategy Selected"

    db.add(case)

    db.flush()

    return strategy