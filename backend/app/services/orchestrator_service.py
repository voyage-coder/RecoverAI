from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import uuid4

from app.schema import (
    Payment,
    RecoveryCase,
    RecoveryAction,
    RecoveryResult,
    CaseStatus,
    ActionStatus,
    RecoveryResultStatus,
)

from app.services.recovery_service import (
    create_recovery_case,
)

from app.services.diagnosis_service import diagnose_case
from app.services.action_service import create_recovery_action
from app.services.recovery_loop_service import process_recovery_loop

from app.services.ai.safe_strategy_selector import (
    select_safe_strategy,
)
from app.services.strategy_evaluation_service import (
    persist_strategy_evaluation,
)
# ============================================================
# PROCESS SINGLE CASE
# ============================================================
def process_case(
    db: Session,
    case: RecoveryCase,
):
    """
    Process one recovery case.

    Flow:

    Diagnosis
        ↓
    ML Strategy Ranking
        ↓
    Safety Engine
        ↓
    Action
        ↓
    Result
        ↓
    Recovery Loop
    """

    # --------------------------------------------------------
    # Don't process completed cases
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
        CaseStatus.ESCALATED,
    ]:
        return case

    # --------------------------------------------------------
    # If an action is already pending / processing, do not
    # re-run ML selection. The executor owns that action.
    # --------------------------------------------------------

    existing_action = db.scalar(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case.id,
            RecoveryAction.status.in_([
                ActionStatus.PENDING,
                ActionStatus.PROCESSING,
            ]),
        )
        .order_by(
            RecoveryAction.created_at.desc()
        )
    )

    if existing_action:
        return case

    # --------------------------------------------------------
    # STEP 1 — DIAGNOSIS
    # --------------------------------------------------------

    diagnose_case(
        db=db,
        case=case,
    )

    db.flush()

    # --------------------------------------------------------
    # STEP 2 — ML STRATEGY + SAFETY
    # --------------------------------------------------------

    selection = select_safe_strategy(
        db=db,
        case=case,
    )

    # --------------------------------------------------------
    # Persist full ML + Safety evaluation (selected + rejected)
    # --------------------------------------------------------

    strategy = persist_strategy_evaluation(
        db=db,
        case=case,
        selection=selection,
    )

    # --------------------------------------------------------
    # No safe strategy available
    # --------------------------------------------------------

    if not selection or not selection["strategy"]:

        case.status = CaseStatus.ESCALATED

        case.current_step = (
            "No Safe Recovery Strategy"
        )

        db.add(case)

        return case

    # --------------------------------------------------------
    # Selected safe strategy
    # --------------------------------------------------------

    selected_strategy = selection["strategy"]

    probability = selection["probability"]

    if strategy is None:
        raise RuntimeError(
            "Selected strategy was not persisted after evaluation."
        )

    # --------------------------------------------------------
    # STEP 4 — UPDATE CASE
    # --------------------------------------------------------

    case.selected_strategy = selected_strategy

    case.recovery_probability = round(
        probability
    )

    case.current_step = (
        "ML Strategy Selected"
    )

    db.add(case)

    db.flush()

    # --------------------------------------------------------
    # STEP 5 — CREATE ACTION
    # --------------------------------------------------------
    #
    # Orchestrator prepares the action only.
    # It does not execute it.
    #

    create_recovery_action(
        db=db,
        case=case,
        strategy=strategy,
    )

    db.flush()

    return case

# ============================================================
# CONTINUE RECOVERY
# ============================================================

def continue_case(
    db: Session,
    case: RecoveryCase,
):
    """
    Continue a case after an action has already produced
    a recovery result.
    """

    # --------------------------------------------------------
    # Get recovery result
    # --------------------------------------------------------

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if not result:
        return case

    # --------------------------------------------------------
    # FULL RECOVERY
    # --------------------------------------------------------

    if result.status == (
        RecoveryResultStatus.FULLY_RECOVERED
    ):

        case.status = CaseStatus.RECOVERED

        case.current_step = "Recovery Complete"

        return case

    # --------------------------------------------------------
    # CASE ALREADY CLOSED / ESCALATED
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.CLOSED,
        CaseStatus.ESCALATED,
    ]:
        return case

    # --------------------------------------------------------
    # PARTIAL / NO RECOVERY
    # --------------------------------------------------------

    action = process_recovery_loop(
        db=db,
        case=case,
    )

    if action:
        db.flush()

    return case


# ============================================================
# PROCESS ACTIVE CASES
# ============================================================

def process_active_cases(
    db: Session,
):
    """
    Process all active recovery cases.

    This function does NOT execute actions.
    It prepares the next action for execution.
    """

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status.in_([
                CaseStatus.ACTIVE,
                CaseStatus.IN_PROGRESS,
            ])
        )
    ).all()

    processed = []

    for case in cases:

        case = process_case(
            db=db,
            case=case,
        )

        processed.append(case)

    db.commit()

    return processed


# ============================================================
# CONTINUE ALL RECOVERY CASES
# ============================================================

def continue_active_cases(
    db: Session,
):
    """
    Continue recovery for cases that already have results.
    """

    cases = db.scalars(
        select(RecoveryCase).where(
            RecoveryCase.status.in_([
                CaseStatus.ACTIVE,
                CaseStatus.IN_PROGRESS,
            ])
        )
    ).all()

    processed = []

    for case in cases:

        case = continue_case(
            db=db,
            case=case,
        )

        processed.append(case)

    db.commit()

    return processed

def generate_case_number(
    db: Session,
) -> str:
    """
    Generate a unique recovery case number.
    """

    last_case = db.scalar(
        select(RecoveryCase)
        .order_by(
            RecoveryCase.created_at.desc()
        )
    )

    if not last_case:
        return "RC-000001"

    try:
        number = int(
            last_case.case_number.split("-")[1]
        )

        return f"RC-{number + 1:06d}"

    except (IndexError, ValueError):
        return f"RC-{str(uuid4())[:8].upper()}"

def process_payment(
    db: Session,
    payment: Payment,
):
    """
    Start RecoverAI for one failed payment.
    """

    # --------------------------------------------------------
    # Only failed payments enter recovery
    # --------------------------------------------------------

    if payment.status != "FAILED":
        return None

    # --------------------------------------------------------
    # Check whether recovery case already exists
    # --------------------------------------------------------

    case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.payment_id == payment.id
        )
    )

    # --------------------------------------------------------
    # Create new recovery case
    # --------------------------------------------------------

    if not case:

        case_number = generate_case_number(
            db=db,
        )

        case = create_recovery_case(
            db=db,
            payment=payment,
            case_number=case_number,
        )

        db.flush()

    # --------------------------------------------------------
    # Process case
    # --------------------------------------------------------

    process_case(
        db=db,
        case=case,
    )

    db.flush()

    from app.services.recovery_mode_service import (
        apply_merchant_recovery_mode,
    )

    apply_merchant_recovery_mode(db, case)
    db.flush()

    return case

def run_recover_ai(
    db: Session,
):
    """
    Run RecoverAI for all failed payments.
    """

    failed_payments = db.scalars(
        select(Payment).where(
            Payment.status == "FAILED"
        )
    ).all()

    processed = []

    for payment in failed_payments:

        case = process_payment(
            db=db,
            payment=payment,
        )

        if case:
            processed.append(case)

        db.commit()

    return processed