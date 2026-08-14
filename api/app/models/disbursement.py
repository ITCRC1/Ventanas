"""Desembolsos (Short Payment) — §7, §8, §11b del esquema.

Los totales los mantiene la base por trigger (disb_recalc_total, sync_credit_applied);
los estados bloqueados (approved+) los protege disb_lines_locked. La app no recalcula.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class DisbStatus(Base):
    __tablename__ = "disb_status"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Payee(Base):
    __tablename__ = "payee"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    legal_id: Mapped[str | None] = mapped_column(Text)
    bank_name: Mapped[str | None] = mapped_column(Text)
    iban: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, default="USD")
    is_international: Mapped[bool] = mapped_column(Boolean, default=False)
    default_category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    default_phase_id: Mapped[int | None] = mapped_column(ForeignKey("phase.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class RecurringItem(Base):
    __tablename__ = "recurring_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    payee_id: Mapped[int] = mapped_column(ForeignKey("payee.id"))
    wbs_id: Mapped[int | None] = mapped_column(ForeignKey("wbs_item.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    default_amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(Text, default="USD")
    active_from: Mapped[date] = mapped_column(Date)
    active_to: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Disbursement(Base):
    __tablename__ = "disbursement"
    __table_args__ = (UniqueConstraint("disb_no", "disb_sub"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    disb_no: Mapped[int] = mapped_column(Integer)
    disb_sub: Mapped[int] = mapped_column(Integer, default=0)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("disbursement.id"))
    period_month: Mapped[date] = mapped_column(Date)
    send_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(ForeignKey("disb_status.code"), default="draft")
    credit_applied: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal(0))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal(0))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    lines: Mapped[list[DisbursementLine]] = relationship(
        back_populates="disbursement",
        cascade="all, delete-orphan",
        order_by="DisbursementLine.line_no",
    )


class DisbursementLine(Base):
    __tablename__ = "disbursement_line"
    __table_args__ = (UniqueConstraint("disbursement_id", "line_no"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    disbursement_id: Mapped[int] = mapped_column(
        ForeignKey("disbursement.id", ondelete="CASCADE")
    )
    line_no: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)
    invoice_no: Mapped[str | None] = mapped_column(Text)
    # Proveedor de la factura (informativo). El pago va al holding, no a él.
    vendor: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal(0))
    currency: Mapped[str] = mapped_column(Text, default="USD")
    wbs_id: Mapped[int | None] = mapped_column(ForeignKey("wbs_item.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    phase_id: Mapped[int | None] = mapped_column(ForeignKey("phase.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payee.id"))
    recurring_id: Mapped[int | None] = mapped_column(ForeignKey("recurring_item.id"))
    transfer: Mapped[str | None] = mapped_column(Text)  # SEND / HOLD

    # Varianza generada por Postgres (solo lectura): amount − amount_paid.
    amount_due: Mapped[Decimal] = mapped_column(
        Numeric(16, 2), Computed("amount - amount_paid", persisted=True)
    )

    disbursement: Mapped[Disbursement] = relationship(back_populates="lines")


class CreditApplication(Base):
    __tablename__ = "credit_application"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    disbursement_id: Mapped[int] = mapped_column(
        ForeignKey("disbursement.id", ondelete="CASCADE")
    )
    applied_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    note: Mapped[str | None] = mapped_column(Text)
    applied_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


class DisbursementApproval(Base):
    """Una aprobación de un usuario sobre un desembolso. Sobre el umbral hacen
    falta dos aprobadores DISTINTOS (§4.4 del plan)."""

    __tablename__ = "disbursement_approval"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    disbursement_id: Mapped[int] = mapped_column(
        ForeignKey("disbursement.id", ondelete="CASCADE")
    )
    approver_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CreditAdjustment(Base):
    """Ajuste manual del saldo de crédito (no viene del ledger). §11b."""

    __tablename__ = "credit_adjustment"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    entry_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))  # + suma, − reduce
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


class InstructionTemplate(Base):
    __tablename__ = "instruction_template"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    escrow_agreement_date: Mapped[date] = mapped_column(Date)
    purchaser: Mapped[str] = mapped_column(Text)
    escrow_agent: Mapped[str] = mapped_column(Text)
    agent_legal_id: Mapped[str] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    payment_block: Mapped[dict[str, Any]] = mapped_column(JSONB)
    signer_name: Mapped[str] = mapped_column(Text)
    signer_title: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
