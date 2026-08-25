from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal

from app.schema import (
    RecoveryCase,
    RecoveryAction,
)

from app.services.orchestrator_service import (
    process_case,
)


def main():

    db = SessionLocal()

    try:

        # Get newest case — our clean ML test case
        case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at.desc()
            )
        )

        if not case:

            print("No recovery cases found.")

            return

        print("=" * 60)
        print("RecoverAI ML Orchestrator Test")
        print("=" * 60)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Initial Status: "
            f"{case.status.value}"
        )

        # ----------------------------------------------------
        # Process case
        # ----------------------------------------------------

        process_case(
            db=db,
            case=case,
        )

        db.commit()

        # ----------------------------------------------------
        # Reload actions
        # ----------------------------------------------------

        actions = db.scalars(
            select(RecoveryAction).where(
                RecoveryAction.case_id == case.id
            )
        ).all()

        print(
            f"\nFinal Status: "
            f"{case.status.value}"
        )

        print(
            f"Selected Strategy: "
            f"{case.selected_strategy.value}"
        )

        print(
            f"Recovery Probability: "
            f"{case.recovery_probability}%"
        )

        print(
            f"Current Step: "
            f"{case.current_step}"
        )

        print(
            f"\nActions Created: "
            f"{len(actions)}"
        )

        for action in actions:

            print(
                f"- {action.action_type.value} "
                f"({action.status.value})"
            )

        print("\n" + "=" * 60)

    except Exception:

        db.rollback()

        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()