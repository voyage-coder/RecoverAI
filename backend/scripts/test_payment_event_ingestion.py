"""
Tests for POST /api/events/payment (simulated payment.failed ingestion).

Uses FastAPI TestClient with dependency override where needed.
"""

from __future__ import annotations

from pathlib import Path
import sys
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import get_db, SessionLocal
from app.main import app
from app.schema import Payment, RecoveryCase, CaseStatus
from app.services.event_ingestion_service import ingest_payment_failed_event


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


def _valid_payload(**overrides):
    payload = {
        "event": "payment.failed",
        "amount": 249900,
        "currency": "INR",
        "customer": {
            "name": "Asha Verma",
            "email": "asha.event.test@recoverai.local",
        },
        "failure": {
            "code": "GATEWAY_TIMEOUT",
            "reason": "Gateway timeout",
        },
    }
    payload.update(overrides)
    return payload


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Payment Event Ingestion Tests")
    print("LABEL: simulated payment-provider events (not Razorpay)")
    print("=" * 72)

    db = SessionLocal()
    process_calls = {"n": 0}
    result = None
    pipeline_idempotency_key = f"evt-test-pipeline-{uuid4()}"

    def track_process_payment(db_sess, payment):
        process_calls["n"] += 1
        from app.services.orchestrator_service import process_payment as real

        return real(db_sess, payment)

    # ----------------------------------------------------------
    # 5 + 9: existing pipeline invoked (not duplicated)
    # ----------------------------------------------------------
    with patch(
        "app.services.event_ingestion_service.process_payment",
        side_effect=track_process_payment,
    ):
        try:
            result = ingest_payment_failed_event(
                db,
                _valid_payload(
                    idempotency_key=pipeline_idempotency_key,
                    customer={
                        "name": "Pipeline Test",
                        "email": f"pipeline.event.{uuid4().hex[:8]}@recoverai.local",
                    },
                ),
            )
            db.commit()
            report.check(
                "5. Existing recovery pipeline is triggered",
                process_calls["n"] == 1,
                f"process_payment calls={process_calls['n']}",
            )
            report.check(
                "9. ML/Safety path unchanged (orchestrator reused)",
                process_calls["n"] == 1 and result.get("case_id"),
                "process_payment from orchestrator_service",
            )
        except Exception as exc:
            db.rollback()
            report.check("5. Existing recovery pipeline is triggered", False, str(exc))
            report.check("9. ML/Safety path unchanged", False, str(exc))

    if result is None:
        report.check("1. Valid payment.failed creates Payment", False, "no result")
        report.check("2. RecoveryCase is created", False, "no result")
        report.check("3. Case is linked to Payment", False, "no result")
        report.check("4. Failure code/reason preserved", False, "no result")
        report.check("6. No fake RECOVERED on ingest", False, "no result")
    else:
        payment = db.scalar(
            select(Payment).where(Payment.id == result["payment_id"])
        )
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.id == result["case_id"]
            )
        )

        report.check(
            "1. Valid payment.failed creates Payment",
            payment is not None and payment.status == "FAILED",
            payment.id if payment else "missing",
        )
        report.check(
            "2. RecoveryCase is created",
            case is not None,
            case.case_number if case else "missing",
        )
        report.check(
            "3. Case is linked to Payment",
            case is not None
            and payment is not None
            and case.payment_id == payment.id,
            f"case.payment_id={case.payment_id if case else None}",
        )
        report.check(
            "4. Failure code/reason preserved",
            payment is not None
            and payment.failure_code == "GATEWAY_TIMEOUT"
            and payment.failure_reason == "Gateway timeout",
        )
        report.check(
            "6. No fake RECOVERED on ingest",
            case is not None and case.status != CaseStatus.RECOVERED,
            str(case.status) if case else "no case",
        )

    # HTTP validation tests
    client = TestClient(app)

    bad_amount = client.post(
        "/api/events/payment",
        json=_valid_payload(amount=0),
    )
    report.check(
        "7. Invalid amount rejected",
        bad_amount.status_code in (400, 422),
        bad_amount.json().get("detail", ""),
    )

    bad_event = client.post(
        "/api/events/payment",
        json=_valid_payload(event="payment.captured"),
    )
    report.check(
        "8. Invalid event type rejected",
        bad_event.status_code == 400,
        bad_event.json().get("detail", ""),
    )

    # Idempotent replay
    if result:
        replay = client.post(
            "/api/events/payment",
            json=_valid_payload(
                idempotency_key=pipeline_idempotency_key,
                customer={
                    "name": "Pipeline Test",
                    "email": "pipeline.event@recoverai.local",
                },
            ),
        )
        report.check(
            "Idempotent replay acknowledged",
            replay.status_code == 200
            and replay.json().get("idempotent") is True
            and replay.json().get("payment_id") == result["payment_id"],
            replay.json().get("message", ""),
        )
    else:
        report.check("Idempotent replay acknowledged", False, "no baseline result")

    db.close()

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
