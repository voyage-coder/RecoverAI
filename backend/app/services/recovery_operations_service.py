"""
Operator recovery actions — thin HTTP layer over existing executor / loop.

Does not bypass Safety Engine or duplicate recovery pipeline logic.
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    Communication,
    AuditLog,
    ActionStatus,
    CaseStatus,
    RecoveryResultStatus,
    ActorType,
    RecoveryMode,
)
from app.services.executor_service import execute_action
from app.services.orchestrator_service import process_case
from app.services.recovery_loop_service import process_recovery_loop
from app.services.payment_details_service import get_case_payment_details
from app.services.payment_gateway_service import (
    MODE_RAZORPAY_TEST,
    get_razorpay_public_key_id,
    is_razorpay_configured,
)
from app.services.merchant_settings_service import (
    classify_approval,
    get_or_create_settings,
    merchant_policy_plain,
)

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+|\/recover\/[A-Za-z0-9_-]+")
_agent_run_locks: dict[str, threading.Lock] = {}
_agent_locks_guard = threading.Lock()
_MAX_AGENT_STEPS = 8


def _case_agent_lock(case_id: str) -> threading.Lock:
    with _agent_locks_guard:
        lock = _agent_run_locks.get(case_id)
        if lock is None:
            lock = threading.Lock()
            _agent_run_locks[case_id] = lock
        return lock


def _get_case_or_raise(db: Session, case_id: str) -> RecoveryCase:
    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == case_id)
    )
    if case is None:
        raise ValueError("case_not_found")
    return case


def _latest_pending_action(
    db: Session,
    case_id: str,
) -> RecoveryAction | None:
    return db.scalar(
        select(RecoveryAction)
        .where(
            RecoveryAction.case_id == case_id,
            RecoveryAction.status.in_([
                ActionStatus.PENDING,
                ActionStatus.PROCESSING,
            ]),
        )
        .order_by(RecoveryAction.created_at.desc())
    )


def _latest_blocked_action(
    db: Session,
    case_id: str,
) -> RecoveryAction | None:
    return db.scalar(
        select(RecoveryAction)
        .where(
            RecoveryAction.case_id == case_id,
            RecoveryAction.status == ActionStatus.BLOCKED,
        )
        .order_by(RecoveryAction.created_at.desc())
    )


def _extract_payment_link(db: Session, case_id: str) -> str | None:
    communications = db.scalars(
        select(Communication)
        .where(Communication.case_id == case_id)
        .order_by(Communication.sent_at.desc())
    ).all()

    for comm in communications:
        if not comm.content:
            continue
        match = _URL_PATTERN.search(comm.content)
        if match:
            return match.group(0).rstrip(".,)")
    return None


def execute_pending_action_for_case(
    db: Session,
    case_id: str,
) -> dict:
    case = _get_case_or_raise(db, case_id)

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ]:
        raise ValueError("case_terminal")

    pending = _latest_pending_action(db, case_id)
    if pending is None:
        blocked = _latest_blocked_action(db, case_id)
        if blocked is not None:
            return {
                "message": "Action blocked by Safety Engine.",
                "case_id": case.id,
                "case_number": case.case_number,
                "case_status": (
                    case.status.value
                    if hasattr(case.status, "value")
                    else str(case.status)
                ),
                "action_id": blocked.id,
                "action_type": (
                    blocked.action_type.value
                    if hasattr(blocked.action_type, "value")
                    else str(blocked.action_type)
                ),
                "action_status": (
                    blocked.status.value
                    if hasattr(blocked.status, "value")
                    else str(blocked.status)
                ),
                "result_text": blocked.result_text,
                "blocked": True,
            }

        latest_executed = db.scalar(
            select(RecoveryAction)
            .where(
                RecoveryAction.case_id == case_id,
                RecoveryAction.status == ActionStatus.EXECUTED,
            )
            .order_by(RecoveryAction.created_at.desc())
        )
        if latest_executed is not None:
            return {
                "message": (
                    "No pending action — latest recovery action "
                    "was already executed (idempotent)."
                ),
                "case_id": case.id,
                "case_number": case.case_number,
                "case_status": (
                    case.status.value
                    if hasattr(case.status, "value")
                    else str(case.status)
                ),
                "action_id": latest_executed.id,
                "action_type": (
                    latest_executed.action_type.value
                    if hasattr(latest_executed.action_type, "value")
                    else str(latest_executed.action_type)
                ),
                "action_status": (
                    latest_executed.status.value
                    if hasattr(latest_executed.status, "value")
                    else str(latest_executed.status)
                ),
                "result_text": latest_executed.result_text,
                "blocked": False,
            }

        raise ValueError("no_pending_action")

    if pending.status == ActionStatus.PROCESSING:
        raise ValueError("action_in_progress")

    if pending.requires_approval and pending.status == ActionStatus.PENDING:
        # Merchant hitting this endpoint is the approval. Do not auto-run
        # approval-required actions from any other path.
        pass

    auto_on = _automatic_mode_on(db)
    lock = None
    if auto_on:
        lock = _case_agent_lock(case_id)
        if not lock.acquire(blocking=False):
            raise ValueError("action_in_progress")

    try:
        action = execute_action(
            db,
            pending,
            executed_by=ActorType.HUMAN_OPERATOR,
        )
        if not auto_on:
            return _response_from_action(
                _get_case_or_raise(db, case_id),
                "Recovery action executed through existing pipeline.",
                action,
                executed_count=1,
            )
        agent_result = _continue_agent_permitted_steps(
            db,
            case_id,
            allow_process_case=False,
            start_note=(
                "Agent continued after the merchant executed a step."
            ),
        )
    except ValueError as exc:
        if str(exc) == "action_already_terminal":
            raise ValueError("action_already_terminal") from exc
        if str(exc) == "action_in_progress":
            raise ValueError("action_in_progress") from exc
        raise
    finally:
        if lock is not None:
            lock.release()

    agent_count = int(agent_result.get("executed_count") or 0)
    prefix = "You ran this step. "
    if agent_result.get("agent_skipped"):
        message = prefix + (
            agent_result.get("message")
            or "The next action is waiting for you — click Execute."
        )
        merged = dict(agent_result)
        merged["message"] = message
        merged["executed_count"] = agent_count + 1
        return merged
    if agent_count:
        message = (
            prefix
            + f"The agent then ran {agent_count} allowed action(s)."
        )
        if agent_result.get("message"):
            message = prefix + str(agent_result["message"])
        merged = dict(agent_result)
        merged["message"] = message
        merged["executed_count"] = agent_count + 1
        return merged
    merged = dict(agent_result)
    merged["message"] = prefix + str(
        agent_result.get("message")
        or "Waiting for the next permitted step."
    )
    if not merged.get("action_id"):
        merged["action_id"] = action.id
        merged["action_type"] = _action_type_name(action)
        merged["action_status"] = (
            action.status.value
            if hasattr(action.status, "value")
            else str(action.status)
        )
        merged["result_text"] = action.result_text
    return merged


def _case_status_str(case: RecoveryCase) -> str:
    return (
        case.status.value
        if hasattr(case.status, "value")
        else str(case.status)
    )


def _is_awaiting_webhook(db: Session, case_id: str) -> bool:
    try:
        details = get_case_payment_details(db, case_id)
    except ValueError:
        return False
    if not details:
        return False
    payment = details.get("payment") or {}
    if str(payment.get("status") or "").upper() == "RECOVERED":
        return False
    gateway = details.get("gateway_summary") or {}
    if gateway.get("awaiting_webhook") is True:
        return True
    for attempt in details.get("attempts") or []:
        code = str(attempt.get("error_code") or "").upper()
        if "AWAITING" in code:
            return True
        if (attempt.get("gateway") or {}).get("awaiting_webhook") is True:
            return True
    return False


def _write_audit(
    db: Session,
    case_id: str,
    action_type: str,
    actor: ActorType,
    details,
) -> None:
    if isinstance(details, str):
        stored = details
    elif isinstance(details, dict):
        stored = str(details.get("note") or details.get("message") or "").strip()
        if not stored:
            stored = json.dumps(details)
    else:
        stored = json.dumps(details) if details is not None else ""
    db.add(
        AuditLog(
            id=str(uuid4()),
            case_id=case_id,
            action_type=action_type,
            actor=actor,
            details=stored,
            timestamp=datetime.utcnow(),
        )
    )


def _response_from_action(
    case: RecoveryCase,
    message: str,
    action: RecoveryAction | None = None,
    *,
    blocked: bool = False,
    agent_skipped: bool = False,
    executed_count: int = 0,
) -> dict:
    payload = {
        "message": message,
        "case_id": case.id,
        "case_number": case.case_number,
        "case_status": _case_status_str(case),
        "action_id": None,
        "action_type": None,
        "action_status": None,
        "result_text": None,
        "blocked": blocked,
        "agent_skipped": agent_skipped,
        "executed_count": executed_count,
    }
    if action is None:
        return payload
    payload["action_id"] = action.id
    payload["action_type"] = (
        action.action_type.value
        if hasattr(action.action_type, "value")
        else str(action.action_type)
    )
    payload["action_status"] = (
        action.status.value
        if hasattr(action.status, "value")
        else str(action.status)
    )
    payload["result_text"] = action.result_text
    payload["blocked"] = blocked or action.status == ActionStatus.BLOCKED
    payload["agent_skipped"] = agent_skipped
    payload["executed_count"] = executed_count
    return payload


def _ensure_pending_for_agent(
    db: Session,
    case: RecoveryCase,
    *,
    allow_process_case: bool = True,
) -> RecoveryAction | None:
    pending = _latest_pending_action(db, case.id)
    if pending is not None:
        return pending

    if allow_process_case:
        process_case(db, case)
        db.flush()
        db.refresh(case)
        pending = _latest_pending_action(db, case.id)
        if pending is not None:
            return pending

    loop_action = process_recovery_loop(db, case)
    db.flush()
    db.refresh(case)
    if loop_action is not None and loop_action.status in (
        ActionStatus.PENDING,
        ActionStatus.PROCESSING,
        ActionStatus.BLOCKED,
    ):
        return loop_action
    return _latest_pending_action(db, case.id)


def _action_type_name(action: RecoveryAction) -> str:
    return (
        action.action_type.value
        if hasattr(action.action_type, "value")
        else str(action.action_type)
    )


def _automatic_mode_on(db: Session) -> bool:
    settings = get_or_create_settings(db)
    return (
        settings.recovery_mode == RecoveryMode.AUTOMATIC
        and bool(settings.automatic_recovery_enabled)
    )


def _continue_agent_permitted_steps(
    db: Session,
    case_id: str,
    *,
    allow_process_case: bool,
    start_note: str,
) -> dict:
    """
    Execute every auto-eligible pending action on this case until the
    agent must stop (customer payment, merchant step, Safety, or done).
    Caller must hold the case agent lock.
    """
    case = _get_case_or_raise(db, case_id)

    if case.status in [CaseStatus.RECOVERED, CaseStatus.CLOSED]:
        return _response_from_action(
            case,
            "This case is closed or recovered.",
        )
    if case.status == CaseStatus.ESCALATED:
        return _response_from_action(
            case,
            "Case is escalated — automated recovery has stopped.",
        )
    if _is_awaiting_webhook(db, case_id):
        return _response_from_action(
            case,
            (
                "Waiting for the customer to pay. Recovered only "
                "after a verified webhook."
            ),
        )

    _write_audit(
        db,
        case.id,
        "AGENT_RUN_STARTED",
        ActorType.AI_AGENT,
        {"case_id": case.id, "note": start_note},
    )
    db.flush()

    executed_count = 0
    last_action: RecoveryAction | None = None
    last_message = "No eligible recovery action for the agent to run."

    for _ in range(_MAX_AGENT_STEPS):
        case = _get_case_or_raise(db, case_id)

        if case.status in [CaseStatus.RECOVERED, CaseStatus.CLOSED]:
            last_message = (
                f"Agent ran {executed_count} allowed action(s). "
                "This case is closed or recovered."
            )
            break

        if case.status == CaseStatus.ESCALATED:
            last_message = (
                f"Agent ran {executed_count} allowed action(s). "
                "Case is escalated — automated recovery has stopped."
            )
            break

        if _is_awaiting_webhook(db, case_id):
            last_message = (
                f"Agent ran {executed_count} allowed action(s). "
                "Waiting for the customer to pay. Recovered only "
                "after a verified webhook."
            )
            break

        pending = _ensure_pending_for_agent(
            db,
            case,
            allow_process_case=allow_process_case and executed_count == 0,
        )
        if pending is None:
            blocked = _latest_blocked_action(db, case_id)
            if blocked is not None and executed_count == 0:
                _write_audit(
                    db,
                    case.id,
                    "SAFETY_DECISION",
                    ActorType.SAFETY_ENGINE,
                    {
                        "decision": "BLOCKED",
                        "action_id": blocked.id,
                        "note": (
                            "Safety Engine blocked the selected action. "
                            "Not executed."
                        ),
                    },
                )
                return _response_from_action(
                    case,
                    "Action blocked by Safety Engine.",
                    blocked,
                    blocked=True,
                    executed_count=0,
                )
            last_message = (
                (
                    f"Agent ran {executed_count} allowed action(s) "
                    "for this case. All permitted strategies are done."
                )
                if executed_count
                else "All permitted strategies are done."
            )
            break

        if pending.status == ActionStatus.PROCESSING:
            raise ValueError("action_in_progress")

        if pending.status == ActionStatus.BLOCKED:
            _write_audit(
                db,
                case.id,
                "SAFETY_DECISION",
                ActorType.SAFETY_ENGINE,
                {
                    "decision": "BLOCKED",
                    "action_id": pending.id,
                    "note": (
                        "Safety Engine blocked the selected action. "
                        "Not executed."
                    ),
                },
            )
            prefix = (
                f"Agent ran {executed_count} allowed action(s). "
                if executed_count
                else ""
            )
            return _response_from_action(
                case,
                prefix + "Action blocked by Safety Engine.",
                pending,
                blocked=True,
                executed_count=executed_count,
            )

        decision = classify_approval(db, case, pending)
        selected = _action_type_name(pending)
        _write_audit(
            db,
            case.id,
            "STRATEGY_SELECTED",
            ActorType.AI_AGENT,
            {
                "strategy": selected,
                "action_id": pending.id,
                "note": "Next permitted strategy for this agent run.",
            },
        )

        if not bool(decision.get("auto_eligible")):
            _write_audit(
                db,
                case.id,
                "SAFETY_DECISION",
                ActorType.SAFETY_ENGINE,
                {
                    "decision": "NOT_EXECUTED",
                    "reason": decision.get("reason"),
                    "action_id": pending.id,
                    "note": (
                        "Left for the merchant. Click Execute on this case."
                    ),
                },
            )
            db.flush()
            skip_text = merchant_policy_plain(decision) or (
                "The agent left this step for you. Click Execute on this case."
            )
            if executed_count:
                skip_text = (
                    f"Agent ran {executed_count} allowed action(s). "
                    + skip_text
                )
            return _response_from_action(
                case,
                skip_text,
                pending,
                blocked=bool(decision.get("approval_state") == "BLOCKED"),
                agent_skipped=True,
                executed_count=executed_count,
            )

        _write_audit(
            db,
            case.id,
            "SAFETY_DECISION",
            ActorType.SAFETY_ENGINE,
            {
                "decision": "ALLOWED",
                "action_id": pending.id,
                "strategy": selected,
            },
        )
        db.flush()

        try:
            action = execute_action(
                db,
                pending,
                executed_by=ActorType.AI_AGENT,
            )
        except ValueError as exc:
            if str(exc) == "action_already_terminal":
                raise ValueError("action_already_terminal") from exc
            if str(exc) == "action_in_progress":
                raise ValueError("action_in_progress") from exc
            raise

        executed_count += 1
        last_action = action
        last_message = (
            f"Agent ran {executed_count} allowed action(s) for this case."
        )
        if selected in {"HUMAN_ESCALATION", "STOP_RECOVERY"}:
            last_message = (
                f"Agent ran {executed_count} allowed action(s). "
                "Recovery was escalated or stopped."
            )
            break
    else:
        last_message = (
            f"Agent ran {executed_count} allowed action(s) "
            "for this case (step limit for one click). Refresh the case."
        )

    case = _get_case_or_raise(db, case_id)
    _write_audit(
        db,
        case.id,
        "AGENT_RUN_COMPLETED",
        ActorType.AI_AGENT,
        {
            "executed_count": executed_count,
            "note": last_message,
        },
    )
    db.flush()
    return _response_from_action(
        case,
        last_message,
        last_action,
        executed_count=executed_count,
    )


def run_agent_for_case(db: Session, case_id: str) -> dict:
    """
    One HTTP request = one case. Analyze, then execute every action that
    Safety and merchant policy allow, until the agent must stop.
    Does not iterate other cases.
    """
    lock = _case_agent_lock(case_id)
    if not lock.acquire(blocking=False):
        raise ValueError("action_in_progress")

    try:
        if not _automatic_mode_on(db):
            raise ValueError("agent_mode_disabled")
        case = _get_case_or_raise(db, case_id)
        if case.status in [CaseStatus.RECOVERED, CaseStatus.CLOSED]:
            raise ValueError("case_terminal")
        return _continue_agent_permitted_steps(
            db,
            case_id,
            allow_process_case=True,
            start_note=(
                "Merchant triggered Run Agent for this case. "
                "The agent executes every permitted action, then stops."
            ),
        )
    finally:
        lock.release()


def continue_recovery_for_case(
    db: Session,
    case_id: str,
) -> dict:
    """
    If a pending action exists, execute it.
    Otherwise run recovery loop to select the next safe strategy.
    """

    case = _get_case_or_raise(db, case_id)

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ]:
        raise ValueError("case_terminal")

    if _is_awaiting_webhook(db, case_id):
        return {
            "message": (
                "Razorpay TEST payment is awaiting a verified "
                "payment.captured webhook. Do not prepare another "
                "action yet — refresh after the webhook reaches "
                "POST /api/webhooks/razorpay."
            ),
            "case_id": case.id,
            "case_number": case.case_number,
            "case_status": _case_status_str(case),
            "action_id": None,
            "action_type": None,
            "action_status": None,
            "result_text": "AWAITING_CUSTOMER_PAYMENT",
            "blocked": False,
        }

    if case.status == CaseStatus.ESCALATED:
        return {
            "message": (
                "Case is escalated — no further automated recovery "
                "actions. If a Razorpay TEST order exists, complete "
                "payment and wait for the verified webhook."
            ),
            "case_id": case.id,
            "case_number": case.case_number,
            "case_status": _case_status_str(case),
            "action_id": None,
            "action_type": None,
            "action_status": None,
            "result_text": "ESCALATED",
            "blocked": False,
        }

    pending = _latest_pending_action(db, case_id)
    if pending is not None:
        return execute_pending_action_for_case(db, case_id)

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case_id
        )
    )

    if result is not None:
        if result.status == RecoveryResultStatus.FULLY_RECOVERED:
            raise ValueError("already_recovered")

        loop_action = process_recovery_loop(db, case)
        db.flush()

        if loop_action is not None:
            return {
                "message": (
                    "Next recovery action prepared by ML + Safety Engine. "
                    "Execute the pending action to run it."
                ),
                "case_id": case.id,
                "case_number": case.case_number,
                "case_status": _case_status_str(case),
                "action_id": loop_action.id,
                "action_type": (
                    loop_action.action_type.value
                    if hasattr(loop_action.action_type, "value")
                    else str(loop_action.action_type)
                ),
                "action_status": (
                    loop_action.status.value
                    if hasattr(loop_action.status, "value")
                    else str(loop_action.status)
                ),
                "result_text": loop_action.result_text,
                "blocked": (
                    loop_action.status == ActionStatus.BLOCKED
                ),
            }

        # Loop stopped (escalated / no safe strategy / recovered).
        db.refresh(case)
        return {
            "message": (
                "No further recovery action was prepared "
                f"(case status: {_case_status_str(case)}). "
                "If a Razorpay TEST order is open, complete payment "
                "and wait for the verified webhook."
            ),
            "case_id": case.id,
            "case_number": case.case_number,
            "case_status": _case_status_str(case),
            "action_id": None,
            "action_type": None,
            "action_status": None,
            "result_text": case.current_step,
            "blocked": False,
        }

    process_case(db, case)
    db.flush()

    pending = _latest_pending_action(db, case_id)
    if pending is None:
        blocked = _latest_blocked_action(db, case_id)
        if blocked is not None:
            return {
                "message": "Recovery blocked by Safety Engine.",
                "case_id": case.id,
                "case_number": case.case_number,
                "case_status": _case_status_str(case),
                "action_id": blocked.id,
                "action_type": (
                    blocked.action_type.value
                    if hasattr(blocked.action_type, "value")
                    else str(blocked.action_type)
                ),
                "action_status": str(blocked.status),
                "result_text": blocked.result_text,
                "blocked": True,
            }
        db.refresh(case)
        return {
            "message": (
                "No further recovery action could be prepared. "
                "Refresh the case or wait for a Razorpay webhook "
                "if payment was completed in TEST MODE."
            ),
            "case_id": case.id,
            "case_number": case.case_number,
            "case_status": _case_status_str(case),
            "action_id": None,
            "action_type": None,
            "action_status": None,
            "result_text": case.current_step,
            "blocked": False,
        }

    return {
        "message": (
            "Recovery action prepared. Execute the pending action to run it."
        ),
        "case_id": case.id,
        "case_number": case.case_number,
        "case_status": _case_status_str(case),
        "action_id": pending.id,
        "action_type": (
            pending.action_type.value
            if hasattr(pending.action_type, "value")
            else str(pending.action_type)
        ),
        "action_status": str(pending.status),
        "result_text": pending.result_text,
        "blocked": pending.status == ActionStatus.BLOCKED,
    }


def get_checkout_config_for_case(
    db: Session,
    case_id: str,
) -> dict:
    case = _get_case_or_raise(db, case_id)

    try:
        details = get_case_payment_details(db, case_id)
    except ValueError:
        details = None

    payment = (details or {}).get("payment") or {}
    gateway = (details or {}).get("gateway_summary") or {}

    order_id = gateway.get("order_id")
    amount = payment.get("amount") or case.amount_at_risk
    currency = payment.get("currency") or "INR"
    awaiting = gateway.get("awaiting_webhook")
    mode = gateway.get("mode")
    payment_link_url = _extract_payment_link(db, case_id)
    payment_status = str(payment.get("status") or "").upper()

    razorpay_test = is_razorpay_configured()
    public_key = get_razorpay_public_key_id() if razorpay_test else None

    checkout_available = bool(
        (order_id and razorpay_test and payment_status != "RECOVERED")
        or (payment_link_url and payment_status != "RECOVERED")
    )

    message = None
    if payment_status == "RECOVERED":
        checkout_available = False
        message = (
            "Payment already marked RECOVERED by a verified webhook. "
            "Checkout is closed for this case."
        )
    elif not checkout_available:
        message = "Run the recommended action first to create a payment link."
    elif awaiting or (order_id and razorpay_test):
        message = "Pay once, then refresh after payment is confirmed."
    elif payment_link_url:
        message = "Use the payment link to complete payment."

    return {
        "available": checkout_available,
        "test_mode": mode == MODE_RAZORPAY_TEST or razorpay_test,
        "demo_label": "Test payment",
        "mode": mode,
        "razorpay_key_id": public_key,
        "order_id": order_id,
        "amount": amount,
        "currency": currency,
        "awaiting_webhook": awaiting,
        "payment_link_url": payment_link_url,
        "payment_status": payment.get("status"),
        "case_status": (
            case.status.value
            if hasattr(case.status, "value")
            else str(case.status)
        ),
        "message": message,
    }
