"""seed de una plantilla de instrucción de transferencia (placeholder editable)

No inventa datos reales (montos, IBAN, cédulas): sólo deja una plantilla base con
textos entre corchetes para que el owner la complete/edite. La instrucción real se
arma con esta plantilla + las líneas del desembolso.

Revision ID: 0003_seed_instruction
Revises: 0002_seed_access
Create Date: 2026-07-25
"""

from __future__ import annotations

import json

from alembic import op

revision = "0003_seed_instruction"
down_revision = "0002_seed_access"
branch_labels = None
depends_on = None

_BODY = (
    "Estimados señores:\n\n"
    "Por medio de la presente instruimos la transferencia de fondos correspondiente al "
    "desembolso del período {{period}}, por un total de USD {{total}}, con cargo a la "
    "cuenta de escrow del proyecto, según el detalle de beneficiarios adjunto.\n\n"
    "Agradecemos confirmar la ejecución de las transferencias a la mayor brevedad.\n\n"
    "Atentamente,"
)


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO instruction_template
          (name, escrow_agreement_date, purchaser, escrow_agent, agent_legal_id,
           body_md, payment_block, signer_name, signer_title, is_active)
        VALUES
          (%(name)s, %(dt)s, %(purch)s, %(agent)s, %(aid)s,
           %(body)s, %(pb)s, %(sname)s, %(stitle)s, true)
        """,
        {
            "name": "Instrucción de Transferencia — Proyecto Ventanas",
            "dt": "2024-01-01",
            "purch": "[Comprador — completar]",
            "agent": "[Agente de escrow — completar]",
            "aid": "[Cédula jurídica del agente]",
            "body": _BODY,
            "pb": json.dumps({"nota": "Bloque de pago editable por el owner"}),
            "sname": "[Nombre del firmante]",
            "stitle": "Financial Controller",
        },
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        "DELETE FROM instruction_template "
        "WHERE name = 'Instrucción de Transferencia — Proyecto Ventanas'"
    )
