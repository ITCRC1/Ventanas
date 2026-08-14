"""Perfiles de acceso por usuario: credenciales + permisos de vista por sección.

El owner quiere distintos tipos de usuario (Dueño, Contador, Administrativo…)
que vean distinto. Hoy el acceso es una sola clave compartida (todos = bismark).
Esta migración habilita:

- `user_credential`: hash de contraseña (bcrypt) por usuario → login correo+clave.
- Permisos de VISIBILIDAD por sección del menú (`view.*`) + `admin.users` para el
  panel de administración. Se reusan `report.view` (Dashboard) y `bank.view`
  (Banca) que ya existían.
- Perfiles nuevos: `owner` (solo Dashboard), `accountant`, `administrative`.
- Grants: a los roles EXISTENTES se les concede la visibilidad que ya tenían de
  hecho (no romper el acceso actual); `controller` gana `admin.users`.

Todo idempotente (ON CONFLICT DO NOTHING).

Revision ID: 0043_profiles_credentials
Revises: 0042_bank_recon
Create Date: 2026-07-31
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0043_profiles_credentials"
down_revision = "0042_bank_recon"
branch_labels = None
depends_on = None

# Permisos de visibilidad por sección (código, descripción). report.view y
# bank.view ya existen — no se recrean.
VIEW_PERMS = [
    ("view.jobcost", "Ver Job Cost"),
    ("view.timeline", "Ver Timeline y Timeline Detail"),
    ("view.planning", "Ver Planning"),
    ("view.payments", "Ver Pagos (Short Payments, Desembolsos, Créditos)"),
    ("view.invoices", "Ver Facturas (Invoice Receipts, Applied, Match, Ledger+Invoices)"),
    ("view.ledger", "Ver Ledger"),
    ("admin.users", "Administrar perfiles y usuarios"),
]

# Todas las secciones (para los perfiles que "ven todo")
ALL_VIEWS = [
    "view.jobcost", "view.timeline", "report.view", "view.planning",
    "view.payments", "view.invoices", "view.ledger", "bank.view",
]
ALL_ACTIONS = [
    "wbs.edit", "budget.edit", "schedule.edit", "ledger.edit",
    "disb.create", "disb.submit", "disb.approve",
]

NEW_ROLES = [
    ("owner", "Dueño"),
    ("accountant", "Contador"),
    ("administrative", "Administrativo"),
]

# role_code -> lista de permisos a conceder (además de los que ya tenga)
GRANTS: dict[str, list[str]] = {
    # Superusuario: todo + administración
    "controller": ALL_VIEWS + ALL_ACTIONS + ["admin.users"],
    # Perfiles nuevos
    "owner": ["report.view"],  # solo Dashboard / Reportes
    "accountant": ALL_VIEWS + ["ledger.edit", "disb.create"],
    "administrative": ALL_VIEWS + ["ledger.edit", "disb.create"],
    # Roles existentes: preservar el acceso que ya tenían (antes veían todo el menú)
    "pm": ["view.jobcost", "view.timeline", "report.view", "view.planning"],
    "corporate": ALL_VIEWS,
    "admin": ALL_VIEWS,
    "viewer": ["report.view"],  # consulta = Dashboard
}


def upgrade() -> None:
    conn = op.get_bind()

    conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS user_credential (
          user_id       int PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
          password_hash text NOT NULL,
          must_change   boolean NOT NULL DEFAULT false,
          updated_at    timestamptz NOT NULL DEFAULT now()
        );
        """
    )

    for code, desc in VIEW_PERMS:
        conn.execute(
            text("INSERT INTO permission (code, description) VALUES (:c, :d) "
                 "ON CONFLICT (code) DO NOTHING"),
            {"c": code, "d": desc},
        )

    for code, name in NEW_ROLES:
        conn.execute(
            text("INSERT INTO role (code, name) VALUES (:c, :n) ON CONFLICT (code) DO NOTHING"),
            {"c": code, "n": name},
        )

    for role_code, perms in GRANTS.items():
        rid = conn.execute(
            text("SELECT id FROM role WHERE code = :c"), {"c": role_code}
        ).scalar_one_or_none()
        if rid is None:
            continue
        for p in perms:
            conn.execute(
                text(
                    "INSERT INTO role_permission (role_id, permission) VALUES (:r, :p) "
                    "ON CONFLICT (role_id, permission) DO NOTHING"
                ),
                {"r": rid, "p": p},
            )


def downgrade() -> None:
    conn = op.get_bind()
    conn.exec_driver_sql("DROP TABLE IF EXISTS user_credential")
    # Los permisos/roles nuevos se dejan (borrarlos arrastraría role_permission);
    # no es necesario revertirlos para el modelo de datos.
