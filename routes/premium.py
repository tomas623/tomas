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

# Informe completo (pago único) — mismo valor que en routes/marca.py.
PRECIO_INFORME = float(os.getenv("PRECIO_INFORME_COMPLETO",
                                  os.getenv("PRECIO_CONSULTA_COMPLETA", "9900")))

# 3 tiers de vigilancia (mensual). Anual = 10 meses (2 gratis).
PRECIO_VIGILANCIA_INDIVIDUAL = float(os.getenv("PRECIO_VIGILANCIA_INDIVIDUAL", "4900"))
PRECIO_VIGILANCIA_MULTI = float(os.getenv("PRECIO_VIGILANCIA_MULTI", "9900"))
PRECIO_VIGILANCIA_PORTFOLIO = float(os.getenv("PRECIO_VIGILANCIA_PORTFOLIO", "20000"))

# Legacy (mantengo para compat con código viejo)
PRECIO_PREMIUM_MES = PRECIO_VIGILANCIA_MULTI
PRECIO_PREMIUM_ANUAL = PRECIO_VIGILANCIA_MULTI * 10

PLAN_TIERS = {
    "personal": {
        "nombre": "Personal",
        "marcas_incluidas": 3,
        "precio_mes": PRECIO_VIGILANCIA_INDIVIDUAL,
        "precio_anual": PRECIO_VIGILANCIA_INDIVIDUAL * 10,
        "descripcion": "Persona física o emprendedor con hasta 3 marcas activas.",
    },
    "pyme": {
        "nombre": "PyME",
        "marcas_incluidas": 10,
        "precio_mes": PRECIO_VIGILANCIA_MULTI,
        "precio_anual": PRECIO_VIGILANCIA_MULTI * 10,
        "descripcion": "Empresa con portfolio de marcas y sub-marcas en distintas clases.",
    },
    "agencia": {
        "nombre": "Agencia / Consultora",
        "marcas_incluidas": 20,
        "precio_mes": PRECIO_VIGILANCIA_PORTFOLIO,
        "precio_anual": PRECIO_VIGILANCIA_PORTFOLIO * 10,
        "descripcion": "Agencias de marketing y consultoras que administran marcas de clientes.",
    },
}


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
        aviso = ("Para acceder al panel de marcas necesitás una suscripción de vigilancia activa. "
                 "Elegí el plan que mejor se ajuste y te mandamos las credenciales por email.")
    return render_template_string(
        PREMIUM_PAGE,
        tiers=PLAN_TIERS,
        aviso=aviso,
        precio_informe=PRECIO_INFORME,
    )


@bp.route("/api/premium/iniciar", methods=["POST"])
def iniciar():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    nombre = (data.get("nombre") or "").strip() or None
    telefono = (data.get("telefono") or "").strip() or None
    plan_tier = (data.get("plan_tier") or "pyme").strip().lower()
    if plan_tier not in PLAN_TIERS:
        plan_tier = "pyme"
    plan_freq = (data.get("plan_freq") or "mensual").strip().lower()
    if plan_freq not in ("mensual", "anual"):
        plan_freq = "mensual"
    auto_renew = bool(data.get("auto_renew", True))

    tier_data = PLAN_TIERS[plan_tier]
    monto = tier_data["precio_anual"] if plan_freq == "anual" else tier_data["precio_mes"]

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

        # Si ya tiene una suscripción de vigilancia activa, no duplicamos
        existing = (s.query(SuscripcionVigilancia)
                    .filter_by(user_id=user.id)
                    .filter(SuscripcionVigilancia.tipo.in_(["premium", "vigilancia_individual",
                                                              "vigilancia_multi", "vigilancia_portfolio"]))
                    .filter(SuscripcionVigilancia.status.in_(["active", "pending"]))
                    .first())
        if existing and existing.status == "active":
            return _err("Ya tenés una suscripción activa. Iniciá sesión.", 409)

        nuevo_tipo = f"vigilancia_{plan_tier}"
        sub = existing or SuscripcionVigilancia(
            user_id=user.id, tipo=nuevo_tipo, status="pending",
            monto=monto, plan_freq=plan_freq, auto_renew=auto_renew,
        )
        if existing:
            sub.tipo = nuevo_tipo
            sub.monto = monto
            sub.plan_freq = plan_freq
            sub.auto_renew = auto_renew
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
    desc = (f"LegalPacers Premium {plan_freq.title()} — consultas ilimitadas + "
            "vigilancia hasta 10 marcas")
    pref = create_vigilancia_subscription(
        suscripcion_id=sub_id, email=sub_email,
        monto=monto, descripcion=desc,
        request_host=request.host_url.rstrip("/"),
        plan_freq=plan_freq,
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
<title>Vigilancia de marcas — LegalPacers</title>
<meta name="description" content="Que nadie registre algo parecido a tu marca sin que te enteres. Vigilamos el boletín de marcas y te avisamos por email y WhatsApp para que puedas oponerte a tiempo.">
<link rel="icon" href="/static/logo-icon.png">
<link rel="canonical" href="https://legalpacers.com/premium">
<meta name="theme-color" content="#0D1B4B">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LegalPacers">
<meta property="og:locale" content="es_AR">
<meta property="og:url" content="https://legalpacers.com/premium">
<meta property="og:title" content="Vigilá tu marca: que nadie la copie sin que te enteres">
<meta property="og:description" content="Vigilamos las marcas nuevas y te avisamos por email y WhatsApp si aparece algo parecido a la tuya. Desde un plan mensual, sin permanencia.">
<meta property="og:image" content="https://legalpacers.com/static/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Vigilá tu marca: que nadie la copie sin que te enteres">
<meta name="twitter:description" content="Vigilamos las marcas nuevas y te avisamos por email y WhatsApp si aparece algo parecido a la tuya. Desde un plan mensual, sin permanencia.">
<meta name="twitter:image" content="https://legalpacers.com/static/og-image.png">
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
  .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:28px 0}
  @media(max-width:640px){.compare-grid{grid-template-columns:1fr}}
  .compare-card{background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:24px;
                display:flex;flex-direction:column}
  .compare-card.highlight{border:2px solid #1B6EF3;box-shadow:0 6px 20px rgba(27,110,243,.12)}
  .compare-card h3{margin:6px 0 4px;font-size:20px}
  .compare-tag{display:inline-block;align-self:flex-start;font-size:11px;font-weight:700;
               text-transform:uppercase;letter-spacing:.5px;padding:3px 10px;border-radius:99px;
               background:#F1F5F9;color:#64748b}
  .compare-tag.green{background:#DCFCE7;color:#16A34A}
  .compare-price{font-size:30px;font-weight:800;color:#1B6EF3;margin:6px 0}
  .compare-price small{font-size:14px;font-weight:400;color:#64748b;margin-left:4px}
  .compare-card p{color:#475569;font-size:14px;margin:4px 0 14px}
  .compare-card ul{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:7px;flex:1}
  .compare-card li{display:flex;gap:8px;font-size:13.5px;color:#334155}
  .compare-card li::before{content:'✓';color:#16A34A;font-weight:700}
  .compare-btn{display:block;text-align:center;padding:12px;border-radius:10px;font-weight:700;
               text-decoration:none;font-size:15px;background:#1B6EF3;color:#fff}
  .compare-btn.ghost{background:#fff;color:#1B6EF3;border:1px solid #1B6EF3}
  .faq-q{font-weight:700;color:#0D1B4B;margin:16px 0 4px}
  .faq-a{color:#475569;font-size:14px;margin:0}
</style></head>
<body x-data="premium()">

<nav class="nav"><a href="/">← Volver a la home</a></nav>

<main>
  <span class="badge">Vigilancia de marcas</span>
  <h1>Que nadie registre algo parecido a tu marca sin que te enteres</h1>
  <p style="color:#475569;font-size:17px">
    Vigilamos el boletín oficial de marcas todas las semanas. Si aparece una marca similar
    a las tuyas, te avisamos por email y WhatsApp para que puedas presentar oposición a tiempo.
  </p>

  {% if aviso %}
  <div style="background:#FEF9C3;border:1px solid #FDE68A;color:#854D0E;
              padding:14px 16px;border-radius:10px;margin:12px 0">
    {{ aviso }}
  </div>
  {% endif %}

  <!-- COMPARADOR: informe único vs vigilancia -->
  <h2 style="font-size:22px;margin:28px 0 0">¿Qué necesitás?</h2>
  <p style="color:#64748b;margin:4px 0 0">Dos formas de proteger tu marca, según tu momento.</p>
  <div class="compare-grid">
    <div class="compare-card">
      <span class="compare-tag">Pago único</span>
      <h3>Informe completo</h3>
      <div class="compare-price">${{ "{:,.0f}".format(precio_informe).replace(",", ".") }}<small>una vez</small></div>
      <p>Estás por registrar <strong>una marca puntual</strong> y querés saber ya si está libre y con qué riesgo.</p>
      <ul>
        <li>Lista completa de marcas similares con titular y fecha</li>
        <li>Score léxico, fonético y conceptual con IA</li>
        <li>Probabilidad de registro en las 45 clases</li>
        <li>PDF descargable + cotización de registro</li>
      </ul>
      <a href="/" class="compare-btn ghost">Hacer una búsqueda gratis →</a>
    </div>
    <div class="compare-card highlight">
      <span class="compare-tag green">Suscripción</span>
      <h3>Vigilancia mensual</h3>
      <div class="compare-price">desde ${{ "{:,.0f}".format(tiers.personal.precio_mes).replace(",", ".") }}<small>/ mes</small></div>
      <p>Ya tenés marcas registradas y querés que <strong>nadie las copie</strong> sin que te enteres.</p>
      <ul>
        <li>Escaneo quincenal del boletín oficial de marcas</li>
        <li>Alertas por email y WhatsApp con el plazo de oposición</li>
        <li>Hasta 3, 10 o 20 marcas según el plan</li>
        <li>Panel privado con tus marcas y alertas</li>
      </ul>
      <a href="#planes" class="compare-btn">Ver planes de vigilancia ↓</a>
    </div>
  </div>

  <h2 id="planes" style="font-size:22px;margin:36px 0 0;scroll-margin-top:20px">Planes de vigilancia</h2>

  <!-- TIER PICKER (3 columnas) -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:16px 0">
    {% for key, t in tiers.items() %}
    <label style="border:2px solid #E2E8F0;border-radius:14px;padding:20px;cursor:pointer;
                  transition:.15s;background:#fff{% if key == 'pyme' %};position:relative{% endif %}"
           :style="form.plan_tier==='{{ key }}' ? 'border-color:#1B6EF3;background:#F0F5FF' : ''">
      <input type="radio" value="{{ key }}" x-model="form.plan_tier" style="display:none">
      {% if key == 'pyme' %}
      <div style="position:absolute;top:-10px;right:12px;background:#16A34A;color:#fff;
                  font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px">
        Más elegido
      </div>
      {% endif %}
      <div style="font-weight:700;font-size:18px;color:#0D1B4B">{{ t.nombre }}</div>
      <div style="font-size:32px;font-weight:800;color:#1B6EF3;margin:6px 0 0">
        $<span x-text="(form.plan_freq==='anual' ? {{ t.precio_anual|int }} : {{ t.precio_mes|int }}).toLocaleString('es-AR')"></span>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">
        <span x-text="form.plan_freq==='anual' ? '/ año (10 cuotas)' : '/ mes'"></span>
      </div>
      <div style="font-size:14px;color:#0D1B4B;line-height:1.5">
        Hasta <strong>{{ t.marcas_incluidas }}</strong> marca{% if t.marcas_incluidas > 1 %}s{% endif %} vigilada{% if t.marcas_incluidas > 1 %}s{% endif %}
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:6px">{{ t.descripcion }}</div>
    </label>
    {% endfor %}
  </div>

  <!-- BILLING TOGGLE -->
  <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin:14px 0">
    <span style="font-size:13px;color:#64748b">Mensual</span>
    <label style="position:relative;display:inline-block;width:48px;height:24px;cursor:pointer">
      <input type="checkbox" x-model="anualToggle" @change="form.plan_freq = anualToggle ? 'anual' : 'mensual'"
             style="opacity:0;width:0;height:0">
      <span :style="(anualToggle ? 'background:#1B6EF3' : 'background:#CBD5E1') + ';position:absolute;top:0;left:0;right:0;bottom:0;border-radius:24px;transition:.15s'"></span>
      <span :style="'transform:translateX(' + (anualToggle ? '24px' : '2px') + ');position:absolute;top:2px;left:0;width:20px;height:20px;background:#fff;border-radius:50%;transition:.15s'"></span>
    </label>
    <span style="font-size:13px;color:#0D1B4B;font-weight:600">Anual <span style="background:#DCFCE7;color:#16A34A;font-size:10px;padding:2px 6px;border-radius:99px;margin-left:4px">2 meses GRATIS</span></span>
  </div>

  <div x-show="anualToggle" x-cloak style="text-align:center;color:#16A34A;font-weight:600;font-size:14px;margin:-4px 0 4px">
    Ahorrás $<span x-text="ahorroAnual().toLocaleString('es-AR')"></span> al año con el plan <span x-text="TIERS[form.plan_tier]?.nombre"></span>
  </div>

  <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;
                margin:18px 0;padding:12px;background:#F4F5F9;border-radius:8px">
    <input type="checkbox" x-model="form.auto_renew" style="margin-top:3px">
    <div>
      <div style="font-weight:600">Renovación automática</div>
      <div style="font-size:13px;color:#64748b">
        Activado por defecto. Si lo desactivás, te avisamos antes del vencimiento
        para que renueves manualmente.
      </div>
    </div>
  </label>

  <div class="card">
    <h2>¿Qué incluye?</h2>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Aviso quincenal de similitudes nuevas</strong>
        <span>Cada 15 días escaneamos los boletines nuevos contra tus marcas y te avisamos si aparece algo parecido.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Alertas por email y WhatsApp opcional</strong>
        <span>Te avisamos con el detalle de la marca similar, el titular y el plazo para presentar oposición.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Hasta tu cap de marcas vigiladas según el plan</strong>
        <span>3 marcas (Personal), 10 marcas (PyME) o 20 marcas (Agencia). Las cargás directamente desde tu cuenta o por Excel.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Cuenta privada con tus marcas y alertas</strong>
        <span>Accedés a tu cuenta para ver el historial de alertas recibidas y administrar el portfolio que vigilamos por vos.</span>
      </div>
    </div>

    <div class="feat">
      <div class="check">✓</div>
      <div class="feat-text">
        <strong>Sin permanencia · cancelás cuando quieras</strong>
        <span>Si decidís cancelar, mantenés el acceso hasta el fin del período pagado.</span>
      </div>
    </div>

    <div style="border-top:1px solid #E2E8F0;margin:18px 0 0;padding-top:14px;font-size:13px;color:#64748b">
      <strong>Importante:</strong> la suscripción cubre vigilancia + alertas. La
      <strong>presentación de oposiciones</strong> es un servicio aparte que se cotiza por caso
      (es trabajo de abogado y depende de la complejidad). Cuando llega una alerta relevante,
      te pasamos la cotización antes de avanzar.
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

    <label>Teléfono (opcional)</label>
    <div style="display:grid;grid-template-columns:200px 1fr;gap:8px">
      <select x-model="form.tel_cc">
        <template x-for="c in COUNTRY_CODES" :key="c.iso">
          <option :value="c.code" x-text="c.flag + ' ' + c.name + ' (+' + c.code + ')'"></option>
        </template>
      </select>
      <input type="tel" x-model="form.tel_num" :placeholder="form.tel_cc === '54' ? '9 11 1234-5678' : 'Número'">
    </div>

    <button @click="iniciar()" :disabled="cargando">
      <span x-show="!cargando">
        Pagar y activar — $<span x-text="precioActual().toLocaleString('es-AR')"></span>
        <span x-text="form.plan_freq==='anual' ? '/ año' : '/ mes'"></span>
      </span>
      <span x-show="cargando" x-cloak>Generando link de pago…</span>
    </button>

    <template x-if="errorMsg">
      <div class="err" x-text="errorMsg"></div>
    </template>

    <p class="micro">El pago se procesa con Mercado Pago. Podés cancelar la suscripción cuando quieras desde tu panel.</p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Preguntas sobre los planes</h2>

    <div class="faq-q">¿Me conviene el informe único o la vigilancia?</div>
    <p class="faq-a">El <strong>informe único</strong> es para un momento puntual: estás por registrar
      una marca y querés saber si está libre. La <strong>vigilancia</strong> es continua: ya tenés
      marcas y querés que te avisemos si alguien intenta registrar algo parecido. Muchos arrancan
      con el informe y después suman vigilancia.</p>

    <div class="faq-q">¿La presentación de la oposición está incluida?</div>
    <p class="faq-a">No. La suscripción cubre la vigilancia y las alertas. Presentar una oposición es
      trabajo de abogado y se cotiza por caso según la complejidad. Cuando llega una alerta relevante,
      te pasamos la cotización antes de avanzar.</p>

    <div class="faq-q">¿Qué pasa si cancelo?</div>
    <p class="faq-a">No hay permanencia. Si cancelás, mantenés el acceso y la vigilancia hasta el final
      del período que ya pagaste.</p>

    <div class="faq-q">¿Puedo cambiar de plan más adelante?</div>
    <p class="faq-a">Sí. Si tu portfolio crece, podés pasar a un plan con más marcas vigiladas desde tu panel.</p>

    <div class="faq-q">¿El plan anual tiene descuento?</div>
    <p class="faq-a">Sí: pagás 10 meses y tenés 12 de cobertura. Son 2 meses gratis frente a pagar mes a mes.</p>
  </div>
</main>

<script>
const TIERS = {
{% for key, t in tiers.items() %}
  "{{ key }}": {nombre:"{{ t.nombre }}", marcas:{{ t.marcas_incluidas }}, precio_mes:{{ t.precio_mes|int }}, precio_anual:{{ t.precio_anual|int }}},
{% endfor %}
};

const COUNTRY_CODES = [
  {iso:'AR', code:'54', name:'Argentina', flag:'🇦🇷'},
  {iso:'UY', code:'598', name:'Uruguay', flag:'🇺🇾'},
  {iso:'CL', code:'56', name:'Chile', flag:'🇨🇱'},
  {iso:'BR', code:'55', name:'Brasil', flag:'🇧🇷'},
  {iso:'PY', code:'595', name:'Paraguay', flag:'🇵🇾'},
  {iso:'BO', code:'591', name:'Bolivia', flag:'🇧🇴'},
  {iso:'PE', code:'51', name:'Perú', flag:'🇵🇪'},
  {iso:'CO', code:'57', name:'Colombia', flag:'🇨🇴'},
  {iso:'VE', code:'58', name:'Venezuela', flag:'🇻🇪'},
  {iso:'EC', code:'593', name:'Ecuador', flag:'🇪🇨'},
  {iso:'MX', code:'52', name:'México', flag:'🇲🇽'},
  {iso:'US', code:'1', name:'Estados Unidos', flag:'🇺🇸'},
  {iso:'ES', code:'34', name:'España', flag:'🇪🇸'},
  {iso:'IT', code:'39', name:'Italia', flag:'🇮🇹'},
  {iso:'FR', code:'33', name:'Francia', flag:'🇫🇷'},
  {iso:'DE', code:'49', name:'Alemania', flag:'🇩🇪'},
  {iso:'UK', code:'44', name:'Reino Unido', flag:'🇬🇧'},
];

function premium(){
  return {
    COUNTRY_CODES,
    TIERS,
    form: {email:'', nombre:'', tel_cc:'54', tel_num:'',
            plan_tier:'pyme', plan_freq:'mensual', auto_renew: true},
    anualToggle: false,
    cargando: false,
    errorMsg: '',
    precioActual(){
      const tier = TIERS[this.form.plan_tier] || TIERS.pyme;
      return this.form.plan_freq === 'anual' ? tier.precio_anual : tier.precio_mes;
    },
    ahorroAnual(){
      const tier = TIERS[this.form.plan_tier] || TIERS.pyme;
      return tier.precio_mes * 12 - tier.precio_anual;
    },
    async iniciar(){
      if(!this.form.email.trim()){
        this.errorMsg = 'Ingresá tu email para continuar.';
        return;
      }
      this.errorMsg = '';
      this.cargando = true;
      const telefonoFull = this.form.tel_num.trim()
        ? '+' + this.form.tel_cc + this.form.tel_num.replace(/[^\d]/g,'')
        : '';
      try {
        const r = await fetch('/api/premium/iniciar', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            email: this.form.email,
            nombre: this.form.nombre,
            telefono: telefonoFull,
            plan_tier: this.form.plan_tier,
            plan_freq: this.form.plan_freq,
            auto_renew: this.form.auto_renew,
          }),
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
