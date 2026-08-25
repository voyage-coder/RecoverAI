from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from uuid import uuid4

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import (
    Payment,
    RecoveryCase,
)

from app.services.recovery_service import (
    create_recovery_case,
)


def main():

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Find the latest recovery case number
        # ----------------------------------------------------

        last_case = db.scalar(
            select(RecoveryCase)
            .order_by(
                RecoveryCase.created_at.desc()
            )
        )

        if last_case:

            try:
                number = int(
                    last_case.case_number.split("-")[1]
                )

                case_number = (
                    f"RC-{number + 1:06d}"
                )

            except (IndexError, ValueError):

                case_number = (
                    f"RC-{str(uuid4())[:8].upper()}"
                )

        else:

            case_number = "RC-000001"

        # ----------------------------------------------------
        # Find an existing order
        # ----------------------------------------------------

        from app.schema import Order

        order = db.scalar(
            select(Order)
            .order_by(
                Order.created_at.desc()
            )
        )

        if not order:

            print(
                "No orders found. "
                "Cannot create test payment."
            )

            return

        # ----------------------------------------------------
        # Create fresh failed payment
        # ----------------------------------------------------

        payment = Payment(
            id=str(uuid4()),

            order_id=order.id,

            amount=199900,

            currency="INR",

            payment_type="CARD",

            status="FAILED",

            failure_code="GATEWAY_TIMEOUT",

            failure_reason=(
                "Synthetic gateway timeout "
                "created for ML integration testing."
            ),
        )

        db.add(payment)

        db.flush()

        # ----------------------------------------------------
        # Create recovery case
        # ----------------------------------------------------

        case = create_recovery_case(
            db=db,
            payment=payment,
            case_number=case_number,
        )

        db.commit()

        print("=" * 60)
        print("Fresh ML Test Case Created")
        print("=" * 60)

        print(
            f"Payment ID: {payment.id}"
        )

        print(
            f"Case Number: {case.case_number}"
        )

        print(
            f"Case ID: {case.id}"
        )

        print(
            f"Status: {case.status.value}"
        )

        print(
            f"Failure: "
            f"{case.failure_category.value}"
        )

        print(
            f"Amount: "
            f"₹{payment.amount / 100:.2f}"
        )

        print("=" * 60)

    except Exception:

        db.rollback()

        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()