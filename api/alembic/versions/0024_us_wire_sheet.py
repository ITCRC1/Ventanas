"""us-wire-sheet — espejo fiel de la hoja 'US Wire Transfers' del Excel

Control maestro de TODA la plata que los dueños transfirieron al proyecto:
bloque Ventanas I (wires al escrow) + bloque Ventanas II (Disb. Request).
Tabla espejo (mismo patrón que ledger_sheet_row): se importa la hoja tal cual.

Revision ID: 0024_us_wire_sheet
Revises: 0023_invoice_void
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0024_us_wire_sheet"
down_revision = "0023_invoice_void"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE us_wire_row (
            id            bigserial PRIMARY KEY,
            sort_order    integer NOT NULL DEFAULT 0,
            block         text NOT NULL,                 -- 'ventanas_i' | 'ventanas_ii'
            trans_label   text,                          -- "Disb. Request #1 06/05/-2024" o NULL
            wire_date     date,
            sender        text,
            from_party    text,
            to_party      text,
            account_number text,
            amount_received numeric(16,2) NOT NULL DEFAULT 0,
            amount_sent   numeric(16,2),
            notas         text
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS us_wire_row;")
