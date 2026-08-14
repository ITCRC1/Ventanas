"""Protege el Ledger al re-importar un Short Payment.

`POST /ledger/import-disbursement` borra las filas del Ledger con ese
`src_disb_no` antes de reinsertar. Antes de la mig. 0041 eso era inofensivo (las
filas venidas del Excel tenían `src_disb_no` NULL); ahora TODAS lo tienen, así
que un "Bring payments" de un mes viejo borraría el histórico del Excel — y con
él, en cascada, las facturas asociadas a esas líneas.

Se marca el origen de cada fila: `excel` (réplica del archivo) o `import` (creada
por el botón). El import solo puede borrar las suyas.

También pasa a ISO las fechas que el import escribió como MM/DD/YYYY: el
auto-match compara por mes y con ese formato no podía leerlas.

Revision ID: 0044_ledger_row_source
Revises: 0043_profiles_credentials
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "0044_ledger_row_source"
down_revision = "0043_profiles_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ledger_sheet_row ADD COLUMN source text NOT NULL DEFAULT 'excel';"
    )
    # Las únicas filas creadas por el botón son las que quedaron con la fecha en
    # MM/DD/YYYY (el Excel y la mig. 0041 dejan ISO).
    op.execute(
        r"""
        UPDATE ledger_sheet_row SET source = 'import'
        WHERE kind = 'data' AND src_disb_no IS NOT NULL
          AND entry_date IS NOT NULL
          AND entry_date !~ '^\d{4}-\d{2}-\d{2}';
        """
    )
    op.execute(
        r"""
        UPDATE ledger_sheet_row
        SET entry_date = to_char(to_date(entry_date, 'MM/DD/YYYY'), 'YYYY-MM-DD')
        WHERE entry_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
        """
    )
    # Línea del Short Payment que originó la fila: permite RE-importar
    # actualizando en el sitio (no se duplica nada y sobreviven el Cost Code
    # asignado a mano, el Amount Paid y las facturas aplicadas).
    op.execute(
        "ALTER TABLE ledger_sheet_row ADD COLUMN src_line_id bigint "
        "REFERENCES disbursement_line(id) ON DELETE SET NULL;"
    )
    op.execute(
        """
        UPDATE ledger_sheet_row s SET src_line_id = dl.id
        FROM disbursement_line dl JOIN disbursement d ON d.id = dl.disbursement_id
        WHERE s.source = 'import' AND s.src_line_id IS NULL
          AND s.src_disb_no = d.disb_no
          AND s.description IS NOT DISTINCT FROM dl.description
          AND s.amount = dl.amount;
        """
    )
    op.execute("CREATE INDEX ix_ledger_sheet_source ON ledger_sheet_row (source, src_disb_no);")
    op.execute("CREATE INDEX ix_ledger_sheet_src_line ON ledger_sheet_row (src_line_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ledger_sheet_src_line;")
    op.execute("DROP INDEX IF EXISTS ix_ledger_sheet_source;")
    op.execute("ALTER TABLE ledger_sheet_row DROP COLUMN src_line_id;")
    op.execute("ALTER TABLE ledger_sheet_row DROP COLUMN source;")
