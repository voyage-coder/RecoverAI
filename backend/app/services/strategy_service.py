from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryStrategy,
    StrategyType,
)


# ============================================================
# STRATEGY RULES
# ============================================================

STRATEGY_RULES = {
    "GATEWAY_TIMEOUT": {
        "strategy": StrategyType.RETRY_AFTER_DELAY,
        "rationale": (
            "Gateway timeout is usually temporary. "
            "Retrying after a short delay may recover "
            "the payment without contacting the customer."
        ),
        "probability": 80,
    },

    "TECHNICAL_FAILURE": {
        "strategy": StrategyType.RETRY_AFTER_DELAY,
        "rationale": (
            "The failure appears temporary. "
            "A delayed retry is preferred before "
            "customer communication."
        ),
        "probability": 75,
    },

    "INSUFFICIENT_FUNDS": {
        "strategy": StrategyType.SEND_PAYMENT_LINK,
        "rationale": (
            "The customer may need to use another payment "
            "method or retry after funds become available."
        ),
        "probability": 70,
    },

    "CARD_DECLINED": {
        "strategy": StrategyType.OFFER_ALT_PAYMENT_METHOD,
        "rationale": (
            "The card was declined, so offering an alternative "
            "payment method is preferable to repeated retries."
        ),
        "probability": 55,
    },

    "EXPIRED_CARD": {
        "strategy": StrategyType.OFFER_ALT_PAYMENT_METHOD,
        "rationale": (
            "The existing payment method has expired. "
            "The customer needs to use another payment method."
        ),
        "probability": 35,
    },

    "AUTHENTICATION_FAILED": {
        "strategy": StrategyType.SEND_PAYMENT_LINK,
        "rationale": (
            "Authentication failed. Sending the customer "
            "a fresh payment flow can allow authentication "
            "to be completed again."
        ),
        "probability": 50,
    },
}


# ============================================================
# CREATE STRATEGY
# ============================================================

def create_strategy(
    db: Session,
    case: RecoveryCase,
):

    failure_code = case.failure_category.value

    rule = STRATEGY_RULES.get(failure_code)

    if rule is None:
        return None

    # --------------------------------------------------------
    # Check whether strategy already exists
    # --------------------------------------------------------

    existing_strategy = db.scalar(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.strategy_type == rule["strategy"],
        )
    )

    if existing_strategy:
        return existing_strategy

    # --------------------------------------------------------
    # Create strategy
    # --------------------------------------------------------

    strategy = RecoveryStrategy(
        id=str(__import__("uuid").uuid4()),

        case_id=case.id,

        strategy_type=rule["strategy"],

        rationale=rule["rationale"],

        expected_probability=rule["probability"],

        stopping_rules=(
            "Stop recovery if payment is successfully recovered "
            "or safety policy blocks further attempts."
        ),

        is_selected=True,
    )

    db.add(strategy)

    # --------------------------------------------------------
    # Update case
    # --------------------------------------------------------

    case.selected_strategy = rule["strategy"]
    case.current_step = "Strategy Selected"

    db.add(case)

    return strategy


# ============================================================
# CREATE STRATEGIES FOR ALL CASES
# ============================================================

def create_strategies(db: Session):

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status == "ACTIVE"
        )
    ).all()

    strategies = []

    for case in cases:

        strategy = create_strategy(
            db,
            case,
        )

        if strategy:
            strategies.append(strategy)

    db.commit()

    return strategies