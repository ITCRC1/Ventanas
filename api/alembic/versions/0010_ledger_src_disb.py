"""Marca de origen para filas del LEDGER importadas desde un Short Payment.

El owner actualiza el LEDGER escribiendo un número de Disbursement: se traen
TODAS las líneas de ese Short Payment al ledger. `src_disb_no` marca esas filas
(NULL = histórico del Excel) para poder re-importar sin duplicar y sin tocar el
histórico.

Revision ID: 0010_ledger_src_disb
Revises: 0009_line_amount_paid
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0010_ledger_src_disb"
down_revision = "0009_line_amount_paid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE ledger_sheet_row ADD COLUMN IF NOT EXISTS src_disb_no int"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("ALTER TABLE ledger_sheet_row DROP COLUMN IF EXISTS src_disb_no")
