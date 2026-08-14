#!/usr/bin/env python3
"""Alta de acceso para un usuario que ya existe en app_user.

Para qué: la migración 0002 crea los cinco usuarios del proyecto SIN correo y
SIN contraseña, y en producción `dev-login` devuelve 404. Sin esto no hay por
dónde entrar la primera vez. También es la salida si alguien queda afuera.

Una vez adentro, el resto de los usuarios se cargan desde /admin, que hace
exactamente lo mismo (app/routers/admin.py).

Uso:
    $env:DATABASE_URL = "postgresql://...:...@...proxy.rlwy.net:PUERTO/railway"
    python etl/set_password.py bismark --email fc@empresa.com

La contraseña nunca se guarda en claro: va el hash bcrypt, igual que en
app/core/security.py.
"""

import argparse
import getpass
import os
import secrets
import sys
from pathlib import Path

try:
    import bcrypt
    import psycopg
except ImportError:
    sys.exit("Faltan dependencias: pip install 'psycopg[binary]' bcrypt")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("username", help="username en app_user (bismark, blake, ...)")
    ap.add_argument("--email", required=True, help="correo con el que va a iniciar sesión")
    ap.add_argument("--password", help="si se omite, se pide por teclado sin mostrarla")
    ap.add_argument(
        "--random",
        action="store_true",
        help="genera una clave fuerte y la escribe en --out; no la muestra en pantalla",
    )
    ap.add_argument("--out", default="clave_inicial.txt", help="archivo destino de --random")
    ap.add_argument("--pg", default=os.environ.get("DATABASE_URL"), help="URL Postgres")
    a = ap.parse_args()

    if not a.pg:
        raise SystemExit("Falta --pg o la variable DATABASE_URL")
    # OJO: forma libpq. La del servicio api lleva '+psycopg' y acá no sirve.
    if "+psycopg" in a.pg:
        raise SystemExit(
            "La URL lleva '+psycopg', que es la forma de SQLAlchemy.\n"
            "Usá el DATABASE_PUBLIC_URL del plugin de Postgres, que empieza con 'postgresql://'."
        )

    if a.random:
        # Para el arranque: la clave no pasa por pantalla ni por el historial de
        # la terminal. Queda en un archivo que se borra después de entrar.
        password = secrets.token_urlsafe(18)
    else:
        password = a.password or getpass.getpass("Contraseña nueva: ")
    if len(password) < 8:
        raise SystemExit("Contraseña muy corta: mínimo 8 caracteres.")

    email = a.email.strip().lower()
    # bcrypt topa a 72 bytes; se trunca igual que en app/core/security.py.
    hashed = bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")

    with psycopg.connect(a.pg) as cx, cx.cursor() as c:
        # Autor para los triggers de auditoría (set_config, nunca SET).
        c.execute("SELECT set_config('app.user_id', %s, false)", ("bootstrap",))

        c.execute("SELECT id FROM app_user WHERE username = %s", (a.username,))
        row = c.fetchone()
        if row is None:
            c.execute("SELECT username FROM app_user ORDER BY id")
            existentes = ", ".join(r[0] for r in c.fetchall()) or "(ninguno)"
            raise SystemExit(
                f"No existe el usuario '{a.username}' en app_user.\nDisponibles: {existentes}"
            )
        uid = row[0]

        # El login busca por lower(email) y exige is_active.
        c.execute(
            "UPDATE app_user SET email = %s, is_active = true WHERE id = %s",
            (email, uid),
        )
        c.execute(
            "INSERT INTO user_credential (user_id, password_hash) VALUES (%s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
            "updated_at = now()",
            (uid, hashed),
        )
        cx.commit()

    print(f"Listo. '{a.username}' (id {uid}) ya entra con {email}")
    if a.random:
        destino = Path(a.out).resolve()
        destino.write_text(
            f"Usuario : {email}\nClave   : {password}\n\n"
            "Cambiala desde /admin apenas entres y borrá este archivo.\n",
            encoding="utf-8",
        )
        print(f"La clave quedó en: {destino}")
        print("Cambiala desde /admin apenas entres y borrá ese archivo.")


if __name__ == "__main__":
    main()
