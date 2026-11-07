"""El CSV de LAFISE: Latin-1, meses en dos idiomas y encabezados con acento.

Las tres cosas que lo rompieron el 2026-11-07, cada una con su prueba. Todas
fallan sin el arreglo y ninguna depende de un archivo en disco.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from app.services.lafise_import import parse

CABECERA = (
    "Usuario originador,Cuenta #,Alias,Fecha del reporte,Sucursal,Oficial de cuenta,Saldo\r\n"
    "3-102-915382 SRL,CR49011400007813265875,{Alias},06/NOV/2026,,,\"48,209.76\"\r\n"
    "\r\n"
    "Cliente,3-102-915382 SRL,\r\n"
    "Nro. de cuenta,CR49011400007813265875,\r\n"
    "Moneda,USD,Tipo de cuenta,Cuenta de Ahorro,\r\n"
    "Banco,Banco LAFISE Costa Rica,\r\n"
    "\r\n"
    "Desde:,01/ENE/2025,Hasta:,06/NOV/2026\r\n"
    "\r\n"
    "Fecha,Número de confirmación,Descripción,Débito,Crédito,Saldo,"
    "Referencia,Tipo de Movimiento,\r\n"
)

# El banco entrega del más reciente al más antiguo; el parser lo invierte.
FILAS = (
    "15/AUG/2026 00:00:00 a.m,111,PAGO AGOSTO,\"1,000.00\",,\"8,000.00\",,TT,\r\n"
    "15/JAN/2026 00:00:00 a.m,222,PAGO ENERO,500.00,,\"9,000.00\",,TT,\r\n"
    "10/ABR/2026 00:00:00 a.m,333,DEPOSITO ABRIL,,\"2,500.00\",\"9,500.00\",,AC,\r\n"
    "05/DEC/2025 00:00:00 a.m,444,PAGO DICIEMBRE,250.00,,\"7,000.00\",,TT,\r\n"
)


def _csv(texto: str, codec: str = "cp1252") -> bytes:
    return texto.encode(codec)


def test_latin1_no_pierde_las_columnas() -> None:
    """El archivo viene en Latin-1. Leerlo como UTF-8 dejaba 'Descripción'
    como 'Descripci\\ufffdn', ninguna columna se reconocía y el estado entraba
    con cero movimientos sin una sola queja."""
    st = parse("MovimientosDeCuenta.csv", _csv(CABECERA + FILAS))
    assert len(st.movements) == 4


def test_tambien_lee_utf8() -> None:
    """Arreglar Latin-1 no puede romper los archivos que sí son UTF-8."""
    st = parse("x.csv", _csv(CABECERA + FILAS, "utf-8"))
    assert len(st.movements) == 4


def test_meses_en_ingles_y_en_espanol() -> None:
    """LAFISE mezcla los dos idiomas en el MISMO archivo. Con solo las
    abreviaturas en español se perdían enero, abril, agosto y diciembre
    completos — 166 de 563 filas en el estado real."""
    st = parse("x.csv", _csv(CABECERA + FILAS))
    meses = sorted(m.tx_date.isoformat() for m in st.movements)
    assert meses == ["2025-12-05", "2026-01-15", "2026-04-10", "2026-08-15"]


def test_la_moneda_no_es_el_tipo_de_cuenta() -> None:
    """La línea dice 'Moneda,USD,Tipo de cuenta,Cuenta de Ahorro': el último
    token es 'Ahorro', no la moneda."""
    st = parse("x.csv", _csv(CABECERA + FILAS))
    assert st.currency == "USD"


def test_montos_y_orden() -> None:
    """Los montos traen separador de miles y comillas; el orden del archivo es
    del más reciente al más antiguo y se invierte."""
    st = parse("x.csv", _csv(CABECERA + FILAS))
    primero, ultimo = st.movements[0], st.movements[-1]
    assert primero.tx_date.isoformat() == "2025-12-05"
    assert ultimo.tx_date.isoformat() == "2026-08-15"
    assert ultimo.debit == Decimal("1000.00")
    assert ultimo.balance == Decimal("8000.00")
    abril = next(m for m in st.movements if m.txn_no == "333")
    assert abril.credit == Decimal("2500.00")
    assert abril.debit is None


def test_sin_encabezado_reconocible_avisa() -> None:
    """Un archivo que no se pudo leer no es un archivo sin movimientos: antes
    devolvía cero en silencio y el error culpaba al archivo."""
    with pytest.raises(ValueError, match="encabezados"):
        parse("x.csv", _csv("una,cosa,cualquiera\r\n1,2,3\r\n"))
