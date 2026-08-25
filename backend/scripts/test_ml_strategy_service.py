from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import (
    RecoveryCase,
    RecoveryStrategy,
)

from app.services.strategy_service import (
    create_strategy,
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

        # ----------------------------------------------------
        # Remove current selected strategy ONLY for this test
        # ----------------------------------------------------

        existing = db.scalars(
            select(RecoveryStrategy).where(
                RecoveryStrategy.case_id == case.id,
                RecoveryStrategy.is_selected.is_(True),
            )
        ).all()

        for strategy in existing:

            strategy.is_selected = False

        db.flush()

        # ----------------------------------------------------
        # Run ML strategy selection
        # ----------------------------------------------------

        strategy = create_strategy(
            db=db,
            case=case,
        )

        db.commit()

        # ----------------------------------------------------
        # Display result
        # ----------------------------------------------------

        print("=" * 60)
        print("RecoverAI ML Strategy Service Test")
        print("=" * 60)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Failure: "
            f"{case.failure_category.value}"
        )

        print(
            f"\nSelected Strategy: "
            f"{strategy.strategy_type.value}"
        )

        print(
            f"Expected Probability: "
            f"{strategy.expected_probability}%"
        )

        print(
            f"\nRationale:\n"
            f"{strategy.rationale}"
        )

        print(
            f"\nCase Recovery Probability: "
            f"{case.recovery_probability}%"
        )

        print(
            f"Case Current Step: "
            f"{case.current_step}"
        )

        print("=" * 60)

    finally:

        db.close()


if __name__ == "__main__":
    main()