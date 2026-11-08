"""La clave la pone el dueño de la cuenta, no el administrador.

Estas pruebas no tocan la base: blindan las dos decisiones que, si alguien las
deshace sin querer, no se notan hasta que es tarde.

1. **El token de invitación se guarda hasheado.** Si alguien vuelve a guardarlo
   en claro, leer `user_invite` alcanzaría para entrar como cualquiera.
2. **La política de contraseña se valida en el servidor.** La pantalla ya la
   avisa, pero la pantalla se puede saltar: `curl` contra el endpoint, no.
"""

from __future__ import annotations

import pytest
from app.core.security import (
    INVITE_DAYS,
    PasswordDebil,
    hash_invite_token,
    nueva_invitacion,
    validar_password,
)


def test_el_token_no_viaja_en_claro_a_la_base() -> None:
    token, guardado = nueva_invitacion()
    assert token not in guardado, "el token no puede aparecer dentro de lo que se guarda"
    assert len(guardado) == 64, "sha256 en hexadecimal"
    assert guardado == hash_invite_token(token), "el hash tiene que ser reproducible"


def test_dos_invitaciones_nunca_son_la_misma() -> None:
    a, _ = nueva_invitacion()
    b, _ = nueva_invitacion()
    assert a != b
    assert len(a) >= 40, "32 bytes en base64url; corto seria adivinable"


def test_un_token_distinto_da_un_hash_distinto() -> None:
    token, guardado = nueva_invitacion()
    assert hash_invite_token(token + "x") != guardado


@pytest.mark.parametrize(
    ("clave", "motivo"),
    [
        ("corta1", "menos de 10 caracteres"),
        ("solamenteletras", "sin números"),
        ("1234567890", "sin letras"),
        ("", "vacía"),
        ("   corta1   ", "corta aun sin los espacios"),
    ],
)
def test_claves_que_el_servidor_rechaza(clave: str, motivo: str) -> None:
    with pytest.raises(PasswordDebil):
        validar_password(clave)


@pytest.mark.parametrize("clave", ["Ventanas2026", "a1b2c3d4e5", "Corcovado-2026!"])
def test_claves_que_el_servidor_acepta(clave: str) -> None:
    assert validar_password(clave) == clave.strip()


def test_la_invitacion_vence() -> None:
    """Un link que no vence es una llave que anda para siempre."""
    assert INVITE_DAYS > 0
    assert INVITE_DAYS <= 30, "más de un mes ya no es una invitación, es una puerta abierta"
