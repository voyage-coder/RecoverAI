from app.database import SessionLocal
from app.services.action_service import create_actions


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Action Engine")
        print("=" * 60)

        actions = create_actions(db)

        print(
            f"\nCreated/found {len(actions)} recovery actions."
        )

        print(
            "\nSafety checks completed successfully."
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