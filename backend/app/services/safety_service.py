from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    StrategyType,
    CaseStatus,
)


MAX_RETRIES = 3
MAX_CUSTOMER_CONTACTS = 3


def check_action_safety(
    db: Session,
    case: RecoveryCase,
    strategy: StrategyType,
):

    # --------------------------------------------------------
    # CASE STATUS
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
        CaseStatus.ESCALATED,
    ]:
        return (
            False,
            "Case is no longer eligible for recovery."
        )

    # --------------------------------------------------------
    # STOP RECOVERY
    # --------------------------------------------------------

    if strategy == StrategyType.STOP_RECOVERY:
        return (
            True,
            "Recovery explicitly stopped."
        )

    # --------------------------------------------------------
    # RETRY LIMIT
    # --------------------------------------------------------

    retry_strategies = [
        StrategyType.IMMEDIATE_RETRY,
        StrategyType.RETRY_AFTER_DELAY,
    ]

    if strategy in retry_strategies:

        if case.retry_count >= MAX_RETRIES:

            return (
                False,
                "Maximum payment retry limit reached."
            )

    # --------------------------------------------------------
    # CONTACT LIMIT
    # --------------------------------------------------------

    communication_strategies = [
        StrategyType.SEND_PAYMENT_LINK,
        StrategyType.SEND_EMAIL_REMINDER,
        StrategyType.SEND_SMS_REMINDER,
        StrategyType.SEND_WHATSAPP_MESSAGE,
    ]

    if strategy in communication_strategies:

        if case.contact_count >= MAX_CUSTOMER_CONTACTS:

            return (
                False,
                "Maximum customer contact limit reached."
            )

    return True, "Action passed safety checks."