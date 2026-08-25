from typing import Any

from app.schema import RecoveryCase


# ============================================================
# FEATURE NAMES
# ============================================================

FEATURE_NAMES = [
    "amount_at_risk",
    "payment_history_score",
    "risk_tier",
    "failure_category",
    "retry_count",
    "contact_count",
    "strategy_type",
]


# ============================================================
# BUILD FEATURES
# ============================================================

def build_case_features(
    case: RecoveryCase,
    strategy_type: str,
) -> dict[str, Any]:
    """
    Convert a recovery case + candidate strategy
    into the exact feature format expected by
    the trained ML pipeline.

    Numerical features remain numerical.

    Categorical features remain strings because
    the trained model uses OneHotEncoder.
    """

    customer = case.customer

    payment_history_score = (
        customer.payment_history_score
        if customer
        else 50
    )

    risk_tier = (
        customer.risk_tier
        if customer
        else "MEDIUM"
    )

    failure_category = (
        case.failure_category.value
    )

    features = {

        # Numerical features
        "amount_at_risk":
            case.amount_at_risk,

        "payment_history_score":
            payment_history_score,

        "retry_count":
            case.retry_count,

        "contact_count":
            case.contact_count,

        # Categorical features
        "risk_tier":
            risk_tier,

        "failure_category":
            failure_category,

        "strategy_type":
            strategy_type,
    }

    return features


# ============================================================
# CONVERT TO VECTOR
# ============================================================

def case_to_vector(
    case: RecoveryCase,
    strategy_type: str,
) -> list:
    """
    Return features in the same order as FEATURE_NAMES.

    This is mainly useful for debugging/testing.
    The trained sklearn pipeline itself receives
    the dictionary/DataFrame with column names.
    """

    features = build_case_features(
        case=case,
        strategy_type=strategy_type,
    )

    return [
        features[name]
        for name in FEATURE_NAMES
    ]