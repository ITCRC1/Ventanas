"""endurecimiento (Fase 11): auditoría inmutable + doble aprobación

- audit_log queda append-only: un trigger rechaza UPDATE/DELETE para cualquier
  rol (§4.2 del plan). La única forma de tocarlo es que un DBA quite el trigger.
- disbursement_approval: registra cada aprobación; sobre un umbral hacen falta
  dos aprobadores DISTINTOS (§4.4). UNIQUE evita que el mismo apruebe dos veces.

Revision ID: 0004_hardening
Revises: 0003_seed_instruction
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0004_hardening"
down_revision = "0003_seed_instruction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        -- 1. audit_log inmutable (append-only)
        CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log es inmutable: no se permite %% sobre la auditoría', TG_OP;
        END $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
        CREATE TRIGGER trg_audit_log_immutable
          BEFORE UPDATE OR DELETE ON audit_log
          FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

        -- 2. Doble aprobación de desembolsos
        CREATE TABLE IF NOT EXISTS disbursement_approval (
          id              bigserial PRIMARY KEY,
          disbursement_id int NOT NULL REFERENCES disbursement(id) ON DELETE CASCADE,
          approver_id     int NOT NULL REFERENCES app_user(id),
          approved_at     timestamptz NOT NULL DEFAULT now(),
          UNIQUE (disbursement_id, approver_id)
        );
        CREATE INDEX IF NOT EXISTS ix_disb_approval_disb
          ON disbursement_approval (disbursement_id);
        """
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        DROP TABLE IF EXISTS disbursement_approval;
        DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
        DROP FUNCTION IF EXISTS audit_log_immutable();
        """
    )
