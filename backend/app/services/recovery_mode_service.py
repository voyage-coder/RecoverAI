"""
Apply merchant recovery mode after the existing pipeline creates an action.

Automatic execution uses executor_service.execute_action — the same path as
the Operations Center. Safety Engine decisions are not bypassed.
Never marks a case RECOVERED.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryAction,
    RecoveryCase,
    ActionStatus,
)
from app.services.merchant_settings_service import classify_approval
from app.services.executor_service import execute_action

logger = logging.getLogger(__name__)


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
    auto_execute: bool = True,
) -> dict:
    pending = _pending_action(db, case.id)
    decision = classify_approval(db, case, pending)

    if pending is None:
        return decision

    pending.requires_approval = bool(decision["requires_approval"])
    db.add(pending)
    db.flush()

    if not auto_execute or not decision.get("auto_eligible"):
        return decision

    # Persist the ingest/case before execute_action, which may commit or
    # roll back its own work. Never let an executor failure undo the case.
    db.commit()
    db.refresh(pending)
    db.refresh(case)

    try:
        execute_action(db, pending)
        db.flush()
        decision["auto_executed"] = True
        decision["approval_state"] = "AUTO_EXECUTED"
    except Exception:
        logger.exception(
            "Automatic recovery execution failed for case=%s; "
            "case is not RECOVERED.",
            case.id,
        )
        decision["auto_executed"] = False
        decision["approval_state"] = "AUTO_FAILED"
        decision["reason"] = (
            "Automatic execution failed. Merchant can retry from Operations."
        )
    return decision
