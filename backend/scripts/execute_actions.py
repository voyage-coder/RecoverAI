from app.database import SessionLocal
from app.services.executor_service import (
    execute_pending_actions,
)


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Action Executor")
        print("=" * 60)

        actions = execute_pending_actions(db)

        print(
            f"\nExecuted {len(actions)} actions."
        )

        print(
            "\nAction execution completed."
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