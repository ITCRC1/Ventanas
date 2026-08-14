"""Invoice Receipts — bandeja de facturas electrónicas llegadas por correo.

Sincroniza desde el buzón IMAP (facturas electrónicas CR) y deja que el usuario
asocie cada factura al asiento del ledger donde está el desembolso.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_current_user, get_db
from app.schemas.disbursement import LineIn
from app.services import disbursement as disb_svc
from app.services import invoice_mail, invoice_scheduler

router = APIRouter(
    prefix="/invoice-receipts",
    tags=["invoice-receipts"],
    dependencies=[Depends(get_current_user)],
)

_can_view = Depends(require_permission("report.view"))
_can_edit = Depends(require_permission("ledger.edit"))
_can_disb = Depends(require_permission("disb.create"))


def _sign(doc_type: str | None) -> int:
    """Nota de crédito resta (efecto negativo); todo lo demás suma."""
    return -1 if doc_type == "NC" else 1


@router.get("/status", dependencies=[_can_view])
def status(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    row = db.execute(
        text("SELECT invoice_last_sync_at, invoice_ref_fx FROM settings LIMIT 1")
    ).first()
    counts = db.execute(
        text("SELECT status, count(*) AS n FROM invoice_receipt GROUP BY status")
    ).mappings().all()
    return {
        "configured": settings.invoice_mail_configured,
        "mailbox": settings.invoice_imap_user or None,
        "last_sync_at": row[0] if row else None,
        # TC de referencia ₡/US$ — compartido (antes vivía en cada navegador).
        "ref_fx": float(row[1]) if row and row[1] is not None else None,
        "counts": {c["status"]: c["n"] for c in counts},
        # Sync manual corriendo en segundo plano + resultado de la última corrida.
        **{f"sync_{k}": v for k, v in invoice_scheduler.job_state(db).items()},
    }


class RefFxIn(BaseModel):
    ref_fx: Decimal | None = None


@router.put("/ref-fx", dependencies=[_can_edit])
def set_ref_fx(data: RefFxIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Guarda el TC de referencia (₡ por US$) para todos los usuarios."""
    db.execute(text("UPDATE settings SET invoice_ref_fx = :v"), {"v": data.ref_fx})
    return {"ok": True, "ref_fx": float(data.ref_fx) if data.ref_fx is not None else None}


@router.get("/applied", dependencies=[_can_view])
def applied_mirror(ref_fx: float | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Espejo del ledger con las facturas aplicadas + diferencial cambiario.

    Convierte la factura a USD así: si es USD, tal cual; si su moneda == la del
    asiento, con el fx_rate del asiento; si es ₡ y se pasó `ref_fx` (₡/US$), con
    ese TC de referencia. Diferencial = USD del ledger − USD de la factura.
    Grano = asiento del ledger con >= 1 factura.
    """
    links = (
        db.execute(
            text(
                """
                SELECT l.id AS ledger_id, l.entry_date, l.description, l.status,
                       l.currency AS ledger_currency, l.amount AS ledger_amount,
                       l.fx_rate, l.amount_usd AS ledger_usd, p.name AS payee_name,
                       r.id AS receipt_id, r.invoice_no, r.issuer_name, r.doc_type,
                       r.currency AS inv_currency, r.total AS inv_total, r.invoice_fx,
                       (SELECT count(*) FROM invoice_receipt_link k2
                         WHERE k2.receipt_id = r.id) AS receipt_link_count
                FROM invoice_receipt_link k
                JOIN ledger_entry l ON l.id = k.ledger_entry_id
                JOIN invoice_receipt r ON r.id = k.receipt_id
                LEFT JOIN payee p ON p.id = l.payee_id
                ORDER BY l.entry_date DESC NULLS LAST, l.id DESC
                """
            )
        )
        .mappings()
        .all()
    )

    def to_usd(total: Any, inv_cur: str | None, led_cur: str | None, fx: Any) -> float | None:
        if total is None:
            return None
        t = float(total)
        if inv_cur == "USD":
            return t
        if inv_cur == led_cur and fx is not None:
            return round(t * float(fx), 2)
        # Factura en ₡ (u otra moneda) sin TC del asiento → usa el TC de referencia.
        if ref_fx and ref_fx > 0:
            return round(t / ref_fx, 2)
        return None  # sin TC disponible para esa combinación

    groups: dict[int, dict[str, Any]] = {}
    for lk in links:
        g = groups.get(lk["ledger_id"])
        if g is None:
            g = {
                "ledger_id": lk["ledger_id"],
                "entry_date": lk["entry_date"],
                "description": lk["description"],
                "payee_name": lk["payee_name"],
                "status": lk["status"],
                "ledger_currency": lk["ledger_currency"],
                "ledger_amount": float(lk["ledger_amount"] or 0),
                "fx_rate": float(lk["fx_rate"] or 0),
                "ledger_usd": float(lk["ledger_usd"] or 0),
                "invoices": [],
                "inv_total_native": 0.0,
                "inv_total_usd": 0.0,
                "inv_currency": lk["inv_currency"],
                "invoice_fx": float(lk["invoice_fx"]) if lk["invoice_fx"] is not None else None,
                "mixed_currency": False,
                "has_shared": False,
                "missing_rate": False,
            }
            groups[lk["ledger_id"]] = g
        sg = _sign(lk["doc_type"])
        inv_usd = to_usd(lk["inv_total"], lk["inv_currency"], lk["ledger_currency"], lk["fx_rate"])
        if inv_usd is None:
            g["missing_rate"] = True
        else:
            inv_usd *= sg  # nota de crédito resta
            g["inv_total_usd"] += inv_usd
        if lk["inv_currency"] != g["inv_currency"]:
            g["mixed_currency"] = True
        g["inv_total_native"] += float(lk["inv_total"] or 0) * sg
        if (lk["receipt_link_count"] or 0) > 1:
            g["has_shared"] = True
        g["invoices"].append(
            {
                "receipt_id": lk["receipt_id"],
                "invoice_no": lk["invoice_no"],
                "issuer_name": lk["issuer_name"],
                "doc_type": lk["doc_type"],
                "currency": lk["inv_currency"],
                "total": str(lk["inv_total"]) if lk["inv_total"] is not None else None,
                "total_usd": inv_usd,
                "shared": (lk["receipt_link_count"] or 0) > 1,
            }
        )

    rows = []
    for g in groups.values():
        g["diff_usd"] = round(g["ledger_usd"] - g["inv_total_usd"], 2) if not g["missing_rate"] else None
        g["diff_native"] = (
            round(g["ledger_amount"] - g["inv_total_native"], 2)
            if g["ledger_currency"] == g["inv_currency"] and not g["mixed_currency"]
            else None
        )
        # Tasa implícita: cuántas unidades de la factura por 1 USD del ledger
        # (ej. ₡ de la factura ÷ USD del ledger = ₡/US$ efectivo del asiento).
        g["implied_rate"] = (
            round(g["inv_total_native"] / g["ledger_usd"], 4)
            if g["ledger_usd"] and not g["mixed_currency"]
            else None
        )
        rows.append(g)

    totals = {
        "ledger_usd": round(sum(r["ledger_usd"] for r in rows), 2),
        "inv_total_usd": round(sum(r["inv_total_usd"] for r in rows), 2),
        "diff_usd": round(
            sum(r["diff_usd"] for r in rows if r["diff_usd"] is not None), 2
        ),
        "count": len(rows),
    }
    return {"rows": rows, "totals": totals, "ref_fx": ref_fx}


@router.get("/ledger-view", dependencies=[_can_view])
def reconstructed_ledger(
    ref_fx: float | None = None, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Copia del LEDGER REAL (réplica del Excel, cuadra con su total) con la
    factura asociada por línea (# factura, proveedor, monto, nota) + # de
    liquidación (Disbursement) y mes. La factura se pega mapeando el asiento
    ligado (cost_code + monto) a su fila del Ledger cuando es único."""
    sheet = (
        db.execute(
            text(
                """
                SELECT s.id, s.src_disb_no, s.cost_code, s.account, s.payee, s.entry_date,
                       s.invoice_no, s.amount, s.amount_paid, s.amount_due, s.notes,
                       d.period_month
                FROM ledger_sheet_row s
                LEFT JOIN disbursement d ON d.disb_no = s.src_disb_no
                WHERE s.kind = 'data'
                ORDER BY s.row_no
                """
            )
        )
        .mappings()
        .all()
    )
    links = (
        db.execute(
            text(
                """
                SELECT k.sheet_row_id, k.receipt_id, r.doc_type, r.invoice_no, r.issuer_name,
                       r.currency AS inv_cur, r.total AS inv_total, r.notes AS note,
                       r.no_invoice, r.invoice_date
                FROM invoice_receipt_link k
                JOIN invoice_receipt r ON r.id = k.receipt_id
                WHERE k.sheet_row_id IS NOT NULL
                """
            )
        )
        .mappings()
        .all()
    )
    # Enlace DIRECTO por línea del Ledger (sin mapeo difuso). Si una línea tiene
    # varias facturas (ej. factura + nota de crédito), se listan varias filas.
    attach: dict[int, list[dict[str, Any]]] = {}
    for lk in links:
        attach.setdefault(lk["sheet_row_id"], []).append(dict(lk))

    def to_usd(total: Any, inv_cur: str | None) -> float | None:
        if total is None:
            return None
        t = float(total)
        if inv_cur == "USD":
            return t
        if ref_fx and ref_fx > 0:
            return round(t / ref_fx, 2)
        return None

    out = []
    for s in sheet:
        month = None
        if s["period_month"]:
            month = str(s["period_month"])[:7]
        elif s["entry_date"]:
            month = str(s["entry_date"])[:7]
        invs = attach.get(s["id"]) or [None]
        for i, lk in enumerate(invs):
            first = i == 0  # el monto del Ledger va solo en la 1ª fila (no doble-cuenta)
            row: dict[str, Any] = {
                "ledger_id": s["id"],
                "src_disb_no": s["src_disb_no"],
                "payee_name": s["payee"],  # "Disbursement #NN" = liquidación
                "month": month,
                "entry_date": str(s["entry_date"]) if s["entry_date"] else None,
                "account": s["account"],
                "description": s["account"],
                "wbs_code": s["cost_code"],
                "wbs_title": None,
                "led_amount": float(s["amount"] or 0) if first else 0.0,
                "led_currency": "USD",
                "led_usd": float(s["amount"] or 0) if first else 0.0,
                "led_paid": float(s["amount_paid"] or 0) if first else 0.0,
                "led_due": float(s["amount_due"] or 0) if first else 0.0,
                "status": None,
                "has_invoice": lk is not None,
                "receipt_id": lk["receipt_id"] if lk else None,
                "doc_type": lk["doc_type"] if lk else None,
                "no_invoice": bool(lk["no_invoice"]) if lk else False,
                "invoice_no": lk["invoice_no"] if lk else None,
                "invoice_date": str(lk["invoice_date"]) if lk and lk["invoice_date"] else None,
                "issuer_name": lk["issuer_name"] if lk else None,
                "inv_currency": lk["inv_cur"] if lk else None,
                "inv_total": None,
                "inv_usd": None,
                "note": lk["note"] if lk else None,
            }
            if lk:
                sg = _sign(lk["doc_type"])
                iu = to_usd(lk["inv_total"], lk["inv_cur"])
                row["inv_total"] = (
                    float(lk["inv_total"]) * sg if lk["inv_total"] is not None else None
                )
                row["inv_usd"] = round(iu * sg, 2) if iu is not None else None
            out.append(row)
    return {"rows": out, "count": len(out), "linked": len(attach)}


@router.get("/by-wbs", dependencies=[_can_view])
def invoices_by_wbs(ref_fx: float | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Total de facturas aplicadas por proyecto (WBS), en USD. El monto de cada
    factura se reparte en partes iguales entre los desembolsos que cubre, y se
    suma por el WBS de cada desembolso. Para comparar contra YTD Expense."""
    rows = (
        db.execute(
            text(
                """
                SELECT k.receipt_id, r.currency AS inv_cur, r.total AS inv_total, r.doc_type,
                       w.id AS wbs_id,
                       (SELECT count(*) FROM invoice_receipt_link k2
                         WHERE k2.receipt_id = k.receipt_id) AS nlinks
                FROM invoice_receipt_link k
                JOIN invoice_receipt r ON r.id = k.receipt_id
                JOIN ledger_sheet_row s ON s.id = k.sheet_row_id
                LEFT JOIN wbs_item w ON w.wbs_code = s.cost_code
                """
            )
        )
        .mappings()
        .all()
    )

    def to_usd(total: Any, inv_cur: str | None) -> float | None:
        if total is None:
            return None
        t = float(total)
        if inv_cur == "USD":
            return t
        if ref_fx and ref_fx > 0:
            return t / ref_fx
        return None

    by_wbs: dict[str, float] = {}
    total_usd = 0.0
    missing = 0
    for r in rows:
        usd = to_usd(r["inv_total"], r["inv_cur"])
        if usd is None:
            missing += 1
            continue
        usd *= _sign(r["doc_type"])  # nota de crédito resta
        share = usd / max(1, int(r["nlinks"] or 1))
        key = str(r["wbs_id"]) if r["wbs_id"] is not None else "null"
        by_wbs[key] = round(by_wbs.get(key, 0.0) + share, 2)
        total_usd += share
    return {"by_wbs": by_wbs, "total_usd": round(total_usd, 2), "missing_rate": missing}


@router.get("", dependencies=[_can_view])
def list_receipts(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    # OJO: nunca traer xml_bytes/pdf_bytes acá (van por el endpoint /file).
    rows = (
        db.execute(
            text(
                """
                SELECT r.id, r.received_at, r.email_from, r.email_subject, r.doc_type, r.clave,
                       r.invoice_no, r.issuer_name, r.issuer_id, r.invoice_date, r.currency,
                       r.subtotal, r.tax, r.total, r.xml_filename, r.pdf_filename, r.has_pdf,
                       r.status, r.notes, r.no_invoice,
                       (r.xml_bytes IS NOT NULL) AS has_xml_file,
                       (r.pdf_bytes IS NOT NULL) AS has_pdf_file,
                       r.sp_line_id, l.line_no AS sp_line_no, l.amount AS sp_amount,
                       d.id AS sp_disb_id, d.disb_no AS sp_disb_no, d.disb_sub AS sp_disb_sub,
                       d.period_month AS sp_period_month, d.status AS sp_status
                FROM invoice_receipt r
                LEFT JOIN disbursement_line l ON l.id = r.sp_line_id
                LEFT JOIN disbursement d ON d.id = l.disbursement_id
                ORDER BY r.received_at DESC NULLS LAST, r.id DESC
                """
            )
        )
        .mappings()
        .all()
    )
    # Enlaces (muchos-a-muchos) con sus líneas del LEDGER real (ledger_sheet_row).
    links = (
        db.execute(
            text(
                """
                SELECT k.receipt_id, k.sheet_row_id AS ledger_entry_id, s.invoice_no,
                       s.account AS description, s.amount, s.amount AS amount_usd,
                       'USD' AS currency, s.entry_date, s.payee AS payee_name,
                       NULL AS status
                FROM invoice_receipt_link k
                JOIN ledger_sheet_row s ON s.id = k.sheet_row_id
                ORDER BY s.row_no
                """
            )
        )
        .mappings()
        .all()
    )
    by_receipt: dict[int, list[dict[str, Any]]] = {}
    for lk in links:
        by_receipt.setdefault(lk["receipt_id"], []).append(dict(lk))
    out = []
    for r in rows:
        d = dict(r)
        d["links"] = by_receipt.get(r["id"], [])
        d["linked_total_usd"] = sum(float(x["amount_usd"] or 0) for x in d["links"])
        out.append(d)
    return out


@router.get("/{rid}/file/{kind}", dependencies=[_can_view])
def get_file(rid: int, kind: str, db: Session = Depends(get_db)) -> Response:
    """Devuelve el PDF o el XML guardado de la factura (para ver/descargar)."""
    if kind not in ("pdf", "xml"):
        raise Problem(status_code=404, title="Tipo inválido")
    col = "pdf_bytes" if kind == "pdf" else "xml_bytes"
    name_col = "pdf_filename" if kind == "pdf" else "xml_filename"
    row = db.execute(
        text(f"SELECT {col} AS data, {name_col} AS name FROM invoice_receipt WHERE id = :i"),
        {"i": rid},
    ).first()
    if row is None or row[0] is None:
        raise Problem(status_code=404, title="Archivo no disponible")
    data = bytes(row[0])
    fname = row[1] or f"factura.{kind}"
    media = "application/pdf" if kind == "pdf" else "application/xml"
    # inline para PDF (abre en el navegador), attachment para XML (descarga).
    disp = "inline" if kind == "pdf" else "attachment"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
    )


@router.post("/sync", dependencies=[_can_edit])
def sync(
    full: bool = False,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Trae los comprobantes nuevos. Por defecto mira solo desde el último sync
    (segundos); `full=true` barre todo el buzón (tarda, pero no deja huecos)."""
    if not settings.invoice_mail_configured:
        raise Problem(
            status_code=400,
            title="Buzón no configurado",
            detail="Falta configurar INVOICE_IMAP_USER / INVOICE_IMAP_PASSWORD en el backend.",
        )
    # Arranca en segundo plano y contesta al toque: cada comando IMAP contra
    # Gmail tarda ~10 s desde el servidor y la pantalla no tiene por qué esperar.
    # El resultado se consulta en /status (syncing / last_sync).
    return {"configured": True, **invoice_scheduler.start_job(db, full=full)}


# ---- Pasar una factura al Short Payment abierto -----------------------------


def _open_batch(db: Session, disb_id: int | None = None) -> dict[str, Any] | None:
    """La tanda ABIERTA del Short Payment (el borrador más reciente), o la pedida."""
    where = "d.id = :id" if disb_id else "d.status = 'draft'"
    row = db.execute(
        text(
            f"""
            SELECT d.id, d.disb_no, d.disb_sub, d.period_month, d.send_date, d.status,
                   d.total_amount,
                   (SELECT count(*) FROM disbursement_line l WHERE l.disbursement_id = d.id)
                     AS n_lines
            FROM disbursement d
            WHERE {where}
            ORDER BY d.period_month DESC, d.disb_no DESC, d.disb_sub DESC
            LIMIT 1
            """
        ),
        {"id": disb_id} if disb_id else {},
    ).mappings().first()
    return dict(row) if row else None


@router.get("/open-short-payment", dependencies=[_can_view])
def open_short_payment(db: Session = Depends(get_db)) -> dict[str, Any] | None:
    """Tanda del Short Payment que está abierta (borrador) — a la que va la factura."""
    return _open_batch(db)


def _money(v: Any, cur: str | None) -> str:
    n = float(v or 0)
    sym = "$" if cur == "USD" else "₡" if (cur or "CRC") == "CRC" else ""
    return f"{sym}{n:,.2f}" if sym else f"{n:,.2f} {cur}"


def _merged_desc(r: dict[str, Any]) -> str:
    """Descripción general de la factura: el detalle de sus líneas (del XML),
    o el asunto del correo si no hay XML. Se antepone la fecha de la factura."""
    parts: list[str] = []
    if r.get("xml_bytes"):
        seen: set[str] = set()
        for d in invoice_mail.parse_detalle(bytes(r["xml_bytes"])):
            key = d.lower()
            if key not in seen:
                seen.add(key)
                parts.append(d)
    body = " + ".join(parts) or (r.get("email_subject") or "") or (r.get("issuer_name") or "")
    body = " ".join(body.split())
    if len(body) > 220:
        body = f"{body[:217]}…"
    day = r.get("invoice_date") or (
        r["received_at"].date() if r.get("received_at") else None
    )
    return f"{day} · {body}".strip(" ·") if day else (body or "Invoice")


class ToShortPaymentIn(BaseModel):
    ref_fx: float | None = None  # ₡ por US$ (para facturas en colones)
    disbursement_id: int | None = None  # por defecto, la tanda abierta
    force: bool = False  # re-enviar aunque ya esté / haya una línea con la misma factura


@router.post("/{rid}/to-short-payment", dependencies=[_can_edit, _can_disb], status_code=201)
def to_short_payment(
    rid: int, data: ToShortPaymentIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Agrega la factura como ÚLTIMA línea del Short Payment abierto (borrador).

    Fecha + descripción del comprobante van en la Descripción y Amount = total CON
    impuesto (en USD). Name, Note y Category/Type quedan VACÍOS (los edita el
    usuario en el tab); Transfer = SEND y el banco es el del holding.
    """
    r = db.execute(
        text(
            """
            SELECT r.id, r.doc_type, r.invoice_no, r.issuer_name, r.issuer_id, r.invoice_date,
                   r.received_at, r.email_subject, r.currency, r.subtotal, r.tax, r.total,
                   r.xml_bytes, r.sp_line_id,
                   l.line_no AS sp_line_no, d.disb_no AS sp_disb_no, d.disb_sub AS sp_disb_sub
            FROM invoice_receipt r
            LEFT JOIN disbursement_line l ON l.id = r.sp_line_id
            LEFT JOIN disbursement d ON d.id = l.disbursement_id
            WHERE r.id = :i
            """
        ),
        {"i": rid},
    ).mappings().first()
    if r is None:
        raise Problem(status_code=404, title="Recibo no encontrado")
    if r["sp_line_no"] is not None and not data.force:
        raise Problem(
            status_code=409,
            title="Ya está en un Short Payment",
            detail=(
                f"Esta factura ya se agregó al Disbursement #{r['sp_disb_no']}."
                f"{r['sp_disb_sub']} (línea {r['sp_line_no']})."
            ),
        )

    batch = _open_batch(db, data.disbursement_id)
    if batch is None:
        raise Problem(
            status_code=409,
            title="No hay Short Payment abierto",
            detail="Creá la tanda del mes en el tab Disbursements y volvé a intentar.",
        )
    if batch["status"] != "draft":
        raise Problem(
            status_code=409,
            title="La tanda no está abierta",
            detail=f"El Disbursement #{batch['disb_no']}.{batch['disb_sub']} está en "
            f'"{batch["status"]}"; solo se agregan líneas a un borrador.',
        )

    if r["total"] is None:
        raise Problem(
            status_code=400,
            title="La factura no tiene monto",
            detail="Complete el total de la factura antes de pasarla al Short Payment.",
        )
    cur = r["currency"] or "CRC"
    total = Decimal(r["total"])
    if cur == "USD":
        usd = total
    elif data.ref_fx and data.ref_fx > 0:
        usd = (total / Decimal(str(data.ref_fx))).quantize(Decimal("0.01"))
    else:
        raise Problem(
            status_code=400,
            title="Falta el tipo de cambio",
            detail="Poné el Reference rate (₡ por US$) arriba para convertir la factura a USD.",
        )
    usd = (usd * _sign(r["doc_type"])).quantize(Decimal("0.01"))  # nota de crédito resta

    inv_no = (r["invoice_no"] or "").strip()
    if inv_no and not data.force:
        dup = db.execute(
            text(
                "SELECT line_no FROM disbursement_line "
                "WHERE disbursement_id = :d AND invoice_no = :n LIMIT 1"
            ),
            {"d": batch["id"], "n": inv_no},
        ).first()
        if dup:
            raise Problem(
                status_code=409,
                title="Factura repetida en la tanda",
                detail=f"La línea {dup[0]} de esa tanda ya tiene la factura {inv_no}.",
            )

    # Decisión del owner: la línea llega "limpia" — sin Name y sin Note (los
    # llena él si quiere); el banco lo pone la vista (siempre el del holding).
    line = disb_svc.add_line(
        db,
        batch["id"],
        LineIn(
            description=_merged_desc(dict(r)),
            invoice_no=inv_no or None,
            vendor=r["issuer_name"],  # proveedor de la factura (columna Vendor)
            amount=usd,
            currency="USD",
            transfer="SEND",
        ),
    )
    db.execute(
        text("UPDATE invoice_receipt SET sp_line_id = :l WHERE id = :i"),
        {"l": line.id, "i": rid},
    )
    return {
        "ok": True,
        "disbursement_id": batch["id"],
        "disb_no": batch["disb_no"],
        "disb_sub": batch["disb_sub"],
        "period_month": batch["period_month"],
        "line_id": line.id,
        "line_no": line.line_no,
        "amount_usd": str(usd),
        "description": line.description,
        "invoice_total": f"{_money(total, cur)} (subtotal {_money(r['subtotal'], cur)}"
        f" + VAT {_money(r['tax'], cur)})",
    }


class ReceiptIn(BaseModel):
    invoice_no: str | None = None
    issuer_name: str | None = None
    invoice_date: date | None = None
    currency: str | None = None
    total: Decimal | None = None
    notes: str | None = None


@router.post("", dependencies=[_can_edit], status_code=201)
def create_receipt(data: ReceiptIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    rid = db.execute(
        text(
            """
            INSERT INTO invoice_receipt
              (invoice_no, issuer_name, invoice_date, currency, total, notes, status, created_at)
            VALUES (:no, :iname, :idate, :cur, :total, :notes, 'new', now())
            RETURNING id
            """
        ),
        {
            "no": data.invoice_no,
            "iname": data.issuer_name,
            "idate": data.invoice_date,
            "cur": data.currency,
            "total": data.total,
            "notes": data.notes,
        },
    ).scalar()
    return {"id": rid}


class JustifyIn(BaseModel):
    detail: str
    ledger_entry_ids: list[int]
    amount_usd: Decimal | None = None  # opcional; si no, se toma del/los desembolso(s)


@router.post("/justify", dependencies=[_can_edit], status_code=201)
def justify_payment(data: JustifyIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Justifica una salida de dinero SIN factura (intereses, gobierno, comisiones).
    Crea un 'documento' de justificación y lo aplica a el/los desembolso(s), igual
    que una factura, para que el gasto quede cubierto en la conciliación."""
    if not data.detail.strip():
        raise Problem(status_code=400, title="Falta el detalle")
    if not data.ledger_entry_ids:
        raise Problem(status_code=400, title="Elegí al menos un desembolso")
    ids = list(dict.fromkeys(data.ledger_entry_ids))  # ids de líneas del Ledger
    # Monto: el indicado, o la suma de las líneas del Ledger (en USD).
    if data.amount_usd is not None:
        total = data.amount_usd
    else:
        total = db.execute(
            text("SELECT COALESCE(SUM(amount), 0) FROM ledger_sheet_row WHERE id = ANY(:ids)"),
            {"ids": ids},
        ).scalar()
    rid = db.execute(
        text(
            """
            INSERT INTO invoice_receipt
              (issuer_name, invoice_date, currency, total, notes, no_invoice, status, created_at)
            VALUES (:d, now(), 'USD', :t, :d, true, 'linked', now())
            RETURNING id
            """
        ),
        {"d": data.detail.strip(), "t": total},
    ).scalar()
    for lid in ids:
        db.execute(
            text(
                "INSERT INTO invoice_receipt_link (receipt_id, sheet_row_id) "
                "VALUES (:r, :l) ON CONFLICT DO NOTHING"
            ),
            {"r": rid, "l": lid},
        )
    return {"id": rid, "linked": len(ids), "total_usd": str(total)}


class ReceiptPatch(BaseModel):
    ledger_entry_id: int | None = None
    invoice_no: str | None = None
    notes: str | None = None
    status: str | None = None  # new | linked | ignored


@router.patch("/{rid}", dependencies=[_can_edit])
def update_receipt(rid: int, data: ReceiptPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        return {"ok": True}
    # Al asociar/desasociar el ledger, el status sigue automáticamente salvo override.
    if "ledger_entry_id" in fields and "status" not in fields:
        fields["status"] = "linked" if fields["ledger_entry_id"] else "new"
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    fields["rid"] = rid
    r = db.execute(
        text(f"UPDATE invoice_receipt SET {sets} WHERE id = :rid RETURNING id"), fields
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Recibo no encontrado")
    return {"ok": True}


@router.delete("/{rid}", dependencies=[_can_edit])
def delete_receipt(rid: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    r = db.execute(
        text("DELETE FROM invoice_receipt WHERE id = :i RETURNING id"), {"i": rid}
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Recibo no encontrado")
    return {"ok": True}


@router.get("/{rid}/candidates", dependencies=[_can_view])
def link_candidates(
    rid: int, q: str = "", show_all: bool = False, db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    """Líneas del LEDGER real (ledger_sheet_row) para marcar con check. Por defecto
    solo las que NO tienen factura aplicada (libres) + las ya ligadas a ESTA factura.
    show_all=true trae todas. El 'id' devuelto es el de la línea del Ledger."""
    like = f"%{q.strip()}%"
    rows = (
        db.execute(
            text(
                """
                SELECT s.id, s.entry_date, s.invoice_no, s.account AS description,
                       s.amount, s.amount AS amount_usd, 'USD' AS currency,
                       s.payee AS payee_name, s.cost_code, s.payee AS status,
                       (kh.receipt_id IS NOT NULL) AS linked_here,
                       (ko.sheet_row_id IS NOT NULL) AS linked_other
                FROM ledger_sheet_row s
                LEFT JOIN invoice_receipt_link kh
                       ON kh.sheet_row_id = s.id AND kh.receipt_id = :rid
                LEFT JOIN LATERAL (
                    SELECT sheet_row_id FROM invoice_receipt_link
                    WHERE sheet_row_id = s.id AND receipt_id <> :rid LIMIT 1
                ) ko ON true
                WHERE s.kind = 'data'
                  AND (:q = '' OR s.invoice_no ILIKE :like OR s.account ILIKE :like
                       OR s.cost_code ILIKE :like OR s.payee ILIKE :like
                       OR CAST(s.id AS text) = :q OR CAST(s.amount AS text) ILIKE :like)
                  AND (
                       :show_all
                       OR kh.receipt_id IS NOT NULL
                       OR ko.sheet_row_id IS NULL
                  )
                ORDER BY (kh.receipt_id IS NOT NULL) DESC, s.row_no
                LIMIT 150
                """
            ),
            {"rid": rid, "q": q.strip(), "like": like, "show_all": show_all},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


class LinksIn(BaseModel):
    ledger_entry_ids: list[int]


@router.post("/{rid}/links", dependencies=[_can_edit])
def set_links(rid: int, data: LinksIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Reemplaza el conjunto de desembolsos ligados a esta factura por los marcados."""
    exists = db.execute(
        text("SELECT 1 FROM invoice_receipt WHERE id = :i"), {"i": rid}
    ).first()
    if exists is None:
        raise Problem(status_code=404, title="Recibo no encontrado")
    ids = list(dict.fromkeys(data.ledger_entry_ids))  # dedup (ahora = ids de líneas del Ledger)
    db.execute(text("DELETE FROM invoice_receipt_link WHERE receipt_id = :r"), {"r": rid})
    for lid in ids:
        db.execute(
            text(
                "INSERT INTO invoice_receipt_link (receipt_id, sheet_row_id) "
                "VALUES (:r, :l) ON CONFLICT DO NOTHING"
            ),
            {"r": rid, "l": lid},
        )
    # Estado sigue el enlace, salvo que ya esté 'ignored'.
    db.execute(
        text(
            "UPDATE invoice_receipt SET status = "
            "CASE WHEN status = 'ignored' THEN 'ignored' "
            "     WHEN :n > 0 THEN 'linked' ELSE 'new' END "
            "WHERE id = :r"
        ),
        {"n": len(ids), "r": rid},
    )
    return {"ok": True, "linked": len(ids)}


@router.get("/ledger-options", dependencies=[_can_view])
def ledger_options(q: str = "", db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """Lista compacta de asientos del ledger para el selector de asociación."""
    like = f"%{q.strip()}%"
    rows = (
        db.execute(
            text(
                """
                SELECT l.id, l.entry_date, l.invoice_no, l.description, l.amount_usd,
                       l.status, p.name AS payee_name
                FROM ledger_entry l
                LEFT JOIN payee p ON p.id = l.payee_id
                WHERE (:q = '' OR l.invoice_no ILIKE :like OR l.description ILIKE :like
                       OR p.name ILIKE :like OR CAST(l.id AS text) = :q
                       OR CAST(l.amount AS text) ILIKE :like
                       OR CAST(l.amount_usd AS text) ILIKE :like)
                ORDER BY l.entry_date DESC NULLS LAST, l.id DESC
                LIMIT 50
                """
            ),
            {"q": q.strip(), "like": like},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


# ---- Auto-match: cruzar facturas con desembolsos y aplicar los obvios --------

_STOP = {
    "sa", "srl", "ltda", "limitada", "sociedad", "responsabilidad", "anonima",
    "de", "del", "la", "el", "los", "las", "y", "cr", "inc", "company", "the",
    "s", "a", "l",
}


def _norm(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def _tokens(s: str | None) -> set[str]:
    return {t for t in _norm(s).split() if len(t) >= 3 and t not in _STOP}


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _as_date(v: Any) -> date | None:
    """La fecha del Ledger viene como TEXTO (celda del Excel, ISO tras la mig. 0041)."""
    if v is None or isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


class AutomatchIn(BaseModel):
    ref_fx: float | None = None


def _inv_usd(total: Any, cur: str | None, ref_fx: float | None) -> float | None:
    if total is None:
        return None
    t = float(total)
    if (cur or "CRC") == "USD":
        return t
    if ref_fx and ref_fx > 0:
        return t / ref_fx
    return None


@router.post("/automatch", dependencies=[_can_view])
def automatch(data: AutomatchIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Propone cruces factura↔desembolso (NO escribe). Marca 'auto' los muy
    claros (monto exacto + proveedor + fecha, candidato único) y 'review' los
    dudosos."""
    invoices = (
        db.execute(
            text(
                """
                SELECT r.id, r.issuer_name, r.issuer_id, r.invoice_no, r.invoice_date,
                       r.currency, r.total, r.doc_type
                FROM invoice_receipt r
                WHERE r.status <> 'ignored'
                  AND NOT EXISTS (SELECT 1 FROM invoice_receipt_link k WHERE k.receipt_id = r.id)
                """
            )
        )
        .mappings()
        .all()
    )
    cands = (
        db.execute(
            text(
                """
                SELECT s.id, s.entry_date, s.invoice_no, s.account AS description,
                       s.amount AS amount_usd, s.payee, s.cost_code, s.notes, d.period_month
                FROM ledger_sheet_row s
                LEFT JOIN disbursement d ON d.disb_no = s.src_disb_no
                WHERE s.kind = 'data'
                  AND NOT EXISTS (
                    SELECT 1 FROM invoice_receipt_link k WHERE k.sheet_row_id = s.id
                  )
                """
            )
        )
        .mappings()
        .all()
    )
    cand_list = [dict(c) for c in cands]

    suggestions: list[dict[str, Any]] = []
    auto_claims: dict[int, list[int]] = {}  # ledger_id -> [receipt_id...] que lo reclaman en auto
    for inv in invoices:
        inv_usd = _inv_usd(inv["total"], inv["currency"], data.ref_fx)
        itoks = _tokens(inv["issuer_name"])
        ino = (inv["invoice_no"] or "").strip()
        inv_ym = (
            (inv["invoice_date"].year, inv["invoice_date"].month) if inv["invoice_date"] else None
        )
        scored = []
        amt_ok_count = 0
        amt_month_count = 0  # candidatos que cuadran en monto Y en mes
        for c in cand_list:
            reasons: list[str] = []
            score = 0
            amt_ok = False
            if inv_usd is not None and c["amount_usd"]:
                a = float(c["amount_usd"])
                if abs(inv_usd - a) <= max(1.0, 0.005 * abs(a)):
                    amt_ok = True
                    amt_ok_count += 1
                    score += 3
                    reasons.append("monto")
            ced_ok = False  # el Ledger sheet no trae cédula del proveedor
            # El proveedor de la línea (notes) viaja desde el Short Payment: suma
            # señal cuando la descripción no nombra al emisor.
            ltoks = _tokens(
                (c.get("payee") or "")
                + " "
                + (c["description"] or "")
                + " "
                + (c.get("notes") or "")
            )
            inter = itoks & ltoks
            name_ok = bool(itoks) and len(inter) / len(itoks) >= 0.5
            if name_ok:
                score += 2
                reasons.append("proveedor")
            if ino and (c["invoice_no"] == ino or (c["description"] and ino in c["description"])):
                score += 3
                reasons.append("# factura")
            date_ok = False
            month_ok = False
            cdate = _as_date(c.get("entry_date")) or c.get("period_month")
            if inv["invoice_date"] and cdate:
                # MISMO MES: el desempate que sirve con los recurrentes (12 líneas
                # idénticas de $3,750, una por mes).
                if inv_ym and (cdate.year, cdate.month) == inv_ym:
                    month_ok = True
                    date_ok = True
                    score += 2
                    reasons.append("mismo mes")
                    if amt_ok:
                        amt_month_count += 1
                else:
                    dd = abs((cdate - inv["invoice_date"]).days)
                    if dd <= 92:
                        date_ok = True
                        score += 1
                        reasons.append(f"fecha ±{dd}d")
            if score >= 3:
                scored.append(
                    {"c": c, "score": score, "reasons": reasons, "amt_ok": amt_ok,
                     "payee_ok": (ced_ok or name_ok), "date_ok": date_ok, "month_ok": month_ok}
                )
        if not scored:
            continue
        scored.sort(key=lambda x: x["score"], reverse=True)
        best = scored[0]
        # AUTO en dos casos, siempre con monto exacto y sin notas de crédito:
        #  a) proveedor + fecha y ÚNICO candidato con ese monto (lo de siempre)
        #  b) mismo MES y único candidato con ese monto en ese mes (recurrentes)
        tier = "review"
        is_nc = inv["doc_type"] == "NC"
        if not is_nc and best["amt_ok"] and (
            (best["payee_ok"] and best["date_ok"] and amt_ok_count == 1)
            or (best["month_ok"] and amt_month_count == 1)
        ):
            tier = "auto"
            auto_claims.setdefault(best["c"]["id"], []).append(inv["id"])
        suggestions.append(
            {
                "receipt_id": inv["id"],
                "issuer_name": inv["issuer_name"],
                "invoice_no": inv["invoice_no"],
                "invoice_date": inv["invoice_date"],
                "invoice_total": str(inv["total"]) if inv["total"] is not None else None,
                "invoice_currency": inv["currency"],
                "invoice_usd": round(inv_usd, 2) if inv_usd is not None else None,
                "ledger_entry_id": best["c"]["id"],
                "ledger_desc": best["c"]["description"] or best["c"].get("payee"),
                "ledger_date": best["c"].get("entry_date") or best["c"].get("period_month"),
                "ledger_amount_usd": (
                    str(best["c"]["amount_usd"]) if best["c"]["amount_usd"] is not None else None
                ),
                "reasons": best["reasons"],
                "score": best["score"],
                "tier": tier,
            }
        )
    # Si un mismo desembolso lo reclaman 2+ facturas en auto → todas a review (ambiguo).
    conflicted = {lid for lid, rs in auto_claims.items() if len(rs) > 1}
    for s in suggestions:
        if s["tier"] == "auto" and s["ledger_entry_id"] in conflicted:
            s["tier"] = "review"
    n_auto = sum(1 for s in suggestions if s["tier"] == "auto")
    return {"suggestions": suggestions, "auto": n_auto, "review": len(suggestions) - n_auto}


class ApplyPair(BaseModel):
    receipt_id: int
    ledger_entry_id: int


class ApplyMatchesIn(BaseModel):
    pairs: list[ApplyPair]


@router.post("/automatch/apply", dependencies=[_can_edit])
def apply_matches(data: ApplyMatchesIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Aplica los cruces elegidos: crea el link factura↔desembolso (como manual).
    Salta si el desembolso ya quedó tomado o la factura ya tiene link."""
    applied = 0
    skipped = 0
    for p in data.pairs:
        taken = db.execute(
            text("SELECT 1 FROM invoice_receipt_link WHERE sheet_row_id = :l"),
            {"l": p.ledger_entry_id},
        ).first()
        has = db.execute(
            text("SELECT 1 FROM invoice_receipt_link WHERE receipt_id = :r"),
            {"r": p.receipt_id},
        ).first()
        if taken or has:
            skipped += 1
            continue
        db.execute(
            text(
                "INSERT INTO invoice_receipt_link (receipt_id, sheet_row_id) "
                "VALUES (:r, :l) ON CONFLICT DO NOTHING"
            ),
            {"r": p.receipt_id, "l": p.ledger_entry_id},
        )
        db.execute(
            text("UPDATE invoice_receipt SET status = 'linked' WHERE id = :r"),
            {"r": p.receipt_id},
        )
        applied += 1
    return {"applied": applied, "skipped": skipped}
