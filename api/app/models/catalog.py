"""Catálogos editables: categoría, fase, estado, tipo de línea (§3 del esquema)."""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Category(Base):
    __tablename__ = "category"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    color_hex: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    phases: Mapped[list[Phase]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )


class Phase(Base):
    __tablename__ = "phase"
    __table_args__ = (UniqueConstraint("category_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("category.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    category: Mapped[Category] = relationship(back_populates="phases")


class TaskState(Base):
    __tablename__ = "task_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    label: Mapped[str] = mapped_column(Text)
    color_hex: Mapped[str] = mapped_column(Text)
    requires_amount: Mapped[bool] = mapped_column(Boolean, default=True)
    is_committed: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class LineType(Base):
    __tablename__ = "line_type"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    counts_as_cost: Mapped[bool] = mapped_column(Boolean)
