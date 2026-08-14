"""package submissions + read receipt — el aprobador devuelve su versión.

Read receipt: opened_count / opened_at / last_opened_at en planning_package.
Versiones devueltas: tabla planning_package_submission (snapshot de comentarios +
notas al momento de "Send with comments"). Se guardan hasta que el owner las borre.

Revision ID: 0030_package_submissions
Revises: 0029_planning_packages
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "0030_package_submissions"
down_revision = "0029_planning_packages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE planning_package ADD COLUMN opened_count integer NOT NULL DEFAULT 0;")
    op.execute("ALTER TABLE planning_package ADD COLUMN opened_at timestamptz;")
    op.execute("ALTER TABLE planning_package ADD COLUMN last_opened_at timestamptz;")
    op.execute(
        """
        CREATE TABLE planning_package_submission (
          id            serial PRIMARY KEY,
          package_id    integer NOT NULL REFERENCES planning_package(id) ON DELETE CASCADE,
          reviewer_name text,
          comments      text,
          notes         jsonb NOT NULL DEFAULT '[]'::jsonb,
          submitted_at  timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ON planning_package_submission (package_id);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS planning_package_submission;")
    op.execute("ALTER TABLE planning_package DROP COLUMN opened_count;")
    op.execute("ALTER TABLE planning_package DROP COLUMN opened_at;")
    op.execute("ALTER TABLE planning_package DROP COLUMN last_opened_at;")
