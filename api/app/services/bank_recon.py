"""Conciliación bancaria: ingesta del estado + auto-match banco↔Ledger."""

from __future__ import annotations

import hashlib
import re
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.repositories import bank_recon as repo
from app.services import lafise_import as L

# # de factura dentro de la descripción del banco: "FC#14860", "FC#14418-14721"
_FC = re.compile(r"#\s*(\d{3,7})")


def import_statement(
    db: Session, filename: str, data: bytes, user: str | None
) -> dict[str, Any]:
    """Parsea el archivo (PDF/CSV/xls) y carga los movimientos nuevos. Idempotente."""
    try:
        st = L.parse(filename, data)
    except Exception as exc:  # noqa: BLE001 — cualquier fallo de parseo es 400
        raise Problem(status_code=400, title="No pude leer el estado de cuenta", detail=str(exc)) from exc
    if not st.movements:
        raise Problem(
            status_code=400,
            title="No encontré movimientos",
            detail="Revisá que el archivo sea un estado de cuenta LAFISE (PDF/CSV/xls) con la tabla de movimientos.",
        )

    account_id = repo.resolve_account(db, st.iban, st.client, st.currency)
    kind = "pdf" if filename.lower().endswith(".pdf") else ("csv" if filename.lower().endswith(".csv") else "xls")
    batch = hashlib.sha1(  # noqa: S324 — solo identifica el lote, no es seguridad
        f"{filename}|{len(st.movements)}|{st.movements[-1].balance}".encode()
    ).hexdigest()[:12]

    opening = None
    if st.movements and st.movements[0].balance is not None:
        first = st.movements[0]
        opening = first.balance - (first.credit or Decimal(0)) + (first.debit or Decimal(0))
    closing = st.movements[-1].balance if st.movements else None

    # el statement primero (necesitamos su id para las tx)
    stmt_id = repo.upsert_statement(
        db, account_id, st.period_from, st.period_to, filename, kind,
        opening, closing, len(st.movements), 0, batch, user,
    )
    new = 0
    for m in st.movements:
        new += repo.insert_tx(db, account_id, stmt_id, batch, m)
    # actualiza n_new (upsert_statement suma; lo dejamos correcto reinsertando el conteo real)
    repo.upsert_statement(
        db, account_id, st.period_from, st.period_to, filename, kind,
        opening, closing, len(st.movements), new, batch, user,
    )
    return {
        "account_id": account_id,
        "statement_id": stmt_id,
        "period_from": st.period_from,
        "period_to": st.period_to,
        "movements": len(st.movements),
        "new": new,
        "already": len(st.movements) - new,
        "closing_balance": closing,
    }


def _score(tx: dict[str, Any], cand: dict[str, Any]) -> tuple[int, bool]:
    """Puntúa un candidato del Ledger para un movimiento del banco.

    Devuelve (score, monto_exacto). Sube por: monto exacto, # de factura del texto
    del banco presente en la factura/descripción del Ledger, y proximidad de fecha.
    """
    target = tx["debit"] or tx["credit"] or Decimal(0)
    amt = cand.get("amount_paid") or cand.get("amount") or Decimal(0)
    exact = abs(Decimal(amt) - Decimal(target)) < Decimal("0.01")
    score = 50 if exact else 0
    # # de factura del banco dentro del invoice_no del Ledger o de la factura ligada
    fcs = set(_FC.findall(tx.get("description") or ""))
    inv_txt = " ".join(str(cand.get(k) or "") for k in ("invoice_no", "inv_no"))
    if fcs and any(fc in inv_txt for fc in fcs):
        score += 40
    # proximidad de fecha (entry_date es texto ISO)
    ed = cand.get("entry_date")
    if ed and tx.get("tx_date"):
        try:
            from datetime import date as _d

            y, mm, dd = str(ed)[:10].split("-")
            delta = abs((tx["tx_date"] - _d(int(y), int(mm), int(dd))).days)
            if delta <= 3:
                score += 20
            elif delta <= 15:
                score += 10
            elif delta <= 45:
                score += 5
        except (ValueError, TypeError):
            pass
    return score, exact


def automatch(db: Session, account_id: int) -> dict[str, Any]:
    """Propone cruces (read-only). tier 'auto' = monto exacto + candidato único fuerte."""
    log = repo.reconciliation_log(db, account_id, None, None)
    pending = [r for r in log if r["recon_status"] == "unreconciled" and (r["debit"] or r["credit"])]
    proposals: list[dict[str, Any]] = []
    for tx in pending:
        target = tx["debit"] or tx["credit"] or Decimal(0)
        cands = repo.candidates(db, tx["id"], Decimal(target))
        if not cands:
            continue
        scored = sorted(
            ((c, *_score(tx, c)) for c in cands), key=lambda x: x[1], reverse=True
        )
        best, best_score, best_exact = scored[0]
        second_score = scored[1][1] if len(scored) > 1 else -1
        tier = "auto" if best_exact and best_score >= 50 and best_score - second_score >= 20 else "review"
        proposals.append(
            {
                "tx_id": tx["id"],
                "tx_date": tx["tx_date"],
                "tx_description": tx["description"],
                "tx_amount": target,
                "sheet_row_id": best["id"],
                "ledger_payee": best["payee"],
                "short_payment_no": best["short_payment_no"],
                "ledger_amount": best.get("amount_paid") or best.get("amount"),
                "invoice_no": best.get("inv_no") or best.get("invoice_no"),
                "provider": best.get("provider"),
                "score": best_score,
                "tier": tier,
                "n_candidates": len(cands),
            }
        )
    auto = [p for p in proposals if p["tier"] == "auto"]
    review = [p for p in proposals if p["tier"] == "review"]
    return {"auto": auto, "review": review, "pending": len(pending)}


def apply_matches(db: Session, pairs: list[dict[str, int]]) -> int:
    n = 0
    for p in pairs:
        if not repo.sheet_row_exists(db, p["sheet_row_id"]):
            continue
        if repo.set_recon(db, p["tx_id"], p["sheet_row_id"], None):
            n += 1
    return n
