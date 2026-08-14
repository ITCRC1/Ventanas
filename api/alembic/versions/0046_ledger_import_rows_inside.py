"""Las filas traídas del Short Payment van DENTRO de la sección Ledger.

El import las numeraba con MAX(row_no)+1, o sea al final de la HOJA — después de
las secciones de cierre del Excel (Service Done/Not Posted, Estimates & Quotes,
Unrecorded Center). Resultado: el mes se veía colgando de la última sección y
seguía apareciendo hasta abajo aunque la vista ordene lo más reciente primero.

Acá se reubican las filas ya importadas (source='import') justo después de la
última fila de datos de la sección Ledger. Solo cambia el ORDEN de despliegue:
ni montos, ni asociaciones, ni el histórico del Excel se tocan.

Revision ID: 0046_ledger_import_rows_inside
Revises: 0045_breakdown_vendor_reffx
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0046_ledger_import_rows_inside"
down_revision = "0045_breakdown_vendor_reffx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id FROM ledger_sheet_row WHERE source = 'import' "
            "ORDER BY src_disb_no, row_no"
        )
    ).scalars().all()
    if not rows:
        return
    # Última fila de datos del Ledger que NO vino del import.
    pos = conn.execute(
        text(
            "SELECT COALESCE(MAX(row_no), 0) FROM ledger_sheet_row "
            "WHERE kind = 'data' AND section = 'Ledger' AND source = 'excel'"
        )
    ).scalar_one()
    # Hace lugar para todas de una vez y las reubica en orden.
    conn.execute(
        text("UPDATE ledger_sheet_row SET row_no = row_no + :n WHERE row_no > :pos"),
        {"n": len(rows), "pos": pos},
    )
    for i, rid in enumerate(rows, start=1):
        conn.execute(
            text("UPDATE ledger_sheet_row SET row_no = :rn, section = 'Ledger' WHERE id = :i"),
            {"rn": pos + i, "i": rid},
        )


def downgrade() -> None:
    # El orden anterior (al final de la hoja) no aporta nada: no se revierte.
    pass
