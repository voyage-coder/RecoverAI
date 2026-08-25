from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    RecoveryResultStatus,
    ActionStatus,
)

from app.services.recovery_loop_service import (
    process_recovery_loop,
)


def main():

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Get newest test case
        # ----------------------------------------------------

        case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at.desc()
            )
        )

        if not case:
            print("No recovery case found.")
            return

        print("=" * 70)
        print("RecoverAI ML Recovery Loop Test")
        print("=" * 70)

        print(f"\nCase: {case.case_number}")
        print(f"Current status: {case.status.value}")

        # ----------------------------------------------------
        # Remove pending action
        #
        # We are simulating that the previous action
        # has already finished unsuccessfully.
        # ----------------------------------------------------

        pending_actions = db.scalars(
            select(RecoveryAction).where(
                RecoveryAction.case_id == case.id,
                RecoveryAction.status.in_([
                    ActionStatus.PENDING,
                    ActionStatus.PROCESSING,
                ]),
            )
        ).all()

        for action in pending_actions:

            action.status = ActionStatus.FAILED

            action.result_text = (
                "Synthetic failure for recovery-loop testing."
            )

            print(
                f"\nMarked action "
                f"{action.action_type.value} "
                f"as FAILED."
            )

        db.flush()

        # ----------------------------------------------------
        # Create / update recovery result
        # ----------------------------------------------------

        result = db.scalar(
            select(RecoveryResult).where(
                RecoveryResult.case_id == case.id
            )
        )

        if not result:

            result = RecoveryResult(
                id=__import__("uuid").uuid4(),
                case_id=case.id,
                original_amount=case.amount_at_risk,
                recovered_amount=0,
                status=RecoveryResultStatus.NOT_RECOVERED,
                recovery_method=None,
            )

            db.add(result)

        else:

            result.status = (
                RecoveryResultStatus.NOT_RECOVERED
            )

            result.recovered_amount = 0

        db.flush()

        # ----------------------------------------------------
        # Run recovery loop
        # ----------------------------------------------------

        action = process_recovery_loop(
            db=db,
            case=case,
        )

        db.commit()

        # ----------------------------------------------------
        # Display result
        # ----------------------------------------------------

        print("\n" + "=" * 70)

        if action:

            print(
                "New action created successfully."
            )

            print(
                f"Strategy: "
                f"{action.action_type.value}"
            )

            print(
                f"Status: "
                f"{action.status.value}"
            )

            print(
                f"Attempt number: "
                f"{action.attempt_number}"
            )

        else:

            print(
                "No new action was created."
            )

        print(
            f"\nCase status: "
            f"{case.status.value}"
        )

        print(
            f"Current step: "
            f"{case.current_step}"
        )

        print(
            f"Selected strategy: "
            f"{case.selected_strategy}"
        )

        print(
            f"Recovery probability: "
            f"{case.recovery_probability}%"
        )

        print("=" * 70)

    except Exception:

        db.rollback()

        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()