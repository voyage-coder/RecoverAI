from app.database import SessionLocal
from app.services.strategy_service import create_strategies


def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI - Recovery Strategy Engine")
        print("=" * 60)

        strategies = create_strategies(db)

        print(
            f"\nCreated/found {len(strategies)} strategies."
        )

        print(
            "\nStrategy selection completed successfully."
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