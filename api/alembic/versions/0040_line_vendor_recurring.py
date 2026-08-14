"""Vendor por línea + los 4 pagos recurrentes reales del mes.

(1) `disbursement_line.vendor`: el PROVEEDOR de la factura (texto libre). Es
    distinto del Beneficiary (payee), que es a quién se le transfiere — todo lo
    que se pide a corporativo entra a la cuenta del holding. Se rellena solo con
    el emisor cuando la línea nace del botón ＋SP de Invoice Receipts.
(2) Los recurrentes del catálogo se alinean con las 4 líneas que el owner repite
    todos los meses (Development Team, Admin Fee + FC, CCSS y Alexi), con el
    beneficiario "Overhead / Personnel" y `{MONTH} {YEAR}` en la etiqueta: el
    "Preload recurring" les pone el mes de la tanda.

Revision ID: 0040_line_vendor_recurring
Revises: 0039_invoice_sp_line
Create Date: 2026-07-30
"""

from __future__ import annotations

from alembic import op

revision = "0040_line_vendor_recurring"
down_revision = "0039_invoice_sp_line"
branch_labels = None
depends_on = None

# label, monto, orden. El beneficiario y la nota son iguales para los cuatro.
_RECURRING = [
    ("Development Team - {MONTH} {YEAR}", "14125.00"),
    ("Admin Fee Budget + Financial Controller 25% Salary - {MONTH} {YEAR}", "3750.00"),
    ("CCSS (Social Security) {MONTH} {YEAR}", "800.00"),
    ("Alexi Payment- Care Taker Ventanas", "1824.70"),
]
_PAYEE = "Overhead / Personnel"
_REASON = "Overhead"


def upgrade() -> None:
    op.execute("ALTER TABLE disbursement_line ADD COLUMN vendor text;")
    # Las líneas que ya vinieron de una factura heredan el emisor como Vendor.
    op.execute(
        "UPDATE disbursement_line l SET vendor = r.issuer_name "
        "FROM invoice_receipt r "
        "WHERE r.sp_line_id = l.id AND r.issuer_name IS NOT NULL;"
    )

    # Beneficiario común de los recurrentes (existe en prod; se crea si falta).
    op.execute(
        f"INSERT INTO payee (name, currency, is_active) "
        f"SELECT '{_PAYEE}', 'USD', true "
        f"WHERE NOT EXISTS (SELECT 1 FROM payee WHERE name = '{_PAYEE}');"
    )
    # Los recurrentes viejos (etiquetas que no se usan) quedan inactivos para que
    # el Preload no los traiga; no se borran para no romper líneas históricas.
    labels = ", ".join("'" + lbl.replace("'", "''") + "'" for lbl, _ in _RECURRING)
    op.execute(f"UPDATE recurring_item SET is_active = false WHERE label NOT IN ({labels});")

    for label, amount in _RECURRING:
        lbl = label.replace("'", "''")
        op.execute(
            f"""
            INSERT INTO recurring_item
              (label, payee_id, reason, default_amount, currency, active_from, is_active)
            SELECT '{lbl}', (SELECT id FROM payee WHERE name = '{_PAYEE}'), '{_REASON}',
                   {amount}, 'USD', DATE '2024-01-01', true
            WHERE NOT EXISTS (SELECT 1 FROM recurring_item WHERE label = '{lbl}');
            """
        )
        op.execute(
            f"""
            UPDATE recurring_item SET
                payee_id = (SELECT id FROM payee WHERE name = '{_PAYEE}'),
                reason = '{_REASON}',
                default_amount = {amount},
                currency = 'USD',
                active_to = NULL,
                is_active = true
            WHERE label = '{lbl}';
            """
        )


def downgrade() -> None:
    labels = ", ".join("'" + lbl.replace("'", "''") + "'" for lbl, _ in _RECURRING)
    op.execute(f"DELETE FROM recurring_item WHERE label IN ({labels});")
    op.execute("ALTER TABLE disbursement_line DROP COLUMN vendor;")
