"""
Phase 11 — customer recovery token tests.
"""

from __future__ import annotations

from pathlib import Path
import sys
from datetime import datetime, timedelta
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.schema import CustomerRecoveryLink, CaseStatus, RecoveryCase
from app.services.event_ingestion_service import ingest_payment_failed_event
from app.services.customer_recovery_service import (
    create_customer_recovery_link,
    resolve_customer_recovery,
    _hash_token,
)


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


FORBIDDEN_KEYS = {
    "recovery_probability",
    "ai_confidence",
    "root_cause",
    "risk_level",
    "retry_count",
    "contact_count",
    "key_secret",
    "webhook_secret",
    "gateway_response",
    "case_id",
    "payment_id",
}


def _flatten(obj, prefix=""):
    items = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            items.append(key.lower())
            items.extend(_flatten(v, key))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            items.extend(_flatten(v, f"{prefix}[{i}]"))
    return items


def main():
    report = Report()
    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]

    try:
        # Ensure table
        from app.schema import CustomerRecoveryLink as CRL
        CRL.__table__.create(bind=db.get_bind(), checkfirst=True)

        a = ingest_payment_failed_event(
            db,
            {
                "event": "payment.failed",
                "amount": 199900,
                "currency": "INR",
                "customer": {
                    "name": "Customer Token A",
                    "email": f"cust.a.{batch}@recoverai.demo",
                },
                "failure": {
                    "code": "GATEWAY_TIMEOUT",
                    "reason": "Gateway timeout",
                },
                "idempotency_key": f"cust-a-{batch}",
            },
        )
        b = ingest_payment_failed_event(
            db,
            {
                "event": "payment.failed",
                "amount": 149900,
                "currency": "INR",
                "customer": {
                    "name": "Customer Token B",
                    "email": f"cust.b.{batch}@recoverai.demo",
                },
                "failure": {
                    "code": "CARD_DECLINED",
                    "reason": "Card declined",
                },
                "idempotency_key": f"cust-b-{batch}",
            },
        )
        db.commit()
        case_a = a["case_id"]
        case_b = b["case_id"]

        created = create_customer_recovery_link(db, case_a)
        db.commit()
        token = created["token"]
        path = created["recovery_path"]
        report.check(
            "A. Valid token created",
            bool(token) and path.startswith("/recover/"),
            path,
        )

        stored = db.scalar(
            select(CustomerRecoveryLink).where(
                CustomerRecoveryLink.case_id == case_a,
                CustomerRecoveryLink.revoked_at.is_(None),
            )
        )
        report.check(
            "A. Only hash stored (not raw token)",
            stored is not None
            and stored.token_hash == _hash_token(token)
            and token not in stored.token_hash,
        )

        r = client.get(f"/api/customer/recovery/{token}")
        report.check(
            "A. Valid token resolves 200",
            r.status_code == 200,
            f"status={r.status_code}",
        )
        body = r.json()
        flat = " ".join(_flatten(body))
        leaked = [k for k in FORBIDDEN_KEYS if k in flat]
        report.check(
            "H/I. Customer payload has no secrets/AI internals",
            len(leaked) == 0,
            f"leaked={leaked}" if leaked else "clean",
        )
        report.check(
            "F. Pending / action_required status present",
            body.get("customer_status")
            in {"action_required", "pending", "payment_pending", "unavailable"},
            body.get("customer_status"),
        )

        bad = client.get("/api/customer/recovery/not-a-real-token-zzzz")
        report.check(
            "B. Invalid token 404",
            bad.status_code == 404,
            f"status={bad.status_code}",
        )

        # Expire token
        stored.expires_at = datetime.utcnow() - timedelta(hours=1)
        db.add(stored)
        db.commit()
        expired = client.get(f"/api/customer/recovery/{token}")
        report.check(
            "C. Expired token 410",
            expired.status_code == 410,
            f"status={expired.status_code}",
        )

        # New token for cross-case isolation
        created2 = create_customer_recovery_link(db, case_a)
        db.commit()
        token_a2 = created2["token"]
        created_b = create_customer_recovery_link(db, case_b)
        db.commit()
        token_b = created_b["token"]

        ra = resolve_customer_recovery(db, token_a2, mark_opened=False)
        rb = resolve_customer_recovery(db, token_b, mark_opened=False)
        report.check(
            "D. Tokens resolve different amounts (case isolation)",
            ra["amount"] != rb["amount"],
            f"a={ra['amount']} b={rb['amount']}",
        )

        # Already recovered
        case = db.scalar(select(RecoveryCase).where(RecoveryCase.id == case_a))
        case.status = CaseStatus.RECOVERED
        db.add(case)
        db.commit()
        try:
            create_customer_recovery_link(db, case_a)
            db.commit()
            report.check("E. Already recovered cannot create link", False)
        except ValueError as exc:
            db.rollback()
            report.check(
                "E. Already recovered cannot create link",
                str(exc) == "already_recovered",
                str(exc),
            )

        # Merchant status endpoint
        st = client.get(
            f"/api/recovery/cases/{case_b}/customer-recovery-link"
        )
        report.check(
            "Merchant link status 200",
            st.status_code == 200 and "status" in st.json(),
            str(st.json().get("status")),
        )
        report.check(
            "Merchant GET does not return raw token",
            st.json().get("token") is None
            and st.json().get("recovery_path") is None,
        )

        # Revoked/old token cannot be reused after regenerate
        old_token = token_b
        regenerated = create_customer_recovery_link(db, case_b)
        db.commit()
        old = client.get(f"/api/customer/recovery/{old_token}")
        report.check(
            "J. Old token invalid after regenerate",
            old.status_code in {404, 410},
            f"status={old.status_code}",
        )
        new = client.get(
            f"/api/customer/recovery/{regenerated['token']}"
        )
        report.check(
            "J. New token works after regenerate",
            new.status_code == 200,
            f"status={new.status_code}",
        )

        # Successful webhook changes customer status — covered lightly:
        # set payment recovered and ensure customer endpoint reflects it
        from app.schema import Payment

        case_b_row = db.scalar(
            select(RecoveryCase).where(RecoveryCase.id == case_b)
        )
        pay = db.scalar(
            select(Payment).where(Payment.id == case_b_row.payment_id)
        )
        pay.status = "RECOVERED"
        case_b_row.status = CaseStatus.RECOVERED
        db.add(pay)
        db.add(case_b_row)
        db.commit()
        # Need active non-expired token — regenerate before marking? Already recovered blocks create.
        # Use resolve on existing regenerated token before recovery was set — token still maps.
        recovered_view = client.get(
            f"/api/customer/recovery/{regenerated['token']}"
        )
        report.check(
            "G. Customer status shows recovered after backend recovery",
            recovered_view.status_code == 200
            and recovered_view.json().get("customer_status") == "recovered",
            str(recovered_view.json().get("customer_status")),
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
