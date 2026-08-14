"""Agrega value_date (fecha valor) a v_wire_reconciliation.

La fila de conciliación de wires ya expone solicitado, enviado, comisiones y neto,
pero no la fecha valor (cuándo acreditó realmente). El modelo/tabla wire_transfer
ya guarda value_date; esta migración solo la sube a la vista para que la fila del
wire pueda mostrarla (§D.4 backlog réplica fiel).

Se agrega al FINAL de la lista de columnas para poder usar CREATE OR REPLACE VIEW
sin DROP (ninguna otra vista depende de v_wire_reconciliation).

Revision ID: 0019_bank_statement
Revises: 0015_spend_from_ledger
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0019_bank_statement"
down_revision = "0018_wires_recurring"
branch_labels = None
depends_on = None


_VIEW_WITH_VALUE_DATE = """
CREATE OR REPLACE VIEW v_wire_reconciliation AS
SELECT w.id, w.wire_date, w.reference,
       d.disb_no, d.disb_sub, d.period_month,
       d.total_amount                              AS solicitado,
       w.amount_sent                               AS enviado,
       w.amount_sent - COALESCE(d.total_amount,0)  AS dif_solicitado_enviado,
       COALESCE(f.comisiones,0)                    AS comisiones,
       w.amount_received                           AS neto_recibido,
       w.amount_sent - COALESCE(f.comisiones,0)
         - COALESCE(w.amount_received,0)           AS sin_explicar,
       CASE WHEN w.amount_sent = 0 THEN NULL
            ELSE ROUND(COALESCE(f.comisiones,0) / w.amount_sent * 100, 4)
       END                                         AS pct_comision,
       b.name                                      AS cuenta_destino,
       w.value_date                                AS value_date
FROM wire_transfer w
LEFT JOIN disbursement d ON d.id = w.disbursement_id
LEFT JOIN bank_account b ON b.id = w.to_account_id
LEFT JOIN LATERAL (SELECT SUM(amount) comisiones FROM wire_fee WHERE wire_id=w.id) f ON true
ORDER BY w.wire_date
"""

# Definición original (schema_v2.sql) para el downgrade.
_VIEW_ORIGINAL = """
CREATE OR REPLACE VIEW v_wire_reconciliation AS
SELECT w.id, w.wire_date, w.reference,
       d.disb_no, d.disb_sub, d.period_month,
       d.total_amount                              AS solicitado,
       w.amount_sent                               AS enviado,
       w.amount_sent - COALESCE(d.total_amount,0)  AS dif_solicitado_enviado,
       COALESCE(f.comisiones,0)                    AS comisiones,
       w.amount_received                           AS neto_recibido,
       w.amount_sent - COALESCE(f.comisiones,0)
         - COALESCE(w.amount_received,0)           AS sin_explicar,
       CASE WHEN w.amount_sent = 0 THEN NULL
            ELSE ROUND(COALESCE(f.comisiones,0) / w.amount_sent * 100, 4)
       END                                         AS pct_comision,
       b.name                                      AS cuenta_destino
FROM wire_transfer w
LEFT JOIN disbursement d ON d.id = w.disbursement_id
LEFT JOIN bank_account b ON b.id = w.to_account_id
LEFT JOIN LATERAL (SELECT SUM(amount) comisiones FROM wire_fee WHERE wire_id=w.id) f ON true
ORDER BY w.wire_date
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_VIEW_WITH_VALUE_DATE)


def downgrade() -> None:
    # CREATE OR REPLACE no puede QUITAR una columna del final; hay que DROP + CREATE.
    op.get_bind().exec_driver_sql("DROP VIEW IF EXISTS v_wire_reconciliation")
    op.get_bind().exec_driver_sql(_VIEW_ORIGINAL)
