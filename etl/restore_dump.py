#!/usr/bin/env python3
"""Restaura un pg_dump en formato texto sin necesitar psql.

Por qué existe: `pg_dump` en texto plano usa `COPY ... FROM stdin` seguido de los
datos y un `\\.` de cierre. Eso es sintaxis que entiende psql, no el servidor. En
una máquina sin las herramientas de cliente de PostgreSQL no hay con qué cargarlo,
así que acá se separan los dos mundos: el SQL va por execute() y los bloques COPY
por la API de copiado de psycopg.

Todo corre en UNA transacción: si algo falla, la base queda como estaba.

Uso:
    $env:DATABASE_URL = "postgresql://...:...@host:puerto/railway?sslmode=require"
    python etl/restore_dump.py respaldo.sql
    python etl/restore_dump.py respaldo.sql --dry-run    # sólo analiza
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

try:
    import psycopg
except ImportError:
    sys.exit("Falta psycopg: pip install 'psycopg[binary]'")

_COPY = re.compile(r"^COPY\s+[\w.\"]+\s*\([^)]*\)\s+FROM\s+stdin;", re.IGNORECASE)

# El dump trae `SET lock_timeout = 0` (esperar para siempre). Si la API tiene
# conexiones vivas, un DROP puede quedarse colgado sin límite. Se acota.
_LOCK = re.compile(r"^SET\s+lock_timeout\s*=\s*0;", re.IGNORECASE)


def restaurar(ruta: Path, url: str, dry: bool) -> None:
    sql: list[str] = []
    copias = 0
    filas_copiadas = 0
    sentencias = 0
    t0 = time.time()

    cx = None if dry else psycopg.connect(url, autocommit=False)
    cur = None if dry else cx.cursor()

    def volcar_sql() -> None:
        """Manda lo acumulado. Sin parámetros psycopg usa el protocolo simple,
        que admite varias sentencias en un solo envío (incluye cuerpos $$...$$)."""
        nonlocal sentencias
        texto = "".join(sql).strip()
        sql.clear()
        if not texto:
            return
        sentencias += texto.count(";")
        if not dry:
            cur.execute(texto)

    try:
        with ruta.open("r", encoding="utf-8", errors="replace") as f:
            for linea in f:
                if _COPY.match(linea):
                    volcar_sql()
                    copias += 1
                    tabla = linea.split()[1]

                    # El bloque de datos se consume ACÁ, dentro del `with`. Antes
                    # esto era una máquina de estados entre iteraciones y el COPY
                    # podía quedar abierto: el servidor esperando datos que nadie
                    # mandaba, bloqueando de paso a la API.
                    if dry:
                        for datos in f:
                            if datos.startswith("\\."):
                                break
                            filas_copiadas += 1
                    else:
                        with cur.copy(linea.rstrip("\n")) as copia:
                            for datos in f:
                                if datos.startswith("\\."):
                                    break
                                filas_copiadas += 1
                                copia.write(datos)
                    print(f"  {tabla} ({copias}/51)", file=sys.stderr, flush=True)
                    continue

                if _LOCK.match(linea):
                    linea = "SET lock_timeout = '60s';\n"
                sql.append(linea)

            volcar_sql()

        if dry:
            print("\n(dry-run: no se escribió nada)")
        else:
            cx.commit()
            print("\nCommit OK.")
    except Exception:
        if cx is not None:
            cx.rollback()
            print("\nRollback: la base quedó como estaba.", file=sys.stderr)
        raise
    finally:
        if cx is not None:
            cx.close()

    print(f"  bloques COPY : {copias}")
    print(f"  filas        : {filas_copiadas:,}")
    print(f"  sentencias   : ~{sentencias:,}")
    print(f"  tiempo       : {time.time() - t0:.1f}s")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo", help="ruta al .sql de pg_dump")
    ap.add_argument("--dry-run", action="store_true", help="analiza sin escribir")
    ap.add_argument("--pg", default=os.environ.get("DATABASE_URL"), help="URL Postgres")
    a = ap.parse_args()

    ruta = Path(a.archivo)
    if not ruta.is_file():
        raise SystemExit(f"No existe el archivo: {ruta}")
    if not a.dry_run:
        if not a.pg:
            raise SystemExit("Falta --pg o la variable DATABASE_URL")
        if "+psycopg" in a.pg:
            raise SystemExit(
                "La URL lleva '+psycopg' (forma de SQLAlchemy). Usá el "
                "DATABASE_PUBLIC_URL, que empieza con 'postgresql://'."
            )

    print(f"Restaurando {ruta.name} ({ruta.stat().st_size / 1024 / 1024:.1f} MB)\n")
    restaurar(ruta, a.pg, a.dry_run)


if __name__ == "__main__":
    main()
