"""planning packages — paquetes de aprobación por mes (foto congelada + link propio).

Cada envío a aprobación es un paquete: nombre + período + token público + un
snapshot (JSON) con los montos CONGELADOS de ese momento + sus notas/comentarios.
Así agosto y septiembre quedan separados, con historial. No se enredan.

Revision ID: 0029_planning_packages
Revises: 0028_planning_share
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "0029_planning_packages"
down_revision = "0028_planning_share"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE planning_package (
          id          serial PRIMARY KEY,
          name        text NOT NULL,
          period_from text,
          months      integer NOT NULL DEFAULT 3,
          token       text NOT NULL UNIQUE,
          comments    text,
          status      text NOT NULL DEFAULT 'draft',
          snapshot    jsonb NOT NULL,
          created_at  timestamptz NOT NULL DEFAULT now(),
          created_by  text
        );
        """
    )
    op.execute(
        """
        CREATE TABLE planning_package_note (
          package_id       integer NOT NULL REFERENCES planning_package(id) ON DELETE CASCADE,
          wbs_id           integer NOT NULL,
          note             text,
          suggested_amount numeric(16,2),
          move_to_month    text,
          updated_at       timestamptz NOT NULL DEFAULT now(),
          updated_by       text,
          PRIMARY KEY (package_id, wbs_id)
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS planning_package_note;")
    op.execute("DROP TABLE IF EXISTS planning_package;")
