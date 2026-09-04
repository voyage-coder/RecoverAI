"""
Apply merchant recovery mode after the pipeline creates an action.

Agent execution is per-case and merchant-triggered
(POST /api/recovery/cases/{id}/run-agent). This module only stamps
approval flags. It never loops cases and never auto-executes.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryAction,
    RecoveryCase,
    ActionStatus,
)
from app.services.merchant_settings_service import (
    classify_approval,
)


def _pending_action(db: Session, case_id: str) -> RecoveryAction | None:
    return db.scalar(
        select(RecoveryAction)
        .where(
            RecoveryAction.case_id == case_id,
            RecoveryAction.status.in_(
                [ActionStatus.PENDING, ActionStatus.PROCESSING]
            ),
        )
        .order_by(RecoveryAction.created_at.desc())
    )


def apply_merchant_recovery_mode(
    db: Session,
    case: RecoveryCase,
    *,
    auto_execute: bool = False,
) -> dict:
    """Stamp merchant policy on the pending action. Never executes."""
    pending = _pending_action(db, case.id)
    decision = classify_approval(db, case, pending)
    decision["auto_executed"] = False

    if pending is None:
        return decision

    pending.requires_approval = bool(decision["requires_approval"])
    db.add(pending)
    db.flush()

    # auto_execute is ignored. Agent runs only via run_agent_for_case.
    return decision
