from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal

from app.services.recovery_loop_service import (
    process_recovery_loops,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Loop")
        print("=" * 60)

        actions = process_recovery_loops(db)

        print(
            f"\nCreated {len(actions)} next recovery actions."
        )

        for action in actions:

            print(
                f"{action.id} → "
                f"{action.action_type.value}"
            )

        print(
            "\nRecovery loop completed."
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