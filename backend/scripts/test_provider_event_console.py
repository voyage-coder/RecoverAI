"""
Phase 12 — Provider Event Console / event ingestion tests.

Covers:
A. payment.failed event
B. invalid event type
C. invalid amount
D. invalid currency
E. idempotent replay
F. different idempotency key creates a new event/case
G. no duplicate case on replay
H. captured event cannot bypass webhook verification
I. unsupported event types do not fake recovery
J. no secrets in event responses
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
    Payment,
    RecoveryAction,
    RecoveryCase,
    CaseStatus,
)


SECRET_MARKERS = (
    "razorpay_key_secret",
    "webhook_secret",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "gateway_response",
    "api_key",
    "card_number",
    "cvv",
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


def _failed_payload(**overrides):
    batch = uuid4().hex[:10]
    payload = {
        "event": "payment.failed",
        "amount": 249900,
        "currency": "INR",
        "customer": {
            "name": "Event Console Tester",
            "email": f"evt.console.{batch}@recoverai.demo",
        },
        "failure": {
            "code": "GATEWAY_TIMEOUT",
            "reason": "Gateway timeout",
        },
        "idempotency_key": f"evt-console-{batch}",
    }
    payload.update(overrides)
    return payload


def _contains_secret(obj) -> bool:
    text = str(obj).lower()
    return any(marker.lower() in text for marker in SECRET_MARKERS)


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Provider Event Console Tests (Phase 12)")
    print("=" * 72)

    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]

    try:
        # Capabilities endpoint
        caps = client.get("/api/events/capabilities")
        report.check(
            "Capabilities endpoint available",
            caps.status_code == 200
            and any(
                c.get("event") == "payment.failed" and c.get("supported")
                for c in caps.json().get("capabilities", [])
            ),
            f"status={caps.status_code}",
        )

        # A. payment.failed
        key_a = f"p12-a-{batch}"
        email_a = f"p12.a.{batch}@recoverai.demo"
        first = client.post(
            "/api/events/payment",
            json=_failed_payload(
                idempotency_key=key_a,
                customer={"name": "A Tester", "email": email_a},
            ),
        )
        body_a = first.json() if first.status_code == 200 else {}
        report.check(
            "A. payment.failed event",
            first.status_code == 200
            and body_a.get("event") == "payment.failed"
            and body_a.get("idempotent") is False
            and bool(body_a.get("case_id")),
            f"status={first.status_code} case={body_a.get('case_number')}",
        )
        case_id_a = body_a.get("case_id")
        payment_id_a = body_a.get("payment_id")

        # B. invalid event type via payment ingest
        bad_type = client.post(
            "/api/events/payment",
            json=_failed_payload(event="payment.authorized"),
        )
        report.check(
            "B. invalid event type",
            bad_type.status_code == 400,
            f"status={bad_type.status_code} detail={bad_type.json().get('detail')}",
        )

        # C. invalid amount
        bad_amount = client.post(
            "/api/events/payment",
            json=_failed_payload(amount=0),
        )
        report.check(
            "C. invalid amount",
            bad_amount.status_code in (400, 422),
            f"status={bad_amount.status_code}",
        )

        # D. invalid currency
        bad_currency = client.post(
            "/api/events/payment",
            json=_failed_payload(
                currency="USD",
                idempotency_key=f"p12-d-{batch}",
                customer={
                    "name": "Currency Tester",
                    "email": f"p12.d.{batch}@recoverai.demo",
                },
            ),
        )
        report.check(
            "D. invalid currency",
            bad_currency.status_code == 400,
            f"status={bad_currency.status_code}",
        )

        # E + G. idempotent replay — no duplicate case/payment/action
        payments_before = db.scalar(
            select(func.count()).select_from(Payment).where(
                Payment.id == payment_id_a
            )
        )
        cases_before = db.scalar(
            select(func.count()).select_from(RecoveryCase).where(
                RecoveryCase.payment_id == payment_id_a
            )
        )
        actions_before = db.scalar(
            select(func.count()).select_from(RecoveryAction).where(
                RecoveryAction.case_id == case_id_a
            )
        ) if case_id_a else 0

        replay = client.post(
            "/api/events/payment",
            json=_failed_payload(
                idempotency_key=key_a,
                customer={"name": "A Tester", "email": email_a},
            ),
        )
        body_replay = replay.json() if replay.status_code == 200 else {}
        report.check(
            "E. idempotent replay",
            replay.status_code == 200
            and body_replay.get("idempotent") is True
            and body_replay.get("case_id") == case_id_a
            and body_replay.get("payment_id") == payment_id_a,
            f"idempotent={body_replay.get('idempotent')}",
        )

        db.expire_all()
        payments_after = db.scalar(
            select(func.count()).select_from(Payment).where(
                Payment.id == payment_id_a
            )
        )
        cases_after = db.scalar(
            select(func.count()).select_from(RecoveryCase).where(
                RecoveryCase.payment_id == payment_id_a
            )
        )
        actions_after = db.scalar(
            select(func.count()).select_from(RecoveryAction).where(
                RecoveryAction.case_id == case_id_a
            )
        ) if case_id_a else 0

        report.check(
            "G. no duplicate case on replay",
            payments_before == payments_after == 1
            and cases_before == cases_after == 1
            and actions_before == actions_after,
            f"payments={payments_after} cases={cases_after} actions={actions_after}",
        )

        # F. different idempotency key → new case
        key_f = f"p12-f-{batch}"
        second = client.post(
            "/api/events/payment",
            json=_failed_payload(
                idempotency_key=key_f,
                customer={
                    "name": "F Tester",
                    "email": f"p12.f.{batch}@recoverai.demo",
                },
            ),
        )
        body_f = second.json() if second.status_code == 200 else {}
        report.check(
            "F. different idempotency key creates a new event/case",
            second.status_code == 200
            and body_f.get("idempotent") is False
            and body_f.get("case_id")
            and body_f.get("case_id") != case_id_a
            and body_f.get("payment_id") != payment_id_a,
            f"case={body_f.get('case_number')}",
        )

        # H. captured via events/payment cannot bypass webhook
        case_before = db.get(RecoveryCase, case_id_a) if case_id_a else None
        status_before = case_before.status if case_before else None
        payment_before = db.get(Payment, payment_id_a) if payment_id_a else None
        pay_status_before = payment_before.status if payment_before else None

        captured_ingest = client.post(
            "/api/events/payment",
            json={
                "event": "payment.captured",
                "amount": 249900,
                "currency": "INR",
                "customer": {
                    "name": "Capture Bypass",
                    "email": f"p12.cap.{batch}@recoverai.demo",
                },
                "failure": {
                    "code": "N/A",
                    "reason": "should not apply",
                },
                "idempotency_key": f"p12-cap-{batch}",
            },
        )
        db.expire_all()
        case_after = db.get(RecoveryCase, case_id_a) if case_id_a else None
        payment_after = db.get(Payment, payment_id_a) if payment_id_a else None

        report.check(
            "H. captured event cannot bypass webhook verification",
            captured_ingest.status_code == 400
            and case_after is not None
            and case_after.status == status_before
            and case_after.status != CaseStatus.RECOVERED
            and payment_after is not None
            and payment_after.status == pay_status_before
            and payment_after.status != "RECOVERED",
            f"ingest={captured_ingest.status_code} "
            f"case={case_after.status if case_after else None} "
            f"payment={payment_after.status if payment_after else None}",
        )

        # I. unsupported acknowledge does not fake recovery
        for event_name in (
            "payment.captured",
            "payment.authorized",
            "payment.expired",
            "payment.refunded",
        ):
            ack = client.post(
                "/api/events/acknowledge",
                json={"event": event_name, "amount": 10000, "currency": "INR"},
            )
            ack_body = ack.json() if ack.status_code == 200 else {}
            ok = (
                ack.status_code == 200
                and ack_body.get("simulation_only") is True
                and ack_body.get("mutates_state") is False
                and ack_body.get("supported") is False
            )
            report.check(
                f"I. unsupported {event_name} does not fake recovery",
                ok,
                f"status={ack.status_code} mutates={ack_body.get('mutates_state')}",
            )

        db.expire_all()
        case_still = db.get(RecoveryCase, case_id_a) if case_id_a else None
        report.check(
            "I. acknowledge leaves existing case unchanged",
            case_still is not None and case_still.status == status_before,
            f"status={case_still.status if case_still else None}",
        )

        # Recent history (backend-derived)
        recent = client.get("/api/events/recent?limit=20")
        recent_body = recent.json() if recent.status_code == 200 else {}
        report.check(
            "Recent events from domain tables",
            recent.status_code == 200
            and recent_body.get("source") == "payments+recovery_cases"
            and isinstance(recent_body.get("events"), list),
            f"count={len(recent_body.get('events') or [])}",
        )

        # J. no secrets in responses
        secret_hits = []
        for label, payload in (
            ("payment.failed", body_a),
            ("replay", body_replay),
            ("capabilities", caps.json() if caps.status_code == 200 else {}),
            ("recent", recent_body),
            (
                "acknowledge",
                client.post(
                    "/api/events/acknowledge",
                    json={"event": "payment.refunded"},
                ).json(),
            ),
        ):
            if _contains_secret(payload):
                secret_hits.append(label)

        # Customer email should be masked in recent history
        masked_ok = True
        for item in recent_body.get("events") or []:
            ref = str(item.get("customer_ref") or "")
            if "@" in ref and "***" not in ref:
                masked_ok = False
            for key in (
                "recovery_probability",
                "risk_level",
                "gateway_response",
                "razorpay_key_secret",
            ):
                if key in item:
                    masked_ok = False

        report.check(
            "J. no secrets in event responses",
            not secret_hits and masked_ok,
            f"hits={secret_hits or 'none'} masked={masked_ok}",
        )

    finally:
        db.close()

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
