"""Un permiso por tab y por sub-tab, en ingles.

Revision ID: 0055_permisos_por_subtab
Revises: 0054_comprometido_contingencia

Owner, 2026-11-10: *«organiza esto por tabs y sub tabs, me pierdo con las
descripciones actuales»* · *«puede que tenga acceso a un sub tab pero no a
todos...asi que favor organiza asi para hacer click»*.

Habia dos problemas y el segundo es el que importa.

1 · LOS TEXTOS ESTABAN EN ESPANOL, en una app que ya se paso entera a ingles
    porque quien la lee no habla espanol. «Ver Pagos (Short Payments,
    Desembolsos, Creditos)» describia tres pantallas en un renglon.

2 · UN PERMISO ABRIA VARIAS PANTALLAS DE GOLPE. `view.invoices` daba las SEIS
    sub-pestanas de Invoices; `view.payments`, las tres de Payments;
    `bank.view`, las tres de Banking. No habia forma de decir «que vea Invoice
    Receipts y nada mas» — justo lo que hace falta para darle acceso al dueno.

Ahora hay un permiso por entrada de menu, con el mismo nombre que la pestana.

⚠️ NADIE PIERDE ACCESO. Cada perfil que tenia el permiso grueso recibe los
finos que lo reemplazan. Un `INSERT ... SELECT` desde `role_permission`, no una
lista escrita a mano: escribirla a mano es como se le quita el Ledger a
Contabilidad sin que nadie se entere hasta el cierre.

⚠️ `bank.view` NO se borra ni se convierte en «la pestana Banking». Son dos
cosas distintas y confundirlas abre datos: ademas del menu, `bank.view` decide
si el PDF del Breakdown imprime el IBAN del beneficiario y si la grilla de
Payments muestra la columna Bank (`show_bank`). Queda como permiso de DATO, y
la pestana Banking pasa a tener el suyo.

⚠️ `report.view` tampoco se borra: es el unico de este grupo que el backend
revisa de verdad (reports, tablero, ledger, planning, presupuesto). Las tres
pestanas que gateaba —Dashboard, Reporting, Budget Proposal— pasan a tener cada
una la suya para el menu, y `report.view` sigue protegiendo la API.

Lo que SI se borra es `view.invoices`: se parte en seis y no queda nada que
represente. `role_permission` tiene ON DELETE CASCADE, asi que sus concesiones
se van con el.
"""

from __future__ import annotations

from alembic import op

revision = "0055_permisos_por_subtab"
down_revision = "0054_comprometido_contingencia"
branch_labels = None
depends_on = None


# (codigo, descripcion). El orden y el agrupado los pone la pantalla de Admin;
# aca solo vive el catalogo.
NUEVOS: list[tuple[str, str]] = [
    ("view.dashboard", "Dashboard"),
    ("view.timeline.detail", "Timeline › Timeline Detail"),
    ("view.reporting", "Reporting"),
    ("view.budget", "Budget Proposal"),
    ("view.disbursements", "Payments › Disbursements"),
    ("view.credits", "Payments › Credits"),
    ("view.invoices.receipts", "Invoices › Invoice Receipts"),
    ("view.invoices.applied", "Invoices › Invoices Applied"),
    ("view.invoices.match", "Invoices › Match Review"),
    ("view.invoices.ledger", "Invoices › Ledger + Invoices"),
    ("view.invoices.manual", "Invoices › Invoices (manual)"),
    ("view.invoices.dehc", "Invoices › DEHC Invoices"),
    ("view.banking", "Banking › Banks"),
    ("view.banking.recon", "Banking › Bank Reconciliation"),
    ("view.banking.wires", "Banking › US Wire Transfers"),
    ("view.blog", "Blog"),
]

# Los que ya existian y cambian de texto: el codigo es el mismo, el rotulo pasa
# a ingles y a nombrar la pestana exacta que abre.
RENOMBRA: list[tuple[str, str]] = [
    ("view.jobcost", "Job Cost"),
    ("view.timeline", "Timeline › Timeline"),
    ("view.planning", "Planning"),
    ("view.payments", "Payments › Short Term Payments"),
    ("view.ledger", "Ledger"),
    ("admin.users", "Admin — manage profiles and users"),
    ("bank.view", "See bank details and beneficiary IBANs"),
    ("report.view", "Read report data (dashboard, reports, planning)"),
    ("blog.post", "Blog — write entries in the project log"),
    ("budget.edit", "Budget Proposal — create budget versions"),
    ("schedule.edit", "Budget Proposal — edit the weekly grid"),
    ("ledger.edit", "Ledger — record payments"),
    ("disb.create", "Payments — create and edit draft disbursements"),
    ("disb.submit", "Payments — submit a disbursement to corporate"),
    ("disb.approve", "Payments — approve a disbursement"),
    ("wbs.edit", "Job Cost — create and edit WBS lines, reassign category and phase"),
]

# Quien tenia el grueso, recibe los finos. Clave: permiso viejo -> nuevos.
HEREDA: dict[str, list[str]] = {
    "report.view": ["view.dashboard", "view.reporting", "view.budget"],
    "view.timeline": ["view.timeline.detail"],
    "view.payments": ["view.disbursements", "view.credits"],
    "view.invoices": [
        "view.invoices.receipts",
        "view.invoices.applied",
        "view.invoices.match",
        "view.invoices.ledger",
        "view.invoices.manual",
        "view.invoices.dehc",
    ],
    "bank.view": ["view.banking", "view.banking.recon", "view.banking.wires"],
}


def upgrade() -> None:
    for code, desc in NUEVOS:
        op.execute(
            f"INSERT INTO permission (code, description) VALUES ('{code}', '{desc}') "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description"
        )
    for code, desc in RENOMBRA:
        op.execute(
            f"UPDATE permission SET description = '{desc}' WHERE code = '{code}'"
        )

    # ⚠️ Esto es lo que evita que alguien se quede sin su pantalla el lunes.
    for viejo, nuevos in HEREDA.items():
        for nuevo in nuevos:
            op.execute(
                f"INSERT INTO role_permission (role_id, permission) "
                f"SELECT role_id, '{nuevo}' FROM role_permission "
                f"WHERE permission = '{viejo}' "
                "ON CONFLICT DO NOTHING"
            )

    # El Blog no tenia permiso: lo veia cualquiera con sesion. Para que la
    # pantalla de Admin no lo muestre apagado para todos, se le da a todos los
    # perfiles que existen hoy. El que no lo quiera, lo destilda.
    op.execute(
        "INSERT INTO role_permission (role_id, permission) "
        "SELECT id, 'view.blog' FROM role ON CONFLICT DO NOTHING"
    )

    # Partido en seis, ya no representa nada. Sus concesiones caen por CASCADE.
    op.execute("DELETE FROM permission WHERE code = 'view.invoices'")


def downgrade() -> None:
    op.execute(
        "INSERT INTO permission (code, description) VALUES "
        "('view.invoices', 'Ver Facturas (Invoice Receipts, Applied, Match, Ledger+Invoices)') "
        "ON CONFLICT (code) DO NOTHING"
    )
    # Quien tenga cualquiera de las seis, recupera la gruesa.
    op.execute(
        "INSERT INTO role_permission (role_id, permission) "
        "SELECT DISTINCT role_id, 'view.invoices' FROM role_permission "
        "WHERE permission LIKE 'view.invoices.%' ON CONFLICT DO NOTHING"
    )
    codes = ", ".join(f"'{c}'" for c, _ in NUEVOS)
    op.execute(f"DELETE FROM permission WHERE code IN ({codes})")
