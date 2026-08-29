"""
Deliver a signature-verified payment.captured webhook to local RecoverAI.

Use this when Razorpay TEST payment succeeded but the Dashboard webhook
could not reach localhost (no ngrok).

This does NOT fake recovery:
- Reads the real Razorpay TEST order/payment for the case
- Requires the payment status to be captured/paid
- Signs with RAZORPAY_WEBHOOK_SECRET
- Posts to the existing POST /api/webhooks/razorpay path

Usage:
  python scripts/apply_local_razorpay_webhook.py --case-number RC-000036
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import Payment, PaymentAttempt, RecoveryCase
from app.services.payment_gateway_service import (
    RAZORPAY_WEBHOOK_SECRET,
    _get_razorpay_client,
    is_razorpay_configured,
    is_webhook_secret_configured,
)
from app.services.razorpay_webhook_service import sign_webhook_body


def _latest_order_id(db, payment_id: str) -> str | None:
    attempts = list(
        db.scalars(
            select(PaymentAttempt)
            .where(PaymentAttempt.payment_id == payment_id)
            .order_by(PaymentAttempt.attempt_number.desc())
        ).all()
    )
    for attempt in attempts:
        gw = attempt.gateway_response or {}
        if gw.get("order_id"):
            return str(gw["order_id"])
    return None


def _fetch_captured_payment(order_id: str) -> dict:
    client = _get_razorpay_client()
    order = client.order.fetch(order_id)
    payments = client.order.payments(order_id)
    items = payments.get("items") or []
    captured = [
        item
        for item in items
        if str(item.get("status") or "").lower() in {"captured", "authorized"}
        or item.get("captured") is True
    ]
    if not captured:
        raise SystemExit(
            f"No captured Razorpay payment found for {order_id} "
            f"(order status={order.get('status')}). "
            "Complete Checkout first."
        )
    return captured[0], order


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply local signed Razorpay payment.captured webhook."
    )
    parser.add_argument("--case-number", required=True)
    parser.add_argument(
        "--webhook-url",
        default="http://127.0.0.1:8000/api/webhooks/razorpay",
    )
    args = parser.parse_args()

    print("=" * 72)
    print("RecoverAI — LOCAL WEBHOOK DELIVERY (TEST MODE)")
    print("Uses real Razorpay captured payment + signed webhook")
    print("=" * 72)

    if not is_razorpay_configured():
        raise SystemExit("FAIL: Razorpay TEST credentials missing.")
    if not is_webhook_secret_configured():
        raise SystemExit("FAIL: RAZORPAY_WEBHOOK_SECRET missing.")

    db = SessionLocal()
    try:
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.case_number == args.case_number
            )
        )
        if case is None:
            raise SystemExit(f"FAIL: case {args.case_number} not found.")

        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )
        if payment is None:
            raise SystemExit("FAIL: payment not found for case.")

        order_id = _latest_order_id(db, payment.id)
        if not order_id:
            raise SystemExit(
                "FAIL: no Razorpay order_id on PaymentAttempt. "
                "Execute a retry/payment-link action first."
            )

        print(f"case_number: {case.case_number}")
        print(f"case_status: {case.status}")
        print(f"payment_status: {payment.status}")
        print(f"order_id: {order_id}")
    finally:
        db.close()

    captured, order = _fetch_captured_payment(order_id)
    razorpay_payment_id = captured["id"]
    amount = int(captured.get("amount") or order.get("amount") or 0)
    currency = captured.get("currency") or "INR"

    print(f"razorpay_payment_id: {razorpay_payment_id}")
    print(f"razorpay_status: {captured.get('status')}")
    print(f"amount: {amount} {currency}")

    body = {
        "entity": "event",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": razorpay_payment_id,
                    "entity": "payment",
                    "amount": amount,
                    "currency": currency,
                    "status": "captured",
                    "order_id": order_id,
                    "notes": {
                        "case_number": args.case_number,
                        "source": "RecoverAI",
                        "local_webhook_helper": "apply_local_razorpay_webhook",
                    },
                }
            }
        },
    }
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    signature = sign_webhook_body(raw, secret=RAZORPAY_WEBHOOK_SECRET)

    # Never print the webhook secret.
    req = urllib.request.Request(
        args.webhook_url,
        data=raw,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": signature,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            print("\nWebhook response:")
            print(json.dumps(payload, indent=2))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"\nFAIL HTTP {exc.code}: {detail}")
        raise SystemExit(1) from exc

    print("\nRefresh Case Details / Dashboard — expect RECOVERED.")
    print("=" * 72)


if __name__ == "__main__":
    main()
