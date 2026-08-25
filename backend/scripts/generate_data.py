from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import random
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.schema import (
    Customer,
    Product,
    Order,
    Payment,
    PaymentAttempt,
)


# ============================================================
# CONFIGURATION
# ============================================================

NUM_CUSTOMERS = 20

random.seed(42)


# ============================================================
# SAMPLE DATA
# ============================================================

FIRST_NAMES = [
    "Aarav",
    "Ananya",
    "Rahul",
    "Priya",
    "Arjun",
    "Sneha",
    "Rohan",
    "Kavya",
    "Aditya",
    "Meera",
    "Vikram",
    "Ishita",
    "Karan",
    "Nisha",
    "Varun",
]

LAST_NAMES = [
    "Sharma",
    "Reddy",
    "Patel",
    "Kumar",
    "Verma",
    "Singh",
    "Rao",
    "Gupta",
    "Nair",
    "Das",
]


PRODUCTS = [
    {
        "name": "Pro Analytics",
        "description": "Advanced analytics dashboard for businesses.",
        "price_in_paise": 199900,
        "category": "Software",
    },
    {
        "name": "Cloud Storage Pro",
        "description": "Secure cloud storage for teams.",
        "price_in_paise": 99900,
        "category": "Software",
    },
    {
        "name": "AI Assistant",
        "description": "AI-powered productivity assistant.",
        "price_in_paise": 149900,
        "category": "AI",
    },
    {
        "name": "Developer Toolkit",
        "description": "Premium tools for software developers.",
        "price_in_paise": 249900,
        "category": "Developer Tools",
    },
    {
        "name": "Business Suite",
        "description": "Complete software suite for small businesses.",
        "price_in_paise": 499900,
        "category": "Business",
    },
]


# ============================================================
# FAILURE SCENARIOS
# ============================================================

FAILURE_SCENARIOS = [
    {
        "code": "GATEWAY_TIMEOUT",
        "reason": (
            "Payment gateway timed out while processing "
            "the payment request."
        ),
    },
    {
        "code": "TECHNICAL_FAILURE",
        "reason": (
            "A temporary technical error occurred while "
            "processing the payment."
        ),
    },
    {
        "code": "INSUFFICIENT_FUNDS",
        "reason": (
            "Payment failed because sufficient funds "
            "were not available."
        ),
    },
    {
        "code": "CARD_DECLINED",
        "reason": (
            "The customer's card was declined by "
            "the issuing bank."
        ),
    },
    {
        "code": "EXPIRED_CARD",
        "reason": (
            "The payment method used for the transaction "
            "has expired."
        ),
    },
    {
        "code": "AUTHENTICATION_FAILED",
        "reason": (
            "Payment authentication failed during "
            "transaction processing."
        ),
    },
]


# ============================================================
# CUSTOMER GENERATOR
# ============================================================

def generate_customers(db: Session):
    customers = []

    for i in range(NUM_CUSTOMERS):

        first_name = random.choice(FIRST_NAMES)
        last_name = random.choice(LAST_NAMES)

        name = f"{first_name} {last_name}"

        email = (
            f"{first_name.lower()}."
            f"{last_name.lower()}"
            f"{i}@example.com"
        )

        phone = (
            f"+91"
            f"{random.randint(6000000000, 9999999999)}"
        )

        payment_history_score = random.randint(50, 100)

        if payment_history_score >= 80:
            risk_tier = "LOW"

        elif payment_history_score >= 60:
            risk_tier = "MEDIUM"

        else:
            risk_tier = "HIGH"

        customer = Customer(
            id=str(uuid4()),
            name=name,
            email=email,
            phone=phone,
            risk_tier=risk_tier,
            payment_history_score=payment_history_score,
        )

        db.add(customer)
        customers.append(customer)

    db.flush()

    return customers


# ============================================================
# PRODUCT GENERATOR
# ============================================================

def generate_products(db: Session):
    products = []

    for product_data in PRODUCTS:

        product = Product(
            id=str(uuid4()),
            name=product_data["name"],
            description=product_data["description"],
            price_in_paise=product_data["price_in_paise"],
            category=product_data["category"],
        )

        db.add(product)
        products.append(product)

    db.flush()

    return products


# ============================================================
# PAYMENT HISTORY GENERATOR
# ============================================================

def generate_customer_history(
    db: Session,
    customers,
    products,
):
    orders = []
    payments = []
    attempts = []

    for customer in customers:

        # ----------------------------------------------------
        # Each customer gets 2-4 historical orders
        # ----------------------------------------------------

        number_of_orders = random.randint(2, 4)

        for order_index in range(number_of_orders):

            product = random.choice(products)

            created_at = (
                datetime.utcnow()
                - timedelta(
                    days=random.randint(1, 60)
                )
            )

            # ------------------------------------------------
            # 75% successful payments
            # 25% failed payments
            # ------------------------------------------------

            successful = random.random() < 0.75

            if successful:

                order_status = "PAID"
                payment_status = "SUCCESS"

                failure_code = None
                failure_reason = None

            else:

                order_status = "FAILED"
                payment_status = "FAILED"

                failure = random.choice(
                    FAILURE_SCENARIOS
                )

                failure_code = failure["code"]
                failure_reason = failure["reason"]

            # ------------------------------------------------
            # ORDER
            # ------------------------------------------------

            order = Order(
                id=str(uuid4()),
                customer_id=customer.id,
                product_id=product.id,
                total_amount=product.price_in_paise,
                status=order_status,
                created_at=created_at,
            )

            db.add(order)
            db.flush()

            orders.append(order)

            # ------------------------------------------------
            # PAYMENT
            # ------------------------------------------------

            payment = Payment(
                id=str(uuid4()),
                order_id=order.id,
                amount=product.price_in_paise,
                currency="INR",

                payment_type=random.choice(
                    [
                        "ONE_TIME",
                        "SUBSCRIPTION",
                    ]
                ),

                status=payment_status,

                failure_code=failure_code,
                failure_reason=failure_reason,

                created_at=created_at,
            )

            db.add(payment)
            db.flush()

            payments.append(payment)

            # ------------------------------------------------
            # PAYMENT ATTEMPT
            # ------------------------------------------------

            attempt = PaymentAttempt(
                id=str(uuid4()),
                payment_id=payment.id,
                attempt_number=1,
                status=payment_status,

                error_code=failure_code,
                error_description=failure_reason,

                error_source=(
                    "PAYMENT_GATEWAY"
                    if not successful
                    else None
                ),

                gateway_response={
                    "mode": "TEST",
                    "simulated": True,
                    "source": "SYNTHETIC_DATA",
                },

                created_at=created_at,
            )

            db.add(attempt)
            attempts.append(attempt)

    db.flush()

    return orders, payments, attempts


# ============================================================
# MAIN
# ============================================================

def main():

    db = SessionLocal()

    try:

        print("=" * 60)
        print("RecoverAI Synthetic Data Generator")
        print("=" * 60)

        # ----------------------------------------------------
        # CUSTOMERS
        # ----------------------------------------------------

        print("\nGenerating customers...")

        customers = generate_customers(db)

        print(
            f"Created {len(customers)} customers."
        )

        # ----------------------------------------------------
        # PRODUCTS
        # ----------------------------------------------------

        print("\nGenerating products...")

        products = generate_products(db)

        print(
            f"Created {len(products)} products."
        )

        # ----------------------------------------------------
        # PAYMENT HISTORY
        # ----------------------------------------------------

        print("\nGenerating customer payment histories...")

        orders, payments, attempts = (
            generate_customer_history(
                db,
                customers,
                products,
            )
        )

        print(
            f"Created {len(orders)} orders."
        )

        print(
            f"Created {len(payments)} payments."
        )

        print(
            f"Created {len(attempts)} payment attempts."
        )

        # ----------------------------------------------------
        # COMMIT
        # ----------------------------------------------------

        db.commit()

        print("\n" + "=" * 60)
        print("Synthetic data generated successfully!")
        print("=" * 60)

    except Exception as e:

        db.rollback()

        print("\nERROR:")
        print(e)

        raise

    finally:

        db.close()


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()