"""La clave la pone el dueño de la cuenta, no el administrador.

Hasta ahora el admin tecleaba una clave al crear el usuario y se la pasaba por
fuera —WhatsApp, correo—. Esa clave viaja en claro por un canal que nadie
controla, queda en el historial del chat, y el admin la conoce para siempre.

Owner, 2026-11-08: *«que asigne clave de la misma manera que este proyecto»*,
señalando el Owner Dashboard, donde el admin **nunca ve la clave**: crea el
usuario, copia un link de un solo uso, y la persona abre el link y pone la suya.

Esta migración agrega lo que falta para eso:

* `user_invite` — las invitaciones. Se guarda el **hash** del token, no el
  token: si alguien lee la tabla no puede entrar con lo que encuentre, igual
  que con las contraseñas.
* `app_user.last_login` — para que la pantalla de administración muestre quién
  entró y quién todavía no abrió su invitación.

⚠️ `user_credential.must_change` ya existía desde la 0043 y **nadie la leía ni
la escribía**. No se toca acá: los 4 usuarios de hoy siguen en `false` a
propósito, para que nadie quede afuera el día del despliegue. La bandera pasa a
usarse solo en las altas y los reinicios nuevos.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_invitacion_usuario"
down_revision: str | None = "0052_factura_pdf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_invite",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("app_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # El hash del token, nunca el token. 64 hex = sha256.
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        # Cuándo se usó. NULL = todavía sirve. Es lo que la hace de un solo uso.
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # Buscar la invitación viva de un usuario es la consulta de todos los días.
    op.create_index("ix_user_invite_user", "user_invite", ["user_id"])

    op.add_column("app_user", sa.Column("last_login", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("app_user", "last_login")
    op.drop_index("ix_user_invite_user", table_name="user_invite")
    op.drop_table("user_invite")
