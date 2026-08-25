from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryStrategy,
    StrategyType,
)

from app.services.ai.strategy_ranker import (
    rank_strategies,
)


# ============================================================
# FALLBACK STRATEGY RULES
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
# ML STRATEGY RATIONALE
# ============================================================

def build_ml_rationale(
    strategy: str,
    probability: float,
) -> str:

    return (
        f"ML model predicts a {probability:.2f}% "
        f"recovery probability for {strategy}. "
        f"This strategy was ranked highest among "
        f"the available recovery strategies."
    )


# ============================================================
# CREATE STRATEGY
# ============================================================

def create_strategy(
    db: Session,
    case: RecoveryCase,
):

    failure_code = case.failure_category.value

    # --------------------------------------------------------
    # Check if an active strategy already exists
    # --------------------------------------------------------

    existing_strategy = db.scalar(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    )

    if existing_strategy:
        return existing_strategy

    # ========================================================
    # STEP 1 — ML STRATEGY RANKING
    # ========================================================

    try:

        rankings = rank_strategies(
            case=case
        )

    except Exception as error:

        print(
            f"ML strategy ranking failed for "
            f"{case.case_number}: {error}"
        )

        rankings = []

    # ========================================================
    # STEP 2 — SELECT ML STRATEGY
    # ========================================================

    if rankings:

        best = rankings[0]

        strategy_name = best["strategy"]

        probability = best["probability"]

        strategy_type = StrategyType(
            strategy_name
        )

        rationale = build_ml_rationale(
            strategy=strategy_name,
            probability=probability,
        )

        expected_probability = round(
            probability
        )

    # ========================================================
    # STEP 3 — FALLBACK TO RULES
    # ========================================================

    else:

        rule = STRATEGY_RULES.get(
            failure_code
        )

        if rule is None:
            return None

        strategy_type = rule["strategy"]

        rationale = (
            rule["rationale"]
            + " ML ranking was unavailable, "
            "so the rule-based fallback was used."
        )

        expected_probability = (
            rule["probability"]
        )

    # ========================================================
    # STEP 4 — CHECK IF THIS STRATEGY ALREADY EXISTS
    # ========================================================

    existing_strategy = db.scalar(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.strategy_type == strategy_type,
        )
    )

    if existing_strategy:

        existing_strategy.is_selected = True

        case.selected_strategy = strategy_type

        case.recovery_probability = (
            expected_probability
        )

        case.current_step = "Strategy Selected"

        db.add(case)

        return existing_strategy

    # ========================================================
    # STEP 5 — DESELECT PREVIOUS STRATEGIES
    # ========================================================

    previous_strategies = db.scalars(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    ).all()

    for previous in previous_strategies:

        previous.is_selected = False

    # ========================================================
    # STEP 6 — CREATE NEW STRATEGY
    # ========================================================

    strategy = RecoveryStrategy(
        id=str(__import__("uuid").uuid4()),

        case_id=case.id,

        strategy_type=strategy_type,

        rationale=rationale,

        expected_probability=expected_probability,

        stopping_rules=(
            "Stop recovery if payment is successfully "
            "recovered or safety policy blocks further "
            "attempts."
        ),

        is_selected=True,
    )

    db.add(strategy)

    # ========================================================
    # STEP 7 — UPDATE CASE
    # ========================================================

    case.selected_strategy = strategy_type

    case.recovery_probability = (
        expected_probability
    )

    case.current_step = "Strategy Selected"

    db.add(case)

    return strategy


# ============================================================
# CREATE STRATEGIES FOR ALL ACTIVE CASES
# ============================================================

def create_strategies(
    db: Session,
):

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status == "ACTIVE"
        )
    ).all()

    strategies = []

    for case in cases:

        strategy = create_strategy(
            db=db,
            case=case,
        )

        if strategy:

            strategies.append(
                strategy
            )

    db.commit()

    return strategies