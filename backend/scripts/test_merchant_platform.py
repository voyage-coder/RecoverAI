"""
Phase 14 — Merchant recovery platform tests.

Covers recovery modes, policy limits, Safety Engine blocking,
verified payment.failed ingest, captured-only RECOVERED, idempotency,
and backend-only Razorpay credentials.
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
from unittest.mock import MagicMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.schema import (
    ActionStatus,
    CaseStatus,
    MerchantSettings,
    Payment,
    RecoveryAction,
    RecoveryCase,
    RecoveryMode,
    StrategyType,
)
from app.services.event_ingestion_service import ingest_payment_failed_event
from app.services.merchant_settings_service import (
    get_or_create_settings,
    public_settings_payload,
    enrich_case_operations,
    classify_approval,
)
from app.services.razorpay_webhook_service import sign_webhook_body
from app.services.recovery_mode_service import apply_merchant_recovery_mode
from app.services.recovery_operations_service import run_agent_for_case


TEST_WEBHOOK_SECRET = "recoverai_phase14_webhook_secret"

SECRET_MARKERS = (
    "key_secret",
    "webhook_secret",
    "razorpay_key_secret",
    "razorpay_webhook_secret",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
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


def _snapshot(db):
    settings = get_or_create_settings(db)
    db.commit()
    return {
        "recovery_mode": settings.recovery_mode,
        "automatic_recovery_enabled": settings.automatic_recovery_enabled,
        "max_automatic_recovery_amount": settings.max_automatic_recovery_amount,
        "max_retry_attempts": settings.max_retry_attempts,
        "payment_link_expiry_hours": settings.payment_link_expiry_hours,
        "high_value_approval_threshold": settings.high_value_approval_threshold,
        "razorpay_key_id": settings.razorpay_key_id,
        "razorpay_key_secret": settings.razorpay_key_secret,
        "razorpay_webhook_secret": settings.razorpay_webhook_secret,
    }


def _restore(db, snap):
    settings = get_or_create_settings(db)
    for key, value in snap.items():
        setattr(settings, key, value)
    db.add(settings)
    db.commit()


def _set_policy(db, **kwargs):
    settings = get_or_create_settings(db)
    for key, value in kwargs.items():
        setattr(settings, key, value)
    db.add(settings)
    db.commit()
    return settings


def _ingest(db, *, amount, email, key):
    return ingest_payment_failed_event(
        db,
        {
            "event": "payment.failed",
            "amount": amount,
            "currency": "INR",
            "customer": {
                "name": "Merchant Platform Tester",
                "email": email,
            },
            "failure": {
                "code": "GATEWAY_TIMEOUT",
                "reason": "Gateway timeout",
            },
            "idempotency_key": key,
        },
    )


def _latest_action(db, case_id):
    return db.scalar(
        select(RecoveryAction)
        .where(RecoveryAction.case_id == case_id)
        .order_by(RecoveryAction.created_at.desc())
    )


def _failed_webhook_body(*, payment_id, amount, email):
    doc = {
        "entity": "event",
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "entity": "payment",
                    "amount": amount,
                    "currency": "INR",
                    "status": "failed",
                    "email": email,
                    "error_code": "BAD_REQUEST_ERROR",
                    "error_description": "Payment failed",
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _captured_webhook_body(*, payment_id, order_id, amount, case_number):
    doc = {
        "entity": "event",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "entity": "payment",
                    "amount": amount,
                    "currency": "INR",
                    "status": "captured",
                    "order_id": order_id,
                    "notes": {
                        "case_number": case_number,
                        "source": "RecoverAI",
                    },
                }
            }
        },
    }
    return json.dumps(doc, separators=(",", ":")).encode("utf-8")


def _contains_secret(obj) -> bool:
    text = str(obj)
    lowered = text.lower()
    if any(marker.lower() in lowered for marker in SECRET_MARKERS):
        if "configured" in lowered and "secret" in lowered:
            # Boolean flags like webhook_secret_configured are allowed.
            forbidden = (
                "razorpay_key_secret\":",
                "\"key_secret\":",
                "\"webhook_secret\":",
                "razorpay_webhook_secret\":",
            )
            return any(token in lowered for token in forbidden)
        return True
    return False


def _no_secret_values(obj, secret_values) -> bool:
    text = str(obj)
    return not any(
        value and value in text
        for value in secret_values
        if isinstance(value, str)
    )


def main():
    report = Report()
    print("=" * 72)
    print("RecoverAI Merchant Platform Tests (Phase 14)")
    print("=" * 72)

    client = TestClient(app)
    db = SessionLocal()
    batch = uuid4().hex[:10]
    snap = None

    try:
        snap = _snapshot(db)

        # --------------------------------------------------
        # Credentials: TEST only, never returned
        # --------------------------------------------------
        live = client.post(
            "/api/integrations/razorpay-credentials",
            json={"key_id": "rzp_live_should_reject"},
        )
        report.check(
            "Live Razorpay keys are rejected",
            live.status_code == 400,
            f"status={live.status_code}",
        )

        secret_value = f"phase14_secret_{batch}"
        webhook_value = f"phase14_wh_{batch}"
        stored = client.post(
            "/api/integrations/razorpay-credentials",
            json={
                "key_id": "rzp_test_phase14abcd",
                "key_secret": secret_value,
                "webhook_secret": webhook_value,
            },
        )
        body = stored.json() if stored.headers.get("content-type", "").startswith("application/json") else {}
        report.check(
            "Credentials store returns 200 without secret fields",
            stored.status_code == 200
            and body.get("razorpay_key_id_configured") is True
            and body.get("key_secret_configured") is True
            and "key_secret" not in body
            and "webhook_secret" not in body
            and secret_value not in str(body)
            and webhook_value not in str(body),
            f"status={stored.status_code}",
        )

        status = client.get("/api/integrations/status")
        settings_get = client.get("/api/integrations/settings")
        report.check(
            "Status/settings payloads omit API and webhook secrets",
            status.status_code == 200
            and settings_get.status_code == 200
            and secret_value not in str(status.json())
            and webhook_value not in str(status.json())
            and secret_value not in str(settings_get.json())
            and webhook_value not in str(settings_get.json())
            and "key_secret" not in settings_get.json(),
        )

        fake_client = MagicMock()
        fake_client.order.all.return_value = {"items": []}
        with patch(
            "app.services.payment_gateway_service._get_razorpay_client",
            return_value=fake_client,
        ):
            test_conn = client.post("/api/integrations/test-connection")
        conn_body = test_conn.json()
        report.check(
            "Connection test does not return secrets",
            test_conn.status_code == 200
            and conn_body.get("secrets_returned") is False
            and secret_value not in str(conn_body)
            and webhook_value not in str(conn_body),
            conn_body.get("detail", ""),
        )

        # Restore keys so gateway tests that expect env-only keys stay honest.
        settings = get_or_create_settings(db)
        settings.razorpay_key_id = snap["razorpay_key_id"]
        settings.razorpay_key_secret = snap["razorpay_key_secret"]
        settings.razorpay_webhook_secret = snap["razorpay_webhook_secret"]
        db.add(settings)
        db.commit()

        # --------------------------------------------------
        # MANUAL mode
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.MANUAL,
            automatic_recovery_enabled=False,
            max_automatic_recovery_amount=5_000_000,
            max_retry_attempts=3,
            high_value_approval_threshold=10_000_000,
        )
        manual = _ingest(
            db,
            amount=199900,
            email=f"manual.{batch}@recoverai.demo",
            key=f"p14-manual-{batch}",
        )
        db.commit()
        case_m = db.get(RecoveryCase, manual["case_id"])
        action_m = _latest_action(db, case_m.id)
        report.check(
            "Manual mode leaves a pending action",
            action_m is not None
            and action_m.status == ActionStatus.PENDING
            and case_m.status != CaseStatus.RECOVERED,
            action_m.status.value if action_m else "none",
        )
        report.check(
            "Manual ingest is a Demo Event",
            db.get(Payment, manual["payment_id"]).event_source == "DEMO_EVENT",
        )

        match = enrich_case_operations(db, case_m)
        report.check(
            "Operations list includes recommended action, risk, safety, approval",
            match.get("recommended_action")
            and match.get("approval_state")
            in {"READY_TO_EXECUTE", "AWAITING_APPROVAL"}
            and match.get("safety_decision")
            and match.get("event_source_label") == "Demo Event"
            and match.get("outcome_kind") == "PREDICTED_RECOVERY",
            match.get("approval_state"),
        )

        # Frontend-style execute must not mark RECOVERED (executor path).
        executed = client.post(
            f"/api/recovery/cases/{case_m.id}/execute-pending-action"
        )
        db.refresh(case_m)
        report.check(
            "Execute/approve path does not mark RECOVERED",
            case_m.status != CaseStatus.RECOVERED,
            str(case_m.status),
        )

        # --------------------------------------------------
        # APPROVAL_REQUIRED
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.APPROVAL_REQUIRED,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=5_000_000,
            high_value_approval_threshold=10_000_000,
        )
        approval = _ingest(
            db,
            amount=249900,
            email=f"approval.{batch}@recoverai.demo",
            key=f"p14-approval-{batch}",
        )
        db.commit()
        case_a = db.get(RecoveryCase, approval["case_id"])
        action_a = _latest_action(db, case_a.id)
        listed_a = enrich_case_operations(db, case_a)
        report.check(
            "Approval mode waits in Operations (not auto-executed)",
            action_a is not None
            and action_a.status == ActionStatus.PENDING
            and action_a.requires_approval is True
            and listed_a.get("approval_state") == "AWAITING_APPROVAL"
            and case_a.status != CaseStatus.RECOVERED,
            listed_a.get("approval_state"),
        )

        # --------------------------------------------------
        # AUTOMATIC within limits
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.AUTOMATIC,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=5_000_000,
            max_retry_attempts=3,
            high_value_approval_threshold=10_000_000,
        )
        auto = _ingest(
            db,
            amount=129900,
            email=f"auto.{batch}@recoverai.demo",
            key=f"p14-auto-{batch}",
        )
        db.commit()
        case_auto = db.get(RecoveryCase, auto["case_id"])
        pending_auto = db.scalar(
            select(RecoveryAction).where(
                RecoveryAction.case_id == case_auto.id,
                RecoveryAction.status == ActionStatus.PENDING,
            )
        )
        executed_on_ingest = db.scalar(
            select(RecoveryAction).where(
                RecoveryAction.case_id == case_auto.id,
                RecoveryAction.status.in_(
                    [ActionStatus.EXECUTED, ActionStatus.FAILED]
                ),
            )
        )
        report.check(
            "Agent mode does not execute on ingest",
            pending_auto is not None
            and executed_on_ingest is None
            and case_auto.status != CaseStatus.RECOVERED,
            f"pending={pending_auto.status.value if pending_auto else None}",
        )
        run_one = run_agent_for_case(db, case_auto.id)
        db.commit()
        db.refresh(case_auto)
        executed_auto = db.scalar(
            select(RecoveryAction).where(
                RecoveryAction.case_id == case_auto.id,
                RecoveryAction.status.in_(
                    [ActionStatus.EXECUTED, ActionStatus.FAILED]
                ),
            )
        )
        report.check(
            "Run Agent executes Safety-allowed actions for one case",
            executed_auto is not None
            and case_auto.status != CaseStatus.RECOVERED
            and not run_one.get("blocked"),
            f"action={executed_auto.status.value if executed_auto else None} "
            f"case={case_auto.status.value}",
        )

        # --------------------------------------------------
        # Amount limit
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.AUTOMATIC,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=50_000,
            high_value_approval_threshold=10_000_000,
        )
        over_cap = _ingest(
            db,
            amount=199900,
            email=f"cap.{batch}@recoverai.demo",
            key=f"p14-cap-{batch}",
        )
        db.commit()
        case_cap = db.get(RecoveryCase, over_cap["case_id"])
        action_cap = _latest_action(db, case_cap.id)
        listed_cap = enrich_case_operations(db, case_cap)
        from types import SimpleNamespace

        link_policy = classify_approval(
            db,
            case_cap,
            SimpleNamespace(
                action_type=StrategyType.SEND_PAYMENT_LINK,
                status=ActionStatus.PENDING,
            ),
        )
        retry_cap_policy = classify_approval(
            db,
            case_cap,
            SimpleNamespace(
                action_type=StrategyType.IMMEDIATE_RETRY,
                status=ActionStatus.PENDING,
            ),
        )
        report.check(
            "Payment link over cap is agent-eligible",
            link_policy.get("auto_eligible") is True
            and action_cap.status == ActionStatus.PENDING
            and case_cap.status != CaseStatus.RECOVERED,
            link_policy.get("reason"),
        )
        report.check(
            "Retry over auto cap requires approval",
            retry_cap_policy.get("auto_eligible") is False
            and retry_cap_policy.get("requires_approval") is True
            and case_cap.status != CaseStatus.RECOVERED,
            retry_cap_policy.get("reason"),
        )

        _set_policy(
            db,
            recovery_mode=RecoveryMode.AUTOMATIC,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=50_000_000,
            high_value_approval_threshold=100_000,
        )
        high = _ingest(
            db,
            amount=250000,
            email=f"high.{batch}@recoverai.demo",
            key=f"p14-high-{batch}",
        )
        db.commit()
        case_high = db.get(RecoveryCase, high["case_id"])
        action_high = _latest_action(db, case_high.id)
        report.check(
            "High-value threshold requires approval",
            action_high.status == ActionStatus.PENDING
            and case_high.status != CaseStatus.RECOVERED,
            action_high.status.value,
        )

        # --------------------------------------------------
        # Retry limit
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.AUTOMATIC,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=50_000_000,
            max_retry_attempts=0,
            high_value_approval_threshold=50_000_000,
        )
        retry = _ingest(
            db,
            amount=159900,
            email=f"retry.{batch}@recoverai.demo",
            key=f"p14-retry-{batch}",
        )
        db.commit()
        case_retry = db.get(RecoveryCase, retry["case_id"])
        first_retry = db.scalar(
            select(RecoveryAction)
            .where(RecoveryAction.case_id == case_retry.id)
            .order_by(RecoveryAction.created_at.asc())
        )
        action_type = (
            first_retry.action_type.value
            if first_retry is not None
            else ""
        )
        if action_type in {"IMMEDIATE_RETRY", "RETRY_AFTER_DELAY"}:
            policy = classify_approval(db, case_retry, first_retry)
            report.check(
                "Merchant retry limit blocks automatic retry",
                first_retry.status == ActionStatus.PENDING
                and policy.get("requires_approval") is True
                and case_retry.status != CaseStatus.RECOVERED,
                action_type,
            )
        else:
            from types import SimpleNamespace
            from app.schema import StrategyType

            retry_action = SimpleNamespace(
                action_type=StrategyType.RETRY_AFTER_DELAY,
                status=ActionStatus.PENDING,
            )
            policy = classify_approval(db, case_retry, retry_action)
            report.check(
                "Merchant retry limit blocks automatic retry",
                policy.get("auto_eligible") is False
                and policy.get("requires_approval") is True
                and case_retry.status != CaseStatus.RECOVERED,
                f"pipeline selected {action_type}; policy={policy.get('reason')}",
            )

        # --------------------------------------------------
        # Safety blocking
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.MANUAL,
            automatic_recovery_enabled=False,
        )
        blocked_ingest = _ingest(
            db,
            amount=189900,
            email=f"block.{batch}@recoverai.demo",
            key=f"p14-block-{batch}",
        )
        db.commit()
        case_b = db.get(RecoveryCase, blocked_ingest["case_id"])
        action_b = _latest_action(db, case_b.id)
        action_b.status = ActionStatus.BLOCKED
        db.add(action_b)
        db.commit()
        _set_policy(
            db,
            recovery_mode=RecoveryMode.AUTOMATIC,
            automatic_recovery_enabled=True,
            max_automatic_recovery_amount=50_000_000,
            high_value_approval_threshold=50_000_000,
        )
        db.refresh(case_b)
        db.refresh(action_b)
        decision = apply_merchant_recovery_mode(db, case_b)
        db.commit()
        db.refresh(action_b)
        db.refresh(case_b)
        report.check(
            "Safety-blocked action is not auto-executed",
            decision.get("auto_eligible") is False
            and action_b.status == ActionStatus.BLOCKED
            and case_b.status != CaseStatus.RECOVERED,
            decision.get("reason"),
        )

        # Spoofing live source via demo ingest is ignored
        spoof = ingest_payment_failed_event(
            db,
            {
                "event": "payment.failed",
                "amount": 111100,
                "currency": "INR",
                "customer": {
                    "name": "Spoof",
                    "email": f"spoof.{batch}@recoverai.demo",
                },
                "failure": {
                    "code": "GATEWAY_TIMEOUT",
                    "reason": "Gateway timeout",
                },
                "idempotency_key": f"p14-spoof-{batch}",
                "event_source": "LIVE_PROVIDER",
            },
        )
        db.commit()
        spoof_payment = db.get(Payment, spoof["payment_id"])
        report.check(
            "Demo ingest cannot spoof Live Provider Event",
            spoof_payment.event_source == "DEMO_EVENT",
            spoof_payment.event_source,
        )

        # --------------------------------------------------
        # Verified payment.failed webhook
        # --------------------------------------------------
        _set_policy(
            db,
            recovery_mode=RecoveryMode.MANUAL,
            automatic_recovery_enabled=False,
        )
        settings_wh = get_or_create_settings(db)
        settings_wh.razorpay_webhook_secret = None
        db.add(settings_wh)
        db.commit()
        rzp_fail_id = f"pay_fail_{batch}"
        fail_email = f"live.{batch}@recoverai.demo"
        fail_body = _failed_webhook_body(
            payment_id=rzp_fail_id,
            amount=329900,
            email=fail_email,
        )
        fail_sig = sign_webhook_body(fail_body, secret=TEST_WEBHOOK_SECRET)

        with patch(
            "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
            TEST_WEBHOOK_SECRET,
        ):
            r1 = client.post(
                "/api/webhooks/razorpay",
                content=fail_body,
                headers={"X-Razorpay-Signature": fail_sig},
            )
            r2 = client.post(
                "/api/webhooks/razorpay",
                content=fail_body,
                headers={"X-Razorpay-Signature": fail_sig},
            )

        report.check(
            "Verified payment.failed webhook is ingested",
            r1.status_code == 200 and r1.json().get("status") == "ingested",
            r1.json() if r1.status_code == 200 else r1.text,
        )
        report.check(
            "Failed webhook replay is idempotent",
            r2.status_code == 200
            and r2.json().get("idempotent") is True
            and r2.json().get("payment_id") == r1.json().get("payment_id"),
            r2.json().get("status"),
        )

        live_payment = db.get(Payment, r1.json().get("payment_id"))
        live_case = db.get(RecoveryCase, r1.json().get("case_id"))
        report.check(
            "Failed webhook is a Live Provider Event and not RECOVERED",
            live_payment is not None
            and live_payment.event_source == "LIVE_PROVIDER"
            and live_case is not None
            and live_case.status != CaseStatus.RECOVERED,
            f"source={getattr(live_payment, 'event_source', None)} "
            f"status={getattr(live_case, 'status', None)}",
        )

        listed_live = enrich_case_operations(db, live_case)
        report.check(
            "Live Provider Event label on operations case",
            listed_live.get("event_source_label") == "Live Provider Event"
            and listed_live.get("outcome_kind") == "PREDICTED_RECOVERY",
            listed_live.get("event_source_label"),
        )

        # Unsigned captured-style event via console is not this test;
        # unsigned webhook cannot recover.
        unsigned = client.post(
            "/api/webhooks/razorpay",
            content=fail_body,
        )
        report.check(
            "Unsigned webhook is rejected",
            unsigned.status_code in {400, 401},
            str(unsigned.status_code),
        )

        # Replay of same Razorpay id after ingest uses rzp-failed key
        # already covered. Second unique failed payment creates another case.
        rzp_fail_id_2 = f"pay_fail2_{batch}"
        fail_body_2 = _failed_webhook_body(
            payment_id=rzp_fail_id_2,
            amount=119900,
            email=f"live2.{batch}@recoverai.demo",
        )
        fail_sig_2 = sign_webhook_body(
            fail_body_2, secret=TEST_WEBHOOK_SECRET
        )
        with patch(
            "app.services.razorpay_webhook_service.RAZORPAY_WEBHOOK_SECRET",
            TEST_WEBHOOK_SECRET,
        ):
            r3 = client.post(
                "/api/webhooks/razorpay",
                content=fail_body_2,
                headers={"X-Razorpay-Signature": fail_sig_2},
            )
        report.check(
            "Different Razorpay payment id creates a new failure case",
            r3.status_code == 200
            and r3.json().get("payment_id") != r1.json().get("payment_id")
            and r3.json().get("status") == "ingested",
            r3.json().get("payment_id"),
        )

        # Policy GET after updates still has no secrets
        pub = public_settings_payload(get_or_create_settings(db))
        report.check(
            "public_settings_payload never includes secret keys",
            "razorpay_key_secret" not in pub
            and "razorpay_webhook_secret" not in pub
            and "key_secret" not in pub,
        )

        report.check(
            "MerchantSettings row exists as backend singleton",
            db.get(MerchantSettings, "default") is not None,
        )

    except Exception as exc:
        report.check("Suite crashed", False, str(exc))
        raise
    finally:
        try:
            if snap is not None:
                _restore(db, snap)
        finally:
            db.close()

    ok = report.summary()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
