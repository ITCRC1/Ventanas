"""seed de accesos — grants role_permission + usuarios reales del proyecto

Los roles y permisos ya los inserta schema_v2.sql. Aquí se agrega el MAPEO
role_permission (dato editable, no código) y los usuarios nombrados en el
proyecto: Financial Controller, Blake (PM), Corporativo, Administración, Ronald.

bank.view y disb.approve quedan SÓLO en 'corporate' a propósito: ver los IBAN de
beneficiarios no es lo mismo que aprobar un desembolso (README §Lo siguiente).
El email queda NULL: lo completa el dueño del tenant cuando active OIDC.

Revision ID: 0002_seed_access
Revises: 0001_baseline
Create Date: 2026-07-24
"""

from __future__ import annotations

from alembic import op

revision = "0002_seed_access"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

# rol -> permisos. Mapeo inicial razonable; se ajusta con UPDATE sin desplegar.
_GRANTS: dict[str, list[str]] = {
    "controller": [
        "wbs.edit",
        "budget.edit",
        "schedule.edit",
        "ledger.edit",
        "disb.create",
        "disb.submit",
        "disb.approve",
        "bank.view",
        "report.view",
    ],
    "pm": ["wbs.edit", "budget.edit", "schedule.edit", "report.view"],
    "corporate": ["disb.approve", "bank.view", "report.view"],
    "admin": ["ledger.edit", "disb.create", "disb.submit", "report.view"],
    "viewer": ["report.view"],
}

# username, nombre, rol
_USERS: list[tuple[str, str, str]] = [
    ("bismark", "Financial Controller", "controller"),
    ("blake", "Blake — Project Manager", "pm"),
    ("corporativo", "Corporativo", "corporate"),
    ("administracion", "Administración", "admin"),
    ("ronald", "Ronald", "viewer"),
]


def upgrade() -> None:
    bind = op.get_bind()
    for role_code, perms in _GRANTS.items():
        for perm in perms:
            bind.exec_driver_sql(
                """
                INSERT INTO role_permission (role_id, permission)
                SELECT r.id, %(perm)s FROM role r WHERE r.code = %(role)s
                ON CONFLICT DO NOTHING
                """,
                {"perm": perm, "role": role_code},
            )
    for username, full_name, role_code in _USERS:
        bind.exec_driver_sql(
            """
            INSERT INTO app_user (username, full_name, role_id)
            SELECT %(u)s, %(n)s, r.id FROM role r WHERE r.code = %(role)s
            ON CONFLICT (username) DO NOTHING
            """,
            {"u": username, "n": full_name, "role": role_code},
        )


def downgrade() -> None:
    bind = op.get_bind()
    usernames = tuple(u[0] for u in _USERS)
    bind.exec_driver_sql("DELETE FROM app_user WHERE username = ANY(%(u)s)", {"u": list(usernames)})
    bind.exec_driver_sql("DELETE FROM role_permission")
