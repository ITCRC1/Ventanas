"""PDFs del Short Payment: Breakdown e Instrucción de transferencia.

Se arma HTML + CSS y se renderiza con WeasyPrint (§2 DECISIONES). El import de
WeasyPrint es DIFERIDO: así la app corre en local (Windows sin GTK) para todo lo
demás; sólo los endpoints de PDF requieren las libs, presentes en el Docker.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from html import escape
from typing import Any

from app.core.holding import HOLDING_SEND


def _ordinal(day: int) -> str:
    if 11 <= day % 100 <= 13:
        return f"{day}th"
    return f"{day}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th') }"


def _letter_date(d: date) -> str:
    """Fecha estilo carta con ordinal, ej. 'July 26th, 2026'."""
    return f"{d.strftime('%B')} {_ordinal(d.day)}, {d.year}"

_CSS = """
@page { size: letter; margin: 2cm; }
* { font-family: "DejaVu Sans", Arial, sans-serif; }
body { color: #1a1a1a; font-size: 11px; }
h1 { font-size: 18px; margin: 0 0 2px; }
.sub { color: #666; font-size: 11px; margin: 0 0 14px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #434343; color: #fff; text-align: left; padding: 5px 6px; font-size: 10px; }
td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.total td { border-top: 2px solid #434343; font-weight: bold; background: #f0f4fa; }
.credit td { color: #1a7f4b; }
.meta { margin: 10px 0; }
.meta b { display: inline-block; width: 150px; }
.letter { white-space: pre-wrap; line-height: 1.5; margin: 14px 0; }
.sign { margin-top: 48px; }
.sign .line { border-top: 1px solid #333; width: 260px; padding-top: 4px; }
"""


def _money(v: Decimal | float | None) -> str:
    if v is None:
        return "—"
    n = float(v)
    s = f"{abs(n):,.2f}"
    return f"({s})" if n < 0 else s


def _usd(v: Decimal | float | None) -> str:
    """Como _money pero con signo $ (negativos entre paréntesis)."""
    if v is None:
        return "—"
    n = float(v)
    s = f"${abs(n):,.2f}"
    return f"({s})" if n < 0 else s


# Destino fijo del holding para transferencias SEND (cuenta LAFISE de Ventanas
# Holding). Se muestra combinado en el Breakdown; confirmado por el owner.
_HOLDING_SEND = HOLDING_SEND


_CSS_BD = """
@page { size: letter landscape; margin: 0.7cm; }
* { font-family: "DejaVu Sans", Arial, sans-serif; }
body { color: #1a1a1a; font-size: 7.5px; }
h1 { font-size: 12px; margin: 0 0 1px; }
.sub { color: #666; font-size: 8px; margin: 0 0 5px; }
table.bd { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.bd th, table.bd td {
  border: 0.7px solid #7a7a7a; padding: 1px 3px; font-size: 7.5px;
  vertical-align: middle; word-wrap: break-word; overflow-wrap: anywhere;
}
table.bd th { background: #fff; color: #000; font-weight: bold; text-align: center; }
th.first { color: #c00000; text-align: left; }
td.desc { text-align: left; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.mid { text-align: center; vertical-align: middle; }
td.grand { text-align: right; vertical-align: middle; font-weight: bold; font-size: 9px; white-space: nowrap; }
tr.total td { background: #d7e5f5; font-weight: bold; }
tr.credit td { color: #1a7f4b; }
"""


def _sent_when(disb: Any) -> str:
    d = disb.send_date or disb.period_month
    if not d:
        return "To be sent"
    return f"To be sent {d.strftime('%B')} {d.day}, {d.year}"


def _breakdown_table(disb: Any, rows: list[dict[str, Any]], *, show_bank: bool) -> str:
    """La tabla del Breakdown (sin envoltura HTML) — reutilizada por el Breakdown
    suelto y por la página 3 de la Instrucción.

    Mapeo columna→campo (según cómo está cargada la data del Short Payment):
      Category←reason · Type←payee_name · Name←bank_name · Transfer←beneficiary ·
      Account←account. El destino (Name/Transfer/Bank/Beneficiary/Account/TOTAL) es
      UNO solo por desembolso → se combina (rowspan).
    """
    n = len(rows) or 1

    def first(field: str) -> str:
        for r in rows:
            if r.get(field):
                return escape(str(r[field]))
        return ""

    name = first("bank_name")
    transfer = first("beneficiary")
    total = Decimal(str(disb.total_amount or 0))
    # Destino combinado: en SEND es la cuenta LAFISE del holding (fija). El IBAN
    # solo se muestra con permiso bancario.
    is_send = transfer.strip().upper() == "SEND"
    bank_name = _HOLDING_SEND["bank"] if is_send else ""
    beneficiary = _HOLDING_SEND["beneficiary"] if is_send else first("beneficiary")
    account = (first("account") or (_HOLDING_SEND["iban"] if is_send else "")) if show_bank else ""

    # Cabecera: primera celda roja "To be sent …", resto centradas.
    # Sin columna "Reason" (iba vacía). Anchos con holgura (suman 98%); TOTAL más
    # ancho para que el monto se lea completo y en una línea.
    heads = [
        f'<th class="first" style="width:19%">{escape(_sent_when(disb))}</th>',
        '<th style="width:7%">Amount</th>',
        '<th style="width:7%">Category</th>',
        '<th style="width:10%">Type</th>',
        '<th style="width:11%">Name</th>',
        '<th style="width:6%">Transfer</th>',
        '<th style="width:7%">Bank Name</th>',
        '<th style="width:8%">Beneficiary</th>',
        '<th style="width:9%">Account</th>',
        '<th style="width:11%">TOTAL</th>',
    ]
    head = "".join(heads)

    body = ""
    for i, r in enumerate(rows):
        amt = _usd(Decimal(str(r["amount"] or 0)))
        left = (
            f'<td class="desc">{escape(r["description"] or "")}</td>'
            f'<td class="num">{amt}</td>'
            f'<td>{escape(r["reason"] or "")}</td>'
            f'<td>{escape(r["payee_name"] or "")}</td>'
        )
        # Bloque de transferencia: solo en la 1ª fila, con rowspan sobre todas y
        # centrado vertical (vertical-align: middle) para que quede en la misma línea.
        mid = ""
        if i == 0:
            mid = (
                f'<td class="mid" rowspan="{n}">{name}</td>'
                f'<td class="mid" rowspan="{n}">{transfer}</td>'
                f'<td class="mid" rowspan="{n}">{escape(bank_name)}</td>'
                f'<td class="mid" rowspan="{n}">{escape(beneficiary)}</td>'
                f'<td class="mid" rowspan="{n}">{escape(account)}</td>'
                f'<td class="mid grand" rowspan="{n}">{_usd(total)}</td>'
            )
        body += f"<tr>{left}{mid}</tr>"

    credit = Decimal(str(disb.credit_applied or 0))
    footer = (
        f'<tr class="credit"><td class="desc">Credit applied</td>'
        f'<td class="num">({_usd(credit)})</td><td colspan="8"></td></tr>'
        if credit
        else ""
    )
    footer += (
        f'<tr class="total"><td class="desc">Total</td>'
        f'<td class="num">{_usd(total)}</td><td colspan="8"></td></tr>'
    )
    return f'<table class="bd"><thead><tr>{head}</tr></thead><tbody>{body}{footer}</tbody></table>'


def breakdown_html(disb: Any, rows: list[dict[str, Any]], *, show_bank: bool) -> str:
    """Breakdown suelto: horizontal (landscape), compacto — réplica del Excel."""
    period = disb.period_month.strftime("%B %Y") if disb.period_month else ""
    table = _breakdown_table(disb, rows, show_bank=show_bank)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{_CSS_BD}</style></head><body>
<h1>Breakdown — Ventanas · Disbursement #{disb.disb_no}.{disb.disb_sub}</h1>
<p class="sub">Period {escape(period)} · Status: {escape(disb.status)}</p>
{table}
</body></html>"""


_CSS_INSTR = """
@page { size: letter; margin: 2.2cm 2.3cm; }
@page bdpage { size: letter landscape; margin: 0.7cm; }
* { font-family: "DejaVu Sans", Arial, sans-serif; }
body { color: #1a1a1a; font-size: 13.5px; }
.title { text-align: center; font-weight: bold; font-size: 18px; letter-spacing: .5px; }
.date { text-align: right; font-size: 13.5px; margin-top: 8px; }
.fromto { margin-top: 34px; }
.fromto div { margin: 8px 0; }
.fromto b { display: inline-block; width: 74px; }
.ref { text-align: right; font-style: italic; font-weight: bold; margin: 28px 0 16px; }
.para { line-height: 1.55; margin: 13px 0; text-align: justify; }
table.amt { width: 100%; border-collapse: collapse; margin: 18px 0; }
table.amt th { background: #1a237e; color: #fff; padding: 9px; font-size: 14px; text-align: center;
  border: 1px solid #1a237e; }
table.amt td { padding: 11px; border: 1px solid #1a237e; font-size: 13px; vertical-align: top;
  font-weight: bold; }
table.amt td.amtc { width: 35%; }
.sign { margin-top: 52px; line-height: 1.5; }
.sign .b { font-weight: bold; }
.pi-title { text-align: center; font-weight: bold; font-size: 18px; }
.pi-sub { text-align: center; font-weight: bold; font-size: 14px; margin: 2px 0 20px; }
table.pi { width: 100%; border-collapse: collapse; }
table.pi td { border: 1px solid #9fb6d0; padding: 10px 12px; font-size: 13px; vertical-align: top; }
table.pi td.k { background: #e8f0f8; font-weight: bold; width: 34%; }
.page-break { page-break-before: always; }
.bd-page { page: bdpage; page-break-before: always; }
table.bd { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.bd th, table.bd td { border: 0.7px solid #7a7a7a; padding: 1px 3px; font-size: 7.5px;
  vertical-align: middle; word-wrap: break-word; overflow-wrap: anywhere; }
table.bd th { background: #fff; color: #000; font-weight: bold; text-align: center; }
table.bd th.first { color: #c00000; text-align: left; }
table.bd td.desc { text-align: left; }
table.bd td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.bd td.mid { text-align: center; vertical-align: middle; }
table.bd td.grand { text-align: right; vertical-align: middle; font-weight: bold; font-size: 9px;
  white-space: nowrap; }
table.bd tr.total td { background: #d7e5f5; font-weight: bold; }
table.bd tr.credit td { color: #1a7f4b; }
"""

# Orden y etiquetas de la página "Payment Instructions" (llaves del payment_block).
_PI_ROWS = [
    ("Beneficiary bank", "beneficiary_bank"),
    ("Intermediary bank", "intermediary_bank"),
    ("Client / Account holder", "account_holder"),
    ("Corporate ID", "corporate_id"),
    ("Telephone", "telephone"),
    ("SWIFT (Intermediary)", "swift_intermediary"),
    ("ABA", "aba"),
    ("SWIFT (Beneficiary bank)", "swift_beneficiary"),
    ("IBAN account", "iban"),
    ("Notify to", "notify"),
    ("Reference location", "reference_location"),
]


def instruction_html(
    disb: Any, template: Any, rows: list[dict[str, Any]], *, show_bank: bool
) -> str:
    """Instrucción de 3 páginas — réplica del modelo del owner:
    1) Carta DISBURSEMENT INSTRUCTIONS  2) PAYMENT INSTRUCTIONS  3) Breakdown.
    Campos que cambian por desembolso: fecha (día de emisión del PDF), monto,
    período y el Breakdown. El resto sale de la plantilla (escrow, banco, firmante).
    """
    total = _usd(Decimal(str(disb.total_amount or 0)))
    total_usd = f"{total} USD"
    period = disb.period_month.strftime("%B, %Y").upper() if disb.period_month else ""
    esc_date = (
        template.escrow_agreement_date.strftime("%B %d, %Y").replace(" 0", " ")
        if template.escrow_agreement_date
        else ""
    )
    letter_date = _letter_date(date.today())  # el día que se prepara el PDF
    purch = escape(template.purchaser or "")
    agent = escape(template.escrow_agent or "")
    aid = escape(template.agent_legal_id or "")

    # --- Página 1: carta ---
    para1 = (
        f'In accordance with the Escrow Agreement dated {escape(esc_date)} and its amendments '
        f'(the "Escrow Agreement") between {purch}, a Wisconsin limited liability company '
        f'("Purchaser") and {agent}, a Costa Rican corporation with Corporate ID number '
        f'{aid} ("Escrow Agent"), by means of the present Disbursement Instruction letter, '
        f"I hereby:"
    )
    para2 = (
        "Grant irrevocable instructions to the Escrow Agent, pursuant to Section 2 of the "
        "Escrow Agreement, to disburse the Earnest Money as detailed herein:"
    )
    amt_table = (
        '<table class="amt"><thead><tr>'
        '<th class="amtc">Amount</th><th>Beneficiary and Purpose</th></tr></thead><tbody>'
        f'<tr><td class="amtc">{total_usd}</td>'
        f"<td>Deployment of planned short-term payments for {escape(period)}.</td></tr>"
        f'<tr><td class="amtc">{total_usd}</td>'
        f"<td>Total cash needs to be approved.</td></tr>"
        "</tbody></table>"
    )
    page1 = (
        '<div class="title">DISBURSEMENT INSTRUCTIONS</div>'
        f'<div class="date">{escape(letter_date)}</div>'
        '<div class="fromto">'
        f"<div><b>FROM:</b> {purch}</div>"
        f"<div><b>TO:</b> {agent}</div>"
        "</div>"
        '<div class="ref">Ref: Irrevocable Disbursement Instructions</div>'
        f'<div class="para">{para1}</div>'
        f'<div class="para">{para2}</div>'
        f"{amt_table}"
        '<div class="sign">Sincerely yours,<br><br><br>'
        f"{escape(template.signer_name or '')}<br>"
        f"{escape(template.signer_title or '')}<br>"
        f'<span class="b">{purch}</span></div>'
    )

    # --- Página 2: payment instructions (del payment_block) ---
    pb = template.payment_block if isinstance(template.payment_block, dict) else {}
    pi_body = ""
    for label, key in _PI_ROWS:
        val = escape(str(pb.get(key) or "")).replace("\n", "<br>")
        pi_body += f'<tr><td class="k">{escape(label)}</td><td>{val}</td></tr>'
    page2 = (
        '<div class="page-break"></div>'
        '<div class="pi-title">PAYMENT INSTRUCTIONS</div>'
        '<div class="pi-sub">INTERNATIONAL DOLLAR</div>'
        f'<table class="pi"><tbody>{pi_body}</tbody></table>'
    )

    # --- Página 3: el Breakdown (landscape) ---
    page3 = f'<div class="bd-page">{_breakdown_table(disb, rows, show_bank=show_bank)}</div>'

    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        f"<style>{_CSS_INSTR}</style></head><body>{page1}{page2}{page3}</body></html>"
    )


def render_pdf(html: str) -> bytes:
    """HTML -> PDF con WeasyPrint (import diferido)."""
    try:
        from weasyprint import HTML
    except ImportError as exc:  # local Windows sin GTK
        raise RuntimeError(
            "WeasyPrint is not available in this environment (GTK is missing). "
            "The PDF is generated on the deployed server."
        ) from exc
    pdf: bytes = HTML(string=html).write_pdf()
    return pdf
