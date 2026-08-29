"""
Build merchant-facing recovery decision explanations from persisted data.

Explanations are derived only from RecoveryCase, RecoveryStrategy,
RecoveryAction, and RecoveryResult fields. Never invents rankings,
percentages, or recovery outcomes. Never mutates recovery state.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryAction,
    RecoveryCase,
    RecoveryResult,
    RecoveryStrategy,
    ActionStatus,
    CaseStatus,
)


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _probability_band(probability: int | None) -> dict:
    if probability is None:
        return {
            "label": "Prediction unavailable",
            "band": None,
            "disclaimer": "Prediction, not a guarantee",
        }
    if probability >= 70:
        band = "High likelihood of recovery"
    elif probability >= 40:
        band = "Moderate likelihood of recovery"
    else:
        band = "Lower likelihood of recovery"
    return {
        "label": band,
        "band": band,
        "disclaimer": "Prediction, not a guarantee",
    }


def _build_summary(case: RecoveryCase, selected: RecoveryStrategy | None) -> str:
    parts = []
    failure = _enum_value(case.failure_category) or case.failure_reason
    strategy = _enum_value(
        case.selected_strategy
        or (selected.strategy_type if selected else None)
    )
    if failure and strategy:
        parts.append(
            f"{strategy.replace('_', ' ').title()} was selected after "
            f"classifying the failure as {failure.replace('_', ' ')}."
        )
    elif strategy:
        parts.append(
            f"{strategy.replace('_', ' ').title()} is the recommended "
            f"recovery strategy for this case."
        )
    elif case.root_cause:
        parts.append(case.root_cause)
    else:
        parts.append(
            "Recovery decision data is still being assembled for this case."
        )

    if case.recovery_probability is not None:
        parts.append(
            f"Model recovery probability is {case.recovery_probability}% "
            f"(prediction, not a guarantee)."
        )
    return " ".join(parts)


def _build_factors(case: RecoveryCase) -> list[str]:
    factors = []
    if case.failure_category is not None:
        factors.append(
            f"Failure category: {_enum_value(case.failure_category)}."
        )
    if case.failure_reason:
        factors.append(f"Failure reason: {case.failure_reason}.")
    if case.root_cause:
        factors.append(f"Root cause: {case.root_cause}.")
    if case.recovery_probability is not None:
        factors.append(
            f"Recovery probability: {case.recovery_probability}%."
        )
    if case.ai_confidence is not None:
        factors.append(f"AI confidence: {case.ai_confidence}%.")
    if case.risk_level is not None:
        factors.append(f"Risk level: {_enum_value(case.risk_level)}.")
    if case.retry_count is not None:
        factors.append(f"Retry count: {case.retry_count}.")
    if case.contact_count is not None:
        factors.append(f"Contact count: {case.contact_count}.")
    return factors


def _safety_payload(
    case: RecoveryCase,
    actions: list[RecoveryAction],
    selected: RecoveryStrategy | None,
) -> dict:
    blocked = [
        a for a in actions if a.status == ActionStatus.BLOCKED
    ]
    pending = [
        a
        for a in actions
        if a.status in (ActionStatus.PENDING, ActionStatus.PROCESSING)
    ]
    executed = [
        a for a in actions if a.status == ActionStatus.EXECUTED
    ]
    failed = [
        a for a in actions if a.status == ActionStatus.FAILED
    ]

    if blocked and not pending:
        decision = "Blocked"
        reason = blocked[-1].result_text or "Action blocked by Safety Engine."
    elif pending:
        decision = "Allowed"
        reason = (
            selected.rationale
            if selected and selected.rationale
            else "Pending action prepared after Safety Engine approval."
        )
    elif executed:
        decision = "Allowed"
        reason = (
            executed[-1].result_text
            or "Action executed after Safety Engine approval."
        )
    elif case.status == CaseStatus.ESCALATED:
        decision = "Escalated"
        reason = case.current_step or "Case escalated; automated path exhausted."
    elif case.status == CaseStatus.CLOSED:
        decision = "Stopped"
        reason = case.current_step or "Recovery stopped."
    else:
        decision = "Not applicable"
        reason = "No Safety Engine decision recorded yet."

    if pending:
        execution = "Pending"
    elif failed and not executed and not pending:
        execution = "Failed"
    elif executed:
        execution = "Executed"
    elif blocked:
        execution = "Blocked"
    else:
        execution = "Not started"

    escalation_required = case.status == CaseStatus.ESCALATED
    stopping_applied = (
        case.status == CaseStatus.CLOSED
        or any(
            _enum_value(a.action_type) == "STOP_RECOVERY" for a in actions
        )
        or bool(blocked)
    )

    return {
        "decision": decision,
        "reason": reason,
        "execution_status": execution,
        "escalation_required": escalation_required,
        "stopping_rules_applied": stopping_applied,
        "stopping_rules_text": (
            selected.stopping_rules if selected else None
        ),
        "blocked_result_text": (
            blocked[-1].result_text if blocked else None
        ),
    }


def _decision_state(
    case: RecoveryCase,
    actions: list[RecoveryAction],
    result: RecoveryResult | None,
    payment_status: str | None,
) -> str:
    case_status = _enum_value(case.status)
    pay = (payment_status or "").upper()

    if case_status == "RECOVERED" or pay == "RECOVERED":
        return "Recovered"
    if case_status == "ESCALATED":
        return "Escalated"
    if case_status == "CLOSED":
        return "Stopped"
    if any(a.status == ActionStatus.BLOCKED for a in actions) and not any(
        a.status in (ActionStatus.PENDING, ActionStatus.PROCESSING)
        for a in actions
    ):
        return "Failed"
    if any(
        a.status in (ActionStatus.PENDING, ActionStatus.PROCESSING)
        for a in actions
    ):
        return "Awaiting merchant"
    if case.selected_strategy and case.root_cause:
        return "Decision ready"
    if case.root_cause:
        return "AI processing"
    return "AI processing"


def build_decision_explanation(
    db: Session,
    case_id: str,
    *,
    payment_status: str | None = None,
) -> dict | None:
    case = db.scalar(
        select(RecoveryCase).where(RecoveryCase.id == case_id)
    )
    if case is None:
        return None

    strategies = db.scalars(
        select(RecoveryStrategy)
        .where(RecoveryStrategy.case_id == case_id)
        .order_by(RecoveryStrategy.created_at.asc())
    ).all()

    actions = db.scalars(
        select(RecoveryAction)
        .where(RecoveryAction.case_id == case_id)
        .order_by(RecoveryAction.created_at.asc())
    ).all()

    result = db.scalar(
        select(RecoveryResult).where(RecoveryResult.case_id == case_id)
    )

    selected = next((s for s in strategies if s.is_selected), None)
    if selected is None and case.selected_strategy is not None:
        selected = next(
            (
                s
                for s in strategies
                if s.strategy_type == case.selected_strategy
            ),
            None,
        )

    alternatives = []
    for strategy in strategies:
        if selected and strategy.id == selected.id:
            continue
        alternatives.append(
            {
                "strategy": _enum_value(strategy.strategy_type),
                "selected": False,
                "available": True,
                "expected_probability": strategy.expected_probability,
                "reason": strategy.rationale,
                "safety_allowed": None,
                "is_ranked_score": False,
            }
        )

    # Honest note: probabilities on alternatives are ML estimates stored
    # at evaluation time when persist_strategy_evaluation ran — not a
    # fabricated leaderboard invented by the UI.
    ranked_supported = any(
        s.expected_probability is not None for s in strategies
    )

    comparison = []
    if selected is not None:
        comparison.append(
            {
                "strategy": _enum_value(selected.strategy_type),
                "selected": True,
                "available": True,
                "expected_probability": selected.expected_probability,
                "reason": selected.rationale,
                "role": "recommended",
            }
        )
    for alt in alternatives:
        comparison.append(
            {
                **alt,
                "role": "alternative",
            }
        )

    # Canonical strategy families for display when few rows exist
    catalog_note = None
    if not strategies:
        catalog_note = (
            "Strategy comparison rows appear after ML + Safety evaluation "
            "persists RecoveryStrategy records for this case."
        )

    prediction = _probability_band(case.recovery_probability)
    safety = _safety_payload(case, list(actions), selected)

    outcome = {
        "case_status": _enum_value(case.status),
        "result_status": _enum_value(result.status) if result else None,
        "recovered_amount": (
            result.recovered_amount if result is not None else None
        ),
        "original_amount": (
            result.original_amount if result is not None else None
        ),
        "recovery_method": (
            result.recovery_method if result is not None else None
        ),
        "recovered_at": (
            result.recovered_at.isoformat()
            if result is not None and result.recovered_at
            else None
        ),
        "source": "recovery_result" if result is not None else "case_status",
    }

    return {
        "case_id": case.id,
        "case_number": case.case_number,
        "decision_state": _decision_state(
            case, list(actions), result, payment_status
        ),
        "failure_category": _enum_value(case.failure_category),
        "failure_reason": case.failure_reason,
        "root_cause": case.root_cause,
        "recovery_probability": case.recovery_probability,
        "ai_confidence": case.ai_confidence,
        "risk_level": _enum_value(case.risk_level),
        "selected_strategy": _enum_value(
            case.selected_strategy
            or (selected.strategy_type if selected else None)
        ),
        "current_step": case.current_step,
        "decision_explanation": {
            "summary": _build_summary(case, selected),
            "factors": _build_factors(case),
            "strategy_reason": (
                selected.rationale if selected else None
            ),
            "safety_reason": safety["reason"],
        },
        "prediction": {
            "recovery_probability": case.recovery_probability,
            "ai_confidence": case.ai_confidence,
            **prediction,
        },
        "strategy_comparison": {
            "ranked_probabilities_supported": ranked_supported,
            "note": (
                "Alternative rows come from persisted RecoveryStrategy "
                "evaluations (ML ranking + Safety Engine reasons). "
                "Scores are not fabricated by the frontend."
                if ranked_supported
                else catalog_note
                or "Selected strategy is shown without fabricating ranks."
            ),
            "strategies": comparison,
        },
        "safety": safety,
        "outcome": outcome,
        "fabricated": False,
    }
