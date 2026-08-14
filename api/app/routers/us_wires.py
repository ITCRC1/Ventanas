"""US Wire Transfers — control de los aportes de los dueños al proyecto (espejo del Excel).

Datos bancarios sensibles → tras bank.view.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_db
from app.models.us_wire import UsWireRow
from app.schemas.us_wire import UsWireIn, UsWireUpdate


class LafiseBalanceIn(BaseModel):
    lafise_balance: Decimal | None

router = APIRouter(
    prefix="/us-wires",
    tags=["us-wires"],
    dependencies=[Depends(require_permission("bank.view"))],
)


def _out(r: UsWireRow) -> dict[str, Any]:
    return {
        "id": r.id,
        "block": r.block,
        "trans_label": r.trans_label,
        "wire_date": r.wire_date.isoformat() if r.wire_date else None,
        "sender": r.sender,
        "from_party": r.from_party,
        "to_party": r.to_party,
        "account_number": r.account_number,
        "amount_received": str(r.amount_received) if r.amount_received is not None else "0",
        "amount_sent": str(r.amount_sent) if r.amount_sent is not None else None,
        "notas": r.notas,
    }


@router.get("")
def list_us_wires(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = list(db.execute(select(UsWireRow).order_by(UsWireRow.sort_order, UsWireRow.id)).scalars())
    running = Decimal(0)
    out: list[dict[str, Any]] = []
    block_totals: dict[str, Decimal] = {}
    for r in rows:
        amt = r.amount_received or Decimal(0)
        running += amt
        block_totals[r.block] = block_totals.get(r.block, Decimal(0)) + amt
        out.append(
            {
                "id": r.id,
                "block": r.block,
                "trans_label": r.trans_label,
                "wire_date": r.wire_date.isoformat() if r.wire_date else None,
                "sender": r.sender,
                "from_party": r.from_party,
                "to_party": r.to_party,
                "account_number": r.account_number,
                "amount_received": str(amt),
                "amount_sent": str(r.amount_sent) if r.amount_sent is not None else None,
                "notas": r.notas,
                "running_balance": str(running),
            }
        )
    bal = db.execute(text("SELECT lafise_balance FROM settings LIMIT 1")).scalar()
    return {
        "rows": out,
        "total_received": str(running),
        "block_totals": {k: str(v) for k, v in block_totals.items()},
        "lafise_balance": str(bal) if bal is not None else None,
    }


@router.put("/lafise-balance")
def set_lafise_balance(data: LafiseBalanceIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    db.execute(
        text("UPDATE settings SET lafise_balance = :b"), {"b": data.lafise_balance}
    )
    return {"lafise_balance": str(data.lafise_balance) if data.lafise_balance is not None else None}


@router.post("", status_code=201)
def create_us_wire(data: UsWireIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    max_order = db.execute(select(func.max(UsWireRow.sort_order))).scalar() or 0
    row = UsWireRow(**data.model_dump(), sort_order=int(max_order) + 1)
    db.add(row)
    db.flush()
    db.refresh(row)
    return _out(row)


@router.patch("/{row_id}")
def update_us_wire(row_id: int, data: UsWireUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(UsWireRow, row_id)
    if row is None:
        raise Problem(status_code=404, title="Transferencia no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.flush()
    return _out(row)


@router.delete("/{row_id}", status_code=204)
def delete_us_wire(row_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(UsWireRow, row_id)
    if row is None:
        raise Problem(status_code=404, title="Transferencia no encontrada")
    db.delete(row)
    db.flush()
