from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, func

from app.database import SessionLocal
from app.schema import (
    RecoveryCase,
    RecoveryAction,
)


def main():
    db = SessionLocal()

    try:
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.case_number == "RC-000013"
            )
        )

        if not case:
            case = db.scalar(
                select(RecoveryCase).order_by(
                    RecoveryCase.created_at.desc()
                )
            )

        if not case:
            print("No recovery case found.")
            return

        actions = db.scalars(
            select(RecoveryAction)
            .where(RecoveryAction.case_id == case.id)
            .order_by(
                RecoveryAction.created_at,
                RecoveryAction.attempt_number,
            )
        ).all()

        print("=" * 60)
        print(f"Case: {case.case_number}")
        print(f"retry_count (payment retries): {case.retry_count}")
        print(f"contact_count: {case.contact_count}")
        print("=" * 60)

        ok = True

        for index, action in enumerate(actions, start=1):
            match = action.attempt_number == index
            ok = ok and match
            marker = "OK" if match else "MISMATCH"
            print(
                f"{marker}  #{action.attempt_number} "
                f"(expected {index})  "
                f"{action.action_type.value:30} "
                f"{action.status.value}"
            )

        count = db.scalar(
            select(func.count(RecoveryAction.id)).where(
                RecoveryAction.case_id == case.id
            )
        )

        print("=" * 60)
        print(f"Action rows: {count}")
        print(
            "PASS"
            if ok
            else "FAIL — attempt_number is not sequential"
        )

        if not ok:
            raise SystemExit(1)

    finally:
        db.close()


if __name__ == "__main__":
    main()
