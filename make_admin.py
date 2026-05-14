"""
Crear o promover un usuario a admin (acceso full al panel sin pagar Premium).

Uso (con el venv activado):
  python make_admin.py tu@email.com tuPasswordSegura

Si el usuario existe, lo marca is_admin=True (y le actualiza la password si pasás
una segunda diferente). Si no existe, lo crea con esa password y is_admin=True.

Una vez creado, podés loguearte en /login con ese email + password y entrar a
/dashboard sin necesidad de tener una suscripción Premium activa.
"""

import sys

from database import User, get_session, init_db
from services.auth import hash_password


def main():
    if len(sys.argv) < 3:
        print("Uso: python make_admin.py EMAIL PASSWORD")
        sys.exit(2)

    email = sys.argv[1].strip().lower()
    password = sys.argv[2]

    if "@" not in email or "." not in email:
        print(f"Email inválido: {email!r}")
        sys.exit(2)
    if len(password) < 8:
        print("La password debe tener al menos 8 caracteres")
        sys.exit(2)

    init_db()
    with get_session() as s:
        user = s.query(User).filter_by(email=email).first()
        if user:
            user.is_admin = True
            user.password_hash = hash_password(password)
            print(f"OK: usuario existente {email} promovido a admin (password actualizada).")
        else:
            user = User(
                email=email,
                password_hash=hash_password(password),
                is_admin=True,
                email_verified=True,
            )
            s.add(user)
            print(f"OK: admin creado — {email}")
        s.commit()

    print()
    print(f"Entrá en http://127.0.0.1:5000/login")
    print(f"  Email:      {email}")
    print(f"  Password:   {password}")
    print(f"  Después podés ir directo a /dashboard sin pagar Premium.")


if __name__ == "__main__":
    main()
