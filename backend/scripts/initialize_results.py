from app.database import SessionLocal
from app.services.result_service import initialize_results


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Result Initialization")
        print("=" * 60)

        results = initialize_results(db)

        print(
            f"\nInitialized {len(results)} recovery results."
        )

        print(
            "\nRecovery results initialized successfully."
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