"""Ingesta de facturas electrónicas desde un buzón IMAP.

Lee el correo (Gmail vía App Password), busca adjuntos XML de comprobante
electrónico de Hacienda CR y agrega una línea por factura a `invoice_receipt`.
No borra ni marca correos (BODY.PEEK, readonly): re-sincronizar es idempotente
gracias al dedup por Message-ID / clave.
"""

from __future__ import annotations

import email
import imaplib
import io
import json
import re
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings

# Raíces que SÍ son comprobantes (no los mensajes de aceptación de Hacienda).
_COMPROBANTE_ROOTS = {
    "FacturaElectronica",
    "TiqueteElectronico",
    "NotaCreditoElectronica",
    "NotaDebitoElectronica",
    "FacturaElectronicaCompra",
    "FacturaElectronicaExportacion",
}
FETCH_LIMIT = 800
_ALL_TOKENS = {"*ALL*", "ALL", "ALL_MAIL", "ALLMAIL"}
_HEADER_CHUNK = 200  # cabeceras por FETCH (una vuelta de red por lote)
_SINCE_MARGIN_DAYS = 7  # margen hacia atrás del sync incremental

# Código corto por tipo de comprobante (raíz del XML de Hacienda).
_DOC_CODE = {
    "FacturaElectronica": "FE",
    "TiqueteElectronico": "TE",
    "NotaCreditoElectronica": "NC",
    "NotaDebitoElectronica": "ND",
    "FacturaElectronicaCompra": "FEC",
    "FacturaElectronicaExportacion": "FEE",
}


_all_mail_cache: str | None = None


def _all_mail_folder(conn: imaplib.IMAP4_SSL) -> str | None:
    """Ubica la carpeta especial \\All de Gmail (a prueba de idioma).

    El nombre no cambia: se cachea en el proceso porque cada comando IMAP contra
    Gmail desde el servidor cuesta ~10 s y este LIST solo se necesita una vez.
    """
    global _all_mail_cache
    if _all_mail_cache:
        return _all_mail_cache
    try:
        typ, data = conn.list()
        if typ != "OK" or not data:
            return None
        for raw in data:
            s = raw.decode(errors="ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
            if "\\All" in s and ' "/" ' in s:
                _all_mail_cache = s.split(' "/" ', 1)[1].strip().strip('"')
                return _all_mail_cache
    except Exception:  # noqa: BLE001
        return None
    return None


def _resolve_folders(conn: imaplib.IMAP4_SSL, spec: str) -> list[str]:
    """Convierte INVOICE_IMAP_FOLDER (coma-separado; admite *ALL*) en carpetas."""
    out: list[str] = []
    for tok in (spec or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok.upper() in _ALL_TOKENS:
            out.append(_all_mail_folder(conn) or "[Gmail]/All Mail")
        else:
            out.append(tok)
    return out or ["INBOX"]


def _quote(folder: str) -> str:
    return folder if folder.startswith('"') else f'"{folder}"'


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _first(root: ET.Element, name: str) -> str | None:
    for el in root.iter():
        if _local(el.tag) == name and el.text and el.text.strip():
            return el.text.strip()
    return None


def _find_el(root: ET.Element, name: str) -> ET.Element | None:
    for el in root.iter():
        if _local(el.tag) == name:
            return el
    return None


def _to_decimal(s: str | None) -> Decimal | None:
    if not s:
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def parse_comprobante(xml_bytes: bytes) -> dict[str, Any] | None:
    """Devuelve los campos clave de un XML de comprobante, o None si no lo es."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None
    root_local = _local(root.tag)
    if root_local not in _COMPROBANTE_ROOTS:
        return None
    doc_type = _DOC_CODE.get(root_local, root_local)

    emisor = _find_el(root, "Emisor")
    issuer_name = _first(emisor, "Nombre") if emisor is not None else None
    issuer_id = None
    if emisor is not None:
        ident = _find_el(emisor, "Identificacion")
        if ident is not None:
            issuer_id = _first(ident, "Numero")

    fecha = _first(root, "FechaEmision")
    invoice_date = None
    if fecha:
        try:
            invoice_date = datetime.fromisoformat(fecha.replace("Z", "+00:00")).date()
        except ValueError:
            invoice_date = None

    return {
        "doc_type": doc_type,
        "clave": _first(root, "Clave"),
        "invoice_no": _first(root, "NumeroConsecutivo"),
        "issuer_name": issuer_name,
        "issuer_id": issuer_id,
        "invoice_date": invoice_date,
        "currency": _first(root, "CodigoMoneda"),
        # Tipo de cambio que trae el propio comprobante (CRC=1.0; USD≈540, etc.).
        "invoice_fx": _to_decimal(_first(root, "TipoCambio")),
        # Subtotal = venta neta (después de descuentos, antes de IVA).
        "subtotal": _to_decimal(_first(root, "TotalVentaNeta")),
        "tax": _to_decimal(_first(root, "TotalImpuesto")),
        "total": _to_decimal(_first(root, "TotalComprobante")),
    }


def parse_detalle(xml_bytes: bytes) -> list[str]:
    """Descripción de cada línea del comprobante (LineaDetalle → Detalle), en orden.

    Sirve para armar una descripción "en general" de la factura cuando se pasa a
    una línea del Short Payment.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []
    out: list[str] = []
    for el in root.iter():
        if _local(el.tag) != "LineaDetalle":
            continue
        for child in el.iter():
            if _local(child.tag) == "Detalle" and child.text and child.text.strip():
                out.append(" ".join(child.text.split()))
                break
    return out


def _consume(out: dict[str, Any], fname: str, ctype: str, payload: bytes | None) -> None:
    """Procesa un archivo suelto (nombre + bytes): guarda PDF, parsea XML."""
    if not payload:
        return
    low = (fname or "").lower()
    if low.endswith(".pdf") or ctype == "application/pdf":
        out["has_pdf"] = True
        if out["pdf_bytes"] is None:
            out["pdf_bytes"] = payload
            out["pdf_filename"] = fname or "factura.pdf"
    elif low.endswith(".xml") or ctype in ("application/xml", "text/xml"):
        comp = parse_comprobante(payload)
        if comp and out["comprobante"] is None:
            out["comprobante"] = comp
            out["xml_filename"] = fname or "comprobante.xml"
            out["xml_bytes"] = payload


def _extract(msg: Message) -> dict[str, Any]:
    """Recorre adjuntos: primer comprobante XML gana; guarda XML y PDF.
    Abre también los .zip (las facturas CR suelen venir empaquetadas)."""
    out: dict[str, Any] = {
        "has_pdf": False,
        "xml_filename": None,
        "comprobante": None,
        "xml_bytes": None,
        "pdf_bytes": None,
        "pdf_filename": None,
    }
    for part in msg.walk():
        if part.is_multipart():
            continue
        fname = part.get_filename() or ""
        ctype = (part.get_content_type() or "").lower()
        low = fname.lower()
        payload = part.get_payload(decode=True)
        if low.endswith(".zip") or ctype in ("application/zip", "application/x-zip-compressed"):
            if not payload:
                continue
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for name in zf.namelist():
                        inner = zf.read(name)
                        _consume(out, name, "", inner)
            except zipfile.BadZipFile:
                continue
        else:
            _consume(out, fname, ctype, payload)
    return out


def _fetch_headers(conn: imaplib.IMAP4_SSL, uids: list[bytes]) -> dict[bytes, str]:
    """Message-ID de muchos correos en UNA vuelta de red, por UID.

    Antes se pedía la cabecera correo por correo: con ~330 correos eran ~330
    idas y vueltas al servidor (minutos). Un FETCH por lotes las reduce a un
    puñado.
    """
    out: dict[bytes, str] = {}
    for i in range(0, len(uids), _HEADER_CHUNK):
        chunk = b",".join(uids[i : i + _HEADER_CHUNK])
        typ, data = conn.uid("FETCH", chunk.decode(), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        if typ != "OK" or not data:
            continue
        for item in data:
            if not isinstance(item, tuple) or item[1] is None:
                continue
            m = re.search(rb"UID (\d+)", item[0] or b"")
            if not m:
                continue
            hdr = email.message_from_bytes(item[1])
            out[m.group(1)] = (hdr.get("Message-ID") or "").strip()
    return out


def fetch_new(db: Session, settings: Settings, *, full: bool = False) -> dict[str, Any]:
    """Conecta al IMAP, ingesta comprobantes nuevos. Idempotente (dedup).

    Por defecto mira solo lo llegado desde el último sync (con margen de
    `_SINCE_MARGIN_DAYS` por si un correo entra con fecha atrasada). `full=True`
    barre todo el buzón — sirve la primera vez o si se sospecha un hueco.
    """
    if not settings.invoice_mail_configured:
        return {"configured": False, "found": 0, "inserted": 0, "skipped": 0}

    global _all_mail_cache
    since: date | None = None
    row = db.execute(
        text("SELECT invoice_last_sync_at, invoice_sync_state FROM settings LIMIT 1")
    ).first()
    if not full and row and row[0] is not None:
        since = (row[0] - timedelta(days=_SINCE_MARGIN_DAYS)).date()
    state: dict[str, Any] = dict(row[1]) if row and isinstance(row[1], dict) else {}
    # Nombre de la carpeta "All Mail" recordado de la corrida anterior: evita un
    # LIST contra Gmail (~10 s) en cada sync, aunque cambie el worker.
    if not _all_mail_cache:
        _all_mail_cache = state.get("all_mail_folder") or None
    # Último UID revisado por carpeta (se ignora en un barrido completo).
    watermarks: dict[str, int] = dict(state.get("uid_watermarks") or {}) if not full else {}

    inserted = skipped = found = 0
    t0 = time.monotonic()
    timings: dict[str, float] = {}

    def mark(step: str) -> None:
        """Cuánto tardó cada tramo — para saber dónde se va el tiempo del sync."""
        nonlocal t0
        now = time.monotonic()
        timings[step] = round(now - t0, 1)
        t0 = now

    conn = imaplib.IMAP4_SSL(settings.invoice_imap_host, settings.invoice_imap_port)
    mark("connect")
    try:
        conn.login(settings.invoice_imap_user, settings.invoice_imap_password)
        mark("login")
        folders = _resolve_folders(conn, settings.invoice_imap_folder)
        mark("folders")
        seen_ids: set[str] = set()
        for folder in folders:
            typ, _ = conn.select(_quote(folder), readonly=True)
            mark("select")
            if typ != "OK":
                continue
            # Marca de agua por carpeta: el UID es estable (a diferencia del
            # número de secuencia), así que lo ya revisado no se vuelve a bajar —
            # ni siquiera los correos que se descartan por no traer XML.
            hwm = 0 if full else int(watermarks.get(folder) or 0)
            if hwm:
                typ, data = conn.uid("SEARCH", None, "UID", f"{hwm + 1}:*")
            elif since is not None:
                typ, data = conn.uid("SEARCH", None, "SINCE", since.strftime("%d-%b-%Y"))
            else:
                typ, data = conn.uid("SEARCH", None, "ALL")
            mark("search")
            if typ != "OK":
                continue
            # "x:*" siempre devuelve el último aunque su UID sea menor: se filtra.
            ids = [u for u in data[0].split() if int(u) > hwm][-FETCH_LIMIT:]
            if ids:
                new_hwm = max(int(u) for u in ids)
                watermarks[folder] = max(int(watermarks.get(folder) or 0), new_hwm)
            headers = _fetch_headers(conn, ids)
            mark("headers")
            # Los ya vistos, en UNA consulta (antes: un SELECT por correo).
            msg_ids = [
                headers.get(n) or f"uid:{folder}:{n.decode()}" for n in ids
            ]
            known: set[str] = set(
                db.execute(
                    text("SELECT source_uid FROM invoice_receipt WHERE source_uid = ANY(:ids)"),
                    {"ids": msg_ids},
                ).scalars()
            )
            mark("known")
            for num in reversed(ids):
                msg_id = headers.get(num) or f"uid:{folder}:{num.decode()}"
                if msg_id in seen_ids:
                    continue
                seen_ids.add(msg_id)
                found += 1
                if msg_id in known:
                    skipped += 1
                    continue
                # 2) Solo si es nuevo, bajamos el cuerpo completo (con adjuntos).
                typ, raw = conn.uid("FETCH", num.decode(), "(BODY.PEEK[])")
                if typ != "OK" or not raw or not isinstance(raw[0], tuple):
                    continue
                msg = email.message_from_bytes(raw[0][1])
                info = _extract(msg)
                comp = info["comprobante"]
                if comp is None:
                    skipped += 1  # sin comprobante XML: se ignora (solo facturas electrónicas)
                    continue
                if comp and comp.get("clave"):
                    dup = db.execute(
                        text("SELECT 1 FROM invoice_receipt WHERE clave = :c"),
                        {"c": comp["clave"]},
                    ).first()
                    if dup:
                        skipped += 1
                        continue
                recv = None
                try:
                    recv = parsedate_to_datetime(msg.get("Date"))
                except (TypeError, ValueError):
                    recv = None
                db.execute(
                    text(
                        """
                        INSERT INTO invoice_receipt
                          (source_uid, received_at, email_from, email_subject, doc_type, clave,
                           invoice_no, issuer_name, issuer_id, invoice_date, currency, invoice_fx,
                           subtotal, tax, total, xml_filename, has_pdf, pdf_filename, xml_bytes,
                           pdf_bytes, status, created_at)
                        VALUES
                          (:uid, :recv, :efrom, :subj, :dtype, :clave, :no, :iname, :iid, :idate,
                           :cur, :ifx, :subtotal, :tax, :total, :xml, :pdf, :pdfname, :xmlb, :pdfb,
                           'new', now())
                        ON CONFLICT (source_uid) DO NOTHING
                        """
                    ),
                    {
                        "uid": msg_id,
                        "recv": recv,
                        "efrom": str(msg.get("From") or "")[:500],
                        "subj": str(msg.get("Subject") or "")[:500],
                        "dtype": (comp or {}).get("doc_type"),
                        "clave": (comp or {}).get("clave"),
                        "no": (comp or {}).get("invoice_no"),
                        "iname": (comp or {}).get("issuer_name"),
                        "iid": (comp or {}).get("issuer_id"),
                        "idate": (comp or {}).get("invoice_date"),
                        "cur": (comp or {}).get("currency"),
                        "ifx": (comp or {}).get("invoice_fx"),
                        "subtotal": (comp or {}).get("subtotal"),
                        "tax": (comp or {}).get("tax"),
                        "total": (comp or {}).get("total"),
                        "xml": info["xml_filename"],
                        "pdf": info["has_pdf"],
                        "pdfname": info["pdf_filename"],
                        "xmlb": info["xml_bytes"],
                        "pdfb": info["pdf_bytes"],
                    },
                )
                inserted += 1
    finally:
        mark("loop")
        # Cerrar el socket a secas: LOGOUT es un comando más (~10 s) y el cierre
        # ordenado de TLS espera el close_notify del otro lado (otros ~10 s).
        try:
            conn.sock.close()
        except Exception:  # noqa: BLE001 — cierre best-effort
            pass
        mark("close")

    mark("bodies")
    db.execute(
        text("UPDATE settings SET invoice_last_sync_at = :t"),
        {"t": datetime.now(timezone.utc)},
    )
    # Se guardan junto al estado del sync (sin columna nueva): nombre de carpeta
    # y hasta qué UID se revisó cada una.
    db.execute(
        text(
            "UPDATE settings SET invoice_sync_state = "
            "COALESCE(invoice_sync_state, '{}'::jsonb) || CAST(:s AS jsonb)"
        ),
        {
            "s": json.dumps(
                {"all_mail_folder": _all_mail_cache, "uid_watermarks": watermarks}, default=str
            )
        },
    )
    return {
        "configured": True,
        "found": found,
        "inserted": inserted,
        "skipped": skipped,
        "full": full,
        "timings": timings,
    }
