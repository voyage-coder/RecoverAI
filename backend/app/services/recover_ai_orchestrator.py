from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schema import (
    Payment,
    RecoveryCase,
    RecoveryAction,
    RecoveryStrategy,
    RecoveryResult,
    CaseStatus,
    ActionStatus,
    RecoveryResultStatus,
)

from app.services.recovery_service import (
    create_recovery_case,
)

from app.services.diagnosis_service import (
    diagnose_case,
)

from app.services.strategy_service import (
    create_strategy,
)

from app.services.action_service import (
    create_recovery_action,
)

from app.services.executor_service import (
    execute_action,
)

from app.services.result_service import (
    create_initial_result,
)

from app.services.recovery_loop_service import (
    process_recovery_loop,
)


# ============================================================
# CREATE CASE IF REQUIRED
# ============================================================

def get_or_create_case(
    db: Session,
    payment: Payment,
):

    case = db.scalar(
        select(RecoveryCase).where(
            RecoveryCase.payment_id == payment.id
        )
    )

    if case:
        return case

    case = create_recovery_case(
        db=db,
        payment=payment,
        case_number=None,
    )

    db.flush()

    return case


# ============================================================
# INITIALIZE CASE
# ============================================================

def initialize_case(
    db: Session,
    case: RecoveryCase,
):

    # --------------------------------------------------------
    # Diagnosis
    # --------------------------------------------------------

    diagnose_case(
        db=db,
        case=case,
    )

    db.flush()

    # --------------------------------------------------------
    # Initial strategy
    # --------------------------------------------------------

    strategy = db.scalar(
        select(
            RecoveryStrategy
        ).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    )

    if not strategy:

        strategy = create_strategy(
            db=db,
            case=case,
        )

        db.flush()

    # --------------------------------------------------------
    # Recovery result
    # --------------------------------------------------------

    create_initial_result(
        db=db,
        case=case,
    )

    db.flush()

    return strategy


# ============================================================
# CREATE ACTION
# ============================================================

def create_case_action(
    db: Session,
    case: RecoveryCase,
):

    strategy = db.scalar(
        select(
            RecoveryStrategy
        ).where(
            RecoveryStrategy.case_id == case.id,
            RecoveryStrategy.is_selected.is_(True),
        )
    )

    if not strategy:
        return None

    action = db.scalar(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case.id,
            RecoveryAction.status == ActionStatus.PENDING,
        )
    )

    if action:
        return action

    return create_recovery_action(
        db=db,
        case=case,
        strategy=strategy,
    )


# ============================================================
# PROCESS ONE PAYMENT
# ============================================================

def process_payment(
    db: Session,
    payment: Payment,
):

    # --------------------------------------------------------
    # Only failed payments need recovery
    # --------------------------------------------------------

    if payment.status != "FAILED":
        return None

    # --------------------------------------------------------
    # Get/create case
    # --------------------------------------------------------

    case = get_or_create_case(
        db=db,
        payment=payment,
    )

    db.flush()

    # --------------------------------------------------------
    # Stop completed cases
    # --------------------------------------------------------

    if case.status in [
        CaseStatus.RECOVERED,
        CaseStatus.CLOSED,
    ]:
        return case

    # --------------------------------------------------------
    # Initialize if this is a new case
    # --------------------------------------------------------

    result = db.scalar(
        select(RecoveryResult).where(
            RecoveryResult.case_id == case.id
        )
    )

    if not result:

        initialize_case(
            db=db,
            case=case,
        )

        db.flush()

    # --------------------------------------------------------
    # Create action
    # --------------------------------------------------------

    action = create_case_action(
        db=db,
        case=case,
    )

    db.flush()

    return action


# ============================================================
# RUN RECOVER AI
# ============================================================

def run_recover_ai(
    db: Session,
):

    failed_payments = db.scalars(
        select(Payment).where(
            Payment.status == "FAILED"
        )
    ).all()

    results = []

    for payment in failed_payments:

        result = process_payment(
            db=db,
            payment=payment,
        )

        if result:
            results.append(result)

    db.commit()

    return results