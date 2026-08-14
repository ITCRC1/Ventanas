"""Modelos ORM. Sólo se mapean las tablas que la API escribe/edita en Fase 3.

Las vistas de reporte (v_*) NO se mapean: se consultan con SQL crudo (§1).
"""

from app.models.access import AppUser, Permission, Role, RolePermission
from app.models.bank import BankAccount, FeeType, WireFee, WireTransfer
from app.models.budget import BudgetLine, BudgetVersion
from app.models.catalog import Category, LineType, Phase, TaskState
from app.models.disbursement import (
    CreditAdjustment,
    CreditApplication,
    DisbStatus,
    Disbursement,
    DisbursementApproval,
    DisbursementLine,
    InstructionTemplate,
    Payee,
    RecurringItem,
)
from app.models.invoice import Invoice, InvoiceLine
from app.models.invoice_receipt import InvoiceReceipt
from app.models.ledger import LedgerEntry, LedgerStatus
from app.models.schedule import ScheduleCell
from app.models.wbs import WbsItem

__all__ = [
    "AppUser",
    "Permission",
    "Role",
    "RolePermission",
    "Category",
    "Phase",
    "TaskState",
    "LineType",
    "WbsItem",
    "BudgetVersion",
    "BudgetLine",
    "LedgerEntry",
    "LedgerStatus",
    "ScheduleCell",
    "DisbStatus",
    "Payee",
    "RecurringItem",
    "Disbursement",
    "DisbursementLine",
    "CreditApplication",
    "CreditAdjustment",
    "DisbursementApproval",
    "InstructionTemplate",
    "BankAccount",
    "WireTransfer",
    "WireFee",
    "FeeType",
    "Invoice",
    "InvoiceLine",
    "InvoiceReceipt",
]
