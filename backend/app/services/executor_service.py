from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryAction,
    RecoveryCase,
    Payment,
    PaymentAttempt,
    Communication,
    AuditLog,
    ActionStatus,
    StrategyType,
    CommunicationChannel,
    CommunicationDirection,
    ActorType,
    CaseStatus,
)
from app.services.result_service import update_recovery_result


# ============================================================
# EXECUTE RETRY
# ============================================================

def execute_retry(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction,
):
    """
    Simulate a payment retry.

    This does NOT call a real payment gateway.
    """

    payment = db.scalar(
        select(Payment).where(
            Payment.id == case.payment_id
        )
    )

    if not payment:
        raise ValueError(
            "Payment associated with recovery case was not found."
        )

    # --------------------------------------------------------
    # Simulated retry result
    # --------------------------------------------------------

    # For now, keep the retry failed.
    # Later we will create realistic recovery scenarios.
    retry_success = False

    attempt_number = (
        case.retry_count + 1
    )

    if retry_success:

        attempt_status = "SUCCESS"

        error_code = None
        error_description = None

        payment.status = "RECOVERED"
        payment.order.status = "RECOVERED"

        case.status = CaseStatus.RECOVERED
        case.current_step = "Payment Recovered"

    else:

        attempt_status = "FAILED"

        error_code = payment.failure_code
        error_description = payment.failure_reason

        case.retry_count += 1
        case.current_step = "Retry Executed"

    # --------------------------------------------------------
    # Create payment attempt
    # --------------------------------------------------------

    attempt = PaymentAttempt(
        id=str(uuid4()),

        payment_id=payment.id,

        attempt_number=attempt_number,

        status=attempt_status,

        error_code=error_code,

        error_description=error_description,

        error_source="SIMULATED_GATEWAY",

        gateway_response={
            "mode": "TEST",
            "simulated": True,
            "executor": "RecoverAI",
        },

        created_at=datetime.utcnow(),
    )

    db.add(attempt)

    return (
        "Payment retry succeeded."
        if retry_success
        else "Payment retry failed."
    )


# ============================================================
# EXECUTE COMMUNICATION
# ============================================================

def execute_communication(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction,
):
    """
    Simulate sending a customer communication.
    """

    strategy = action.action_type

    # --------------------------------------------------------
    # Determine channel
    # --------------------------------------------------------

    if strategy == StrategyType.SEND_EMAIL_REMINDER:
        channel = CommunicationChannel.EMAIL

    elif strategy == StrategyType.SEND_SMS_REMINDER:
        channel = CommunicationChannel.SMS

    elif strategy == StrategyType.SEND_WHATSAPP_MESSAGE:
        channel = CommunicationChannel.WHATSAPP

    else:
        # Payment link / alternative payment method
        channel = CommunicationChannel.EMAIL

    # --------------------------------------------------------
    # Message
    # --------------------------------------------------------

    content = (
        "We were unable to complete your recent payment. "
        "Please try again using the payment link or "
        "an alternative payment method."
    )

    # --------------------------------------------------------
    # Create communication
    # --------------------------------------------------------

    communication = Communication(
        id=str(uuid4()),

        case_id=case.id,

        channel=channel,

        direction=CommunicationDirection.OUTBOUND,

        content=content,

        status="SENT",

        sent_at=datetime.utcnow(),
    )

    db.add(communication)

    # --------------------------------------------------------
    # Update contact count
    # --------------------------------------------------------

    case.contact_count += 1

    case.current_step = "Customer Contacted"

    return (
        f"Simulated {channel.value} communication sent."
    )


# ============================================================
# EXECUTE HUMAN ESCALATION
# ============================================================

def execute_human_escalation(
    db: Session,
    case: RecoveryCase,
):

    case.status = CaseStatus.ESCALATED

    case.current_step = "Human Escalation"

    audit = AuditLog(
        id=str(uuid4()),

        case_id=case.id,

        action_type="HUMAN_ESCALATION",

        actor=ActorType.AI_AGENT,

        details=(
            "Recovery case escalated to a human operator."
        ),

        timestamp=datetime.utcnow(),
    )

    db.add(audit)

    return "Case escalated to human operator."


# ============================================================
# EXECUTE SINGLE ACTION
# ============================================================

def execute_action(
    db: Session,
    action: RecoveryAction,
):

    case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.id == action.case_id
        )
    )

    if not case:
        raise ValueError(
            "Recovery case not found."
        )

    # --------------------------------------------------------
    # Mark processing
    # --------------------------------------------------------

    action.status = ActionStatus.PROCESSING

    db.flush()

    try:

        strategy = action.action_type

        # ----------------------------------------------------
        # RETRY
        # ----------------------------------------------------

        if strategy in [
            StrategyType.IMMEDIATE_RETRY,
            StrategyType.RETRY_AFTER_DELAY,
        ]:

            result = execute_retry(
                db,
                case,
                action,
            )

        # ----------------------------------------------------
        # COMMUNICATION
        # ----------------------------------------------------

        elif strategy in [
            StrategyType.SEND_PAYMENT_LINK,
            StrategyType.SEND_EMAIL_REMINDER,
            StrategyType.SEND_SMS_REMINDER,
            StrategyType.SEND_WHATSAPP_MESSAGE,
            StrategyType.OFFER_ALT_PAYMENT_METHOD,
        ]:

            result = execute_communication(
                db,
                case,
                action,
            )

        # ----------------------------------------------------
        # HUMAN ESCALATION
        # ----------------------------------------------------

        elif strategy == StrategyType.HUMAN_ESCALATION:

            result = execute_human_escalation(
                db,
                case,
            )

        # ----------------------------------------------------
        # STOP RECOVERY
        # ----------------------------------------------------

        elif strategy == StrategyType.STOP_RECOVERY:

            case.status = CaseStatus.CLOSED

            case.current_step = "Recovery Stopped"

            result = "Recovery stopped."

        else:

            raise ValueError(
                f"Unsupported strategy: {strategy}"
            )

        # --------------------------------------------------------
        # DETERMINE RECOVERED AMOUNT
        # --------------------------------------------------------

        recovered_amount = 0

        # ----------------------------------------------------
        # SUCCESSFUL EXECUTION
        # ----------------------------------------------------

        action.status = ActionStatus.EXECUTED

        action.executed_at = datetime.utcnow()

        action.result_text = result

        # --------------------------------------------------------
        # UPDATE RECOVERY RESULT
        # --------------------------------------------------------

        update_recovery_result(
            db=db,
            case=case,
            action=action,
            recovered_amount=recovered_amount,
        )

        # ----------------------------------------------------
        # Audit log
        # ----------------------------------------------------

        audit = AuditLog(
            id=str(uuid4()),

            case_id=case.id,

            action_type="ACTION_EXECUTED",

            actor=ActorType.AI_AGENT,

            details=(
                f"Executed strategy: "
                f"{strategy.value}"
            ),

            timestamp=datetime.utcnow(),
        )

        db.add(audit)

        db.commit()

        return action

    except Exception as e:

        db.rollback()

        # Reload action because rollback expired objects
        action = db.merge(action)

        action.status = ActionStatus.FAILED

        action.executed_at = datetime.utcnow()

        action.result_text = str(e)

        db.commit()

        raise


# ============================================================
# EXECUTE ALL PENDING ACTIONS
# ============================================================

def execute_pending_actions(db: Session):

    actions = db.scalars(
        select(RecoveryAction).where(
            RecoveryAction.status == ActionStatus.PENDING
        )
    ).all()

    executed_actions = []

    for action in actions:

        executed_action = execute_action(
            db,
            action,
        )

        executed_actions.append(
            executed_action
        )

    return executed_actions