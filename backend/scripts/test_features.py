from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import RecoveryCase

from app.services.ai.feature_service import (
    build_case_features,
    case_to_vector,
)


def main():

    db = SessionLocal()

    try:

        case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at
            )
        )

        if not case:
            print("No recovery cases found.")
            return

        strategy = "SEND_PAYMENT_LINK"

        print("=" * 60)
        print("RecoverAI - Feature Extraction Test")
        print("=" * 60)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Strategy: {strategy}"
        )

        features = build_case_features(
            case=case,
            strategy_type=strategy,
        )

        print("\nFeatures:")

        for name, value in features.items():

            print(
                f"{name}: {value}"
            )

        print("\nFeature Vector:")

        print(
            case_to_vector(
                case=case,
                strategy_type=strategy,
            )
        )

    finally:

        db.close()


if __name__ == "__main__":
    main()