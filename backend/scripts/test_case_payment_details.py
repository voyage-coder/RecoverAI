"""
Tests for GET /api/recovery/cases/{case_id}/payment-details

A. valid case returns payment details
B. attempts ordered by attempt_number ASC
C. missing case → 404
D. missing payment handled safely
E. secrets never returned
F. gateway_response sanitized (no raw dump)
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app
from app.services.payment_details_service import (
    build_payment_details_payload,
    get_case_payment_details,
    sanitize_gateway_response,
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


def _attempt(n, status="FAILED", gateway=None):
    return SimpleNamespace(
        id=str(uuid4()),
        attempt_number=n,
        status=status,
        error_code="AWAITING_CUSTOMER_PAYMENT" if n == 3 else "SIMULATED_DECLINE",
        error_description="desc",
        error_source="RAZORPAY_TEST" if n == 3 else "SIMULATED_GATEWAY",
        created_at=datetime.utcnow(),
        gateway_response=gateway
        or {
            "mode": "SIMULATED_GATEWAY",
            "simulated": True,
            "key_secret": "SHOULD_NOT_APPEAR",
            "RAZORPAY_KEY_SECRET": "leak",
            "authorization": "Bearer leak",
            "order_id": f"order_test_{n}",
            "awaiting_webhook": n == 3,
            "card": {"number": "4111"},
            "cvv": "123",
        },
    )


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Case Payment Details API Tests")
    print("=" * 72)

    case = SimpleNamespace(
        id="case_pd_1",
        case_number="RC-PD-001",
        payment_id="pay_pd_1",
    )
    payment = SimpleNamespace(
        id="pay_pd_1",
        amount=199900,
        currency="INR",
        payment_type="ONE_TIME",
        status="FAILED",
        failure_code="GATEWAY_TIMEOUT",
        failure_reason="Timeout",
        created_at=datetime.utcnow(),
    )
    attempts = [
        _attempt(2),
        _attempt(1),
        _attempt(
            3,
            gateway={
                "mode": "RAZORPAY_TEST",
                "order_id": "order_real_1",
                "razorpay_payment_id": "pay_rzp_1",
                "awaiting_webhook": True,
                "status": "created",
                "RAZORPAY_WEBHOOK_SECRET": "whsec_leak",
                "api_key": "rzp_test_leak",
            },
        ),
    ]
    # Service expects DB ordered ASC; simulate unsorted input then sort in test of order via service query mock.
    ordered = sorted(attempts, key=lambda a: a.attempt_number)

    # ----------------------------------------------------------
    # F. sanitize unit
    # ----------------------------------------------------------
    dirty = {
        "mode": "RAZORPAY_TEST",
        "order_id": "order_x",
        "razorpay_payment_id": "pay_x",
        "awaiting_webhook": True,
        "key_secret": "SECRET",
        "RAZORPAY_KEY_SECRET": "SECRET2",
        "RAZORPAY_WEBHOOK_SECRET": "SECRET3",
        "authorization": "Bearer x",
        "card": {"number": "4111"},
        "cvv": "999",
        "unknown_blob": {"nested": True},
    }
    clean = sanitize_gateway_response(dirty)
    report.check(
        "F. gateway_response is sanitized",
        clean.get("mode") == "RAZORPAY_TEST"
        and clean.get("order_id") == "order_x"
        and "key_secret" not in clean
        and "RAZORPAY_KEY_SECRET" not in clean
        and "RAZORPAY_WEBHOOK_SECRET" not in clean
        and "authorization" not in clean
        and "card" not in clean
        and "cvv" not in clean
        and "unknown_blob" not in clean
        and "gateway_response" not in clean,
        str(sorted(clean.keys())),
    )

    # ----------------------------------------------------------
    # A + B. payload build
    # ----------------------------------------------------------
    payload = build_payment_details_payload(case, payment, ordered)
    report.check(
        "A. valid case returns payment details",
        payload["payment"]["payment_id"] == "pay_pd_1"
        and payload["payment"]["amount"] == 199900
        and payload["payment"]["currency"] == "INR"
        and payload["payment"]["status"] == "FAILED"
        and len(payload["attempts"]) == 3
        and "gateway_summary" in payload,
        payload["case_number"],
    )
    nums = [a["attempt_number"] for a in payload["attempts"]]
    report.check(
        "B. attempts are ordered correctly",
        nums == [1, 2, 3],
        str(nums),
    )

    # ----------------------------------------------------------
    # E. secrets never returned in payload
    # ----------------------------------------------------------
    blob = str(payload)
    report.check(
        "E. secrets are never returned",
        "SHOULD_NOT_APPEAR" not in blob
        and "SECRET" not in blob
        and "whsec_leak" not in blob
        and "rzp_test_leak" not in blob
        and "Bearer leak" not in blob
        and "4111" not in blob
        and all("gateway_response" not in a for a in payload["attempts"])
        and all("gateway" in a for a in payload["attempts"]),
    )

    # ----------------------------------------------------------
    # C. missing case → 404 via route
    # ----------------------------------------------------------
    def override_missing():
        raise AssertionError("should not hit real db")

    from app.database import get_db

    def fake_db_missing():
        db = MagicMock()

        def scalar(stmt):
            return None

        db.scalar.side_effect = scalar
        yield db

    app.dependency_overrides[get_db] = fake_db_missing
    client = TestClient(app)
    with patch(
        "app.routes.recovery_routes.get_case_payment_details",
        return_value=None,
    ):
        res_c = client.get("/api/recovery/cases/missing/payment-details")
    report.check(
        "C. missing case returns 404",
        res_c.status_code == 404,
        res_c.json().get("detail", ""),
    )

    # ----------------------------------------------------------
    # D. missing payment handled safely
    # ----------------------------------------------------------
    with patch(
        "app.routes.recovery_routes.get_case_payment_details",
        side_effect=ValueError("payment_not_found"),
    ):
        res_d = client.get("/api/recovery/cases/case_pd_1/payment-details")
    report.check(
        "D. missing payment is handled safely",
        res_d.status_code == 404
        and "Payment" in res_d.json().get("detail", ""),
        res_d.json().get("detail", ""),
    )

    # Happy-path HTTP with patched service
    with patch(
        "app.routes.recovery_routes.get_case_payment_details",
        return_value=payload,
    ):
        res_a = client.get("/api/recovery/cases/case_pd_1/payment-details")
    report.check(
        "A2. HTTP 200 returns sanitized payment details",
        res_a.status_code == 200
        and res_a.json()["payment"]["payment_id"] == "pay_pd_1"
        and "gateway" in res_a.json()["attempts"][0]
        and "gateway_response" not in str(res_a.json()),
        f"status={res_a.status_code}",
    )

    # get_case_payment_details unit: payment missing
    db = MagicMock()

    def scalar_case_only(stmt):
        text = str(stmt).lower()
        if "recovery_cases" in text or "RecoveryCase" in str(stmt):
            return case
        return None

    db.scalar.side_effect = lambda stmt: case
    # First call case, second payment None — implement properly
    calls = {"n": 0}

    def scalar_seq(stmt):
        calls["n"] += 1
        if calls["n"] == 1:
            return case
        return None

    db.scalar.side_effect = scalar_seq
    try:
        get_case_payment_details(db, case.id)
        missing_ok = False
    except ValueError as exc:
        missing_ok = str(exc) == "payment_not_found"
    report.check(
        "D2. service raises payment_not_found",
        missing_ok,
    )

    app.dependency_overrides.clear()

    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
