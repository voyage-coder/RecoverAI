"""merchant settings

Revision ID: b7e8f9a0b1c2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-31

Merchant recovery policy + backend-only Razorpay TEST credentials.
Adds payment.event_source and recovery_actions.requires_approval.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e8f9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "merchant_settings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("recovery_mode", sa.String(length=32), nullable=False),
        sa.Column("automatic_recovery_enabled", sa.Boolean(), nullable=False),
        sa.Column("max_automatic_recovery_amount", sa.Integer(), nullable=False),
        sa.Column("max_retry_attempts", sa.Integer(), nullable=False),
        sa.Column("payment_link_expiry_hours", sa.Integer(), nullable=False),
        sa.Column("high_value_approval_threshold", sa.Integer(), nullable=False),
        sa.Column("razorpay_key_id", sa.String(length=100), nullable=True),
        sa.Column("razorpay_key_secret", sa.Text(), nullable=True),
        sa.Column("razorpay_webhook_secret", sa.Text(), nullable=True),
        sa.Column("credentials_last_tested_at", sa.DateTime(), nullable=True),
        sa.Column("credentials_last_test_ok", sa.Boolean(), nullable=True),
        sa.Column(
            "credentials_last_test_detail",
            sa.String(length=240),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "payments",
        sa.Column(
            "event_source",
            sa.String(length=32),
            server_default="DEMO_EVENT",
            nullable=False,
        ),
    )
    op.add_column(
        "recovery_actions",
        sa.Column(
            "requires_approval",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("recovery_actions", "requires_approval")
    op.drop_column("payments", "event_source")
    op.drop_table("merchant_settings")
