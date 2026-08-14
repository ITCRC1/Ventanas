"""Ola 4 — Short Payments + Wires: recurrentes reales + vista US Wire Transfers

Siembra idempotente de los 4 pagos recurrentes reales del proyecto (con su WBS
y monto de referencia) y crea la vista `v_us_wire_transfers` que replica la hoja
"US Wire Transfers" del Excel: registro de wires (Hovde Master / SunWest →
escrow) con saldo corrido al pie.

Recurrentes (label · WBS · monto · reason):
  - Development Director              · 0.7   · 14 125 · Management Fee
  - Admin Fee + Financial Controller · 0.4   ·  3 750 · Employee Salary
  - Farm Manager (Alexi)             · 0.6.1 ·  1 600 · Employee Salary
  - CCSS (Social Security)           · 0.6.3 ·    800 · Employee Salary

Los 4 mapean a un `wbs_code` existente (sección 0 — Property Holding). Cada uno
necesita un payee (FK NOT NULL): se crean payees dedicados con solo el nombre;
el detalle bancario lo completa el owner desde la UI. No se inventan IBAN/banco.

Revision ID: 0018_wires_recurring
Revises: 0015_spend_from_ledger
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0018_wires_recurring"
down_revision = "0016_jobcost_sections"
branch_labels = None
depends_on = None

# (label, payee_name, wbs_code, amount, reason)
_RECURRING = [
    ("Development Director", "Development Director", "0.7", "14125.00", "Management Fee"),
    (
        "Admin Fee + Financial Controller 25%",
        "Admin Fee + Financial Controller 25%",
        "0.4",
        "3750.00",
        "Employee Salary",
    ),
    ("Farm Manager (Alexi)", "Farm Manager (Alexi)", "0.6.1", "1600.00", "Employee Salary"),
    ("CCSS (Social Security)", "CCSS (Social Security)", "0.6.3", "800.00", "Employee Salary"),
]

_ACTIVE_FROM = "2024-01-01"  # arranque del holding; recurrentes activos todo el proyecto


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Payees dedicados (solo nombre; banco/IBAN los completa el owner). Idempotente.
    for _label, payee, _wbs, _amt, _reason in _RECURRING:
        bind.exec_driver_sql(
            "INSERT INTO payee (name) VALUES (%(name)s) ON CONFLICT (name) DO NOTHING",
            {"name": payee},
        )

    # 2. Recurrentes. Idempotente por label (no hay unique -> guardia NOT EXISTS).
    #    wbs_id se resuelve por wbs_code; si no existe el código, queda NULL.
    for label, payee, wbs, amt, reason in _RECURRING:
        bind.exec_driver_sql(
            """
            INSERT INTO recurring_item
                (label, payee_id, wbs_id, reason, default_amount, currency,
                 active_from, is_active)
            SELECT
                %(label)s,
                (SELECT id FROM payee WHERE name = %(payee)s),
                (SELECT id FROM wbs_item WHERE wbs_code = %(wbs)s),
                %(reason)s, %(amt)s, 'USD', %(af)s, true
            WHERE NOT EXISTS (
                SELECT 1 FROM recurring_item WHERE label = %(label)s
            )
            """,
            {
                "label": label,
                "payee": payee,
                "wbs": wbs,
                "reason": reason,
                "amt": amt,
                "af": _ACTIVE_FROM,
            },
        )

    # 3. Vista "US Wire Transfers" — registro tipo Excel con saldo corrido.
    #    Un wire por fila; saldo = acumulado de lo recibido (o enviado si aún no
    #    hay recibido) ordenado por fecha e id de inserción.
    bind.exec_driver_sql("DROP VIEW IF EXISTS v_us_wire_transfers")
    bind.exec_driver_sql(
        """
        CREATE VIEW v_us_wire_transfers AS
        SELECT
          w.id,
          row_number() OVER (ORDER BY w.wire_date, w.id)          AS trans_no,
          w.wire_date,
          w.value_date,
          w.sender,
          w.from_bank,
          w.to_account_id,
          ba.name                                                 AS to_account,
          ba.role                                                 AS to_account_role,
          d.id                                                    AS disbursement_id,
          d.disb_no,
          d.disb_sub,
          w.reference,
          w.currency,
          w.amount_sent,
          w.amount_received,
          w.note,
          SUM(COALESCE(w.amount_received, w.amount_sent))
            OVER (ORDER BY w.wire_date, w.id ROWS UNBOUNDED PRECEDING)
                                                                  AS running_balance
        FROM wire_transfer w
        JOIN bank_account ba ON ba.id = w.to_account_id
        LEFT JOIN disbursement d ON d.id = w.disbursement_id
        ORDER BY w.wire_date, w.id
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("DROP VIEW IF EXISTS v_us_wire_transfers")
    for label, payee, _wbs, _amt, _reason in _RECURRING:
        bind.exec_driver_sql(
            "DELETE FROM recurring_item WHERE label = %(label)s", {"label": label}
        )
        bind.exec_driver_sql(
            "DELETE FROM payee WHERE name = %(payee)s "
            "AND NOT EXISTS (SELECT 1 FROM recurring_item WHERE payee_id = payee.id) "
            "AND NOT EXISTS (SELECT 1 FROM disbursement_line WHERE payee_id = payee.id)",
            {"payee": payee},
        )
