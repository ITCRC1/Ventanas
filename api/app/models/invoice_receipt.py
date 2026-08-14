"""Invoice Receipt — una factura electrónica llegada por correo.

El usuario asocia cada recibo al asiento del ledger (donde está el desembolso)
mediante ledger_entry_id. El motor no calcula nada: es una bandeja de captura.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    LargeBinary,
    Numeric,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class InvoiceReceipt(Base):
    __tablename__ = "invoice_receipt"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_uid: Mapped[str | None] = mapped_column(Text, unique=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    email_from: Mapped[str | None] = mapped_column(Text)
    email_subject: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(Text)  # FE | NC | ND | TE …
    clave: Mapped[str | None] = mapped_column(Text)
    invoice_no: Mapped[str | None] = mapped_column(Text)
    issuer_name: Mapped[str | None] = mapped_column(Text)
    issuer_id: Mapped[str | None] = mapped_column(Text)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str | None] = mapped_column(Text)
    invoice_fx: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    tax: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    total: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    xml_filename: Mapped[str | None] = mapped_column(Text)
    pdf_filename: Mapped[str | None] = mapped_column(Text)
    xml_bytes: Mapped[bytes | None] = mapped_column(LargeBinary)
    pdf_bytes: Mapped[bytes | None] = mapped_column(LargeBinary)
    has_pdf: Mapped[bool] = mapped_column(Boolean, default=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id", ondelete="SET NULL")
    )
    # Línea del Short Payment creada desde esta factura (traza del reintegro).
    sp_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("disbursement_line.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(Text, default="new")  # new | linked | ignored
    no_invoice: Mapped[bool] = mapped_column(Boolean, default=False)  # justificación sin factura
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
