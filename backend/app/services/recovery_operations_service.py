"""
Operator recovery actions — thin HTTP layer over existing executor / loop.

Does not bypass Safety Engine or duplicate recovery pipeline logic.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    Communication,
    ActionStatus,
    CaseStatus,
    RecoveryResultStatus,
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

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+|\/recover\/[A-Za-z0-9_-]+")


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

    if pending.requires_approval and pending.status == ActionStatus.PENDING:
        # Merchant hitting this endpoint is the approval. Do not auto-run
        # approval-required actions from any other path.
        pass

    try:
        action = execute_action(db, pending)
    except ValueError as exc:
        if str(exc) == "action_already_terminal":
            raise ValueError("action_already_terminal") from exc
        raise
    db.flush()

    return {
        "message": "Recovery action executed through existing pipeline.",
        "case_id": case.id,
        "case_number": case.case_number,
        "case_status": (
            case.status.value
            if hasattr(case.status, "value")
            else str(case.status)
        ),
        "action_id": action.id,
        "action_type": (
            action.action_type.value
            if hasattr(action.action_type, "value")
            else str(action.action_type)
        ),
        "action_status": (
            action.status.value
            if hasattr(action.status, "value")
            else str(action.status)
        ),
        "result_text": action.result_text,
        "blocked": False,
    }


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
