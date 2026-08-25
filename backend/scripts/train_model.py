from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pathlib import Path

import joblib
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    GradientBoostingClassifier,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


# ============================================================
# PATHS
# ============================================================

DATA_PATH = Path(
    "data/ml/recovery_training_data.csv"
)

MODEL_DIR = Path("models")

MODEL_PATH = (
    MODEL_DIR /
    "recovery_predictor.joblib"
)


# ============================================================
# FEATURES
# ============================================================

NUMERICAL_FEATURES = [
    "amount_at_risk",
    "payment_history_score",
    "retry_count",
    "contact_count",
]

CATEGORICAL_FEATURES = [
    "risk_tier",
    "failure_category",
    "strategy_type",
]

TARGET = "recovered"


# ============================================================
# LOAD DATA
# ============================================================

def load_data():

    if not DATA_PATH.exists():

        raise FileNotFoundError(
            f"Dataset not found: {DATA_PATH}"
        )

    df = pd.read_csv(DATA_PATH)

    print(
        f"Loaded {len(df)} records."
    )

    return df


# ============================================================
# PREPARE DATA
# ============================================================

def prepare_data(df):

    feature_columns = (
        NUMERICAL_FEATURES
        + CATEGORICAL_FEATURES
    )

    X = df[feature_columns]

    y = df[TARGET]

    return X, y


# ============================================================
# PREPROCESSOR
# ============================================================

def create_preprocessor():

    return ColumnTransformer(
        transformers=[
            (
                "categorical",
                OneHotEncoder(
                    handle_unknown="ignore"
                ),
                CATEGORICAL_FEATURES,
            ),
        ],
        remainder="passthrough",
    )


# ============================================================
# MODELS
# ============================================================

def create_models():

    return {

        "Logistic Regression":
            LogisticRegression(
                max_iter=1000,
                random_state=42,
            ),

        "Random Forest":
            RandomForestClassifier(
                n_estimators=300,
                max_depth=12,
                min_samples_leaf=3,
                random_state=42,
                n_jobs=-1,
            ),

        "Gradient Boosting":
            GradientBoostingClassifier(
                n_estimators=150,
                learning_rate=0.05,
                max_depth=3,
                random_state=42,
            ),
    }


# ============================================================
# TRAIN + EVALUATE
# ============================================================

def train_and_evaluate(
    X_train,
    X_test,
    y_train,
    y_test,
):

    models = create_models()

    results = {}

    best_model = None
    best_model_name = None
    best_auc = -1

    for name, model in models.items():

        print("\n" + "=" * 60)

        print(
            f"Training: {name}"
        )

        pipeline = Pipeline(
            steps=[
                (
                    "preprocessor",
                    create_preprocessor(),
                ),
                (
                    "model",
                    model,
                ),
            ]
        )

        pipeline.fit(
            X_train,
            y_train,
        )

        predictions = pipeline.predict(
            X_test
        )

        probabilities = pipeline.predict_proba(
            X_test
        )[:, 1]

        accuracy = accuracy_score(
            y_test,
            predictions,
        )

        auc = roc_auc_score(
            y_test,
            probabilities,
        )

        print(
            f"Accuracy: {accuracy:.4f}"
        )

        print(
            f"ROC-AUC:  {auc:.4f}"
        )

        print("\nClassification Report:")

        print(
            classification_report(
                y_test,
                predictions,
            )
        )

        results[name] = {
            "accuracy": accuracy,
            "roc_auc": auc,
        }

        if auc > best_auc:

            best_auc = auc

            best_model = pipeline

            best_model_name = name

    return (
        best_model,
        best_model_name,
        results,
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 60)
    print("RecoverAI Recovery Prediction Model")
    print("=" * 60)

    # --------------------------------------------------------
    # Load
    # --------------------------------------------------------

    df = load_data()

    # --------------------------------------------------------
    # Prepare
    # --------------------------------------------------------

    X, y = prepare_data(df)

    print(
        f"\nFeatures: {X.shape[1]}"
    )

    print(
        f"Target distribution:"
    )

    print(
        y.value_counts()
    )

    # --------------------------------------------------------
    # Train/Test split
    # --------------------------------------------------------

    X_train, X_test, y_train, y_test = (
        train_test_split(
            X,
            y,
            test_size=0.20,
            random_state=42,
            stratify=y,
        )
    )

    print(
        f"\nTraining records: "
        f"{len(X_train)}"
    )

    print(
        f"Testing records: "
        f"{len(X_test)}"
    )

    # --------------------------------------------------------
    # Train models
    # --------------------------------------------------------

    (
        best_model,
        best_model_name,
        results,
    ) = train_and_evaluate(
        X_train,
        X_test,
        y_train,
        y_test,
    )

    # --------------------------------------------------------
    # Save best model
    # --------------------------------------------------------

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    joblib.dump(
        best_model,
        MODEL_PATH,
    )

    print("\n" + "=" * 60)

    print(
        f"Best Model: {best_model_name}"
    )

    print(
        f"Best ROC-AUC: "
        f"{results[best_model_name]['roc_auc']:.4f}"
    )

    print(
        f"\nModel saved to:"
        f"\n{MODEL_PATH}"
    )

    print("=" * 60)


if __name__ == "__main__":
    main()