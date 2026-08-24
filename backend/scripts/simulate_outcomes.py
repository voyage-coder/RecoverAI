from sqlalchemy import select

from app.database import SessionLocal

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    ActionStatus,
)

from app.services.simulation_service import (
    simulate_recovery_outcome,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Outcome Simulator")
        print("=" * 60)

        cases = db.scalars(
            select(RecoveryCase)
        ).all()

        processed = 0

        for case in cases:

            action = db.scalar(
                select(RecoveryAction)
                .where(
                    RecoveryAction.case_id == case.id,
                    RecoveryAction.status
                    == ActionStatus.EXECUTED,
                )
                .order_by(
                    RecoveryAction.created_at.desc()
                )
            )

            if not action:
                continue

            result = simulate_recovery_outcome(
                db=db,
                case=case,
                action=action,
            )

            print(
                f"{case.case_number} → "
                f"{result.status.value} → "
                f"₹{result.recovered_amount / 100:.2f}"
            )

            processed += 1

        print(
            f"\nProcessed {processed} recovery cases."
        )

    except Exception as e:

        db.rollback()

        print("\nERROR:")
        print(e)

        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()