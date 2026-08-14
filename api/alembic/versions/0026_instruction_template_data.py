"""poblar la plantilla de instrucción con los datos reales de Ventanas

El owner compartió el modelo (Disbursement Instructions): escrow, banco y firmante.
Se completa la plantilla activa (antes tenía placeholders). Idempotente: hace UPDATE
de la fila sembrada en 0003.

Revision ID: 0026_instruction_data
Revises: 0025_lafise_balance
Create Date: 2026-07-27
"""

from __future__ import annotations

import json

from alembic import op

revision = "0026_instruction_data"
down_revision = "0025_lafise_balance"
branch_labels = None
depends_on = None

_PAYMENT_BLOCK = {
    "beneficiary_bank": (
        "Banco Lafise S.A.\n"
        "50 m Este de la rotonda de la fuente de la Hispanidad, "
        "San Pedro, Montes de Oca, San José, Costa Rica"
    ),
    "intermediary_bank": "Citibank N.A.\n111 Wall St. New York City, NY 10005\nUnited States",
    "account_holder": "Servicios Fiduciarios S F, S.A.",
    "corporate_id": "3-101-135728",
    "telephone": "+506 4036 2000",
    "swift_intermediary": "CITIUS33",
    "aba": "021000089",
    "swift_beneficiary": "BCCECRSJ",
    "iban": "CR71011400007911452080",
    "notify": "rvillegas@altalegal.com",
    "reference_location": "Sabana Business Center, piso 12, Sabana Norte, San José, Costa Rica",
}


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        UPDATE instruction_template SET
          name = %(name)s,
          escrow_agreement_date = %(dt)s,
          purchaser = %(purch)s,
          escrow_agent = %(agent)s,
          agent_legal_id = %(aid)s,
          payment_block = %(pb)s,
          signer_name = %(sname)s,
          signer_title = %(stitle)s
        WHERE is_active = true
        """,
        {
            "name": "Disbursement Instructions — Ventanas",
            "dt": "2024-05-24",
            "purch": "Hovde Master, LLC",
            "agent": "Servicios Fiduciarios S F, Sociedad Anónima",
            "aid": "3-101-135728",
            "pb": json.dumps(_PAYMENT_BLOCK),
            "sname": "Randall John Guenther",
            "stitle": "Authorized Representative",
        },
    )


def downgrade() -> None:
    # Vuelve a los placeholders de 0003 (sin datos reales).
    op.get_bind().exec_driver_sql(
        """
        UPDATE instruction_template SET
          purchaser = '[Comprador — completar]',
          escrow_agent = '[Agente de escrow — completar]',
          agent_legal_id = '[Cédula jurídica del agente]',
          payment_block = %(pb)s
        WHERE is_active = true
        """,
        {"pb": json.dumps({"nota": "Bloque de pago editable por el owner"})},
    )
