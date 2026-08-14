"""Vendor en el Breakdown PDF + tipo de cambio de referencia compartido.

(1) `v_breakdown_pdf` cae al **Vendor** de la línea cuando no hay beneficiario:
    las líneas que nacen de una factura llegan sin payee (el pago va al holding),
    y el PDF que ve corporativo mostraba el nombre en blanco.
(2) `settings.invoice_ref_fx`: el TC ₡/US$ vivía en el localStorage de cada
    navegador; pasa a la base para que sea el mismo para todos.

Solo cambia la VISTA y agrega una columna: ninguna fila histórica se modifica.

Revision ID: 0045_breakdown_vendor_reffx
Revises: 0044_ledger_row_source
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "0045_breakdown_vendor_reffx"
down_revision = "0044_ledger_row_source"
branch_labels = None
depends_on = None

_VIEW = """
CREATE OR REPLACE VIEW v_breakdown_pdf AS
 SELECT d.disb_no,
    d.disb_sub,
    d.period_month,
    d.send_date,
    dl.line_no,
    dl.description,
    dl.amount,
    c.name AS category,
    p.name AS type,
    dl.reason,
    COALESCE(pe.name, dl.vendor) AS payee_name,
    'SEND'::text AS transfer,
    pe.bank_name,
    pe.legal_id AS beneficiary,
    pe.iban AS account,
    d.credit_applied,
    d.total_amount
   FROM disbursement d
     JOIN disbursement_line dl ON dl.disbursement_id = d.id
     LEFT JOIN category c ON c.id = dl.category_id
     LEFT JOIN phase p ON p.id = dl.phase_id
     LEFT JOIN payee pe ON pe.id = dl.payee_id
  ORDER BY d.disb_no, d.disb_sub, dl.line_no;
"""

_VIEW_OLD = _VIEW.replace("COALESCE(pe.name, dl.vendor) AS payee_name", "pe.name AS payee_name")


def upgrade() -> None:
    op.execute(_VIEW)
    op.execute("ALTER TABLE settings ADD COLUMN invoice_ref_fx numeric(12,4);")


def downgrade() -> None:
    op.execute("ALTER TABLE settings DROP COLUMN invoice_ref_fx;")
    op.execute(_VIEW_OLD)
