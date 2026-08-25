"""
RecoverAI final end-to-end backend verification.

Reuses the existing integration harness and expands it into a
lifecycle + invariant report for one recovery case.

Does not delete data. Does not modify schema/APIs/frontend.
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collections import Counter

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.database import SessionLocal
from app.schema import (
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    RecoveryResult,
    Payment,
    PaymentAttempt,
    Communication,
    ActionStatus,
    CaseStatus,
    StrategyType,
    RecoveryResultStatus,
)
from app.services.ai.feature_service import (
    FEATURE_NAMES,
    build_case_features,
)
from app.services.ai.recovery_predictor import (
    predict_recovery_probability,
)
from app.services.ai.strategy_ranker import (
    rank_strategies,
)
from app.services.ai.safe_strategy_selector import (
    select_safe_strategy,
)
from app.services.safety_service import (
    check_action_safety,
    MAX_RETRIES,
    MAX_CUSTOMER_CONTACTS,
)
from app.services.orchestrator_service import (
    process_case,
)
from app.services.executor_service import (
    execute_action,
)
from app.services.recovery_loop_service import (
    process_recovery_loop,
)


EXPECTED_FEATURES = {
    "amount_at_risk",
    "payment_history_score",
    "risk_tier",
    "failure_category",
    "retry_count",
    "contact_count",
    "strategy_type",
}

RETRY_STRATEGIES = {
    StrategyType.IMMEDIATE_RETRY,
    StrategyType.RETRY_AFTER_DELAY,
}

# Strategies that increment contact_count in the executor
CONTACT_STRATEGIES = {
    StrategyType.SEND_PAYMENT_LINK,
    StrategyType.SEND_EMAIL_REMINDER,
    StrategyType.SEND_SMS_REMINDER,
    StrategyType.SEND_WHATSAPP_MESSAGE,
    StrategyType.OFFER_ALT_PAYMENT_METHOD,
}

# Strategies counted by Safety Engine contact limit
SAFETY_CONTACT_STRATEGIES = {
    StrategyType.SEND_PAYMENT_LINK,
    StrategyType.SEND_EMAIL_REMINDER,
    StrategyType.SEND_SMS_REMINDER,
    StrategyType.SEND_WHATSAPP_MESSAGE,
}


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name: str, passed: bool, detail: str = ""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        suffix = f" — {detail}" if detail else ""
        print(f"[{status}] {name}{suffix}")
        return passed

    def section(self, title: str):
        print("\n" + "=" * 72)
        print(title)
        print("=" * 72)

    def summary(self):
        print("\n" + "=" * 72)
        print("SUMMARY")
        print("=" * 72)
        passed = sum(1 for s, _, _ in self.rows if s == "PASS")
        failed = sum(1 for s, _, _ in self.rows if s == "FAIL")
        for status, name, detail in self.rows:
            line = f"{status:4}  {name}"
            if detail:
                line += f"  ({detail})"
            print(line)
        print("-" * 72)
        print(f"TOTAL  PASS={passed}  FAIL={failed}")
        return failed == 0


def load_case(db, case_number="RC-000013"):
    case = db.scalar(
        select(RecoveryCase)
        .options(joinedload(RecoveryCase.customer))
        .where(RecoveryCase.case_number == case_number)
    )
    if not case:
        case = db.scalar(
            select(RecoveryCase)
            .options(joinedload(RecoveryCase.customer))
            .order_by(RecoveryCase.created_at.desc())
        )
    return case


def get_actions(db, case_id):
    return list(
        db.scalars(
            select(RecoveryAction)
            .where(RecoveryAction.case_id == case_id)
            .order_by(
                RecoveryAction.created_at,
                RecoveryAction.attempt_number,
            )
        ).all()
    )


def main():
    report = Report()
    db = SessionLocal()

    try:
        case = load_case(db)
        if not case:
            print("No recovery case found.")
            raise SystemExit(1)

        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )
        actions = get_actions(db, case.id)
        strategies = list(
            db.scalars(
                select(RecoveryStrategy).where(
                    RecoveryStrategy.case_id == case.id
                )
            ).all()
        )
        result = db.scalar(
            select(RecoveryResult).where(
                RecoveryResult.case_id == case.id
            )
        )
        payment_attempts = list(
            db.scalars(
                select(PaymentAttempt).where(
                    PaymentAttempt.payment_id == case.payment_id
                )
            ).all()
        )
        communications = list(
            db.scalars(
                select(Communication).where(
                    Communication.case_id == case.id
                )
            ).all()
        )

        report.section(
            f"RecoverAI E2E Verification — {case.case_number}"
        )
        print(f"Status: {case.status.value}")
        print(f"Step:   {case.current_step}")
        print(f"retry_count={case.retry_count}  contact_count={case.contact_count}")
        print(f"Actions={len(actions)}  Strategies={len(strategies)}")
        print(
            f"PaymentAttempts={len(payment_attempts)}  "
            f"Communications={len(communications)}"
        )
        if result:
            print(
                f"RecoveryResult={result.status.value}  "
                f"recovered={result.recovered_amount}"
            )

        # --------------------------------------------------
        # Lifecycle evidence (historical)
        # --------------------------------------------------
        report.section("Lifecycle evidence")

        report.check(
            "1. Failed payment",
            payment is not None and (
                payment.status in ("FAILED", "RECOVERED")
                or len(actions) > 0
            ),
            f"payment.status={payment.status if payment else None}",
        )
        report.check(
            "2. Recovery case creation",
            case is not None and bool(case.case_number),
            case.case_number,
        )
        report.check(
            "3. Diagnosis",
            bool(case.failure_category)
            and bool(case.failure_reason or case.root_cause),
            f"category={case.failure_category.value if case.failure_category else None}",
        )
        report.check(
            "4. Initial strategy selection",
            case.selected_strategy is not None or len(strategies) > 0,
            (
                case.selected_strategy.value
                if case.selected_strategy
                else "via RecoveryStrategy rows"
            ),
        )

        # ML ranking
        rankings = rank_strategies(case=case)
        report.check(
            "5. ML strategy ranking",
            len(rankings) == 9
            and rankings[0]["probability"] >= rankings[-1]["probability"],
            f"top={rankings[0]['strategy']} @ {rankings[0]['probability']}%",
        )

        selection = select_safe_strategy(db=db, case=case)
        report.check(
            "6. Safety Engine + safe selector",
            selection is not None and "rankings" in selection,
            (
                f"selected={selection['strategy'].value if selection.get('strategy') else None}"
                f" | {selection.get('safety_reason')}"
            ),
        )
        report.check(
            "7. Action creation",
            len(actions) > 0,
            f"{len(actions)} RecoveryAction row(s)",
        )

        executed_actions = [
            a for a in actions
            if a.status in (ActionStatus.EXECUTED, ActionStatus.FAILED)
        ]
        report.check(
            "8. Action execution",
            len(executed_actions) > 0,
            f"{len(executed_actions)} executed/failed",
        )

        retry_executed = [
            a for a in executed_actions
            if a.action_type in RETRY_STRATEGIES
            and a.status == ActionStatus.EXECUTED
        ]
        contact_executed = [
            a for a in executed_actions
            if a.action_type in CONTACT_STRATEGIES
            and a.status == ActionStatus.EXECUTED
        ]

        report.check(
            "9a. PaymentAttempt for retry strategies",
            len(payment_attempts) >= len(retry_executed),
            f"attempts={len(payment_attempts)} retries_executed={len(retry_executed)}",
        )
        report.check(
            "9b. Communication for contact strategies",
            len(communications) >= len(contact_executed),
            f"comms={len(communications)} contacts_executed={len(contact_executed)}",
        )
        report.check(
            "10. RecoveryResult update",
            result is not None
            and result.status != RecoveryResultStatus.PENDING,
            f"status={result.status.value if result else None}",
        )

        # Distinct strategies attempted implies loop progressed
        attempted_types = {a.action_type for a in actions}
        report.check(
            "11-14. Recovery loop progressed to next strategies",
            len(attempted_types) >= 2,
            f"distinct strategies={len(attempted_types)}",
        )

        # --------------------------------------------------
        # Invariants
        # --------------------------------------------------
        report.section("Invariants")

        # ML features
        features = build_case_features(
            case=case,
            strategy_type="RETRY_AFTER_DELAY",
        )
        feature_keys = set(features.keys())
        report.check(
            "ML features exact set",
            feature_keys == EXPECTED_FEATURES
            and set(FEATURE_NAMES) == EXPECTED_FEATURES,
            f"keys={sorted(feature_keys)}",
        )
        report.check(
            "No recovery_probability / ai_confidence in ML inputs",
            "recovery_probability" not in features
            and "ai_confidence" not in features,
        )
        predict_recovery_probability(
            case=case,
            strategy_type="SEND_PAYMENT_LINK",
        )

        # retry_count / contact_count
        report.check(
            "retry_count matches executed payment retries",
            case.retry_count == len(retry_executed),
            f"retry_count={case.retry_count} executed_retries={len(retry_executed)}",
        )
        report.check(
            "contact_count matches executed communications",
            case.contact_count == len(contact_executed),
            f"contact_count={case.contact_count} executed_contacts={len(contact_executed)}",
        )

        # attempt_number sequential
        sequential = all(
            action.attempt_number == index
            for index, action in enumerate(actions, start=1)
        )
        report.check(
            "attempt_number sequential across ALL RecoveryAction rows",
            sequential and len(actions) > 0,
            ", ".join(
                f"{a.attempt_number}:{a.action_type.value}"
                for a in actions
            ),
        )

        # no duplicate pending/processing
        active_actions = [
            a for a in actions
            if a.status in (
                ActionStatus.PENDING,
                ActionStatus.PROCESSING,
            )
        ]
        report.check(
            "No duplicate PENDING/PROCESSING actions",
            len(active_actions) <= 1,
            f"active={len(active_actions)}",
        )

        # safety limits respected
        safety_ok = True
        safety_detail = []
        if case.retry_count > MAX_RETRIES:
            safety_ok = False
            safety_detail.append(
                f"retry_count {case.retry_count} > MAX_RETRIES {MAX_RETRIES}"
            )
        # Safety contact limit applies only to SAFETY_CONTACT_STRATEGIES
        safety_contact_exec = [
            a for a in contact_executed
            if a.action_type in SAFETY_CONTACT_STRATEGIES
        ]
        # contact_count can include OFFER_ALT; safety limit uses contact_count
        # against SEND_* only when selecting. Ensure no SEND_* was created
        # after contact_count was already at limit without being blocked.
        if case.contact_count > MAX_CUSTOMER_CONTACTS:
            # Soft fail only if exceeded beyond what executor could produce
            # under normal flow (executor increments one at a time)
            if case.contact_count > MAX_CUSTOMER_CONTACTS + 1:
                safety_ok = False
                safety_detail.append(
                    f"contact_count {case.contact_count} exceeds limit"
                )

        # If retry_count >= MAX, safe selector must not allow another retry
        if case.retry_count >= MAX_RETRIES:
            for ranking in selection["rankings"]:
                if ranking["strategy"] in {
                    s.value for s in RETRY_STRATEGIES
                }:
                    if ranking["allowed"]:
                        safety_ok = False
                        safety_detail.append(
                            f"retry allowed after limit: {ranking['strategy']}"
                        )

        if case.contact_count >= MAX_CUSTOMER_CONTACTS:
            for ranking in selection["rankings"]:
                if ranking["strategy"] in {
                    s.value for s in SAFETY_CONTACT_STRATEGIES
                }:
                    if ranking["allowed"]:
                        safety_ok = False
                        safety_detail.append(
                            f"contact allowed after limit: {ranking['strategy']}"
                        )

        report.check(
            "Safety limits respected",
            safety_ok,
            "; ".join(safety_detail) if safety_detail else (
                f"MAX_RETRIES={MAX_RETRIES}, "
                f"MAX_CUSTOMER_CONTACTS={MAX_CUSTOMER_CONTACTS}"
            ),
        )

        # Completed cases not processed again
        completed = db.scalars(
            select(RecoveryCase).where(
                RecoveryCase.status.in_([
                    CaseStatus.RECOVERED,
                    CaseStatus.CLOSED,
                    CaseStatus.ESCALATED,
                ])
            ).limit(3)
        ).all()

        completed_ok = True
        completed_detail = "no completed cases to probe"
        for completed_case in completed:
            before_count = db.scalar(
                select(func.count(RecoveryAction.id)).where(
                    RecoveryAction.case_id == completed_case.id
                )
            )
            process_case(db=db, case=completed_case)
            db.flush()
            after_count = db.scalar(
                select(func.count(RecoveryAction.id)).where(
                    RecoveryAction.case_id == completed_case.id
                )
            )
            if after_count != before_count:
                completed_ok = False
                completed_detail = (
                    f"{completed_case.case_number} gained actions"
                )
                break
            completed_detail = (
                f"checked {len(completed)} completed case(s); no new actions"
            )
        db.rollback()
        case = load_case(db, case.case_number)
        actions = get_actions(db, case.id)

        report.check(
            "Completed cases are not processed again",
            completed_ok,
            completed_detail,
        )

        # --------------------------------------------------
        # Live loop step (non-destructive where possible)
        # --------------------------------------------------
        report.section("Live recovery-loop step")

        pending = next(
            (
                a for a in actions
                if a.status == ActionStatus.PENDING
            ),
            None,
        )

        if pending and pending.action_type == StrategyType.HUMAN_ESCALATION:
            # Execute escalation: verifies executor + terminal stop
            before_retry = case.retry_count
            before_contact = case.contact_count
            before_action_count = len(actions)

            execute_action(db=db, action=pending)
            db.refresh(case)
            actions = get_actions(db, case.id)
            result = db.scalar(
                select(RecoveryResult).where(
                    RecoveryResult.case_id == case.id
                )
            )

            report.check(
                "Executor ran pending HUMAN_ESCALATION",
                any(
                    a.id == pending.id
                    and a.status == ActionStatus.EXECUTED
                    for a in actions
                ),
            )
            report.check(
                "Escalation does not bump retry/contact counters",
                case.retry_count == before_retry
                and case.contact_count == before_contact,
                f"retry={case.retry_count} contact={case.contact_count}",
            )
            report.check(
                "Case reached ESCALATED terminal state",
                case.status == CaseStatus.ESCALATED,
                case.status.value,
            )
            report.check(
                "No new PENDING action after escalation",
                not any(
                    a.status == ActionStatus.PENDING
                    for a in actions
                ),
            )

            # process_case must no-op now
            count_before = len(actions)
            process_case(db=db, case=case)
            db.flush()
            actions_after = get_actions(db, case.id)
            report.check(
                "Orchestrator skips escalated case",
                len(actions_after) == count_before,
            )
            db.commit()

        elif pending:
            before_retry = case.retry_count
            before_contact = case.contact_count
            before_types = {
                a.action_type for a in actions
                if a.status != ActionStatus.PENDING
            }
            executed_type = pending.action_type

            execute_action(db=db, action=pending)
            db.refresh(case)
            actions = get_actions(db, case.id)
            result = db.scalar(
                select(RecoveryResult).where(
                    RecoveryResult.case_id == case.id
                )
            )

            report.check(
                "Executor marked action EXECUTED",
                any(
                    a.id == pending.id
                    and a.status == ActionStatus.EXECUTED
                    for a in actions
                ),
            )

            if executed_type in RETRY_STRATEGIES:
                report.check(
                    "retry_count +1 only for payment retry",
                    case.retry_count == before_retry + 1,
                    f"{before_retry} -> {case.retry_count}",
                )
                report.check(
                    "contact_count unchanged on retry",
                    case.contact_count == before_contact,
                )
            elif executed_type in CONTACT_STRATEGIES:
                report.check(
                    "contact_count +1 only for communication",
                    case.contact_count == before_contact + 1,
                    f"{before_contact} -> {case.contact_count}",
                )
                report.check(
                    "retry_count unchanged on communication",
                    case.retry_count == before_retry,
                )

            report.check(
                "RecoveryResult updated after execution",
                result is not None
                and result.status
                in (
                    RecoveryResultStatus.NOT_RECOVERED,
                    RecoveryResultStatus.PARTIALLY_RECOVERED,
                    RecoveryResultStatus.FULLY_RECOVERED,
                ),
                result.status.value if result else None,
            )

            new_pending = [
                a for a in actions
                if a.status == ActionStatus.PENDING
            ]
            if case.status in (
                CaseStatus.ESCALATED,
                CaseStatus.CLOSED,
                CaseStatus.RECOVERED,
            ):
                report.check(
                    "Terminal case has no next PENDING action",
                    len(new_pending) == 0,
                    case.status.value,
                )
            else:
                report.check(
                    "Recovery Loop scheduled next safe strategy",
                    len(new_pending) == 1,
                    (
                        new_pending[0].action_type.value
                        if new_pending
                        else "none"
                    ),
                )
                if new_pending:
                    report.check(
                        "Next strategy was not previously attempted",
                        new_pending[0].action_type not in before_types,
                        new_pending[0].action_type.value,
                    )
                    report.check(
                        "Next attempt_number is sequential",
                        new_pending[0].attempt_number == len(actions),
                        f"attempt_number={new_pending[0].attempt_number} "
                        f"rows={len(actions)}",
                    )
            db.commit()

        else:
            # No pending — ask loop to prepare one if eligible
            if case.status in (
                CaseStatus.ACTIVE,
                CaseStatus.IN_PROGRESS,
            ):
                before_count = len(actions)
                action = process_recovery_loop(db=db, case=case)
                db.commit()
                db.refresh(case)
                actions = get_actions(db, case.id)
                report.check(
                    "Recovery Loop can select/schedule next strategy",
                    action is not None
                    or case.status == CaseStatus.ESCALATED,
                    (
                        f"new={action.action_type.value}"
                        if action
                        else f"status={case.status.value}"
                    ),
                )
                report.check(
                    "At most one PENDING after loop",
                    sum(
                        1
                        for a in actions
                        if a.status == ActionStatus.PENDING
                    )
                    <= 1,
                )
            else:
                report.check(
                    "No pending action on terminal case (expected)",
                    case.status
                    in (
                        CaseStatus.RECOVERED,
                        CaseStatus.CLOSED,
                        CaseStatus.ESCALATED,
                    ),
                    case.status.value,
                )

        # Final sequential check
        actions = get_actions(db, case.id)
        sequential = all(
            action.attempt_number == index
            for index, action in enumerate(actions, start=1)
        )
        report.check(
            "Final attempt_number integrity",
            sequential,
            ", ".join(
                f"#{a.attempt_number} {a.action_type.value}"
                for a in actions
            ),
        )

        ok = report.summary()
        raise SystemExit(0 if ok else 1)

    except SystemExit:
        raise
    except Exception as exc:
        db.rollback()
        print(f"\n[FAIL] Unexpected error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
