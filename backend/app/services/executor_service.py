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
    RecoveryResultStatus,
)
from app.services.result_service import (
    update_recovery_result,
)
from app.services.ai.llm_service import (
    generate_customer_message,
)
from app.services.payment_gateway_service import (
    attempt_payment_retry,
    create_payment_link,
)


# ============================================================
# EXECUTE RETRY
# ============================================================

def execute_retry(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction,
):
    """
    Execute a payment retry through the payment gateway service.

    Razorpay TEST MODE is used when credentials exist.
    Otherwise SIMULATED_GATEWAY is used.

    ActionStatus.EXECUTED (set by caller) means this action ran.
    It does NOT imply the payment was recovered.
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

    attempt_number = (
        case.retry_count + 1
    )

    gateway_result = attempt_payment_retry(
        amount=payment.amount,
        currency=payment.currency or "INR",
        receipt=f"rc_{case.case_number}_{attempt_number}",
        notes={
            "case_number": case.case_number,
            "strategy": (
                action.action_type.value
                if hasattr(action.action_type, "value")
                else str(action.action_type)
            ),
        },
        failure_code=payment.failure_code,
        failure_reason=payment.failure_reason,
    )

    retry_success = gateway_result.success

    if retry_success:

        attempt_status = "SUCCESS"

        error_code = None
        error_description = None

        payment.status = "RECOVERED"
        if payment.order is not None:
            payment.order.status = "RECOVERED"

        case.status = CaseStatus.RECOVERED
        case.current_step = "Payment Recovered"

    else:

        attempt_status = "FAILED"

        error_code = gateway_result.error_code or payment.failure_code
        error_description = (
            gateway_result.error_description
            or payment.failure_reason
        )

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

        error_source=gateway_result.error_source,

        gateway_response={
            **(gateway_result.gateway_response or {}),
            "executor": "RecoverAI",
            "gateway_mode": gateway_result.mode,
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

    Flow:

    Approved RecoveryAction
        ↓
    LLM drafts customer-facing copy
        ↓
    Communication record created

    Gemini is used only for message text.
    Strategy selection and safety already happened upstream.
    """

    strategy = action.action_type

    # --------------------------------------------------------
    # Determine channel from the approved strategy
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
    # LLM message generation (communication strategies only)
    #
    # On Gemini failure, llm_service returns a safe fallback.
    # The executor must never crash because of LLM issues.
    # --------------------------------------------------------

    try:

        llm_result = generate_customer_message(
            case=case,
            strategy=strategy,
        )

        content = llm_result.message

    except Exception:

        content = (
            "We were unable to complete your recent payment. "
            "Please try again using the payment link or "
            "an alternative payment method."
        )

    # --------------------------------------------------------
    # SEND_PAYMENT_LINK — Razorpay owns the URL
    # Gemini only provides surrounding copy.
    # --------------------------------------------------------

    if strategy == StrategyType.SEND_PAYMENT_LINK:

        payment = db.scalar(
            select(Payment).where(
                Payment.id == case.payment_id
            )
        )

        customer = getattr(case, "customer", None)

        link_result = create_payment_link(
            amount=(
                payment.amount
                if payment is not None
                else case.amount_at_risk
            ),
            currency=(
                payment.currency
                if payment is not None
                else "INR"
            ),
            description=(
                f"RecoverAI payment recovery for {case.case_number}"
            ),
            customer_name=getattr(customer, "name", None),
            customer_email=getattr(customer, "email", None),
            customer_contact=getattr(customer, "phone", None),
            notes={
                "case_number": case.case_number,
            },
        )

        if link_result.success and link_result.payment_link_url:
            content = (
                f"{content}\n\n"
                f"Payment link: {link_result.payment_link_url}"
            )
        elif link_result.error_description:
            content = (
                f"{content}\n\n"
                "A payment link could not be generated right now. "
                "Please reply to this message for assistance."
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

        # ----------------------------------------------------
        # SUCCESSFUL ACTION EXECUTION
        #
        # ActionStatus.EXECUTED means the recovery action
        # itself ran successfully. It does NOT necessarily
        # mean the payment was recovered.
        # ----------------------------------------------------

        action.status = ActionStatus.EXECUTED

        action.executed_at = datetime.utcnow()

        action.result_text = result

        # Flush so Recovery Loop does not treat this action
        # as still PENDING / PROCESSING.
        db.flush()

        # ----------------------------------------------------
        # Terminal strategies do not continue the recovery
        # result / loop path.
        # ----------------------------------------------------

        if strategy not in [
            StrategyType.HUMAN_ESCALATION,
            StrategyType.STOP_RECOVERY,
        ]:

            # ------------------------------------------------
            # DETERMINE RECOVERED AMOUNT
            # ------------------------------------------------

            recovered_amount = 0

            if case.status == CaseStatus.RECOVERED:

                recovered_amount = (
                    case.amount_at_risk
                )

            # ------------------------------------------------
            # UPDATE RECOVERY RESULT
            # ------------------------------------------------

            recovery_result = update_recovery_result(
                db=db,
                case=case,
                action=action,
                recovered_amount=recovered_amount,
            )

            db.flush()

            # ------------------------------------------------
            # If payment was not recovered, continue via
            # Recovery Loop:
            #   ML rank → skip attempted → Safety → next action
            #
            # Local import avoids circular import risk with
            # recovery_loop_service / action_service.
            # ------------------------------------------------

            if (
                case.status in [
                    CaseStatus.ACTIVE,
                    CaseStatus.IN_PROGRESS,
                ]
                and recovery_result.status in [
                    RecoveryResultStatus.NOT_RECOVERED,
                    RecoveryResultStatus.PARTIALLY_RECOVERED,
                ]
            ):

                from app.services.recovery_loop_service import (
                    process_recovery_loop,
                )

                process_recovery_loop(
                    db=db,
                    case=case,
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