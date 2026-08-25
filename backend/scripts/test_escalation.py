from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal

from app.schema import (
    RecoveryCase,
    RecoveryResult,
    RecoveryResultStatus,
)

from app.services.escalation_service import (
    create_next_strategy,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Strategy Escalation Engine")
        print("=" * 60)

        cases = db.scalars(
            select(RecoveryCase)
        ).all()

        processed = 0

        for case in cases:

            result = db.scalar(
                select(RecoveryResult).where(
                    RecoveryResult.case_id == case.id
                )
            )

            if not result:
                continue

            if result.status == (
                RecoveryResultStatus.FULLY_RECOVERED
            ):
                continue

            strategy = create_next_strategy(
                db,
                case,
            )

            if strategy:

                print(
                    f"{case.case_number} → "
                    f"{strategy.strategy_type.value}"
                )

                processed += 1

        db.commit()

        print(
            f"\nCreated {processed} next strategies."
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