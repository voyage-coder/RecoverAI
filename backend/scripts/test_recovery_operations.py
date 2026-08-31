"""
Tests for operator recovery operations endpoints.
"""

from __future__ import annotations

from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.schema import RecoveryAction, ActionStatus, RecoveryMode
from app.services.event_ingestion_service import ingest_payment_failed_event
from app.services.merchant_settings_service import get_or_create_settings


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        status = "PASS" if passed else "FAIL"
        self.rows.append((status, name, detail))
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))

    def summary(self):
        passed = sum(1 for s, _, _ in self.rows if s == "PASS")
        failed = sum(1 for s, _, _ in self.rows if s == "FAIL")
        print(f"TOTAL  PASS={passed}  FAIL={failed}")
        return failed == 0


def main():
    report = Report()
    client = TestClient(app)
    db = SessionLocal()

    batch_id = str(uuid4())
    settings = get_or_create_settings(db)
    settings.recovery_mode = RecoveryMode.MANUAL
    settings.automatic_recovery_enabled = False
    db.add(settings)
    db.commit()

    ingest = ingest_payment_failed_event(
        db,
        {
            "event": "payment.failed",
            "amount": 199900,
            "currency": "INR",
            "customer": {
                "name": "Ops Test",
                "email": f"ops.{batch_id[:8]}@recoverai.demo",
            },
            "failure": {
                "code": "GATEWAY_TIMEOUT",
                "reason": "Gateway timeout",
            },
            "idempotency_key": f"ops-test-{batch_id}",
        },
    )
    db.commit()
    case_id = ingest["case_id"]

    pending = db.scalar(
        select(RecoveryAction).where(
            RecoveryAction.case_id == case_id,
            RecoveryAction.status == ActionStatus.PENDING,
        )
    )
    report.check(
        "Pending action exists after ingest",
        pending is not None,
        pending.action_type.value if pending else "none",
    )

    checkout_before = client.get(
        f"/api/recovery/cases/{case_id}/checkout-config"
    )
    report.check(
        "Checkout config endpoint",
        checkout_before.status_code == 200,
        checkout_before.json().get("demo_label", ""),
    )
    body = checkout_before.json()
    report.check(
        "No secret in checkout config",
        "key_secret" not in str(body).lower(),
    )

    execute = client.post(
        f"/api/recovery/cases/{case_id}/execute-pending-action"
    )
    report.check(
        "Execute pending action",
        execute.status_code == 200,
        execute.json().get("action_status", ""),
    )
    report.check(
        "Does not fake RECOVERED on execute alone",
        execute.json().get("case_status") != "RECOVERED",
        execute.json().get("case_status"),
    )

    checkout_after = client.get(
        f"/api/recovery/cases/{case_id}/checkout-config"
    )
    report.check(
        "Checkout after execute",
        checkout_after.status_code == 200,
    )

    no_pending = client.post(
        f"/api/recovery/cases/{case_id}/execute-pending-action"
    )
    report.check(
        "Repeat execute without duplicate pending",
        no_pending.status_code in (404, 200),
        str(no_pending.status_code),
    )

    db.close()
    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
