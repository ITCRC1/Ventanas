"""Lógica de bancos y wires.

La ecuación enviado − comisiones = recibido la valida un CONSTRAINT TRIGGER
DEFERRED (wire_fees_balance). Se fuerza IMMEDIATE tras el flush para devolver el
error de forma síncrona (mismo patrón que credit_not_overdrawn).
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.models.bank import WireFee, WireTransfer
from app.repositories import bank as repo
from app.schemas.bank import WireFeeIn, WireIn, WireUpdate


def create_wire(db: Session, data: WireIn) -> WireTransfer:
    wire = WireTransfer(**data.model_dump())
    db.add(wire)
    db.flush()
    # received_not_over_sent (CHECK) + wire_fees_balance (deferred) se validan;
    # forzamos para error síncrono si amount_received > amount_sent, etc.
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.refresh(wire)
    return wire


def _require(db: Session, wire_id: int) -> WireTransfer:
    wire = repo.get_wire(db, wire_id)
    if wire is None:
        raise Problem(status_code=404, title="Wire no encontrado")
    return wire


def update_wire(db: Session, wire_id: int, data: WireUpdate) -> WireTransfer:
    wire = _require(db, wire_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(wire, field, value)
    db.flush()
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.refresh(wire)
    return wire


def add_fee(db: Session, wire_id: int, data: WireFeeIn) -> WireFee:
    _require(db, wire_id)
    fee = WireFee(wire_id=wire_id, **data.model_dump())
    db.add(fee)
    db.flush()
    # wire_fees_balance rechaza asignar más comisión que la diferencia real.
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    return fee


def absorb_difference(db: Session, wire_id: int, fee_type: str = "unidentified") -> Decimal:
    """Registra toda la diferencia sin explicar como una comisión estimada."""
    _require(db, wire_id)
    diff = db.execute(
        text("SELECT wire_absorb_difference(:w, :t)"),
        {"w": wire_id, "t": fee_type},
    ).scalar_one()
    db.flush()
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    return Decimal(str(diff or 0))
