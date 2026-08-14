"""planning notes — anotaciones de revisión/aprobación del tab Planning.

Por número de proyecto (wbs): nota + monto sugerido + mover-a-mes (instrucción,
NO edita el cronograma real). Más un comentario general del documento en settings.

Revision ID: 0027_planning_notes
Revises: 0026_instruction_template_data
Create Date: 2026-07-27
"""

from __future__ import annotations

from alembic import op

revision = "0027_planning_notes"
down_revision = "0026_instruction_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN planning_comments text;")
    op.execute(
        """
        CREATE TABLE planning_note (
          wbs_id           integer PRIMARY KEY REFERENCES wbs_item(id) ON DELETE CASCADE,
          note             text,
          suggested_amount numeric(16,2),
          move_to_month    text,
          updated_at       timestamptz NOT NULL DEFAULT now(),
          updated_by       text
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS planning_note;")
    op.execute("ALTER TABLE settings DROP COLUMN planning_comments;")
