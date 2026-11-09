"""La SECCIÓN del WBS: el único lugar del backend donde se decide cómo agrupar.

Owner, 2026-11-09: *«todo el app debe estar estandarizado a estos grupos de la
misma manera... y también arregla el excel file de cada vista»*.

El proyecto tiene once secciones, 0 a 10. El número sale del `wbs_code` —lo que
está antes del primer punto— y el nombre, de la fila cuyo código es ese número
pelado: «0» → «Property Holding Expenses».

Es el gemelo de `web/lib/seccion.ts`. Los dos existen porque la pantalla agrupa
en el navegador y el Excel en el servidor; que digan lo mismo es el punto, y por
eso la regla vive en un archivo de cada lado y no repartida por las vistas.

⚠️ Antes cada hoja agrupaba a su manera: Job Cost por sección, y Timeline,
Timeline Detail, Dashboard y Planning por `category`. Ocho grupos de un lado,
once del otro.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# La sección como expresión SQL, para ordenar por ella en una consulta.
#
# ⚠️ Va con CASE y no con `::int` a secas: hay códigos de WBS que son TEXTO
# —`Blue`, `Green`, `Grey`, `Red`, `Yellow`, `Other Items`, `Project Estimate:`—.
# Son la leyenda del Job Cost guardada como filas de WBS, con presupuesto 0. El
# cast directo revienta con `invalid input syntax for integer: "Other Items"`;
# lo descubrí midiendo, no leyendo.
SQL_SECCION = (
    "CASE WHEN split_part({c}, '.', 1) ~ '^[0-9]+$' "
    "THEN split_part({c}, '.', 1)::int END"
)


def sql_seccion(col: str = "f.wbs_code") -> str:
    """La expresión SQL de la sección para la columna dada."""
    return SQL_SECCION.format(c=col)


def seccion_de(wbs_code: Any) -> str:
    """`"3.2.1"` → `"3"`. Devuelve TEXTO, no entero: ver la nota de arriba."""
    return str(wbs_code or "").split(".")[0]


def es_seccion(wbs_code: Any) -> bool:
    """`True` si el código ES una fila de sección (`"0"`, `"10"`)."""
    s = str(wbs_code or "")
    return s.isdigit()


def titulos(db: Session) -> dict[str, str]:
    """El título de cada sección, por su número.

    ⚠️ Sin filtrar por `kind`: la sección 6 es `proceeds` (la venta) y un
    `WHERE kind = 'cost'` la dejaría sin nombre.
    """
    return {
        str(r["wbs_code"]): r["title"]
        for r in db.execute(
            text(
                "SELECT wbs_code, title FROM v_wbs_financials "
                "WHERE wbs_code ~ '^[0-9]+$'"
            )
        ).mappings()
    }


def rotulo(sec: Any, tit: dict[str, str]) -> str:
    """Cómo se escribe una sección: `"0 PROPERTY HOLDING EXPENSES"`."""
    s = str(sec)
    t = tit.get(s)
    return (f"{s} {t}" if t else s).upper()


def orden(sec: Any) -> tuple[int, str]:
    """Clave de orden: 0, 1, 2 … 10, y lo no numérico al final.

    ⚠️ Numérico y no alfabético: ordenando texto, «10» cae entre «1» y «2» y
    Construction termina tercera en vez de última.
    """
    s = str(sec)
    return (int(s) if s.isdigit() else 10**9, s)


def agrupar(filas: list[Any], tit: dict[str, str], clave: str = "wbs_code") -> list[tuple[str, list[Any]]]:
    """Agrupa filas por sección, ya ordenadas, conservando el orden interno."""
    m: dict[str, list[Any]] = {}
    for f in filas:
        code = f[clave] if not hasattr(f, "get") else f.get(clave)
        m.setdefault(seccion_de(code), []).append(f)
    return [(rotulo(s, tit), m[s]) for s in sorted(m, key=orden)]
