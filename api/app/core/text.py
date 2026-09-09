"""Normalización de texto para comparar nombres y conceptos.

La usan el automatch de facturas (proveedor ↔ ledger) y la sugerencia de número
de proyecto en el Short Payment. Vive acá para que los dos comparen igual.
"""

from __future__ import annotations

import re
import unicodedata

# Ruido societario y conectores: no distinguen a un proveedor de otro.
STOP = {
    "sa", "srl", "ltda", "limitada", "sociedad", "responsabilidad", "anonima",
    "de", "del", "la", "el", "los", "las", "y", "cr", "inc", "company", "the",
    "s", "a", "l",
}

# Meses en los dos idiomas: aparecen en la descripción de la línea ("Jan 2026 ·
# Development Team", "pago agosto") y cambian todos los meses, así que no pueden
# formar parte del concepto — si no, nada empareja con el mes anterior.
MONTHS = {
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august", "september",
    "october", "november", "december",
    "ene", "abr", "ago", "dic",
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
}


def norm(s: str | None) -> str:
    """Minúsculas, sin acentos y sin puntuación."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def tokens(s: str | None) -> set[str]:
    """Palabras significativas (3+ letras, sin ruido societario)."""
    return {t for t in norm(s).split() if len(t) >= 3 and t not in STOP}


def concept_tokens(s: str | None) -> set[str]:
    """Como `tokens`, pero sin fechas ni meses: lo que queda es el CONCEPTO,
    lo que se repite mes a mes ("servicios de ingenieria", "development team")."""
    return {t for t in tokens(s) if not t.isdigit() and t not in MONTHS}
