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
)

from app.services.orchestrator_service import (
    process_payment,
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

    return cases


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

    return case


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