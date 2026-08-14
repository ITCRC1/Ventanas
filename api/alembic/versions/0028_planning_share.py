"""planning share token — link público (sin clave) al Planning.

Un token en settings; el link /share/planning/<token> abre SOLO el Planning
(ver + comentar), sin login y sin acceso al resto de la app.

Revision ID: 0028_planning_share
Revises: 0027_planning_notes
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "0028_planning_share"
down_revision = "0027_planning_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN planning_share_token text;")
    # Token aleatorio inicial (32 hex). El owner puede regenerarlo por endpoint.
    op.execute(
        "UPDATE settings SET planning_share_token = "
        "md5(random()::text || clock_timestamp()::text);"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE settings DROP COLUMN planning_share_token;")
