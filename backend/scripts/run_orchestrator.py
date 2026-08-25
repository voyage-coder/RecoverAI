from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal

from app.services.orchestrator_service import (
    process_active_cases,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Orchestrator")
        print("=" * 60)

        cases = process_active_cases(db)

        print(
            f"\nProcessed {len(cases)} recovery cases."
        )

        print(
            "\nOrchestration completed."
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