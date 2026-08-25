from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    StrategyType,
)

from app.services.ai.strategy_ranker import (
    rank_strategies,
)

from app.services.safety_service import (
    check_action_safety,
)


def select_safe_strategy(
    db: Session,
    case: RecoveryCase,
) -> dict | None:
    """
    Rank strategies using ML, remove strategies that have
    already been attempted, and return the highest-ranked
    remaining strategy that passes the Safety Engine.

    ML recommends.
    Safety Engine decides.
    """

    # --------------------------------------------------------
    # Get strategies already attempted
    # --------------------------------------------------------

    attempted_actions = db.scalars(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case.id
        )
    ).all()

    attempted_strategies = {
        action.action_type
        for action in attempted_actions
    }

    # --------------------------------------------------------
    # ML ranking
    # --------------------------------------------------------

    rankings = rank_strategies(
        case=case
    )

    evaluated = []

    for ranking in rankings:

        strategy_name = ranking["strategy"]

        # ----------------------------------------------------
        # Skip strategies already attempted
        # ----------------------------------------------------

        strategy = StrategyType(
            strategy_name
        )

        if strategy in attempted_strategies:

            evaluated.append({
                "strategy": strategy_name,
                "probability": ranking["probability"],
                "allowed": False,
                "reason": "Strategy already attempted.",
            })

            continue

        # ----------------------------------------------------
        # Safety check
        # ----------------------------------------------------

        allowed, reason = check_action_safety(
            db=db,
            case=case,
            strategy=strategy,
        )

        evaluated.append({
            "strategy": strategy_name,
            "probability": ranking["probability"],
            "allowed": allowed,
            "reason": reason,
        })

        # ----------------------------------------------------
        # First safe unused strategy wins
        # ----------------------------------------------------

        if allowed:

            return {
                "strategy": strategy,
                "probability": ranking["probability"],
                "safety_reason": reason,
                "rankings": evaluated,
            }

    # --------------------------------------------------------
    # Nothing available
    # --------------------------------------------------------

    return {
        "strategy": None,
        "probability": None,
        "safety_reason": (
            "No unused recovery strategy passed "
            "the Safety Engine."
        ),
        "rankings": evaluated,
    }