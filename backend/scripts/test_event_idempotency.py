"""
Phase 10A — payment.failed event idempotency tests.

Verifies POST /api/events/payment with idempotency_key does not
duplicate Payment, RecoveryCase, or RecoveryAction on replay.
"""

from __future__ import annotations

from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.schema import (
    Order,
    Payment,
    RecoveryAction,
    RecoveryCase,
)
from app.services.event_ingestion_service import (
    ingest_payment_failed_event,
)


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
        return passed

    def summary(self):
        print("\n" + "=" * 72)
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


def _payload(key: str, email: str, amount: int = 199900):
    return {
        "event": "payment.failed",
        "amount": amount,
        "currency": "INR",
        "customer": {
            "name": "Idempotency Tester",
            "email": email,
        },
        "failure": {
            "code": "GATEWAY_TIMEOUT",
            "reason": "Gateway timeout",
        },
        "idempotency_key": key,
    }


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Event Idempotency Tests")
    print("=" * 72)

    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]
    key = f"idem-evt-{batch}"
    email = f"idem.evt.{batch}@recoverai.demo"

    try:
        # A. First event
        first = ingest_payment_failed_event(
            db, _payload(key, email)
        )
        db.commit()
        report.check(
            "A. First event creates payment + case",
            first.get("idempotent") is False and bool(first.get("case_id")),
            f"case={first.get('case_number')} payment={first.get('payment_id')}",
        )
        case_id = first["case_id"]
        payment_id = first["payment_id"]

        payments_after_first = db.scalar(
            select(func.count()).select_from(Payment).where(
                Payment.id == payment_id
            )
        )
        cases_after_first = db.scalar(
            select(func.count()).select_from(RecoveryCase).where(
                RecoveryCase.payment_id == payment_id
            )
        )
        actions_after_first = db.scalar(
            select(func.count()).select_from(RecoveryAction).where(
                RecoveryAction.case_id == case_id
            )
        )
        orders_before_replay = db.scalar(
            select(func.count()).select_from(Order)
        )

        # B + C. Identical replay (same key + same payload)
        second = ingest_payment_failed_event(
            db, _payload(key, email)
        )
        db.commit()
        report.check(
            "B. Identical replay is idempotent",
            second.get("idempotent") is True,
            second.get("message", ""),
        )
        report.check(
            "C. Same key returns same case/payment",
            second.get("case_id") == case_id
            and second.get("payment_id") == payment_id,
            f"case={second.get('case_id')} payment={second.get('payment_id')}",
        )

        # E/F. Database counts
        payments_after = db.scalar(
            select(func.count()).select_from(Payment).where(
                Payment.id == payment_id
            )
        )
        cases_after = db.scalar(
            select(func.count()).select_from(RecoveryCase).where(
                RecoveryCase.payment_id == payment_id
            )
        )
        actions_after = db.scalar(
            select(func.count()).select_from(RecoveryAction).where(
                RecoveryAction.case_id == case_id
            )
        )
        orders_after_replay = db.scalar(
            select(func.count()).select_from(Order)
        )

        report.check(
            "E. No duplicate Payment row",
            payments_after_first == 1 and payments_after == 1,
            f"payments={payments_after}",
        )
        report.check(
            "F. Only one RecoveryCase for payment",
            cases_after_first == 1 and cases_after == 1,
            f"cases={cases_after}",
        )
        report.check(
            "E. No duplicate RecoveryAction from replay",
            actions_after_first == actions_after,
            f"actions_before={actions_after_first} after={actions_after}",
        )
        report.check(
            "E. Replay does not create orphan Order",
            orders_after_replay == orders_before_replay,
            f"orders_before={orders_before_replay} after={orders_after_replay}",
        )

        # D. Different idempotency key → new case
        other_key = f"idem-evt-other-{batch}"
        third = ingest_payment_failed_event(
            db,
            _payload(
                other_key,
                f"idem.evt.other.{batch}@recoverai.demo",
            ),
        )
        db.commit()
        report.check(
            "D. Different idempotency key creates new case",
            third.get("idempotent") is False
            and third.get("case_id") != case_id
            and third.get("payment_id") != payment_id,
            f"new_case={third.get('case_number')}",
        )

        # HTTP API path
        http_key = f"idem-http-{batch}"
        http_email = f"idem.http.{batch}@recoverai.demo"
        r1 = client.post(
            "/api/events/payment",
            json=_payload(http_key, http_email),
        )
        r2 = client.post(
            "/api/events/payment",
            json=_payload(http_key, http_email),
        )
        report.check(
            "HTTP first event 200 + not idempotent",
            r1.status_code == 200 and r1.json().get("idempotent") is False,
            f"status={r1.status_code}",
        )
        report.check(
            "HTTP replay 200 + idempotent",
            r2.status_code == 200 and r2.json().get("idempotent") is True,
            f"status={r2.status_code} case={r2.json().get('case_number')}",
        )
        report.check(
            "HTTP replay same case_id",
            r1.json().get("case_id") == r2.json().get("case_id"),
        )

        # Dashboard invariant: cases for this payment stay 1
        overview = client.get("/api/dashboard/overview")
        report.check(
            "Dashboard overview reachable after replay",
            overview.status_code == 200,
        )

    except Exception as exc:
        db.rollback()
        report.check("Suite completed without exception", False, str(exc))
        raise
    finally:
        db.close()

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
