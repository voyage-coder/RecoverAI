"""
Persist ML + Safety strategy evaluation rows on RecoveryStrategy.

Does not change ranking or Safety Engine logic — only records what
select_safe_strategy already returned so merchants can inspect
recommended vs rejected alternatives from real decision data.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    RecoveryCase,
    RecoveryStrategy,
    StrategyType,
)


def _strategy_enum(value) -> StrategyType:
    if isinstance(value, StrategyType):
        return value
    return StrategyType(str(value))


def _find_strategy_row(
    db: Session,
    *,
    case_id: str,
    strategy_type: StrategyType,
) -> RecoveryStrategy | None:
    return db.scalar(
        select(RecoveryStrategy)
        .where(
            RecoveryStrategy.case_id == case_id,
            RecoveryStrategy.strategy_type == strategy_type,
        )
        .order_by(RecoveryStrategy.created_at.desc())
        .limit(1)
    )


def persist_strategy_evaluation(
    db: Session,
    case: RecoveryCase,
    selection: dict | None,
) -> RecoveryStrategy | None:
    """
    Upsert RecoveryStrategy rows for every evaluated ranking entry.

    Selected strategy gets ML + Safety approval rationale.
    Non-selected entries store the real rejection / skip reason
    from the Safety Engine or "already attempted" path.
    """
    if not selection:
        return None

    rankings = selection.get("rankings") or []
    selected = selection.get("strategy")
    selected_enum = (
        _strategy_enum(selected) if selected is not None else None
    )
    probability = selection.get("probability")
    safety_reason = str(selection.get("safety_reason") or "").strip()

    selected_row: RecoveryStrategy | None = None
    seen: set[StrategyType] = set()

    for item in rankings:
        strategy_enum = _strategy_enum(item["strategy"])
        seen.add(strategy_enum)
        is_selected = (
            selected_enum is not None and strategy_enum == selected_enum
        )
        item_probability = item.get("probability")
        if item_probability is None:
            item_probability = probability

        if is_selected:
            rationale = (
                f"ML model predicted "
                f"{float(item_probability):.2f}% recovery probability "
                f"for this strategy. "
                f"Safety Engine approved the strategy. "
                f"{safety_reason}".strip()
            )
            expected = (
                round(float(item_probability))
                if item_probability is not None
                else None
            )
            stopping = (
                "Stop recovery if payment is successfully "
                "recovered or safety policy blocks further "
                "attempts."
            )
        else:
            reason = str(item.get("reason") or "").strip()
            allowed = item.get("allowed")
            if allowed is False and reason:
                rationale = reason
            elif reason:
                rationale = reason
            else:
                rationale = (
                    "Evaluated by ML ranking but not selected "
                    "for this recovery step."
                )
            expected = (
                round(float(item_probability))
                if item_probability is not None
                else None
            )
            stopping = None

        row = _find_strategy_row(
            db,
            case_id=case.id,
            strategy_type=strategy_enum,
        )
        if row is None:
            row = RecoveryStrategy(
                id=str(uuid4()),
                case_id=case.id,
                strategy_type=strategy_enum,
                rationale=rationale,
                expected_probability=expected,
                stopping_rules=stopping,
                is_selected=is_selected,
            )
            db.add(row)
        else:
            row.rationale = rationale
            row.expected_probability = expected
            if stopping:
                row.stopping_rules = stopping
            row.is_selected = is_selected

        if is_selected:
            selected_row = row

    # Ensure previously selected rows of other types are deselected
    others = db.scalars(
        select(RecoveryStrategy).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    ).all()
    for other in others:
        if selected_row is None or other.id != selected_row.id:
            if other.strategy_type not in seen or (
                selected_enum is not None
                and other.strategy_type != selected_enum
            ):
                other.is_selected = False

    if selected_row is not None:
        for other in others:
            if other.id != selected_row.id:
                other.is_selected = False

    db.flush()
    return selected_row
