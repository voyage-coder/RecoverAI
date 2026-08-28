"""
Create ONE real Razorpay TEST MODE order.

Reuses payment_gateway_service.attempt_payment_retry so order creation
matches RecoverAI's gateway path.

Does NOT:
- mark Payment / RecoveryCase / RecoveryResult as recovered
- print RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET
- accept rzp_live_ credentials
- fabricate payment success

IMPORTANT — webhook matching:
RecoverAI only applies payment.captured when it can match:
  - notes.case_number → RecoveryCase, and/or
  - PaymentAttempt.gateway_response.order_id → Payment

Without --case-number, the order is orphaned from RecoverAI cases
(HTTP 200 unmatched). Pass --case-number to link a PaymentAttempt.

Usage:
  python scripts/create_real_razorpay_test_order.py
  python scripts/create_real_razorpay_test_order.py --case-number RC-000013
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.schema import (
    Payment,
    PaymentAttempt,
    RecoveryCase,
)
from app.services.payment_gateway_service import (
    MODE_RAZORPAY_TEST,
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    SOURCE_RAZORPAY,
    attempt_payment_retry,
    is_razorpay_configured,
)


# Default standalone smoke amount (₹10). When --case-number is set,
# amount comes from the case payment so checkout matches the case.
DEFAULT_TEST_AMOUNT_PAISE = 1000
TEST_CURRENCY = "INR"


def _refuse_live_key() -> None:
    key_id = (RAZORPAY_KEY_ID or "").strip()
    if key_id.startswith("rzp_live_"):
        print("=" * 72)
        print("REFUSED — LIVE MODE KEY DETECTED")
        print("=" * 72)
        print(
            "RAZORPAY_KEY_ID starts with rzp_live_. "
            "This script only allows TEST MODE (rzp_test_)."
        )
        raise SystemExit(2)


def _static_safety_check() -> list[str]:
    lines: list[str] = []

    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        print("FAIL: Razorpay credentials are not configured in .env")
        raise SystemExit(1)
    lines.append("PASS: credentials present (values not printed)")

    if RAZORPAY_KEY_ID.startswith("rzp_live_"):
        print("FAIL: live key refused")
        raise SystemExit(2)
    lines.append("PASS: key is not rzp_live_")

    if not RAZORPAY_KEY_ID.startswith("rzp_test_"):
        print(
            "FAIL: key does not start with rzp_test_ "
            f"(prefix={RAZORPAY_KEY_ID[:8]}...)"
        )
        raise SystemExit(2)
    lines.append("PASS: key starts with rzp_test_")

    if not is_razorpay_configured():
        print("FAIL: is_razorpay_configured() returned False")
        raise SystemExit(1)
    lines.append("PASS: gateway reports RAZORPAY_TEST configured")

    source = Path(__file__).read_text(encoding="utf-8")
    for secret in (RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET):
        if secret and secret in source:
            print("FAIL: script source embeds a secret value")
            raise SystemExit(1)
    lines.append("PASS: script source does not embed secrets")

    return lines


def _link_attempt_to_case(
    *,
    case_number: str,
    order_id: str,
    amount: int,
    currency: str,
    gateway_response: dict,
) -> None:
    """
    Persist a FAILED/awaiting PaymentAttempt so payment.captured can match.

    Does NOT mark payment/case/result recovered.
    """

    db = SessionLocal()
    try:
        case = db.scalar(
            select(RecoveryCase).where(
                RecoveryCase.case_number == case_number
            )
        )
        if case is None:
            print(f"FAIL: case {case_number} not found")
            raise SystemExit(1)

        payment = db.scalar(
            select(Payment).where(Payment.id == case.payment_id)
        )
        if payment is None:
            print(f"FAIL: payment for {case_number} not found")
            raise SystemExit(1)

        next_number = (
            db.scalar(
                select(PaymentAttempt.attempt_number)
                .where(PaymentAttempt.payment_id == payment.id)
                .order_by(PaymentAttempt.attempt_number.desc())
            )
            or 0
        ) + 1

        attempt = PaymentAttempt(
            id=str(uuid4()),
            payment_id=payment.id,
            attempt_number=next_number,
            status="FAILED",
            error_code="AWAITING_CUSTOMER_PAYMENT",
            error_description=(
                "Razorpay TEST order linked for manual checkout; "
                "awaiting verified payment.captured webhook."
            ),
            error_source=SOURCE_RAZORPAY,
            gateway_response={
                **(gateway_response or {}),
                "order_id": order_id,
                "amount": amount,
                "currency": currency,
                "awaiting_webhook": True,
                "linked_case_number": case.case_number,
                "script": "create_real_razorpay_test_order",
            },
            created_at=datetime.utcnow(),
        )
        db.add(attempt)
        db.commit()

        print("\nDB link (not recovered):")
        print(f"  case_number:     {case.case_number}")
        print(f"  case_status:     {case.status}")
        print(f"  payment_id:      {payment.id}")
        print(f"  payment_status:  {payment.status} (unchanged)")
        print(f"  attempt_number:  {next_number}")
        print(f"  attempt_status:  FAILED / AWAITING_CUSTOMER_PAYMENT")
        print(f"  linked_order_id: {order_id}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a Razorpay TEST MODE order for RecoverAI."
    )
    parser.add_argument(
        "--case-number",
        default=None,
        help=(
            "Optional RecoverAI case number (e.g. RC-000013). "
            "When set, notes.case_number is sent to Razorpay and a "
            "PaymentAttempt is stored so payment.captured can match."
        ),
    )
    args = parser.parse_args()

    print("=" * 72)
    print("RecoverAI — REAL RAZORPAY TEST MODE ORDER")
    print("LABEL: TEST MODE ONLY — not a payment success")
    print("=" * 72)

    _refuse_live_key()

    print("\nStatic / safety checks")
    print("-" * 72)
    for line in _static_safety_check():
        print(line)

    amount = DEFAULT_TEST_AMOUNT_PAISE
    currency = TEST_CURRENCY
    case_number = args.case_number

    if case_number:
        db = SessionLocal()
        try:
            case = db.scalar(
                select(RecoveryCase).where(
                    RecoveryCase.case_number == case_number
                )
            )
            if case is None:
                print(f"FAIL: case {case_number} not found")
                raise SystemExit(1)
            payment = db.scalar(
                select(Payment).where(Payment.id == case.payment_id)
            )
            if payment is None:
                print(f"FAIL: payment for {case_number} not found")
                raise SystemExit(1)
            amount = int(payment.amount)
            currency = payment.currency or TEST_CURRENCY
            print(
                f"\nLinked case {case_number}: "
                f"status={case.status} amount={amount} {currency}"
            )
            print(
                "NOTE: case status is not changed by this script. "
                "Webhook applies RECOVERED after verified capture "
                "(including ESCALATED when ALLOW_RECOVERY_WHEN_ESCALATED)."
            )
        finally:
            db.close()
    else:
        print(
            "\nWARNING: No --case-number provided. "
            "Order will NOT match any RecoverAI case on webhook "
            "(HTTP 200 unmatched). Use --case-number for E2E recovery."
        )

    notes = {
        "source": "RecoverAI",
        "purpose": "manual_test_order",
        "script": "create_real_razorpay_test_order",
    }
    if case_number:
        notes["case_number"] = case_number

    print("\nCreating Razorpay TEST order via payment_gateway_service...")
    print(f"Amount: ₹{amount / 100:.2f} ({amount} paise)")
    print(f"Currency: {currency}")

    result = attempt_payment_retry(
        amount=amount,
        currency=currency,
        receipt=f"rc_{(case_number or 'manual')[:20]}",
        notes=notes,
    )

    order_id = (result.gateway_response or {}).get("order_id")
    out_amount = (result.gateway_response or {}).get("amount", amount)
    out_currency = (result.gateway_response or {}).get(
        "currency", currency
    )
    order_status = (result.gateway_response or {}).get("status")

    blob = " ".join(
        map(
            str,
            [
                order_id,
                out_amount,
                out_currency,
                order_status,
                result.error_code,
                result.error_description,
                result.mode,
                result.status,
            ],
        )
    )
    if RAZORPAY_KEY_SECRET and RAZORPAY_KEY_SECRET in blob:
        print("FAIL: output would have included KEY_SECRET — aborting print")
        raise SystemExit(1)
    if RAZORPAY_WEBHOOK_SECRET and RAZORPAY_WEBHOOK_SECRET in blob:
        print(
            "FAIL: output would have included WEBHOOK_SECRET — aborting print"
        )
        raise SystemExit(1)

    print("\n" + "=" * 72)
    print("RESULT — TEST MODE")
    print("=" * 72)
    print(f"Gateway mode:     {result.mode}")
    print(f"Gateway success:  {result.success}  (must be False)")
    print(f"Attempt status:   {result.status}")
    print(f"Error code:       {result.error_code}")
    print(f"Razorpay order:   {order_id}")
    print(f"Amount (paise):   {out_amount}")
    print(f"Currency:         {out_currency}")
    print(f"Order status:     {order_status}")
    print(
        f"Awaiting webhook: "
        f"{(result.gateway_response or {}).get('awaiting_webhook')}"
    )

    if result.mode != MODE_RAZORPAY_TEST or not order_id:
        print("\nFAIL: order was not created in RAZORPAY_TEST mode.")
        raise SystemExit(1)

    if result.success:
        print("\nFAIL: gateway unexpectedly reported success=True.")
        raise SystemExit(1)

    if case_number:
        _link_attempt_to_case(
            case_number=case_number,
            order_id=str(order_id),
            amount=int(out_amount),
            currency=str(out_currency),
            gateway_response=dict(result.gateway_response or {}),
        )

    print("\n" + "=" * 72)
    print("CHECKOUT (TEST MODE)")
    print("=" * 72)
    print(
        f"""
Use Razorpay Standard Checkout with:
  key:      {RAZORPAY_KEY_ID}
  amount:   {out_amount}
  currency: {out_currency}
  order_id: {order_id}

TEST card: 4111 1111 1111 1111 / any future expiry / any CVV / OTP 123456

After capture, RecoverAI recovers ONLY if this order was linked
(via --case-number / PaymentAttempt.order_id / notes.case_number).
"""
    )
    print("DONE — TEST MODE order created. Payment not marked recovered.")
    print("=" * 72)


if __name__ == "__main__":
    main()
