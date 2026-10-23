"""Lo que sólo está en el PDF de la factura: oferta, proyecto y su detalle real.

Owner, 2026-10-23, mostrando el PDF de una factura de DEHC: *«se pone el detalle
de la factura, se repite la factura según el detalle y se pone subtotal»* y
antes: *«que tenga el número de proyecto y nombre del proyecto»*.

## Por qué no alcanza con el XML

El XML es el documento legal y de ahí salen los montos que cuadran con Hacienda.
Pero para leer **qué nos están cobrando** se queda corto en dos cosas, las dos
medidas sobre las 16 facturas de DEHC:

* **Recorta la descripción a 67 caracteres.** «1.-First payment of three when
  starting the preliminary environmenta» — ahí se corta, justo antes del monto
  del contrato, que es el dato que permite saber de qué etapa se trata.
* **Parte cada concepto en dos renglones por código CABYS.** El PDF muestra
  cuatro conceptos y el XML trae ocho líneas. Sumadas dan lo mismo, pero leídas
  no dicen lo mismo.

Y hay campos que **no existen en el esquema de Hacienda**: `Oferta` (el número
de contrato del proveedor), `Proyecto`, `Centro de Costo` y la referencia del
SINPE con que se pagó. Viven sólo en la plantilla impresa.

## Por qué se guarda y no se parsea al vuelo

Abrir dieciséis PDF en cada carga de pantalla son varios segundos, y la pantalla
se refresca al volver a ella. Se extrae una vez —al ingestar la factura— y se
guarda. Una factura nueva entra con sus datos ya puestos.

⚠️ Esto **no reemplaza** al XML ni a `total`/`subtotal`/`tax`: esas columnas
siguen siendo la verdad fiscal. `pdf_lineas` es cómo el proveedor lo presenta.
Si un PDF no se puede leer, las columnas quedan nulas y la pantalla cae al
detalle del XML — menos legible, pero nunca vacío.

Revision ID: 0052_factura_pdf
Revises: 0051_bitacora
Create Date: 2026-10-23
"""

from __future__ import annotations

from alembic import op

revision = "0052_factura_pdf"
down_revision = "0051_bitacora"
branch_labels = None
depends_on = None


_COLUMNAS = """
ALTER TABLE invoice_receipt
  -- El contrato del proveedor. Agrupa facturas: las cinco de topografía de
  -- camino de DEHC son todas la oferta 24-243-005.
  ADD COLUMN IF NOT EXISTS oferta          text,
  -- Cómo llama el PROVEEDOR al proyecto. No es el WBS: DEHC usa «Ventanas»,
  -- «Las Ventanas» y «Playa Ventanas» para el mismo, así que sirve de pista,
  -- no de llave.
  ADD COLUMN IF NOT EXISTS proyecto        text,
  ADD COLUMN IF NOT EXISTS centro_costo    text,
  -- La referencia del pago que el proveedor imprime en la factura
  -- («14/1/2025 6931813 CR,CD: SERVICIOS FIDUCIARIO, Servicio SINPE»).
  ADD COLUMN IF NOT EXISTS referencia_pago text,
  -- Las líneas como el proveedor las factura: [{n, detalle, monto}]. El monto
  -- es el NETO, sin impuesto, igual que la columna DEBE del PDF.
  ADD COLUMN IF NOT EXISTS pdf_lineas      jsonb;

CREATE INDEX IF NOT EXISTS invoice_receipt_oferta_idx
  ON invoice_receipt (oferta) WHERE oferta IS NOT NULL;
"""


def upgrade() -> None:
    op.execute(_COLUMNAS)
    # ⚠️ El relleno de lo ya cargado NO va acá. Son 230 PDF y abrirlos uno por
    # uno retrasaría el arranque del contenedor —Railway corre `alembic upgrade
    # head` antes de levantar uvicorn—, con el riesgo de que el deploy se caiga
    # por tiempo de espera. Se rellena aparte, con el script de backfill, que
    # además se puede repetir sin consecuencias.


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS invoice_receipt_oferta_idx;")
    op.execute(
        "ALTER TABLE invoice_receipt "
        "  DROP COLUMN IF EXISTS oferta, "
        "  DROP COLUMN IF EXISTS proyecto, "
        "  DROP COLUMN IF EXISTS centro_costo, "
        "  DROP COLUMN IF EXISTS referencia_pago, "
        "  DROP COLUMN IF EXISTS pdf_lineas;"
    )
