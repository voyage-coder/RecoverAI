from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.services.recovery_service import create_recovery_cases


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Case Detection")
        print("=" * 60)

        cases = create_recovery_cases(db)

        print(
            f"\nCreated/found {len(cases)} recovery cases."
        )

        print("\nRecovery cases created successfully.")

    except Exception as e:

        db.rollback()

        print("\nERROR:")
        print(e)

        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()