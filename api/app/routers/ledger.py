"""Ledger — registrar compromisos y pagos."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_current_user, get_db
from app.models.ledger import LedgerEntry
from app.repositories import ledger as repo
from app.repositories import schedule as sched_repo
from app.routers import invoice_receipts
from app.schemas.ledger import (
    ImportDisbursement,
    LedgerIn,
    LedgerLinePatch,
    LedgerOut,
    LedgerSheetPatch,
    LedgerUpdate,
    PaymentIn,
)
from app.services import ledger as service

router = APIRouter(prefix="/ledger", tags=["ledger"], dependencies=[Depends(get_current_user)])

_can_edit = Depends(require_permission("ledger.edit"))
_can_report = Depends(require_permission("report.view"))

# Columnas de texto editables del LEDGER (whitelist para el UPDATE dinámico).
_TEXT_FIELDS = (
    "entry_date", "invoice_no", "payee", "description", "paid_total",
    "date_paid", "payment_info", "bank_paid_from", "request", "notes",
)  # fmt: skip


@router.get("", response_model=list[LedgerOut])
def list_ledger(
    status: str | None = None,
    wbs_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[LedgerEntry]:
    return repo.list_entries(db, status=status, wbs_id=wbs_id, limit=limit, offset=offset)


@router.get("/sheet", dependencies=[_can_report])
def ledger_sheet(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """El LEDGER completo: histórico del Excel + los Short Payments importados a
    demanda (POST /ledger/import-disbursement). Todas las filas son editables
    (Cost Code → Account, Amount Paid → varianza)."""
    rows = (
        db.execute(
            text(
                "SELECT r.*, p.label AS payment_label "
                "FROM ledger_sheet_row r "
                "LEFT JOIN ledger_payment p ON p.id = r.payment_id "
                "ORDER BY r.row_no"
            )
        )
        .mappings()
        .all()
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        row["editable"] = row["kind"] == "data"
        row["line_id"] = None
        out.append(row)
    return out


@router.get("/payments", dependencies=[_can_report])
def list_payments(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """Pagos en cuotas: total, asignado (suma de cuotas ligadas) y saldo."""
    rows = db.execute(
        text("""
            SELECT p.id, p.label, p.total_amount, p.notes,
                   COALESCE(SUM(r.amount), 0)                    AS allocated,
                   p.total_amount - COALESCE(SUM(r.amount), 0)   AS remaining,
                   COUNT(r.id)                                   AS installments
            FROM ledger_payment p
            LEFT JOIN ledger_sheet_row r ON r.payment_id = p.id
            GROUP BY p.id
            ORDER BY p.label
        """)
    ).mappings().all()
    return [dict(r) for r in rows]


@router.post("/payments", status_code=201, dependencies=[_can_edit])
def create_payment(data: PaymentIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Crea un pago (con su total) para repartir en cuotas entre Disbursements."""
    pid = db.execute(
        text(
            "INSERT INTO ledger_payment (label, total_amount, notes) "
            "VALUES (:l, :t, :n) RETURNING id"
        ),
        {"l": data.label, "t": data.total_amount, "n": data.notes},
    ).scalar()
    db.commit()
    return {"id": pid, "label": data.label}


@router.post("/import-disbursement", dependencies=[_can_edit])
def import_disbursement(data: ImportDisbursement, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Trae al LEDGER las líneas del Short Payment con ese # de Disbursement.

    Idempotente y NO destructivo: cada línea se ACTUALIZA en su fila (o se crea
    si es nueva), así que re-importar conserva lo que se trabajó en el Ledger —
    Cost Code asignado a mano, Amount Paid y facturas aplicadas. Solo se borran
    las filas de una línea que ya no existe en el Short Payment (y nunca si
    tiene factura). El histórico del Excel (source='excel') no se toca.
    """
    disbs = (
        db.execute(
            text(
                "SELECT id, disb_no, send_date FROM disbursement "
                "WHERE disb_no = :n ORDER BY disb_sub"
            ),
            {"n": data.disb_no},
        )
        .mappings()
        .all()
    )
    if not disbs:
        raise Problem(
            status_code=404,
            title="Short Payment no encontrado",
            detail=f"No existe un Disbursement #{data.disb_no} en Short Payments.",
        )

    from_excel = db.execute(
        text("SELECT count(*) FROM ledger_sheet_row WHERE src_disb_no = :n AND source = 'excel'"),
        {"n": data.disb_no},
    ).scalar_one()
    # Filas que ya trajo este botón, por línea de origen.
    existing: dict[int, int] = {
        r[0]: r[1]
        for r in db.execute(
            text(
                "SELECT src_line_id, id FROM ledger_sheet_row "
                "WHERE src_disb_no = :n AND source = 'import' AND src_line_id IS NOT NULL"
            ),
            {"n": data.disb_no},
        ).all()
    }
    # Las filas nuevas entran al FINAL de la sección "Ledger", NO al final de la
    # hoja: si no, caen debajo de las secciones de cierre del Excel (Service
    # Done/Not Posted, Estimates & Quotes…) y el mes aparece dentro de ellas.
    next_row = int(
        db.execute(
            text(
                "SELECT COALESCE(MAX(row_no), 0) FROM ledger_sheet_row "
                "WHERE kind = 'data' AND section = 'Ledger'"
            )
        ).scalar()
        or 0
    )
    imported = 0
    updated = 0
    seen_lines: list[int] = []
    for d in disbs:
        sd = d["send_date"]
        # Etiqueta como en el Excel ("Disbursement #26 - 08/01/2026"); la fecha
        # que usa el motor va aparte, en ISO.
        label = f"Disbursement #{d['disb_no']}" + (f" - {sd.strftime('%m/%d/%Y')}" if sd else "")
        lines = (
            db.execute(
                text(
                    # WBS de la línea, o si es RECURRENTE, el WBS del recurrente
                    # (auto-asigna el # de proyecto a los recurrentes; los demás quedan
                    # en blanco para asignar a mano).
                    "SELECT dl.id, dl.description, dl.invoice_no, dl.vendor, dl.amount, "
                    "       dl.amount_paid, w.wbs_code, w.title "
                    "FROM disbursement_line dl "
                    "LEFT JOIN recurring_item ri ON ri.id = dl.recurring_id "
                    "LEFT JOIN wbs_item w ON w.id = COALESCE(dl.wbs_id, ri.wbs_id) "
                    "WHERE dl.disbursement_id = :id ORDER BY dl.line_no"
                ),
                {"id": d["id"]},
            )
            .mappings()
            .all()
        )
        for ln in lines:
            seen_lines.append(ln["id"])
            params = {
                "cc": ln["wbs_code"],
                "ac": ln["title"],
                "pe": label,
                "de": ln["description"],
                "inv": ln["invoice_no"],
                # ISO: es la fecha que usan el auto-match (mismo mes) y los reportes.
                "dt": sd.isoformat() if sd else None,
                "am": ln["amount"],
                "src": data.disb_no,
                # El proveedor de la factura ayuda a cruzar después.
                "nt": ln["vendor"],
                "sl": ln["id"],
            }
            row_id = existing.get(ln["id"])
            if row_id is not None:
                # Actualiza en el sitio: NO pisa el Cost Code ni el Amount Paid
                # que se hayan trabajado en el Ledger.
                db.execute(
                    text("""
                        UPDATE ledger_sheet_row SET
                          cost_code  = COALESCE(cost_code, :cc),
                          account    = COALESCE(account, :ac),
                          payee      = :pe,
                          description = :de,
                          invoice_no = COALESCE(:inv, invoice_no),
                          entry_date = :dt,
                          amount     = :am,
                          amount_due = :am - COALESCE(amount_paid, 0),
                          notes      = COALESCE(notes, :nt)
                        WHERE id = :id
                    """),
                    {**params, "id": row_id},
                )
                updated += 1
            else:
                next_row += 1
                imported += 1
                # Hace lugar: todo lo que va después (las secciones de cierre)
                # corre una posición para que el mes quede DENTRO del Ledger.
                db.execute(
                    text("UPDATE ledger_sheet_row SET row_no = row_no + 1 WHERE row_no >= :rn"),
                    {"rn": next_row},
                )
                db.execute(
                    text("""
                        INSERT INTO ledger_sheet_row
                          (row_no, section, kind, cost_code, account, payee, description,
                           invoice_no, entry_date, amount, amount_paid, amount_due, src_disb_no,
                           source, notes, src_line_id)
                        VALUES
                          (:rn, 'Ledger', 'data', :cc, :ac, :pe, :de,
                           :inv, :dt, :am, :ap, :ad, :src, 'import', :nt, :sl)
                    """),
                    {
                        **params,
                        "rn": next_row,
                        "ap": ln["amount_paid"],
                        "ad": (
                            (ln["amount"] - ln["amount_paid"]) if ln["amount"] is not None else None
                        ),
                    },
                )
    # Líneas borradas del Short Payment: su fila se va, salvo que tenga factura.
    stale = db.execute(
        text(
            "DELETE FROM ledger_sheet_row s "
            "WHERE s.src_disb_no = :n AND s.source = 'import' "
            "  AND (s.src_line_id IS NULL OR NOT (s.src_line_id = ANY(:ids))) "
            "  AND NOT EXISTS (SELECT 1 FROM invoice_receipt_link k WHERE k.sheet_row_id = s.id)"
        ),
        {"n": data.disb_no, "ids": seen_lines or [0]},
    ).rowcount
    db.commit()
    return {
        "ok": True,
        "disb_no": data.disb_no,
        "imported": imported,  # filas nuevas
        "updated": updated,  # filas que ya estaban y se refrescaron
        "removed": stale,  # líneas que ya no existen en el Short Payment
        "kept_from_excel": from_excel,
    }


@router.post("/deploy-to-jobcost", dependencies=[_can_edit])
def deploy_to_jobcost(data: ImportDisbursement, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Despliega un Short Payment (ya en el Ledger) al cronograma del Job Cost:
    agrupa las filas del Ledger por WBS y coloca el monto en la 3ª semana del mes
    del disbursement. Si ese mes YA tiene monto para ese WBS (en otra semana),
    avisa y NO coloca nada (para mover lo viejo al futuro primero)."""
    disb = (
        db.execute(
            text(
                "SELECT period_month, send_date FROM disbursement "
                "WHERE disb_no = :n ORDER BY disb_sub LIMIT 1"
            ),
            {"n": data.disb_no},
        )
        .mappings()
        .first()
    )
    if disb is None:
        raise Problem(status_code=404, title=f"No existe el Disbursement #{data.disb_no}.")
    month_date = disb["send_date"] or disb["period_month"]

    # Filas del Ledger de este Short Payment con Cost Code (WBS) asignado → suma por WBS.
    rows = (
        db.execute(
            text(
                "SELECT w.id AS wbs_id, w.wbs_code, COALESCE(SUM(r.amount), 0) AS amount "
                "FROM ledger_sheet_row r JOIN wbs_item w ON w.wbs_code = r.cost_code "
                "WHERE r.src_disb_no = :n AND r.cost_code IS NOT NULL AND r.cost_code <> '' "
                "GROUP BY w.id, w.wbs_code"
            ),
            {"n": data.disb_no},
        )
        .mappings()
        .all()
    )
    if not rows:
        return {
            "placed": 0,
            "conflicts": [],
            "message": "No hay filas con Cost Code (WBS) asignado en el Ledger para desplegar.",
        }

    # 3ª semana (lunes) del mes del disbursement, dentro del horizonte del cronograma.
    start, end = sched_repo.week_bounds(db)
    weeks = sched_repo.contiguous_weeks(start, end)
    month_weeks = [
        w for w in weeks if w.year == month_date.year and w.month == month_date.month
    ]
    if not month_weeks:
        raise Problem(
            status_code=422,
            title="Mes fuera del cronograma",
            detail=f"El mes {month_date:%m/%Y} no está en el horizonte del cronograma.",
        )
    third = month_weeks[2] if len(month_weeks) >= 3 else month_weeks[-1]
    # Rango del mes (sin castear en SQL) para el chequeo de conflicto.
    month_start = date(month_date.year, month_date.month, 1)
    month_end = (
        date(month_date.year + 1, 1, 1)
        if month_date.month == 12
        else date(month_date.year, month_date.month + 1, 1)
    )

    # Conflicto: montos ya presentes en ese mes para ese WBS, en OTRA semana (no la 3ª).
    conflicts: list[dict[str, Any]] = []
    for r in rows:
        existing = (
            db.execute(
                text(
                    "SELECT week_start, planned_amount FROM schedule_cell "
                    "WHERE wbs_id = :w AND planned_amount IS NOT NULL AND planned_amount <> 0 "
                    "AND week_start >= :ms AND week_start < :me AND week_start <> :third"
                ),
                {"w": r["wbs_id"], "ms": month_start, "me": month_end, "third": third},
            )
            .mappings()
            .all()
        )
        if existing:
            conflicts.append(
                {
                    "wbs_code": r["wbs_code"],
                    "weeks": [str(e["week_start"]) for e in existing],
                    "total": str(sum((e["planned_amount"] for e in existing), 0)),
                }
            )
    if conflicts:
        return {"placed": 0, "week": str(third), "conflicts": conflicts}

    # Sin conflicto → colocar cada WBS en la 3ª semana (sobrescribe la 3ª si ya estaba).
    state_id = int(
        db.execute(text("SELECT id FROM task_state ORDER BY sort_order, id LIMIT 1")).scalar() or 1
    )
    for r in rows:
        exists = db.execute(
            text("SELECT 1 FROM schedule_cell WHERE wbs_id = :w AND week_start = :wk"),
            {"w": r["wbs_id"], "wk": third},
        ).first()
        params = {"w": r["wbs_id"], "wk": third, "amt": r["amount"], "st": state_id}
        if exists:
            db.execute(
                text(
                    "UPDATE schedule_cell SET planned_amount = :amt, state_id = :st "
                    "WHERE wbs_id = :w AND week_start = :wk"
                ),
                params,
            )
        else:
            db.execute(
                text(
                    "INSERT INTO schedule_cell (wbs_id, week_start, planned_amount, state_id) "
                    "VALUES (:w, :wk, :amt, :st)"
                ),
                params,
            )
    db.commit()
    return {"placed": len(rows), "week": str(third), "conflicts": []}


class RunMonth(BaseModel):
    disb_no: int
    apply_matches: bool = True  # aplica los cruces "seguros" (monto+mes únicos)


@router.post("/run-month", dependencies=[_can_edit])
def run_month(data: RunMonth, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Corre el mes de una sola vez: Ledger → Job Cost → cruce de facturas.

    Cada paso es el mismo que hacen los botones sueltos (mismas reglas y
    resguardos), encadenados y con un parte de lo que pasó. Se puede repetir: el
    import actualiza en el sitio, el deploy reescribe la 3ª semana y el cruce
    salta lo que ya está tomado.
    """
    steps: dict[str, Any] = {}

    # 1) Short Payment → Ledger (upsert; no pisa lo trabajado ni el histórico).
    steps["ledger"] = import_disbursement(ImportDisbursement(disb_no=data.disb_no), db)

    # Líneas sin nº de proyecto: no pueden ir al Job Cost (las asigna el usuario).
    missing = db.execute(
        text(
            "SELECT count(*) FROM ledger_sheet_row WHERE src_disb_no = :n AND source = 'import' "
            "  AND (cost_code IS NULL OR cost_code = '')"
        ),
        {"n": data.disb_no},
    ).scalar_one()
    steps["missing_cost_codes"] = int(missing)

    # 2) Ledger → cronograma del Job Cost (toma cualquier proyecto, nuevo o viejo).
    steps["jobcost"] = deploy_to_jobcost(ImportDisbursement(disb_no=data.disb_no), db)

    # 3) Facturas: propone cruces y aplica solo los seguros.
    ref = db.execute(text("SELECT invoice_ref_fx FROM settings LIMIT 1")).scalar()
    sug = invoice_receipts.automatch(
        invoice_receipts.AutomatchIn(ref_fx=float(ref) if ref is not None else None), db
    )
    autos = [s for s in sug["suggestions"] if s["tier"] == "auto"]
    applied = {"applied": 0, "skipped": 0}
    if data.apply_matches and autos:
        applied = invoice_receipts.apply_matches(
            invoice_receipts.ApplyMatchesIn(
                pairs=[
                    invoice_receipts.ApplyPair(
                        receipt_id=s["receipt_id"], ledger_entry_id=s["ledger_entry_id"]
                    )
                    for s in autos
                ]
            ),
            db,
        )
    steps["invoices"] = {
        "auto": len(autos),
        "review": sug["review"],
        "applied": applied["applied"],
        "skipped": applied["skipped"],
    }
    db.commit()
    return {"ok": True, "disb_no": data.disb_no, **steps}


@router.patch("/sheet/{row_id}", dependencies=[_can_edit])
def update_sheet_row(
    row_id: int, data: LedgerSheetPatch, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Corrige una fila del histórico del LEDGER: Cost Code (WBS → Account
    automático) y/o Amount Paid (→ Amount Due = Amount − Amount Paid)."""
    sets: list[str] = []
    params: dict[str, Any] = {"id": row_id}
    if data.wbs_id is not None:
        w = db.execute(
            text("SELECT wbs_code, title FROM wbs_item WHERE id = :w"), {"w": data.wbs_id}
        ).first()
        if w is None:
            raise Problem(status_code=404, title="WBS no encontrado")
        sets += ["cost_code = :cc", "account = :ac"]
        params["cc"], params["ac"] = w.wbs_code, w.title
    if data.amount_paid is not None:
        sets += ["amount_paid = :ap", "amount_due = amount - :ap"]
        params["ap"] = data.amount_paid
    if data.payment_id is not None:
        # 0 = desligar (NULL); otro valor = ligar la cuota a ese pago
        sets.append("payment_id = :pmt")
        params["pmt"] = data.payment_id or None
    # Campos de texto editables (proveedor, fecha, descripción, etc.). Solo los
    # enviados; vacío → NULL. Nombres desde el modelo (no hay inyección).
    sent = data.model_dump(exclude_unset=True)
    for col in _TEXT_FIELDS:
        if col in sent:
            sets.append(f"{col} = :{col}")  # noqa: S608 — col viene de whitelist
            params[col] = sent[col] or None
    if not sets:
        raise Problem(status_code=400, title="Nada que actualizar")
    updated = db.execute(
        text(f"UPDATE ledger_sheet_row SET {', '.join(sets)} WHERE id = :id RETURNING id"),  # noqa: S608
        params,
    ).first()
    if updated is None:
        raise Problem(status_code=404, title="Fila no encontrada")
    db.commit()
    return {"ok": True}


@router.patch("/line/{line_id}", dependencies=[_can_edit])
def update_ledger_line(
    line_id: int, data: LedgerLinePatch, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Edita una línea reflejada del Short Payment desde el LEDGER: Amount Paid
    (pago real) y/o el WBS (Cost Code → Account automático)."""
    sets: list[str] = []
    params: dict[str, Any] = {"id": line_id}
    if data.amount_paid is not None:
        sets.append("amount_paid = :amount_paid")
        params["amount_paid"] = data.amount_paid
    if data.wbs_id is not None:
        sets.append("wbs_id = :wbs_id")
        params["wbs_id"] = data.wbs_id
    if not sets:
        raise Problem(status_code=400, title="Nada que actualizar")
    updated = db.execute(
        text(f"UPDATE disbursement_line SET {', '.join(sets)} WHERE id = :id RETURNING id"),  # noqa: S608
        params,
    ).first()
    if updated is None:
        raise Problem(status_code=404, title="Línea no encontrada")
    db.commit()
    return {"ok": True}


@router.get("/{entry_id}", response_model=LedgerOut)
def get_entry(entry_id: int, db: Session = Depends(get_db)) -> LedgerEntry:
    entry = repo.get_entry(db, entry_id)
    if entry is None:
        raise Problem(status_code=404, title="Asiento no encontrado")
    return entry


@router.post("", response_model=LedgerOut, status_code=201, dependencies=[_can_edit])
def create_entry(data: LedgerIn, db: Session = Depends(get_db)) -> LedgerEntry:
    return service.create_entry(db, data)


@router.patch("/{entry_id}", response_model=LedgerOut, dependencies=[_can_edit])
def update_entry(entry_id: int, data: LedgerUpdate, db: Session = Depends(get_db)) -> LedgerEntry:
    return service.update_entry(db, entry_id, data)
