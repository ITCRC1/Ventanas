"""read-receipt + returned versions para el LINK NORMAL de Planning.

El link normal (settings.planning_share_token) no es un paquete, así que lleva
su propio read-receipt (columnas en settings) y su propia tabla de versiones
devueltas (planning_link_submission), en paralelo a las de los paquetes.

Revision ID: 0031_planning_link_receipt
Revises: 0030_package_submissions
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "0031_planning_link_receipt"
down_revision = "0030_package_submissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN planning_opened_count integer NOT NULL DEFAULT 0;")
    op.execute("ALTER TABLE settings ADD COLUMN planning_opened_at timestamptz;")
    op.execute("ALTER TABLE settings ADD COLUMN planning_last_opened_at timestamptz;")
    op.execute(
        """
        CREATE TABLE planning_link_submission (
          id            serial PRIMARY KEY,
          reviewer_name text,
          comments      text,
          notes         jsonb NOT NULL DEFAULT '[]'::jsonb,
          submitted_at  timestamptz NOT NULL DEFAULT now()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS planning_link_submission;")
    op.execute("ALTER TABLE settings DROP COLUMN planning_opened_count;")
    op.execute("ALTER TABLE settings DROP COLUMN planning_opened_at;")
    op.execute("ALTER TABLE settings DROP COLUMN planning_last_opened_at;")
