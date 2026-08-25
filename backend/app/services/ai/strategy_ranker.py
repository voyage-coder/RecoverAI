from app.schema import RecoveryCase

from app.services.ai.recovery_predictor import (
    predict_recovery_probability,
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


def rank_strategies(
    case: RecoveryCase,
) -> list[dict]:

    rankings = []

    for strategy in STRATEGIES:

        probability = predict_recovery_probability(
            case=case,
            strategy_type=strategy,
        )

        rankings.append({
            "strategy": strategy,
            "probability": probability,
        })

    rankings.sort(
        key=lambda item: item["probability"],
        reverse=True,
    )

    return rankings


def get_best_strategy(
    case: RecoveryCase,
) -> dict:

    rankings = rank_strategies(
        case=case
    )

    return rankings[0]