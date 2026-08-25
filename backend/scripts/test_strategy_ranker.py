from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import RecoveryCase

from app.services.ai.strategy_ranker import (
    rank_strategies,
    get_best_strategy,
)


def main():

    db = SessionLocal()

    try:

        case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at
            )
        )

        if not case:

            print("No recovery cases found.")

            return

        rankings = rank_strategies(
            case=case
        )

        print("=" * 60)
        print("RecoverAI ML Strategy Ranking")
        print("=" * 60)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Failure: "
            f"{case.failure_category.value}"
        )

        print("\nRankings:\n")

        for index, item in enumerate(
            rankings,
            start=1,
        ):

            print(
                f"{index}. "
                f"{item['strategy']:30}"
                f"{item['probability']:6.2f}%"
            )

        best = get_best_strategy(
            case=case
        )

        print("\n" + "=" * 60)

        print(
            f"Best Strategy: "
            f"{best['strategy']}"
        )

        print(
            f"Probability: "
            f"{best['probability']}%"
        )

        print("=" * 60)

    finally:

        db.close()


if __name__ == "__main__":
    main()