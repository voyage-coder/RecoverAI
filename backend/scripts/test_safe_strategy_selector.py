from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import RecoveryCase

from app.services.ai.safe_strategy_selector import (
    select_safe_strategy,
)


def main():

    db = SessionLocal()

    try:

        case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at.desc()
            )
        )

        if not case:

            print("No recovery cases found.")

            return

        result = select_safe_strategy(
            db=db,
            case=case,
        )

        print("=" * 70)
        print("RecoverAI ML + Safety Test")
        print("=" * 70)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Failure: "
            f"{case.failure_category.value}"
        )

        print(
            f"Retry Count: "
            f"{case.retry_count}"
        )

        print(
            f"Contact Count: "
            f"{case.contact_count}"
        )

        print("\nStrategy Evaluation:\n")

        for index, item in enumerate(
            result["rankings"],
            start=1,
        ):

            status = (
                "ALLOWED"
                if item["allowed"]
                else "BLOCKED"
            )

            print(
                f"{index}. "
                f"{item['strategy']:30}"
                f"{item['probability']:6.2f}%"
                f"   {status}"
            )

            print(
                f"   Reason: {item['reason']}"
            )

        print("\n" + "=" * 70)

        if result["strategy"]:

            print(
                f"Selected Strategy: "
                f"{result['strategy'].value}"
            )

            print(
                f"ML Probability: "
                f"{result['probability']}%"
            )

            print(
                f"Safety: "
                f"{result['safety_reason']}"
            )

        else:

            print(
                "NO SAFE STRATEGY AVAILABLE"
            )

            print(
                result["safety_reason"]
            )

        print("=" * 70)

    finally:

        db.close()


if __name__ == "__main__":
    main()