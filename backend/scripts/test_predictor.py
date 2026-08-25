from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import RecoveryCase

from app.services.ai.recovery_predictor import (
    predict_recovery,
)


STRATEGIES = [
    "IMMEDIATE_RETRY",
    "RETRY_AFTER_DELAY",
    "SEND_PAYMENT_LINK",
    "SEND_EMAIL_REMINDER",
    "SEND_SMS_REMINDER",
    "SEND_WHATSAPP_MESSAGE",
    "OFFER_ALT_PAYMENT_METHOD",
    "HUMAN_ESCALATION",
    "STOP_RECOVERY",
]


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

            print(
                "No recovery cases found."
            )

            return

        print("=" * 60)
        print("RecoverAI ML Prediction Test")
        print("=" * 60)

        print(
            f"\nCase: {case.case_number}"
        )

        print(
            f"Failure: "
            f"{case.failure_category.value}"
        )

        print(
            f"Amount at risk: "
            f"₹{case.amount_at_risk / 100:.2f}"
        )

        print("\nStrategy predictions:\n")

        results = []

        for strategy in STRATEGIES:

            result = predict_recovery(
                case=case,
                strategy_type=strategy,
            )

            results.append(result)

            print(
                f"{strategy:30}"
                f"{result['probability']:6.2f}%"
            )

        best = max(
            results,
            key=lambda item: item["probability"],
        )

        print("\n" + "=" * 60)

        print(
            f"Recommended strategy: "
            f"{best['strategy']}"
        )

        print(
            f"Predicted recovery probability: "
            f"{best['probability']}%"
        )

        print("=" * 60)

    finally:

        db.close()


if __name__ == "__main__":
    main()