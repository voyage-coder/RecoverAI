"""customer recovery links

Revision ID: a1b2c3d4e5f6
Revises: c088b170994b
Create Date: 2026-08-29

Stores hashed customer recovery tokens only — never the raw token.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "c088b170994b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "customer_recovery_links",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("first_opened_at", sa.DateTime(), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["case_id"],
            ["recovery_cases.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_customer_recovery_links_case_id",
        "customer_recovery_links",
        ["case_id"],
    )
    op.create_index(
        "ix_customer_recovery_links_token_hash",
        "customer_recovery_links",
        ["token_hash"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_customer_recovery_links_token_hash",
        table_name="customer_recovery_links",
    )
    op.drop_index(
        "ix_customer_recovery_links_case_id",
        table_name="customer_recovery_links",
    )
    op.drop_table("customer_recovery_links")
