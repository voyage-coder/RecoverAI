from pathlib import Path

import joblib
import pandas as pd

from app.schema import RecoveryCase
from app.services.ai.feature_service import (
    build_case_features,
)


# ============================================================
# MODEL PATH
# ============================================================

MODEL_PATH = Path(
    "models/recovery_predictor.joblib"
)


# ============================================================
# LOAD MODEL
# ============================================================

_model = None


def get_model():

    global _model

    if _model is None:

        if not MODEL_PATH.exists():

            raise FileNotFoundError(
                f"Recovery model not found: {MODEL_PATH}"
            )

        _model = joblib.load(
            MODEL_PATH
        )

    return _model


# ============================================================
# PREDICT RECOVERY PROBABILITY
# ============================================================

def predict_recovery_probability(
    case: RecoveryCase,
    strategy_type: str,
) -> float:
    """
    Predict probability that a specific recovery
    strategy will successfully recover the payment.
    """

    features = build_case_features(
        case=case,
        strategy_type=strategy_type,
    )

    dataframe = pd.DataFrame(
        [features]
    )

    model = get_model()

    probability = model.predict_proba(
        dataframe
    )[0][1]

    return round(
        float(probability) * 100,
        2,
    )


# ============================================================
# PREDICT BINARY OUTCOME
# ============================================================

def predict_recovery(
    case: RecoveryCase,
    strategy_type: str,
) -> dict:

    features = build_case_features(
        case=case,
        strategy_type=strategy_type,
    )

    dataframe = pd.DataFrame(
        [features]
    )

    model = get_model()

    probability = model.predict_proba(
        dataframe
    )[0][1]

    prediction = model.predict(
        dataframe
    )[0]

    return {
        "strategy": strategy_type,
        "probability": round(
            float(probability) * 100,
            2,
        ),
        "predicted_recovery": bool(
            prediction
        ),
    }