"""
Diagnóstico de un usuario: muestra is_admin, suscripción Premium, fechas.

Uso:
  python diag_user.py tu@email.com
"""

import sys
from datetime import datetime
from database import SuscripcionVigilancia, User, get_session, init_db


def main():
    if len(sys.argv) < 2:
        print("Uso: python diag_user.py EMAIL")
        sys.exit(2)
    email = sys.argv[1].strip().lower()
    init_db()

    with get_session() as s:
        u = s.query(User).filter_by(email=email).first()
        if not u:
            print(f"❌ Usuario {email} no encontrado.")
            sys.exit(1)

        print("=" * 60)
        print(f"  Usuario: {u.email}")
        print("=" * 60)
        print(f"  id            : {u.id}")
        print(f"  nombre        : {u.nombre or '—'}")
        print(f"  is_admin      : {u.is_admin!r}   {'✓' if u.is_admin else '✗ NO ES ADMIN'}")
        print(f"  email_verified: {u.email_verified!r}")
        print(f"  password_hash : {'sí (bcrypt)' if u.password_hash else '✗ NO TIENE'}")
        print(f"  last_login_at : {u.last_login_at}")
        print(f"  created_at    : {u.created_at}")
        print()

        # Suscripciones
        subs = s.query(SuscripcionVigilancia).filter_by(user_id=u.id).all()
        print(f"  Suscripciones ({len(subs)}):")
        if not subs:
            print("    (ninguna)")
        for sub in subs:
            print(f"    #{sub.id}  tipo={sub.tipo}  status={sub.status}  monto=${sub.monto}")
            print(f"           plan_freq={sub.plan_freq}  auto_renew={sub.auto_renew}")
            print(f"           paid_through={sub.paid_through_date}")

        print()
        # Diagnóstico
        from services.auth import has_active_premium
        # Necesitamos detach el user para que has_active_premium funcione fuera de sesión
        s.expunge(u)

    has_prem = has_active_premium(u)
    print(f"  has_active_premium() → {has_prem}   "
          f"{'✓ acceso al panel' if has_prem else '✗ SIN ACCESO'}")
    print()

    if not u.is_admin:
        print("  💡 Tu usuario NO está marcado como admin.")
        print(f"     Corré:   python make_admin.py {email} TuPasswordSegura")


if __name__ == "__main__":
    main()
