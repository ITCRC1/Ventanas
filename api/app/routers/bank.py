"""Bancos, wires y comisiones. Todo tras bank.view (datos bancarios sensibles)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import CurrentUser, get_current_user, get_db
from app.models.bank import BankAccount, WireFee, WireTransfer
from app.repositories import bank as repo
from app.repositories import bank_recon as rrepo
from app.schemas.bank import (
    ApplyMatchesIn,
    BankAccountOut,
    ClassifyIn,
    ReconcileIn,
    TxUpdate,
    UsWireRow,
    WireFeeIn,
    WireFeeOut,
    WireIn,
    WireOut,
    WireUpdate,
)
from app.services import bank as svc
from app.services import bank_recon as rsvc

router = APIRouter(
    prefix="/bank",
    tags=["bancos"],
    dependencies=[Depends(require_permission("bank.view"))],
)


@router.get("/accounts", response_model=list[BankAccountOut])
def accounts(db: Session = Depends(get_db)) -> list[BankAccount]:
    return repo.list_accounts(db)


@router.get("/statement")
def statement(account_id: int, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.statement(db, account_id)


# --- Wires ------------------------------------------------------------------


@router.get("/wires", response_model=list[WireOut])
def list_wires(db: Session = Depends(get_db)) -> list[WireTransfer]:
    return repo.list_wires(db)


@router.get("/us-wire-transfers", response_model=list[UsWireRow])
def us_wire_transfers(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """Registro 'US Wire Transfers' del Excel: wires + saldo corrido al pie."""
    return repo.us_wire_transfers(db)


@router.post("/wires", response_model=WireOut, status_code=201)
def create_wire(data: WireIn, db: Session = Depends(get_db)) -> WireTransfer:
    return svc.create_wire(db, data)


@router.patch("/wires/{wire_id}", response_model=WireOut)
def update_wire(wire_id: int, data: WireUpdate, db: Session = Depends(get_db)) -> WireTransfer:
    return svc.update_wire(db, wire_id, data)


@router.get("/wires/{wire_id}/fees", response_model=list[WireFeeOut])
def wire_fees(wire_id: int, db: Session = Depends(get_db)) -> list[WireFee]:
    return repo.wire_fees(db, wire_id)


@router.post("/wires/{wire_id}/fees", response_model=WireFeeOut, status_code=201)
def add_fee(wire_id: int, data: WireFeeIn, db: Session = Depends(get_db)) -> WireFee:
    return svc.add_fee(db, wire_id, data)


@router.post("/wires/{wire_id}/absorb")
def absorb(wire_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    diff = svc.absorb_difference(db, wire_id)
    return {"absorbed": str(diff)}


# --- Conciliación (vistas, SQL crudo) ---------------------------------------


@router.get("/reconciliation")
def reconciliation(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.reconciliation(db)


@router.get("/pending")
def pending(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.pending(db)


@router.get("/fees")
def fees(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.fees_summary(db)


@router.get("/fees-by-year")
def fees_by_year(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.fees_by_year(db)


@router.get("/charges-monthly")
def charges_monthly(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.charges_monthly(db)


@router.get("/charges-pending")
def charges_pending(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.charges_pending(db)


# --- Bandeja de sin clasificar ----------------------------------------------


@router.get("/movement-classes")
def movement_classes(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.movement_classes(db)


@router.get("/unclassified")
def unclassified(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return repo.unclassified(db)


@router.patch("/tx/{tx_id}/classify")
def classify_tx(
    tx_id: int, data: ClassifyIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    if not repo.class_exists(db, data.class_code):
        raise Problem(status_code=422, title="Tipo de movimiento inválido")
    tx = repo.classify_tx(db, tx_id, data.class_code)
    if tx is None:
        raise Problem(status_code=404, title="Movimiento no encontrado")
    return tx


@router.patch("/tx/{tx_id}")
def update_tx(tx_id: int, data: TxUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Edita los INPUTS de un movimiento bancario (monto, fecha, descripción, cuenta, tipo)."""
    fields = data.model_dump(exclude_unset=True)
    if "account_id" in fields and not repo.account_exists(db, fields["account_id"]):
        raise Problem(status_code=422, title="Cuenta bancaria inválida")
    if (
        "class_code" in fields
        and fields["class_code"] is not None
        and not repo.class_exists(db, fields["class_code"])
    ):
        raise Problem(status_code=422, title="Tipo de movimiento inválido")
    tx = repo.update_tx(db, tx_id, fields)
    if tx is None:
        raise Problem(status_code=404, title="Movimiento no encontrado")
    return tx


# --- Conciliación bancaria: estado de cuenta LAFISE ↔ Ledger ----------------


@router.post("/statements/import")
async def import_statement(
    file: Annotated[UploadFile, File()],
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Sube un estado de cuenta LAFISE (PDF, CSV o .xls) y carga los movimientos
    nuevos (idempotente). Cada movimiento se auto-clasifica por reglas."""
    raw = await file.read()
    return rsvc.import_statement(db, file.filename or "estado", raw, user.username)


@router.get("/statements")
def statements(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """Histórico de estados de cuenta subidos."""
    return rrepo.list_statements(db)


@router.get("/reconciliation/log")
def reconciliation_log(
    account_id: int | None = None,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Log extendido: cada movimiento del banco con su pago del Ledger, factura,
    proveedor y # de Short Payment, más el estado de conciliación.

    OJO: la ruta es `/reconciliation/log` — `/reconciliation` (exacta) ya la usa la
    conciliación de wires (v_wire_reconciliation) definida más arriba."""
    acc = account_id or rrepo.default_account(db)
    if acc is None:
        return {"account_id": None, "rows": []}
    rows = rrepo.reconciliation_log(db, acc, date_from, date_to)
    return {"account_id": acc, "rows": rows}


@router.get("/reconciliation/candidates")
def reconciliation_candidates(
    tx_id: int, db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    """Filas del Ledger que podrían corresponder al movimiento (mismo monto, sin conciliar)."""
    tx = rrepo.get_tx(db, tx_id)
    if tx is None:
        raise Problem(status_code=404, title="Movimiento no encontrado")
    target = tx["debit"] or tx["credit"] or Decimal(0)
    return rrepo.candidates(db, tx_id, Decimal(target))


@router.post("/tx/{tx_id}/reconcile")
def reconcile_tx(
    tx_id: int, data: ReconcileIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Liga (o desliga, con sheet_row_id=null) un movimiento a una fila del Ledger."""
    if data.sheet_row_id is not None and not rrepo.sheet_row_exists(db, data.sheet_row_id):
        raise Problem(status_code=422, title="La fila del Ledger no existe")
    row = rrepo.set_recon(db, tx_id, data.sheet_row_id, data.note)
    if row is None:
        raise Problem(status_code=404, title="Movimiento no encontrado")
    return row


@router.post("/reconciliation/automatch")
def reconciliation_automatch(
    account_id: int | None = None, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Propone cruces por monto/fecha/# de factura (read-only)."""
    acc = account_id or rrepo.default_account(db)
    if acc is None:
        return {"auto": [], "review": [], "pending": 0}
    return rsvc.automatch(db, acc)


@router.post("/reconciliation/automatch/apply")
def reconciliation_apply(data: ApplyMatchesIn, db: Session = Depends(get_db)) -> dict[str, int]:
    """Aplica los cruces confirmados."""
    pairs = [{"tx_id": p.tx_id, "sheet_row_id": p.sheet_row_id} for p in data.pairs]
    return {"applied": rsvc.apply_matches(db, pairs)}


@router.get("/fees/recap")
def fees_recap(
    account_id: int | None = None,
    asof: date | None = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Recap MTD y YTD de comisiones e intereses del banco."""
    acc = account_id or rrepo.default_account(db)
    if acc is None:
        return {"account_id": None}
    if asof is None:
        asof = db.execute(
            text("SELECT MAX(tx_date) FROM bank_tx WHERE account_id = :a"),
            {"a": acc},
        ).scalar_one_or_none() or date.today()
    out = rrepo.fees_recap(db, acc, asof)
    out["account_id"] = acc
    return out
