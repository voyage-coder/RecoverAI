from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import csv
import random
from pathlib import Path


# ============================================================
# CONFIGURATION
# ============================================================

NUM_RECORDS = 5000

OUTPUT_DIR = Path("data/ml")
OUTPUT_FILE = OUTPUT_DIR / "recovery_training_data.csv"

random.seed(42)


# ============================================================
# DOMAIN VALUES
# ============================================================

FAILURE_CATEGORIES = [
    "INSUFFICIENT_FUNDS",
    "CARD_DECLINED",
    "EXPIRED_CARD",
    "GATEWAY_TIMEOUT",
    "TECHNICAL_FAILURE",
    "AUTHENTICATION_FAILED",
]

RISK_TIERS = [
    "LOW",
    "MEDIUM",
    "HIGH",
]

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


# ============================================================
# BASE RECOVERY PROBABILITY
# ============================================================

FAILURE_BASE_PROBABILITY = {
    "INSUFFICIENT_FUNDS": 0.55,
    "CARD_DECLINED": 0.45,
    "EXPIRED_CARD": 0.35,
    "GATEWAY_TIMEOUT": 0.65,
    "TECHNICAL_FAILURE": 0.60,
    "AUTHENTICATION_FAILED": 0.40,
}


STRATEGY_EFFECT = {
    "IMMEDIATE_RETRY": 0.05,
    "RETRY_AFTER_DELAY": 0.08,
    "SEND_PAYMENT_LINK": 0.12,
    "SEND_EMAIL_REMINDER": 0.04,
    "SEND_SMS_REMINDER": 0.05,
    "SEND_WHATSAPP_MESSAGE": 0.07,
    "OFFER_ALT_PAYMENT_METHOD": 0.15,
    "HUMAN_ESCALATION": 0.03,
    "STOP_RECOVERY": -0.35,
}


# ============================================================
# HELPERS
# ============================================================

def clamp(
    value: float,
    minimum: float = 0.02,
    maximum: float = 0.98,
) -> float:

    return max(
        minimum,
        min(maximum, value),
    )


def choose_risk_tier(
    payment_history_score: int,
) -> str:

    if payment_history_score >= 80:
        return "LOW"

    if payment_history_score >= 60:
        return "MEDIUM"

    return "HIGH"


def generate_probability(
    failure_category: str,
    payment_history_score: int,
    risk_tier: str,
    amount_at_risk: int,
    retry_count: int,
    contact_count: int,
    strategy_type: str,
) -> float:

    probability = FAILURE_BASE_PROBABILITY[
        failure_category
    ]

    # --------------------------------------------------------
    # Customer payment history
    # --------------------------------------------------------

    history_effect = (
        payment_history_score - 50
    ) / 100

    probability += history_effect * 0.45

    # --------------------------------------------------------
    # Risk tier
    # --------------------------------------------------------

    if risk_tier == "LOW":
        probability += 0.08

    elif risk_tier == "HIGH":
        probability -= 0.08

    # --------------------------------------------------------
    # Amount at risk
    # Higher amounts are slightly harder to recover
    # --------------------------------------------------------

    if amount_at_risk > 400000:
        probability -= 0.08

    elif amount_at_risk > 200000:
        probability -= 0.04

    elif amount_at_risk < 100000:
        probability += 0.03

    # --------------------------------------------------------
    # Retry behavior
    # --------------------------------------------------------

    probability -= retry_count * 0.035

    # --------------------------------------------------------
    # Customer contact
    # --------------------------------------------------------

    if contact_count == 1:
        probability += 0.03

    elif contact_count >= 2:
        probability += 0.05

    # --------------------------------------------------------
    # Strategy effect
    # --------------------------------------------------------

    probability += STRATEGY_EFFECT[
        strategy_type
    ]

    return clamp(probability)


# ============================================================
# GENERATE ONE RECORD
# ============================================================

def generate_record(
    record_id: int,
) -> dict:

    # --------------------------------------------------------
    # Customer
    # --------------------------------------------------------

    payment_history_score = random.randint(
        40,
        100,
    )

    risk_tier = choose_risk_tier(
        payment_history_score
    )

    # --------------------------------------------------------
    # Payment
    # --------------------------------------------------------

    amount_at_risk = random.choice(
        [
            random.randint(5000, 50000),
            random.randint(50000, 200000),
            random.randint(200000, 500000),
            random.randint(500000, 1000000),
        ]
    )

    # --------------------------------------------------------
    # Failure
    # --------------------------------------------------------

    failure_category = random.choice(
        FAILURE_CATEGORIES
    )

    # --------------------------------------------------------
    # Recovery history
    # --------------------------------------------------------

    retry_count = random.randint(
        0,
        3,
    )

    contact_count = random.randint(
        0,
        3,
    )

    # --------------------------------------------------------
    # Strategy
    # --------------------------------------------------------

    strategy_type = random.choice(
        STRATEGIES
    )

    # --------------------------------------------------------
    # Recovery probability
    # --------------------------------------------------------

    probability = generate_probability(
        failure_category=failure_category,
        payment_history_score=payment_history_score,
        risk_tier=risk_tier,
        amount_at_risk=amount_at_risk,
        retry_count=retry_count,
        contact_count=contact_count,
        strategy_type=strategy_type,
    )

    # --------------------------------------------------------
    # Outcome
    # --------------------------------------------------------

    recovered = (
        1
        if random.random() < probability
        else 0
    )

    # --------------------------------------------------------
    # Amount recovered
    # --------------------------------------------------------

    if recovered:

        recovery_percentage = random.uniform(
            0.75,
            1.00,
        )

        recovered_amount = int(
            amount_at_risk
            * recovery_percentage
        )

    else:

        recovered_amount = 0

    return {
        "record_id": record_id,
        "amount_at_risk": amount_at_risk,
        "payment_history_score": payment_history_score,
        "risk_tier": risk_tier,
        "failure_category": failure_category,
        "retry_count": retry_count,
        "contact_count": contact_count,
        "strategy_type": strategy_type,
        "recovered": recovered,
        "recovered_amount": recovered_amount,
    }


# ============================================================
# MAIN
# ============================================================

def main():

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    records = []

    for record_id in range(
        1,
        NUM_RECORDS + 1,
    ):

        records.append(
            generate_record(record_id)
        )

    fieldnames = [
        "record_id",
        "amount_at_risk",
        "payment_history_score",
        "risk_tier",
        "failure_category",
        "retry_count",
        "contact_count",
        "strategy_type",
        "recovered",
        "recovered_amount",
    ]

    with OUTPUT_FILE.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:

        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        writer.writerows(records)

    recovered_count = sum(
        row["recovered"]
        for row in records
    )

    recovery_rate = (
        recovered_count
        / NUM_RECORDS
        * 100
    )

    print("=" * 60)
    print("RecoverAI ML Dataset Generator")
    print("=" * 60)

    print(
        f"\nGenerated records: {NUM_RECORDS}"
    )

    print(
        f"Recovered: {recovered_count}"
    )

    print(
        f"Not recovered: "
        f"{NUM_RECORDS - recovered_count}"
    )

    print(
        f"Recovery rate: "
        f"{recovery_rate:.2f}%"
    )

    print(
        f"\nDataset saved to:"
        f"\n{OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()