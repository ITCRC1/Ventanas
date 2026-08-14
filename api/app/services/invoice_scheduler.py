"""Auto-sync de facturas: revisa el buzón cada N minutos en segundo plano.

Queda DORMIDO mientras el buzón no esté configurado (sin App Password no hace
nada). Es best-effort: cualquier error de IMAP se registra y se reintenta en el
siguiente ciclo. El sync manual (botón) sigue disponible siempre.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.logging import get_logger
from app.services import invoice_mail

log = get_logger()
_started = False


# El estado vive en la BASE (settings.invoice_sync_state), no en memoria: el
# backend corre con varios workers y la pantalla puede preguntarle a cualquiera.
_STALE_MINUTES = 15  # un "running" más viejo que esto = worker caído

# En prod gunicorn levanta varios workers y CADA UNO arranca su hilo de
# auto-sync. Sin candado, dos pasadas simultáneas por el buzón se pisan la marca
# de UID leído y pueden duplicar facturas. El lock es de transacción: Postgres lo
# suelta solo al cerrar, así que un worker que se muera no deja nada trabado.
_SYNC_LOCK_KEY = 8150001


def _read_state(db: Session) -> dict[str, Any]:
    raw = db.execute(text("SELECT invoice_sync_state FROM settings LIMIT 1")).scalar()
    st: dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
    if st.get("running") and st.get("started_at"):
        try:
            started = datetime.fromisoformat(str(st["started_at"]))
            if datetime.now(UTC) - started > timedelta(minutes=_STALE_MINUTES):
                st["running"] = False  # se murió el worker: no dejarlo trabado
        except ValueError:
            st["running"] = False
    return st


def _write_state(db: Session, st: dict[str, Any]) -> None:
    """MEZCLA con lo que ya había: el estado guarda también hasta qué UID se leyó
    cada carpeta, y pisarlo entero borraba esa marca en cada corrida."""
    db.execute(
        text(
            "UPDATE settings SET invoice_sync_state = "
            "COALESCE(invoice_sync_state, '{}'::jsonb) || CAST(:s AS jsonb)"
        ),
        {"s": json.dumps(st, default=str)},
    )
    db.commit()


def job_state(db: Session) -> dict[str, Any]:
    """Estado del sync manual (corre en segundo plano: la pantalla no espera)."""
    st = _read_state(db)
    return {
        "running": bool(st.get("running")),
        "last": st.get("last"),
        "error": st.get("error"),
    }


def start_job(db: Session, full: bool = False) -> dict[str, Any]:
    """Dispara un sync en un hilo. Si ya hay uno corriendo, no encola otro."""
    if _read_state(db).get("running"):
        return {"started": False, "already_running": True}
    _write_state(
        db,
        {"running": True, "started_at": datetime.now(UTC).isoformat(), "error": None},
    )

    def run() -> None:
        own = SessionLocal()
        try:
            res = _sync_once(full=full)
            _write_state(own, {"running": False, "last": res, "error": None})
        except Exception as exc:  # noqa: BLE001 — se reporta en el estado
            log.warning("invoice.sync.error", error=str(exc))
            _write_state(own, {"running": False, "last": None, "error": str(exc)})
        finally:
            own.close()

    threading.Thread(target=run, daemon=True, name="invoice-sync").start()
    return {"started": True, "already_running": False}


def _sync_once(full: bool = False) -> dict[str, object]:
    """Una pasada por el buzón, con su propia sesión.

    OJO: `session_scope` es un generador (dependencia de FastAPI), NO un context
    manager — usarlo con `with` hacía fallar TODOS los ciclos en silencio.
    """
    settings = get_settings()
    db = SessionLocal()
    try:
        got = db.execute(
            text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _SYNC_LOCK_KEY}
        ).scalar()
        if not got:
            log.info("invoice.sync.skipped", reason="otro worker está sincronizando")
            db.rollback()
            return {"skipped": True}
        res = invoice_mail.fetch_new(db, settings, full=full)
        db.commit()
        return res
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _loop(interval_min: int) -> None:
    while True:
        time.sleep(interval_min * 60)
        if not get_settings().invoice_mail_configured:
            continue
        try:
            log.info("invoice.autosync", **_sync_once())
        except Exception as exc:  # noqa: BLE001 — best-effort, reintenta al próximo ciclo
            log.warning("invoice.autosync.error", error=str(exc))


def start() -> None:
    """Arranca el hilo una sola vez. No-op si el intervalo es 0."""
    global _started
    if _started:
        return
    interval = get_settings().invoice_sync_interval_min
    if interval <= 0:
        return
    _started = True
    t = threading.Thread(target=_loop, args=(interval,), daemon=True, name="invoice-autosync")
    t.start()
    log.info("invoice.autosync.started", interval_min=interval)
