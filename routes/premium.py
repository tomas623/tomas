"""
Suscripción Premium — $30.000/mes con consultas ilimitadas, vigilancia de
hasta 10 marcas y panel completo.

Flujo:
1. Usuario va a /premium, lee qué incluye, completa email + nombre + tel.
2. POST /api/premium/iniciar:
   - Si no existe User, crea uno con password aleatorio.
   - Crea SuscripcionVigilancia(tipo='premium', status='pending', monto=30000).
   - Guarda la password en texto plano en metadata_json (se borra apenas se manda).
   - Crea preapproval MP y devuelve init_point.
3. Webhook MP marca la suscripción como 'active' y dispara el envío de credenciales.
4. Usuario recibe email con email + password + link a /login. Puede cambiar la
   password desde /dashboard cuando entra.

Notas:
- Reutilizamos SuscripcionVigilancia con tipo='premium'. _has_unlimited_searches
  ya lo reconoce porque solo chequea status='active'.
- El cap de 10 marcas vigiladas se controla en el endpoint que activa vigilancia
  cuando el usuario tiene una premium activa (próxima iteración).
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import string

from flask import Blueprint, jsonify, render_template_string, request

from database import SuscripcionVigilancia, User, get_session
from services.auth import hash_password

logger = logging.getLogger(__name__)
bp = Blueprint("premium", __name__)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PRECIO_PREMIUM_MES = float(os.getenv("PRECIO_PREMIUM_MES", "30000"))


def _ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status


def _err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


def _generate_password(length: int = 12) -> str:
    """Genera una password legible (sin caracteres ambiguos)."""
    alphabet = string.ascii_letters + string.digits
    alphabet = alphabet.translate(str.maketrans("", "", "Il1O0o"))
    return "".join(secrets.choice(alphabet) for _ in range(length))


@bp.route("/premium")
def premium_page():
    reason = request.args.get("reason", "")
    aviso = ""
    if reason == "needs_subscription":
        aviso = ("Para acceder al panel necesitás una suscripción Premium activa. "
                 "Suscribite acá abajo y te mandamos las credenciales por email.")
    return render_template_string(
        PREMIUM_PAGE, precio=int(PRECIO_PREMIUM_MES), aviso=aviso,
    )


@bp.route("/api/premium/iniciar", methods=["POST"])
def iniciar():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    nombre = (data.get("nombre") or "").strip() or None
    telefono = (data.get("telefono") or "").strip() or None

    if not EMAIL_RE.match(email):
        return _err("Email inválido")

    with get_session() as s:
        user = s.query(User).filter_by(email=email).first()
        new_password = None
        if not user:
            new_password = _generate_password()
            user = User(
                email=email,
                password_hash=hash_password(new_password),
                nombre=nombre, telefono=telefono,
            )
            s.add(user)
            s.flush()  # obtener user.id
        else:
            # Si existe pero no tiene password (solo magic link), seteamos una nueva.
            if not user.password_hash:
                new_password = _generate_password()
                user.password_hash = hash_password(new_password)
            if nombre and not user.nombre:
                user.nombre = nombre
            if telefono and not user.telefono:
                user.telefono = telefono

        # Si ya tiene una premium activa, no duplicamos
        existing = (s.query(SuscripcionVigilancia)
                    .filter_by(user_id=user.id, tipo="premium")
                    .filter(SuscripcionVigilancia.status.in_(["active", "pending"]))
                    .first())
        if existing and existing.status == "active":
            return _err("Ya tenés una suscripción premium activa. Iniciá sesión.", 409)

        sub = existing or SuscripcionVigilancia(
            user_id=user.id, tipo="premium", status="pending",
            monto=PRECIO_PREMIUM_MES,
        )
        # Guardamos la password temporal hasta el envío de credenciales
        sub.metadata_json = {
            "pending_password": new_password,
            "first_signup": new_password is not None,
        } if new_password else (sub.metadata_json or {})
        if not existing:
            s.add(sub)
        s.commit()
        s.refresh(sub)
        sub_id = sub.id
        sub_email = user.email

    # Crear preapproval MP
    from services.mercadopago import create_vigilancia_subscription
    pref = create_vigilancia_subscription(
        suscripcion_id=sub_id, email=sub_email,
        monto=PRECIO_PREMIUM_MES,
        descripcion="LegalPacers Premium — consultas ilimitadas + vigilancia hasta 10 marcas",
        request_host=request.host_url.rstrip("/"),
    )

    if not pref.get("init_point"):
        return _err("No pudimos iniciar el pago. Probá de nuevo.", 502)

    return _ok({
        "suscripcion_id": sub_id,
        "init_point": pref["init_point"],
        "dev": pref.get("dev", False),
    })


# ─────────────────────────────────────────────────────────────────────
# Página HTML
# ─────────────────────────────────────────────────────────────────────

PREMIUM_PAGE = """<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suscripción Premium — LegalPacers</title>
<script defer src="https://unpkg.com/alpinejs@3.13.0/dist/cdn.min.js"></script>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F4F5F9;color:#0D1B4B;line-height:1.55}
  .nav{background:#fff;border-bottom:1px solid #E2E8F0;padding:14px 32px}
  .nav a{color:#1B6EF3;text-decoration:none;font-weight:600}
  main{max-width:760px;margin:40px auto;padding:0 24px}
  h1{font-size:36px;margin:0 0 8px;line-height:1.2}
  .price-box{background:linear-gradient(135deg,#1B6EF3,#0D1B4B);color:#fff;
             border-radius:14px;padding:28px;margin:24px 0;text-align:center}
  .price{font-size:48px;font-weight:800;letter-spacing:-1px}
  .price small{font-size:16px;opacity:.85;display:block;font-weight:400;margin-top:4px}
  .card{background:#fff;border-radius:14px;padding:28px;margin-bottom:20px;
        box-shadow:0 1px 4px rgba(0,0,0,.04)}
  .card h2{margin-top:0;font-size:22px}
  .feat{display:flex;gap:14px;align-items:flex-start;margin:14px 0}
  .feat .check{flex:0 0 28px;height:28px;border-radius:50%;background:#1B6EF3;
              color:#fff;display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:14px}
  .feat-text strong{display:block;margin-bottom:2px}
  .feat-text span{color:#64748b;font-size:14px}
  label{display:block;font-weight:600;font-size:14px;margin:14px 0 4px}
  input{width:100%;padding:12px;border:1px solid #E2E8F0;border-radius:10px;
        font-size:15px;font-family:inherit}
  button{width:100%;padding:14px;background:#1B6EF3;color:#fff;border:none;
         border-radius:10px;font-weight:700;font-size:16px;cursor:pointer;
         margin-top:18px}
  button:hover{background:#1656c4}
  button:disabled{background:#94a3b8;cursor:wait}
  .err{background:#FEE2E2;color:#991B1B;padding:12px;border-radius:8px;
       margin-top:14px;font-size:14px}
  .micro{color:#64748b;font-size:13px;margin-top:16px;text-align:center}
  .badge{display:inline-block;background:#DBEAFE;color:#1B6EF3;padding:4px 12px;
         border-radius:99px;font-size:12px;font-weight:700;margin-bottom:12px;
         text-transform:uppercase;letter-spacing:.5px}
</style></head>
<body x-data="premium()">

<nav class="nav"><a href="/">← Volver a la home</a></nav>

<main>
  <span class="badge">Plan Premium</span>
  <h1>Consultas ilimitadas + vigilancia automática</h1>
  <p style="color:#475569;font-size:17px">
    Para quienes manejan varias marcas y necesitan validar nombres seguido sin
    pagar consulta por consulta.
  </p>

  {% if aviso %}
  <div style="background:#FEF9C3;border:1px solid #FDE68A;color:#854D0E;
              padding:14px 16px;border-radius:10px;margin:12px 0">
    {{ aviso }}
  </div>
  {% endif %}

  <div class="price-box">
    <div class="price">${{ "{:,}".format(precio).replace(",", ".") }}<small>ARS / mes — cancelás cuando quieras</small></div>
  </div>

  <div class="card">
    <h2>¿Qué incluye?</h2>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Consultas y análisis completos ilimitados</strong>
        <span>Sin el límite de 3 búsquedas por semana. Acceso al análisis de confundibilidad en las 45 clases para cada marca.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Vigilancia automática de hasta 10 marcas</strong>
        <span>Cada semana revisamos el boletín del INPI y te avisamos si aparece alguna marca similar a las tuyas.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Aviso de declaración de uso (5 años) y vencimiento (10 años)</strong>
        <span>No te olvidás de los hitos legales que mantienen tus marcas vigentes.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Panel de marcas</strong>
        <span>Cargás todas tus marcas (registradas o en trámite) y seguís fechas y estados en un solo lugar.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Sin permanencia</strong>
        <span>Cancelás desde tu panel cuando quieras, sin penalidad.</span>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Cómo funciona</h2>
    <p style="margin:8px 0">
      <strong>1.</strong> Completás email y datos abajo, te llevamos a Mercado Pago.<br>
      <strong>2.</strong> Pagás la primera mensualidad de forma segura.<br>
      <strong>3.</strong> Recibís un mail con tu usuario y contraseña para entrar al panel.<br>
      <strong>4.</strong> Cargás tus marcas y empezás a usar la suscripción.
    </p>
  </div>

  <div class="card">
    <h2>Datos para la suscripción</h2>
    <label for="email">Email *</label>
    <input id="email" type="email" x-model="form.email" placeholder="vos@empresa.com" required>

    <label for="nombre">Nombre</label>
    <input id="nombre" type="text" x-model="form.nombre" placeholder="Cómo querés que te llamemos">

    <label for="telefono">Teléfono (opcional)</label>
    <input id="telefono" type="tel" x-model="form.telefono" placeholder="+54 9 11 ...">

    <button @click="iniciar()" :disabled="cargando">
      <span x-show="!cargando">Pagar y activar — ${{ "{:,}".format(precio).replace(",", ".") }} / mes</span>
      <span x-show="cargando" x-cloak>Generando link de pago…</span>
    </button>

    <template x-if="errorMsg">
      <div class="err" x-text="errorMsg"></div>
    </template>

    <p class="micro">El pago se procesa con Mercado Pago. Podés cancelar la suscripción cuando quieras desde tu panel.</p>
  </div>
</main>

<script>
function premium(){
  return {
    form: {email:'', nombre:'', telefono:''},
    cargando: false,
    errorMsg: '',
    async iniciar(){
      if(!this.form.email.trim()){
        this.errorMsg = 'Ingresá tu email para continuar.';
        return;
      }
      this.errorMsg = '';
      this.cargando = true;
      try {
        const r = await fetch('/api/premium/iniciar', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(this.form),
        });
        const d = await r.json();
        if(!d.ok){
          this.errorMsg = d.error || 'No pudimos iniciar la suscripción.';
        } else if(d.data.init_point){
          window.location.href = d.data.init_point;
        } else {
          this.errorMsg = 'No recibimos un link de pago. Intentá de nuevo.';
        }
      } catch(e){
        this.errorMsg = 'Error de red. Probá de nuevo.';
      } finally {
        this.cargando = false;
      }
    },
  };
}
</script>
</body></html>
"""
