from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    FailureCategory,
)


# ============================================================
# DIAGNOSIS RULES
# ============================================================

DIAGNOSIS_RULES = {

    FailureCategory.INSUFFICIENT_FUNDS: {
        "root_cause": (
            "Customer did not have sufficient "
            "available funds."
        ),
        "recovery_probability": 70,
        "risk_level": "MEDIUM",
        "confidence": 95,
    },

    FailureCategory.CARD_DECLINED: {
        "root_cause": (
            "Customer card was declined by "
            "the issuing bank."
        ),
        "recovery_probability": 55,
        "risk_level": "MEDIUM",
        "confidence": 92,
    },

    FailureCategory.EXPIRED_CARD: {
        "root_cause": (
            "Customer payment card has expired."
        ),
        "recovery_probability": 35,
        "risk_level": "HIGH",
        "confidence": 98,
    },

    FailureCategory.GATEWAY_TIMEOUT: {
        "root_cause": (
            "Payment gateway timed out while "
            "processing the transaction."
        ),
        "recovery_probability": 80,
        "risk_level": "LOW",
        "confidence": 96,
    },

    FailureCategory.TECHNICAL_FAILURE: {
        "root_cause": (
            "Temporary technical failure occurred "
            "during payment processing."
        ),
        "recovery_probability": 75,
        "risk_level": "LOW",
        "confidence": 94,
    },

    FailureCategory.AUTHENTICATION_FAILED: {
        "root_cause": (
            "Payment authentication failed "
            "during transaction processing."
        ),
        "recovery_probability": 50,
        "risk_level": "MEDIUM",
        "confidence": 93,
    },
}


# ============================================================
# DIAGNOSE CASE
# ============================================================

def diagnose_case(
    db: Session,
    case: RecoveryCase,
):

    diagnosis = DIAGNOSIS_RULES.get(
        case.failure_category
    )

    if diagnosis is None:
        return case

    case.root_cause = diagnosis["root_cause"]

    case.recovery_probability = (
        diagnosis["recovery_probability"]
    )

    case.risk_level = diagnosis["risk_level"]

    case.ai_confidence = diagnosis["confidence"]

    case.current_step = "Diagnosis Complete"

    db.add(case)

    return case


# ============================================================
# DIAGNOSE ALL ACTIVE CASES
# ============================================================

def diagnose_all_cases(db: Session):

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status == "ACTIVE"
        )
    ).all()

    diagnosed_cases = []

    for case in cases:

        diagnosed_case = diagnose_case(
            db,
            case,
        )

        diagnosed_cases.append(
            diagnosed_case
        )

    db.commit()

    return diagnosed_cases