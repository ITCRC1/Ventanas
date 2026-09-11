"""Columna Beneficiary en el LEDGER.

La columna `payee` de la hoja guarda la etiqueta del Excel ("Disbursement #26 -
08/01/2026") y con ella se arman los bloques y subtotales por tanda: no puede
llevar el nombre del beneficiario. `beneficiary` es ese nombre, tal como se
escribe en la columna Beneficiary del Short Payment, y lo refresca cada import.

Revision ID: 0048_ledger_beneficiary
Revises: 0047_invoice_sync_state
Create Date: 2026-09-11
"""

from __future__ import annotations

from alembic import op

revision = "0048_ledger_beneficiary"
down_revision = "0047_invoice_sync_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE ledger_sheet_row ADD COLUMN IF NOT EXISTS beneficiary text;")
    # Las filas ya importadas toman el beneficiario de su línea de origen.
    op.execute("""
        UPDATE ledger_sheet_row s
           SET beneficiary = p.name
          FROM disbursement_line dl
          JOIN payee p ON p.id = dl.payee_id
         WHERE s.src_line_id = dl.id
           AND s.beneficiary IS NULL;
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE ledger_sheet_row DROP COLUMN IF EXISTS beneficiary;")
