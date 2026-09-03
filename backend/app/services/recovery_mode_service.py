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
    CaseStatus,
    RecoveryMode,
)
from app.services.merchant_settings_service import (
    classify_approval,
    get_or_create_settings,
)
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


def process_automatic_recovery_queue(db: Session) -> dict:
    """
    When Automatic mode is on, run every open case that is still allowed.

    Safety Engine, rupee caps, high-value threshold, and escalated /
    recovered / closed cases are skipped. Does not mark Recovered.
    """
    settings = get_or_create_settings(db)
    auto_on = (
        settings.recovery_mode == RecoveryMode.AUTOMATIC
        and bool(settings.automatic_recovery_enabled)
    )
    if not auto_on:
        return {
            "ran": False,
            "considered": 0,
            "executed": 0,
            "skipped": 0,
            "failed": 0,
        }

    from app.services.orchestrator_service import process_case

    case_ids = list(
        db.scalars(
            select(RecoveryCase.id).where(
                RecoveryCase.status.notin_(
                    [
                        CaseStatus.RECOVERED,
                        CaseStatus.CLOSED,
                        CaseStatus.ESCALATED,
                    ]
                )
            )
        ).all()
    )

    executed = 0
    skipped = 0
    failed = 0

    for case_id in case_ids:
        case = db.get(RecoveryCase, case_id)
        if case is None:
            continue
        if case.status in (
            CaseStatus.RECOVERED,
            CaseStatus.CLOSED,
            CaseStatus.ESCALATED,
        ):
            skipped += 1
            continue
        try:
            process_case(db, case)
            db.flush()
            db.refresh(case)
            decision = apply_merchant_recovery_mode(
                db,
                case,
                auto_execute=True,
            )
            if decision.get("auto_executed"):
                executed += 1
            else:
                skipped += 1
        except Exception:
            logger.exception(
                "Automatic queue failed for case=%s",
                case_id,
            )
            failed += 1
            try:
                db.rollback()
            except Exception:
                pass

    return {
        "ran": True,
        "considered": len(case_ids),
        "executed": executed,
        "skipped": skipped,
        "failed": failed,
    }
