"""Short Term Payments: campo TRANSFER (SEND/HOLD) por línea de desembolso

El Short Payment List del Excel marca cada pago como SEND (se envía) o HOLD
(retenido). Se agrega como texto libre a disbursement_line.

Revision ID: 0006_line_transfer
Revises: 0005_jobcost_forecast
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0006_line_transfer"
down_revision = "0005_jobcost_forecast"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE disbursement_line ADD COLUMN IF NOT EXISTS transfer text"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("ALTER TABLE disbursement_line DROP COLUMN IF EXISTS transfer")
