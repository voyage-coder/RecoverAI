from app.database import SessionLocal
from app.services.diagnosis_service import (
    diagnose_all_cases,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - AI Diagnosis Engine")
        print("=" * 60)

        cases = diagnose_all_cases(db)

        print(
            f"\nDiagnosed {len(cases)} recovery cases."
        )

        print(
            "\nDiagnosis completed successfully."
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