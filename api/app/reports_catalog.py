"""Catálogo de reportes: qué vista, cómo se llama y cómo se rotula cada columna.

Las vistas nacieron con nombres mezclados (`comprometido_en_desembolsos`,
`pagado`, `solicitado`). Estos reportes se mandan afuera — junta y dueños — así
que acá viven las etiquetas en inglés y el tipo de cada columna, que es lo que
decide alineación, formato de monto y totales tanto en pantalla como en el Excel.

`kind`: money · date · int · pct · text. Una columna que no aparece en `cols`
no se publica (los `id` internos, por ejemplo).
"""

from __future__ import annotations

from typing import Any

# (clave, etiqueta, tipo)
Col = tuple[str, str, str]


def _c(cols: list[Col]) -> list[dict[str, str]]:
    return [{"key": k, "label": lb, "kind": kd} for k, lb, kd in cols]


REPORTS: dict[str, dict[str, Any]] = {
    # --- Budget & Schedule ---------------------------------------------------
    "budget-vs-actual": {
        "view": "v_budget_vs_actual",
        "title": "Budget vs. Actual",
        "blurb": "Revised budget, amounts committed in disbursements, paid to date and available, by WBS line.",
        "group": "Budget & Schedule",
        "cols": _c([
            ("wbs_code", "WBS", "text"),
            ("title", "Line", "text"),
            ("category", "Category", "text"),
            ("phase", "Phase", "text"),
            ("budget_revised", "Revised Budget", "money"),
            ("comprometido_en_desembolsos", "Committed in Disbursements", "money"),
            ("pagado", "Paid", "money"),
            ("disponible", "Available", "money"),
        ]),
    },
    "timeline": {
        "view": "v_timeline",
        "title": "Timeline by Category",
        "blurb": "Budget, spend and planned amounts rolled up by category and phase, week by week.",
        "group": "Budget & Schedule",
        "cols": _c([
            ("category", "Category", "text"),
            ("phase", "Phase", "text"),
            ("week_start", "Week", "date"),
            ("budget_revised", "Revised Budget", "money"),
            ("spend", "Spend", "money"),
            ("remaining", "Remaining", "money"),
            ("planned", "Planned", "money"),
        ]),
    },
    "timeline-detail": {
        "view": "v_timeline_detail",
        "title": "Timeline Detail",
        "blurb": "Every WBS line with its budget, spend and the amount planned in each week.",
        "group": "Budget & Schedule",
        "cols": _c([
            ("wbs_code", "WBS", "text"),
            ("title", "Line", "text"),
            ("owner", "Owner", "text"),
            ("state", "Status", "text"),
            ("category", "Category", "text"),
            ("phase", "Phase", "text"),
            ("budget_original", "Original Budget", "money"),
            ("budget_change", "Changes", "money"),
            ("budget_revised", "Revised Budget", "money"),
            ("spend", "Spend", "money"),
            ("remaining", "Remaining", "money"),
            ("week_start", "Week", "date"),
            ("planned_amount", "Planned", "money"),
        ]),
    },
    "reassignment-queue": {
        "view": "v_reassignment_queue",
        "title": "Lines Needing Attention",
        "blurb": "WBS lines the database flags as inconsistent and that require a decision.",
        "group": "Budget & Schedule",
        "cols": _c([
            ("wbs_code", "WBS", "text"),
            ("title", "Line", "text"),
            ("category", "Category", "text"),
            ("phase", "Phase", "text"),
            ("issue", "Issue", "text"),
        ]),
    },
    # --- Ledger --------------------------------------------------------------
    "ledger": {
        "view": "v_ledger",
        "title": "Ledger",
        "blurb": "Every entry with its cost code, payee, amount committed, amount paid and balance due.",
        "group": "Ledger",
        "cols": _c([
            ("cost_code", "Cost Code", "text"),
            ("account", "Account", "text"),
            ("entry_date", "Date", "date"),
            ("invoice_no", "Invoice #", "text"),
            ("payee", "Payee", "text"),
            ("description", "Description", "text"),
            ("amount", "Amount", "money"),
            ("amount_paid", "Amount Paid", "money"),
            ("amount_due", "Amount Due", "money"),
            ("status", "Status", "text"),
            ("bank_paid_from", "Bank Paid From", "text"),
            ("notes", "Notes", "text"),
        ]),
    },
    # --- Disbursements & Wires ----------------------------------------------
    "disbursement-trace": {
        "view": "v_disbursement_trace",
        "title": "Disbursement Trace",
        "blurb": "Each draw from request through corporate transfer, escrow receipt and final payment.",
        "group": "Disbursements & Wires",
        "cols": _c([
            ("disb_no", "Draw #", "int"),
            ("disb_sub", "Sub", "int"),
            ("period_month", "Period", "date"),
            ("status", "Status", "text"),
            ("solicitado", "Requested", "money"),
            ("enviado_por_corporativo", "Sent by Corporate", "money"),
            ("neto_recibido_escrow", "Net Received in Escrow", "money"),
            ("trasladado_operativa", "Transferred to Operating", "money"),
            ("pagado", "Paid", "money"),
            ("pendiente_pago", "Pending Payment", "money"),
        ]),
    },
    "disbursement-gaps": {
        "view": "v_disbursement_gaps",
        "title": "Missing Draw Numbers",
        "blurb": "Gaps in the disbursement numbering. An empty report means the sequence is complete.",
        "group": "Disbursements & Wires",
        "cols": _c([("disb_no_faltante", "Missing Draw #", "int")]),
    },
    "wire-reconciliation": {
        "view": "v_wire_reconciliation",
        "title": "Wire Reconciliation",
        "blurb": "Requested versus sent and received per wire, with bank fees and any unexplained difference.",
        "group": "Disbursements & Wires",
        "cols": _c([
            ("wire_date", "Wire Date", "date"),
            ("reference", "Reference", "text"),
            ("disb_no", "Draw #", "int"),
            ("disb_sub", "Sub", "int"),
            ("period_month", "Period", "date"),
            ("solicitado", "Requested", "money"),
            ("enviado", "Sent", "money"),
            ("dif_solicitado_enviado", "Difference", "money"),
            ("comisiones", "Bank Fees", "money"),
            ("neto_recibido", "Net Received", "money"),
            ("sin_explicar", "Unexplained", "money"),
            ("pct_comision", "Fee %", "pct"),
            ("cuenta_destino", "Destination Account", "text"),
            ("value_date", "Value Date", "date"),
        ]),
    },
    "wire-pending": {
        "view": "v_wire_pending",
        "title": "Wires Pending Explanation",
        "blurb": "Wires where the amount received does not match the amount sent and the gap is still open.",
        "group": "Disbursements & Wires",
        "cols": _c([
            ("wire_date", "Wire Date", "date"),
            ("reference", "Reference", "text"),
            ("amount_sent", "Amount Sent", "money"),
            ("amount_received", "Amount Received", "money"),
            ("sin_explicar", "Unexplained", "money"),
            ("pendiente", "Pending", "text"),
        ]),
    },
    "credit-ledger": {
        "view": "v_credit_ledger",
        "title": "Credit Statement",
        "blurb": "Movements of the credit balance with a running total.",
        "group": "Disbursements & Wires",
        "cols": _c([
            ("move_date", "Date", "date"),
            ("kind", "Type", "text"),
            ("description", "Description", "text"),
            ("amount", "Amount", "money"),
            ("balance", "Balance", "money"),
        ]),
    },
    "credit-balance": {
        "view": "v_credit_balance",
        "title": "Credit Balance",
        "blurb": "Credit accrued, credit already applied to disbursements and the balance available.",
        "group": "Disbursements & Wires",
        "cols": _c([
            ("acumulado", "Accrued", "money"),
            ("aplicado", "Applied", "money"),
            ("disponible", "Available", "money"),
        ]),
    },
    # --- Banking -------------------------------------------------------------
    "bank-charges-monthly": {
        "view": "v_bank_charges_monthly",
        "title": "Bank Charges by Month",
        "blurb": "Transfer fees, administration charges, FX fees and interest earned, by account and month.",
        "group": "Banking",
        "cols": _c([
            ("cuenta", "Account", "text"),
            ("mes", "Month", "date"),
            ("comision_transf", "Transfer Fees", "money"),
            ("n_transf", "# Transfers", "int"),
            ("cargo_admin", "Admin Charge", "money"),
            ("comision_cambio", "FX Fee", "money"),
            ("total_cargos", "Total Charges", "money"),
            ("intereses", "Interest", "money"),
            ("neto", "Net", "money"),
        ]),
    },
    "charges-pending-recovery": {
        "view": "v_charges_pending_recovery",
        "title": "Charges Pending Recovery",
        "blurb": "Bank charges not yet recovered from the project, by account and month.",
        "group": "Banking",
        "cols": _c([
            ("cuenta", "Account", "text"),
            ("mes", "Month", "date"),
            ("total_cargos", "Total Charges", "money"),
            ("intereses", "Interest", "money"),
            ("neto", "Net", "money"),
            ("recuperado", "Recovered", "money"),
            ("por_recuperar", "To Recover", "money"),
        ]),
    },
    "bank-fees": {
        "view": "v_bank_fees",
        "title": "Bank Fees by Type",
        "blurb": "Fees charged per bank and fee type, with the average, minimum and maximum observed.",
        "group": "Banking",
        "cols": _c([
            ("banco", "Bank", "text"),
            ("tipo", "Type", "text"),
            ("fee_type", "Fee Type", "text"),
            ("wires", "Wires", "int"),
            ("total", "Total", "money"),
            ("promedio", "Average", "money"),
            ("minimo", "Minimum", "money"),
            ("maximo", "Maximum", "money"),
            ("estimadas", "Estimated", "int"),
        ]),
    },
}

GROUPS = ["Budget & Schedule", "Ledger", "Disbursements & Wires", "Banking"]
