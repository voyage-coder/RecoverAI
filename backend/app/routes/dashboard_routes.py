from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.database import get_db

from app.schema import (
    RecoveryCase,
    RecoveryResult,
    CaseStatus,
)


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
)


# ============================================================
# DASHBOARD OVERVIEW
# ============================================================

@router.get("/overview")
def get_dashboard_overview(
    db: Session = Depends(get_db),
):

    # --------------------------------------------------------
    # Total cases
    # --------------------------------------------------------

    total_cases = db.scalar(
        select(func.count(RecoveryCase.id))
    ) or 0

    # --------------------------------------------------------
    # Active
    # --------------------------------------------------------

    active_cases = db.scalar(
        select(func.count(RecoveryCase.id))
        .where(
            RecoveryCase.status == CaseStatus.ACTIVE
        )
    ) or 0

    # --------------------------------------------------------
    # In progress
    # --------------------------------------------------------

    in_progress_cases = db.scalar(
        select(func.count(RecoveryCase.id))
        .where(
            RecoveryCase.status == CaseStatus.IN_PROGRESS
        )
    ) or 0

    # --------------------------------------------------------
    # Recovered
    # --------------------------------------------------------

    recovered_cases = db.scalar(
        select(func.count(RecoveryCase.id))
        .where(
            RecoveryCase.status == CaseStatus.RECOVERED
        )
    ) or 0

    # --------------------------------------------------------
    # Escalated
    # --------------------------------------------------------

    escalated_cases = db.scalar(
        select(func.count(RecoveryCase.id))
        .where(
            RecoveryCase.status == CaseStatus.ESCALATED
        )
    ) or 0

    # --------------------------------------------------------
    # Closed
    # --------------------------------------------------------

    closed_cases = db.scalar(
        select(func.count(RecoveryCase.id))
        .where(
            RecoveryCase.status == CaseStatus.CLOSED
        )
    ) or 0

    # --------------------------------------------------------
    # Amount at risk
    # --------------------------------------------------------

    amount_at_risk = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    RecoveryCase.amount_at_risk
                ),
                0,
            )
        )
    ) or 0

    # --------------------------------------------------------
    # Amount recovered
    # --------------------------------------------------------

    amount_recovered = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    RecoveryResult.recovered_amount
                ),
                0,
            )
        )
    ) or 0

    # --------------------------------------------------------
    # Recovery rate
    # --------------------------------------------------------

    if amount_at_risk > 0:

        recovery_rate = round(
            (
                amount_recovered
                / amount_at_risk
            ) * 100,
            2,
        )

    else:

        recovery_rate = 0

    return {
        "total_cases": total_cases,

        "active_cases": active_cases,

        "in_progress_cases": in_progress_cases,

        "recovered_cases": recovered_cases,

        "escalated_cases": escalated_cases,

        "closed_cases": closed_cases,

        "amount_at_risk": amount_at_risk,

        "amount_recovered": amount_recovered,

        "recovery_rate": recovery_rate,
    }


@router.get("/recent-activity")
def get_recent_activity(
    db: Session = Depends(get_db),
):

    activities = db.execute(
        select(
            RecoveryCase.case_number,
            RecoveryCase.current_step,
            RecoveryCase.status,
            RecoveryCase.updated_at,
        )
        .order_by(
            RecoveryCase.updated_at.desc()
        )
        .limit(10)
    ).all()

    return [
        {
            "case_number": row.case_number,
            "current_step": row.current_step,
            "status": row.status,
            "updated_at": row.updated_at,
        }
        for row in activities
    ]


@router.get("/failure-categories")
def get_failure_categories(
    db: Session = Depends(get_db),
):

    rows = db.execute(
        select(
            RecoveryCase.failure_category,
            func.count(RecoveryCase.id),
        )
        .group_by(
            RecoveryCase.failure_category
        )
        .order_by(
            func.count(RecoveryCase.id).desc()
        )
    ).all()

    return [
        {
            "category": category.value,
            "count": count,
        }
        for category, count in rows
    ]