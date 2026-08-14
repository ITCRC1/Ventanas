"""disb-edit — el sobregiro de crédito también cubre los ajustes manuales

El constraint trigger credit_not_overdrawn() ya protegía las APLICACIONES de
crédito (credit_application). Al hacer editables/anulables los AJUSTES manuales
(credit_adjustment), un ajuste negativo o su borrado podía dejar el saldo por
debajo de lo ya aplicado sin que nada lo frenara. Extendemos el mismo trigger
(DEFERRABLE INITIALLY DEFERRED) a credit_adjustment. El servicio fuerza
SET CONSTRAINTS ALL IMMEDIATE para rechazar de forma síncrona.

Revision ID: 0022_disb_edit
Revises: 0019_bank_statement
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0022_disb_edit"
down_revision = "0019_bank_statement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_credit_adj_balance
          AFTER INSERT OR UPDATE OR DELETE ON credit_adjustment
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION credit_not_overdrawn();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_credit_adj_balance ON credit_adjustment;")
