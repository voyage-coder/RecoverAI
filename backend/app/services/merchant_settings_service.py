"""
Merchant recovery policy and TEST credential storage.

Secrets are never included in public response dicts.
Default recovery mode is MANUAL so existing operator/demo flows stay unchanged.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    MerchantSettings,
    Payment,
    RecoveryAction,
    RecoveryCase,
    RecoveryMode,
    ActionStatus,
    CaseStatus,
)

DEFAULT_SETTINGS_ID = "default"

SECRET_MARKERS = (
    "key_secret",
    "webhook_secret",
    "razorpay_key_secret",
    "razorpay_webhook_secret",
)


def get_or_create_settings(db: Session) -> MerchantSettings:
    row = db.get(MerchantSettings, DEFAULT_SETTINGS_ID)
    if row is not None:
        return row
    row = MerchantSettings(id=DEFAULT_SETTINGS_ID)
    db.add(row)
    db.flush()
    return row


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _key_hint(key_id: str | None) -> str | None:
    value = (key_id or "").strip()
    if not value:
        return None
    if len(value) <= 8:
        return value[:4] + "****"
    return f"{value[:8]}…{value[-4:]}"


def public_settings_payload(settings: MerchantSettings) -> dict:
    """Safe merchant-facing settings — never includes secrets."""
    return {
        "recovery_mode": _enum_value(settings.recovery_mode),
        "automatic_recovery_enabled": bool(
            settings.automatic_recovery_enabled
        ),
        "max_automatic_recovery_amount": int(
            settings.max_automatic_recovery_amount
        ),
        "max_retry_attempts": int(settings.max_retry_attempts),
        "payment_link_expiry_hours": int(
            settings.payment_link_expiry_hours
        ),
        "high_value_approval_threshold": int(
            settings.high_value_approval_threshold
        ),
        "razorpay_key_id_configured": bool(
            (settings.razorpay_key_id or "").strip()
        ),
        "razorpay_key_id_hint": _key_hint(settings.razorpay_key_id),
        "webhook_secret_configured": bool(
            (settings.razorpay_webhook_secret or "").strip()
        ),
        "key_secret_configured": bool(
            (settings.razorpay_key_secret or "").strip()
        ),
        "credentials_last_tested_at": (
            settings.credentials_last_tested_at.isoformat()
            if settings.credentials_last_tested_at
            else None
        ),
        "credentials_last_test_ok": settings.credentials_last_test_ok,
        "credentials_last_test_detail": settings.credentials_last_test_detail,
        "updated_at": (
            settings.updated_at.isoformat()
            if settings.updated_at
            else None
        ),
    }


def update_policy(db: Session, body: dict) -> MerchantSettings:
    settings = get_or_create_settings(db)

    if "recovery_mode" in body and body["recovery_mode"] is not None:
        mode = str(body["recovery_mode"]).strip().upper()
        settings.recovery_mode = RecoveryMode(mode)

    if "automatic_recovery_enabled" in body:
        settings.automatic_recovery_enabled = bool(
            body["automatic_recovery_enabled"]
        )

    if settings.recovery_mode == RecoveryMode.AUTOMATIC:
        settings.automatic_recovery_enabled = True

    for field, attr, minimum, maximum in (
        (
            "max_automatic_recovery_amount",
            "max_automatic_recovery_amount",
            1,
            100_000_000,
        ),
        ("max_retry_attempts", "max_retry_attempts", 0, 20),
        (
            "payment_link_expiry_hours",
            "payment_link_expiry_hours",
            1,
            24 * 30,
        ),
        (
            "high_value_approval_threshold",
            "high_value_approval_threshold",
            1,
            100_000_000,
        ),
    ):
        if field in body and body[field] is not None:
            value = int(body[field])
            if value < minimum or value > maximum:
                raise ValueError(
                    f"{field} must be between {minimum} and {maximum}."
                )
            setattr(settings, attr, value)

    settings.updated_at = datetime.utcnow()
    db.add(settings)
    db.flush()
    return settings


def store_razorpay_credentials(db: Session, body: dict) -> MerchantSettings:
    settings = get_or_create_settings(db)

    key_id = str(body.get("key_id") or "").strip()
    key_secret = str(body.get("key_secret") or "").strip()
    webhook_secret = str(body.get("webhook_secret") or "").strip()

    if key_id:
        if key_id.startswith("rzp_live_"):
            raise ValueError(
                "Live Razorpay keys are not allowed. Use a TEST key "
                "(rzp_test_…)."
            )
        settings.razorpay_key_id = key_id[:100]

    if key_secret:
        settings.razorpay_key_secret = key_secret

    if webhook_secret:
        settings.razorpay_webhook_secret = webhook_secret

    if not key_id and not key_secret and not webhook_secret:
        raise ValueError("Provide at least one credential field to update.")

    settings.updated_at = datetime.utcnow()
    db.add(settings)
    db.flush()
    return settings


def _as_secret_str(value) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def stored_credentials(db: Session) -> tuple[str, str, str]:
    settings = get_or_create_settings(db)
    return (
        _as_secret_str(settings.razorpay_key_id),
        _as_secret_str(settings.razorpay_key_secret),
        _as_secret_str(settings.razorpay_webhook_secret),
    )


def payment_link_expiry_hours(db: Session) -> int:
    settings = get_or_create_settings(db)
    hours = int(settings.payment_link_expiry_hours or 72)
    return max(1, min(hours, 24 * 30))


def merchant_policy_plain(policy: dict) -> str | None:
    """Short merchant-facing text when the agent is not allowed to execute."""
    reason = str(policy.get("reason") or "")
    if policy.get("high_value"):
        return (
            "This payment is large, so the agent did not send anything. "
            "In Settings choose Manual, open this case, then click Execute."
        )
    if policy.get("over_auto_cap"):
        return (
            "This payment is above the agent rupee limit, so the agent "
            "did not send anything. In Settings choose Manual, open this "
            "case, then click Execute."
        )
    if "retry limit" in reason.lower():
        return (
            "The agent already used the allowed payment retries, so it "
            "did not charge the original method again. A payment link or "
            "reminder can still run. Or choose Manual and click Execute."
        )
    return None


def classify_approval(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction | None = None,
) -> dict:
    """
    Derive merchant approval / auto-exec eligibility.

    Does not mutate recovery truth (RECOVERED). Safety Engine remains
    the action-eligibility authority; this layer applies merchant policy.
    """
    settings = get_or_create_settings(db)
    mode = settings.recovery_mode
    amount = int(case.amount_at_risk or 0)
    auto_on = bool(settings.automatic_recovery_enabled)
    high_value = amount >= int(settings.high_value_approval_threshold)
    over_auto_cap = amount > int(settings.max_automatic_recovery_amount)

    action_type = None
    action_status = None
    if action is not None:
        action_type = _enum_value(action.action_type)
        action_status = _enum_value(action.status)

    blocked = action_status == "BLOCKED"
    pending = action_status in {"PENDING", "PROCESSING"}

    requires_approval = False
    auto_eligible = False
    reason = "Merchant executes recovery actions from Operations."

    if case.status in (
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ):
        reason = "Case is terminal — no merchant recovery action."
    elif blocked:
        reason = "Action blocked by Safety Engine."
    elif not pending:
        reason = "No pending recovery action."
    elif action_type in {"HUMAN_ESCALATION", "STOP_RECOVERY"}:
        requires_approval = True
        reason = "Escalation / stop actions require merchant review."
    elif mode == RecoveryMode.MANUAL or not auto_on:
        reason = "Manual recovery mode — merchant must execute."
    elif mode == RecoveryMode.APPROVAL_REQUIRED:
        requires_approval = True
        reason = "Approval required before execution."
    elif high_value:
        requires_approval = True
        reason = (
            "Amount meets the high-value approval threshold."
        )
    elif over_auto_cap:
        requires_approval = True
        reason = (
            "Amount exceeds the maximum automatic recovery amount."
        )
    elif (
        action_type in {"IMMEDIATE_RETRY", "RETRY_AFTER_DELAY"}
        and int(case.retry_count or 0) >= int(settings.max_retry_attempts)
    ):
        requires_approval = True
        reason = "Merchant retry limit reached — automatic retry blocked."
    elif mode == RecoveryMode.AUTOMATIC and auto_on:
        auto_eligible = True
        reason = (
            "Automatic mode: action passed Safety Engine and "
            "merchant limits."
        )
    else:
        requires_approval = True
        reason = "Merchant review required."

    approval_state = "NONE"
    if blocked:
        approval_state = "BLOCKED"
    elif case.status == CaseStatus.RECOVERED:
        approval_state = "NONE"
    elif pending and requires_approval:
        approval_state = "AWAITING_APPROVAL"
    elif pending and auto_eligible:
        approval_state = "AUTO_ELIGIBLE"
    elif pending:
        approval_state = "READY_TO_EXECUTE"

    return {
        "recovery_mode": _enum_value(mode),
        "requires_approval": requires_approval,
        "auto_eligible": auto_eligible,
        "approval_state": approval_state,
        "reason": reason,
        "high_value": high_value,
        "over_auto_cap": over_auto_cap,
        "recommended_action": action_type,
        "action_status": action_status,
        "safety_decision": (
            "Blocked"
            if blocked
            else ("Allowed" if pending else "Not applicable")
        ),
    }


def event_source_for_case(db: Session, case: RecoveryCase) -> str:
    payment = db.get(Payment, case.payment_id)
    if payment is None:
        return "DEMO_EVENT"
    source = getattr(payment, "event_source", None) or "DEMO_EVENT"
    return str(source)


def outcome_kind(case: RecoveryCase) -> str:
    status = _enum_value(case.status)
    if status == "RECOVERED":
        return "CONFIRMED_RECOVERY"
    return "PREDICTED_RECOVERY"


def enrich_case_operations(db: Session, case: RecoveryCase) -> dict:
    pending = db.scalar(
        select(RecoveryAction)
        .where(
            RecoveryAction.case_id == case.id,
            RecoveryAction.status.in_(
                [
                    ActionStatus.PENDING,
                    ActionStatus.PROCESSING,
                    ActionStatus.BLOCKED,
                ]
            ),
        )
        .order_by(RecoveryAction.created_at.desc())
    )
    if pending is None:
        pending = db.scalar(
            select(RecoveryAction)
            .where(RecoveryAction.case_id == case.id)
            .order_by(RecoveryAction.created_at.desc())
        )

    policy = classify_approval(db, case, pending)
    source = event_source_for_case(db, case)
    guidance = merchant_next_step(db, case, pending, policy)

    return {
        "id": case.id,
        "case_number": case.case_number,
        "amount_at_risk": case.amount_at_risk,
        "status": _enum_value(case.status),
        "failure_category": _enum_value(case.failure_category),
        "failure_reason": case.failure_reason,
        "recovery_probability": case.recovery_probability or 0,
        "risk_level": case.risk_level,
        "selected_strategy": _enum_value(case.selected_strategy),
        "current_step": case.current_step,
        "retry_count": case.retry_count,
        "contact_count": case.contact_count,
        "created_at": case.created_at,
        "event_source": source,
        "event_source_label": (
            "Live Provider Event"
            if source == "LIVE_PROVIDER"
            else "Demo Event"
        ),
        "webhook_authority_label": (
            "Verified Webhook"
            if _enum_value(case.status) == "RECOVERED"
            else None
        ),
        "outcome_kind": outcome_kind(case),
        "recommended_action": policy["recommended_action"],
        "approval_state": policy["approval_state"],
        "safety_decision": policy["safety_decision"],
        "requires_approval": policy["requires_approval"],
        "policy_reason": policy["reason"],
        "next_step_code": guidance["code"],
        "next_step_label": guidance["label"],
        "next_step_detail": guidance["detail"],
    }


def merchant_next_step(
    db: Session,
    case: RecoveryCase,
    action: RecoveryAction | None,
    policy: dict,
) -> dict:
    """
    Merchant-facing next action from persisted case/action/policy only.
    """
    status = _enum_value(case.status)
    action_status = policy.get("action_status")
    awaiting_customer = False
    if case.payment_id:
        from app.schema import PaymentAttempt

        attempts = db.scalars(
            select(PaymentAttempt).where(
                PaymentAttempt.payment_id == case.payment_id
            )
        ).all()
        for attempt in attempts:
            gateway = attempt.gateway_response
            if isinstance(gateway, dict) and gateway.get(
                "awaiting_webhook"
            ):
                awaiting_customer = True
                break
            code = str(attempt.error_code or "").upper()
            if "AWAITING" in code:
                awaiting_customer = True
                break

    if status == "RECOVERED":
        return {
            "code": "CONFIRMED_RECOVERY",
            "label": "Recovery confirmed",
            "detail": (
                "A verified payment.captured webhook marked this case "
                "RECOVERED. No further merchant action is required."
            ),
        }
    if status == "CLOSED":
        return {
            "code": "RECOVERY_STOPPED",
            "label": "Recovery stopped",
            "detail": (
                "This case is closed. RecoverAI will not run further "
                "automatic recovery actions."
            ),
        }
    if action_status == "BLOCKED" or policy.get("approval_state") == "BLOCKED":
        return {
            "code": "SAFETY_BLOCKED",
            "label": "Safety Engine blocked this action",
            "detail": (
                policy.get("reason")
                or "The Safety Engine blocked the recommended action. "
                "Review the case; RecoverAI will not bypass safety limits."
            ),
        }
    if status == "ESCALATED":
        return {
            "code": "ESCALATED",
            "label": "Needs human follow-up",
            "detail": (
                case.current_step
                or "The case is escalated. Review Operations and continue "
                "only if a safe pending action exists."
            ),
        }
    if awaiting_customer:
        return {
            "code": "AWAITING_CUSTOMER",
            "label": "Waiting for customer payment",
            "detail": (
                "A checkout or payment link is waiting on the customer. "
                "RecoverAI will confirm recovery only after a verified "
                "payment capture. If checkout finished and this has not "
                "updated, the webhook was not received."
            ),
        }
    if policy.get("approval_state") == "AWAITING_APPROVAL":
        plain = merchant_policy_plain(policy)
        return {
            "code": "APPROVAL_REQUIRED",
            "label": (
                "Agent will not send this — you can run it in Manual"
                if plain
                else "Merchant approval required"
            ),
            "detail": (
                plain
                or policy.get("reason")
                or "Approve and execute the recommended action in Operations. "
                "Approval does not mark the payment recovered."
            ),
        }
    if policy.get("approval_state") == "READY_TO_EXECUTE":
        return {
            "code": "READY_TO_EXECUTE",
            "label": "Execute the recommended recovery action",
            "detail": (
                "Run the pending action from Operations. This starts recovery "
                "work; it does not confirm customer payment."
            ),
        }
    if action_status in {"PENDING", "PROCESSING"}:
        return {
            "code": "ACTION_WAITING",
            "label": "A recovery action is waiting",
            "detail": (
                f"Current action: {policy.get('recommended_action') or 'pending'}."
            ),
        }
    return {
        "code": "IN_PROGRESS",
        "label": "Recovery in progress",
        "detail": (
            case.current_step
            or "The recovery pipeline is active. Use continue-recovery if "
            "no pending action is listed."
        ),
    }
