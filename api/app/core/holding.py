"""Cuenta destino fija del holding (Ventanas Holding Company).

Todo lo que se le pide a corporativo (transferencias SEND) llega a la misma
cuenta; por eso una línea del Short Payment sin banco propio muestra este banco.
`HOLDING_SEND` es el bloque completo que sale en el PDF de Breakdown.
"""

from __future__ import annotations

# Como está escrito en el Excel / en el catálogo de payees (ojo: doble espacio).
HOLDING_BANK = "3-102-915382  S.R.L (Ventanas Holding Company)"

HOLDING_SEND = {
    "bank": "LAFISE",
    "beneficiary": "3-102-915382 S.R.L",
    "iban": "CR49011400 00781326587 5",
}
