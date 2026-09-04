from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db

from app.schema import (
    Payment,
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    RecoveryResult,
    Communication,
    AuditLog,
)

from app.api_schemas import (
    RecoveryCaseResponse,
    RecoveryCaseListResponse,
    RecoveryTimelineResponse,
    CasePaymentDetailsResponse,
    ExecuteRecoveryActionResponse,
    CheckoutConfigResponse,
    MerchantCustomerRecoveryLinkResponse,
    CaseDecisionExplanationResponse,
)

from app.services.orchestrator_service import (
    process_payment,
)
from app.services.payment_details_service import (
    get_case_payment_details,
)
from app.services.recovery_operations_service import (
    execute_pending_action_for_case,
    continue_recovery_for_case,
    run_agent_for_case,
    get_checkout_config_for_case,
)
from app.services.customer_recovery_service import (
    create_customer_recovery_link,
    merchant_link_status,
)
from app.services.decision_explanation_service import (
    build_decision_explanation,
)
from app.services.merchant_settings_service import (
    enrich_case_operations,
)


router = APIRouter(
    prefix="/api/recovery",
    tags=["Recovery"],
)


# ============================================================
# GET ALL RECOVERY CASES
# ============================================================

@router.get(
    "/cases",
    response_model=list[RecoveryCaseListResponse],
)
def get_recovery_cases(
    db: Session = Depends(get_db),
):

    cases = db.scalars(
        select(RecoveryCase)
        .order_by(
            RecoveryCase.created_at.desc()
        )
    ).all()

    return [enrich_case_operations(db, case) for case in cases]


# ============================================================
# GET SINGLE CASE
# ============================================================

@router.get(
    "/cases/{case_id}",
    response_model=RecoveryCaseResponse,
)
def get_recovery_case(
    case_id: str,
    db: Session = Depends(get_db),
):

    case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.id == case_id
        )
    )

    if not case:

        raise HTTPException(
            status_code=404,
            detail="Recovery case not found.",
        )

    extras = enrich_case_operations(db, case)
    payload = RecoveryCaseResponse.model_validate(case).model_dump()
    for key in (
        "event_source",
        "event_source_label",
        "webhook_authority_label",
        "outcome_kind",
        "recommended_action",
        "approval_state",
        "safety_decision",
        "requires_approval",
        "policy_reason",
        "next_step_code",
        "next_step_label",
        "next_step_detail",
    ):
        payload[key] = extras.get(key)
    return payload


# ============================================================
# GET CASE TIMELINE
# ============================================================

@router.get(
    "/cases/{case_id}/timeline",
    response_model=RecoveryTimelineResponse,
)
def get_case_timeline(
    case_id: str,
    db: Session = Depends(get_db),
):

    case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.id == case_id
        )
    )

    if not case:

        raise HTTPException(
            status_code=404,
            detail="Recovery case not found.",
        )

    strategies = db.scalars(
        select(RecoveryStrategy)
        .where(
            RecoveryStrategy.case_id == case_id
        )
        .order_by(
            RecoveryStrategy.created_at
        )
    ).all()

    actions = db.scalars(
        select(RecoveryAction)
        .where(
            RecoveryAction.case_id == case_id
        )
        .order_by(
            RecoveryAction.created_at
        )
    ).all()

    communications = db.scalars(
        select(Communication)
        .where(
            Communication.case_id == case_id
        )
        .order_by(
            Communication.sent_at
        )
    ).all()

    audit_logs = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.case_id == case_id
        )
        .order_by(
            AuditLog.timestamp
        )
    ).all()

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case_id
        )
    )

    return {
        "case": case,
        "strategies": strategies,
        "actions": actions,
        "communications": communications,
        "result": result,
        "audit_logs": audit_logs,
    }


# ============================================================
# CASE DECISION EXPLANATION (read-only)
# ============================================================

@router.get(
    "/cases/{case_id}/decision",
    response_model=CaseDecisionExplanationResponse,
    summary="Recovery decision explanation (derived)",
)
def get_case_decision_explanation(
    case_id: str,
    db: Session = Depends(get_db),
):
    """
    Merchant-facing explainability for diagnosis, strategy, safety,
    prediction vs actual outcome. Read-only — never mutates state.
    """
    payment = None
    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == case_id)
    )
    if case is not None:
        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )

    payload = build_decision_explanation(
        db,
        case_id,
        payment_status=payment.status if payment else None,
    )
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail="Recovery case not found.",
        )
    return payload


# ============================================================
# CASE PAYMENT DETAILS (read-only)
# ============================================================

@router.get(
    "/cases/{case_id}/payment-details",
    response_model=CasePaymentDetailsResponse,
)
def get_payment_details_for_case(
    case_id: str,
    db: Session = Depends(get_db),
):
    """
    Read-only payment + sanitized gateway attempt history for a case.
    """

    try:
        payload = get_case_payment_details(db, case_id)
    except ValueError as exc:
        if str(exc) == "payment_not_found":
            raise HTTPException(
                status_code=404,
                detail="Payment associated with recovery case was not found.",
            ) from exc
        raise

    if payload is None:
        raise HTTPException(
            status_code=404,
            detail="Recovery case not found.",
        )

    return payload


# ============================================================
# RUN RECOVERY FOR PAYMENT
# ============================================================

@router.post("/payments/{payment_id}/run")
def run_payment_recovery(
    payment_id: str,
    db: Session = Depends(get_db),
):

    payment = db.scalar(
        select(Payment).where(
            Payment.id == payment_id
        )
    )

    if not payment:

        raise HTTPException(
            status_code=404,
            detail="Payment not found.",
        )

    if payment.status != "FAILED":

        raise HTTPException(
            status_code=400,
            detail="Only failed payments can enter recovery.",
        )

    case = process_payment(
        db=db,
        payment=payment,
    )

    db.commit()

    if not case:

        return {
            "message": "Recovery case already completed."
        }

    return {
        "message": "Recovery workflow started.",
        "case_id": case.id,
        "case_number": case.case_number,
        "status": case.status,
    }


# ============================================================
# OPERATOR: EXECUTE PENDING RECOVERY ACTION
# ============================================================

@router.post(
    "/cases/{case_id}/execute-pending-action",
    response_model=ExecuteRecoveryActionResponse,
    summary="Execute pending recovery action",
    description=(
        "Runs the existing executor for the case's pending RecoveryAction. "
        "Safety Engine decisions are not bypassed."
    ),
)
def execute_pending_recovery_action(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        result = execute_pending_action_for_case(db, case_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        code = str(exc)
        if code == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        if code == "case_terminal":
            raise HTTPException(
                status_code=400,
                detail="Case is already closed or recovered.",
            ) from exc
        if code == "no_pending_action":
            raise HTTPException(
                status_code=404,
                detail=(
                    "Retry unavailable — no pending recovery action. "
                    "Continue recovery to prepare the next Safety-approved "
                    "step, or review why recovery stopped."
                ),
            ) from exc
        if code == "action_already_terminal":
            raise HTTPException(
                status_code=400,
                detail=(
                    "This recovery action already finished and cannot "
                    "execute twice."
                ),
            ) from exc
        if code == "approval_required":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Merchant approval is required before this action "
                    "can run. Use Approve & execute in Operations."
                ),
            ) from exc
        if code == "action_in_progress":
            raise HTTPException(
                status_code=409,
                detail="A recovery action is already running for this case.",
            ) from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except Exception:
        db.rollback()
        raise


# ============================================================
# AGENT: RUN FOR ONE CASE
# ============================================================

@router.post(
    "/cases/{case_id}/run-agent",
    response_model=ExecuteRecoveryActionResponse,
    summary="Run agent for one recovery case",
    description=(
        "Runs AI analysis, selects one strategy, applies the Safety Engine, "
        "and executes only that allowed action. Never iterates other cases."
    ),
)
def run_recovery_agent(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        result = run_agent_for_case(db, case_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        code = str(exc)
        if code == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        if code == "case_terminal":
            raise HTTPException(
                status_code=400,
                detail="Case is already closed or recovered.",
            ) from exc
        if code == "agent_mode_disabled":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Run Agent is available only when recovery mode is "
                    "set to run the agent per case."
                ),
            ) from exc
        if code == "action_already_terminal":
            raise HTTPException(
                status_code=400,
                detail=(
                    "This recovery action already finished and cannot "
                    "execute twice."
                ),
            ) from exc
        if code == "action_in_progress":
            raise HTTPException(
                status_code=409,
                detail="The agent is already running for this case.",
            ) from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except Exception:
        db.rollback()
        raise


# ============================================================
# OPERATOR: CONTINUE RECOVERY (ML + SAFETY → next action)
# ============================================================

@router.post(
    "/cases/{case_id}/continue-recovery",
    response_model=ExecuteRecoveryActionResponse,
    summary="Continue recovery pipeline",
    description=(
        "Executes a pending action if one exists, otherwise runs the "
        "recovery loop to prepare the next safe strategy action."
    ),
)
def continue_recovery(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        result = continue_recovery_for_case(db, case_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        code = str(exc)
        if code == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        if code in ("case_terminal", "already_recovered"):
            raise HTTPException(
                status_code=400,
                detail="Case recovery is already complete.",
            ) from exc
        if code == "no_action_created":
            raise HTTPException(
                status_code=400,
                detail="No further recovery action could be prepared.",
            ) from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except Exception:
        db.rollback()
        raise


# ============================================================
# OPERATOR: RAZORPAY TEST CHECKOUT CONFIG (read-only)
# ============================================================

@router.get(
    "/cases/{case_id}/checkout-config",
    response_model=CheckoutConfigResponse,
    summary="Razorpay TEST checkout configuration",
    description=(
        "Returns public checkout fields only. Never exposes API secrets."
    ),
)
def get_checkout_config(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        return get_checkout_config_for_case(db, case_id)
    except ValueError as exc:
        if str(exc) == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        raise
# ============================================================
# MERCHANT: CUSTOMER RECOVERY LINK
# ============================================================

@router.get(
    "/cases/{case_id}/customer-recovery-link",
    response_model=MerchantCustomerRecoveryLinkResponse,
    summary="Customer recovery link status",
)
def get_customer_recovery_link_status(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        return merchant_link_status(db, case_id)
    except ValueError as exc:
        if str(exc) == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/cases/{case_id}/customer-recovery-link",
    response_model=MerchantCustomerRecoveryLinkResponse,
    summary="Generate customer recovery link",
    description=(
        "Creates a hashed, expiring customer recovery token. "
        "Raw token is returned once in recovery_path."
    ),
)
def post_customer_recovery_link(
    case_id: str,
    db: Session = Depends(get_db),
):
    try:
        result = create_customer_recovery_link(db, case_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        code = str(exc)
        if code == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Recovery case not found.",
            ) from exc
        if code == "already_recovered":
            raise HTTPException(
                status_code=400,
                detail="Case is already recovered.",
            ) from exc
        if code == "case_closed":
            raise HTTPException(
                status_code=400,
                detail="Closed cases cannot generate recovery links.",
            ) from exc
        raise HTTPException(status_code=400, detail=code) from exc
    except Exception:
        db.rollback()
        raise
