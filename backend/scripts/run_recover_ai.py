from app.database import SessionLocal

from app.services.orchestrator_service import (
    run_recover_ai,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI")
        print("Autonomous Payment Recovery Engine")
        print("=" * 60)

        cases = run_recover_ai(db)

        print(
            f"\nProcessed {len(cases)} recovery cases."
        )

        for case in cases:

            print(
                f"{case.case_number} | "
                f"{case.status.value} | "
                f"{case.current_step}"
            )

        print(
            "\nRecoverAI run completed successfully."
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