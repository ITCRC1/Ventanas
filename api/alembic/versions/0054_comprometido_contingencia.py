"""Comprometido en el Job Cost, y la linea de contingencia.

Revision ID: 0054_comprometido_contingencia
Revises: 0053_invitacion_usuario

El Dashboard de inversionista necesita dos cosas que el modelo no tenia.

1 · COMPROMETIDO. `v_wbs_financials` sumaba `amount_paid` (lo pagado) y nada
    mas. El LEDGER tambien guarda `amount` —a lo que el proyecto YA se obligo,
    este pagado o no— y esa diferencia es la que separa un reporte historico de
    uno que mira hacia adelante: con $6.7M de remanente, saber cuanto ya tiene
    contrato detras es la senal mas temprana que hay. Hoy, medido contra
    produccion, solo el 3.9% esta comprometido.

2 · CONTINGENCIA. El proyecto corre sin reserva: las 78 lineas son alcance. La
    industria usa 5-10% del hard cost y el indicador clasico es «contingencia
    consumida contra % de avance»: si se gasto el 60% de la reserva al 30% de
    avance, el sobrecosto ya esta decidido.

    ⚠️ Esta migracion NO crea ninguna linea ni mueve un peso del presupuesto.
    Solo agrega la marca. El monto lo pone el dueno desde Job Cost, como
    cualquier otra linea: cuanto reservar es una decision de plata, no de
    pantalla, y no le toca al codigo tomarla.

El texto de la vista sale de `pg_get_viewdef` sobre produccion, con dos parches
verificados: el lateral del ledger suma tambien `amount`, y las dos columnas
nuevas van AL FINAL —CREATE OR REPLACE VIEW exige que las que ya existian
queden en el mismo orden—.
"""

from alembic import op

revision = "0054_comprometido_contingencia"
down_revision = "0053_invitacion_usuario"
branch_labels = None
depends_on = None

VISTA_NUEVA = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id,
    w.wbs_code,
    w.title,
    w.owner,
    w.kind,
    ts.code AS state,
    c.name AS category,
    p.name AS phase,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) AS budget_original,
    COALESCE(w.budget_change_ovr, b.changes, 0::numeric) AS budget_change,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric) AS budget_revised,
    COALESCE(lsr.paid, 0::numeric) AS spend,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric) - COALESCE(lsr.paid, 0::numeric) AS remaining,
    COALESCE(w.forecast_total, COALESCE(lsr.paid, 0::numeric) + COALESCE(tlf.future, 0::numeric)) AS forecast,
    COALESCE(w.forecast_total, COALESCE(lsr.paid, 0::numeric) + COALESCE(tlf.future, 0::numeric)) - (COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric)) AS over_under,
    d.draw_no,
    w.start_date,
    w.due_date,
        CASE
            WHEN w.start_date IS NULL OR w.due_date IS NULL THEN NULL::integer
            ELSE ((date_part('year'::text, w.due_date) - date_part('year'::text, w.start_date)) * 360::double precision + (date_part('month'::text, w.due_date) - date_part('month'::text, w.start_date)) * 30::double precision + (
            CASE
                WHEN date_part('day'::text, w.due_date) = 31::double precision AND date_part('day'::text, w.start_date) >= 30::double precision THEN 30::double precision
                ELSE date_part('day'::text, w.due_date)
            END -
            CASE
                WHEN date_part('day'::text, w.start_date) = 31::double precision THEN 30::double precision
                ELSE date_part('day'::text, w.start_date)
            END))::integer
        END AS duration_days,
    d.draw_no_first,
    COALESCE(lsr.committed, 0::numeric) AS committed,
    w.is_contingency
   FROM wbs_item w
     JOIN task_state ts ON ts.id = w.state_id
     LEFT JOIN category c ON c.id = w.category_id
     LEFT JOIN phase p ON p.id = w.phase_id
     LEFT JOIN LATERAL ( SELECT sum(bl.amount) FILTER (WHERE v.version_no = 1) AS original,
            sum(bl.amount) FILTER (WHERE v.version_no > 1) AS changes
           FROM budget_line bl
             JOIN budget_version v ON v.id = bl.version_id
          WHERE bl.wbs_id = w.id) b ON true
     LEFT JOIN LATERAL ( SELECT sum(ledger_sheet_row.amount_paid) AS paid,
            sum(ledger_sheet_row.amount) AS committed
           FROM ledger_sheet_row
          WHERE ledger_sheet_row.cost_code = w.wbs_code AND ledger_sheet_row.kind = 'data'::text) lsr ON true
     LEFT JOIN LATERAL ( SELECT sum(schedule_cell.planned_amount) AS future
           FROM schedule_cell
          WHERE schedule_cell.wbs_id = w.id AND schedule_cell.week_start >= COALESCE(( SELECT settings.cutoff_date
                   FROM settings
                 LIMIT 1), '1900-01-01'::date)) tlf ON true
     LEFT JOIN LATERAL ( SELECT max(di.disb_no) AS draw_no,
            min(di.disb_no) AS draw_no_first
           FROM disbursement_line dl
             JOIN disbursement di ON di.id = dl.disbursement_id
          WHERE dl.wbs_id = w.id) d ON true
  WHERE w.is_active;
"""

VISTA_VIEJA = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id,
    w.wbs_code,
    w.title,
    w.owner,
    w.kind,
    ts.code AS state,
    c.name AS category,
    p.name AS phase,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) AS budget_original,
    COALESCE(w.budget_change_ovr, b.changes, 0::numeric) AS budget_change,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric) AS budget_revised,
    COALESCE(lsr.paid, 0::numeric) AS spend,
    COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric) - COALESCE(lsr.paid, 0::numeric) AS remaining,
    COALESCE(w.forecast_total, COALESCE(lsr.paid, 0::numeric) + COALESCE(tlf.future, 0::numeric)) AS forecast,
    COALESCE(w.forecast_total, COALESCE(lsr.paid, 0::numeric) + COALESCE(tlf.future, 0::numeric)) - (COALESCE(w.budget_original_ovr, b.original, 0::numeric) + COALESCE(w.budget_change_ovr, b.changes, 0::numeric)) AS over_under,
    d.draw_no,
    w.start_date,
    w.due_date,
        CASE
            WHEN w.start_date IS NULL OR w.due_date IS NULL THEN NULL::integer
            ELSE ((date_part('year'::text, w.due_date) - date_part('year'::text, w.start_date)) * 360::double precision + (date_part('month'::text, w.due_date) - date_part('month'::text, w.start_date)) * 30::double precision + (
            CASE
                WHEN date_part('day'::text, w.due_date) = 31::double precision AND date_part('day'::text, w.start_date) >= 30::double precision THEN 30::double precision
                ELSE date_part('day'::text, w.due_date)
            END -
            CASE
                WHEN date_part('day'::text, w.start_date) = 31::double precision THEN 30::double precision
                ELSE date_part('day'::text, w.start_date)
            END))::integer
        END AS duration_days,
    d.draw_no_first
   FROM wbs_item w
     JOIN task_state ts ON ts.id = w.state_id
     LEFT JOIN category c ON c.id = w.category_id
     LEFT JOIN phase p ON p.id = w.phase_id
     LEFT JOIN LATERAL ( SELECT sum(bl.amount) FILTER (WHERE v.version_no = 1) AS original,
            sum(bl.amount) FILTER (WHERE v.version_no > 1) AS changes
           FROM budget_line bl
             JOIN budget_version v ON v.id = bl.version_id
          WHERE bl.wbs_id = w.id) b ON true
     LEFT JOIN LATERAL ( SELECT sum(ledger_sheet_row.amount_paid) AS paid
           FROM ledger_sheet_row
          WHERE ledger_sheet_row.cost_code = w.wbs_code AND ledger_sheet_row.kind = 'data'::text) lsr ON true
     LEFT JOIN LATERAL ( SELECT sum(schedule_cell.planned_amount) AS future
           FROM schedule_cell
          WHERE schedule_cell.wbs_id = w.id AND schedule_cell.week_start >= COALESCE(( SELECT settings.cutoff_date
                   FROM settings
                 LIMIT 1), '1900-01-01'::date)) tlf ON true
     LEFT JOIN LATERAL ( SELECT max(di.disb_no) AS draw_no,
            min(di.disb_no) AS draw_no_first
           FROM disbursement_line dl
             JOIN disbursement di ON di.id = dl.disbursement_id
          WHERE dl.wbs_id = w.id) d ON true
  WHERE w.is_active;
"""


def upgrade() -> None:
    op.execute(
        "ALTER TABLE wbs_item "
        "ADD COLUMN IF NOT EXISTS is_contingency boolean NOT NULL DEFAULT false"
    )
    op.execute(VISTA_NUEVA)


def downgrade() -> None:
    # Primero la vista: no se puede soltar una columna de la que depende.
    op.execute(VISTA_VIEJA)
    op.execute("ALTER TABLE wbs_item DROP COLUMN IF EXISTS is_contingency")
