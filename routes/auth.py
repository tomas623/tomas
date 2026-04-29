"""
Rutas de autenticación (Blueprint /auth y /api/auth).

Flujos soportados:
- Signup con email + password (opcional — el cliente puede solo usar magic link)
- Login con email + password
- Magic link: pedir → recibir email → click → sesión iniciada
- Logout
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime

from flask import Blueprint, jsonify, redirect, render_template_string, request, url_for

from database import User, get_session
from services.auth import (
    consume_magic_token, create_magic_token, current_user, hash_password,
    link_pending_records, login_user, logout_user, verify_password,
)
from services.email import send_email, template_magic_link

logger = logging.getLogger(__name__)

bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _ok(data: dict, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _err(msg: str, status: int = 400):
    return jsonify({"ok": False, "error": msg}), status


# ─────────────────────────────────────────────────────────────────────
# API JSON
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/auth/signup", methods=["POST"])
def api_signup():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()
    nombre = (data.get("nombre") or "").strip() or None
    telefono = (data.get("telefono") or "").strip() or None

    if not EMAIL_RE.match(email):
        return _err("Email inválido")
    if len(password) < 8:
        return _err("La contraseña debe tener al menos 8 caracteres")

    with get_session() as s:
        existing = s.query(User).filter_by(email=email).first()
        if existing:
            # Si ya existe sin password (creado vía magic link), permitir setear password
            if not existing.password_hash:
                existing.password_hash = hash_password(password)
                if nombre and not existing.nombre:
                    existing.nombre = nombre
                if telefono and not existing.telefono:
                    existing.telefono = telefono
                existing.last_login_at = datetime.utcnow()
                s.commit()
                s.refresh(existing)
                s.expunge(existing)
                login_user(existing)
                link_pending_records(existing)
                return _ok({"user_id": existing.id, "email": existing.email})
            return _err("Ya existe una cuenta con ese email", 409)

        user = User(
            email=email,
            password_hash=hash_password(password),
            nombre=nombre,
            telefono=telefono,
            last_login_at=datetime.utcnow(),
        )
        s.add(user)
        s.commit()
        s.refresh(user)
        s.expunge(user)

    login_user(user)
    link_pending_records(user)
    return _ok({"user_id": user.id, "email": user.email}, 201)


@bp.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not EMAIL_RE.match(email) or not password:
        return _err("Email y contraseña son requeridos")

    with get_session() as s:
        user = s.query(User).filter_by(email=email).first()
        if not user or not user.password_hash:
            return _err("Credenciales inválidas", 401)
        if not verify_password(password, user.password_hash):
            return _err("Credenciales inválidas", 401)
        user.last_login_at = datetime.utcnow()
        s.commit()
        s.refresh(user)
        s.expunge(user)

    login_user(user)
    link_pending_records(user)
    return _ok({"user_id": user.id, "email": user.email})


@bp.route("/api/auth/magic/request", methods=["POST"])
def api_magic_request():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email):
        return _err("Email inválido")

    token = create_magic_token(email)
    base = os.getenv("APP_BASE_URL", request.host_url.rstrip("/"))
    magic_url = f"{base}/auth/magic/{token}"

    subject, html, text = template_magic_link(magic_url)
    send_email(email, subject, html, text=text)
    logger.info(f"Magic link enviado a {email}")

    return _ok({"sent": True, "email": email})


@bp.route("/api/auth/logout", methods=["POST"])
def api_logout():
    logout_user()
    return _ok({"ok": True})


@bp.route("/api/auth/me", methods=["GET"])
def api_me():
    u = current_user()
    if not u:
        return _ok({"authenticated": False})
    return _ok({
        "authenticated": True,
        "user_id": u.id,
        "email": u.email,
        "nombre": u.nombre,
        "is_admin": u.is_admin,
    })


# ─────────────────────────────────────────────────────────────────────
# Páginas HTML
# ─────────────────────────────────────────────────────────────────────

LOGIN_PAGE = """<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingresar — LegalPacers</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f5f9;color:#0D1B4B;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#fff;border-radius:14px;padding:40px;max-width:420px;width:100%;
        box-shadow:0 4px 24px rgba(13,27,75,.08)}
  .logo{font-weight:800;font-size:18px;letter-spacing:.5px;margin-bottom:8px}
  .logo .accent{color:#1B6EF3}
  h1{margin:0 0 24px;font-size:22px}
  .tabs{display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid #e2e8f0}
  .tab{flex:1;padding:12px 0;text-align:center;cursor:pointer;font-weight:600;color:#64748b;
       border-bottom:2px solid transparent;transition:.15s}
  .tab.active{color:#1B6EF3;border-bottom-color:#1B6EF3}
  label{display:block;margin:14px 0 6px;font-size:13px;font-weight:600}
  input{width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-size:15px;font-family:inherit}
  input:focus{outline:none;border-color:#1B6EF3;box-shadow:0 0 0 3px rgba(27,110,243,.1)}
  button{width:100%;padding:13px;background:#1B6EF3;color:#fff;border:none;border-radius:8px;
         font-size:15px;font-weight:600;cursor:pointer;margin-top:18px}
  button:hover{background:#1656c4}
  button:disabled{background:#93AEDB;cursor:not-allowed}
  button.secondary{background:#fff;color:#1B6EF3;border:1px solid #1B6EF3;margin-top:8px}
  .hint{font-size:13px;color:#64748b;margin-top:8px}
  .msg{margin-top:14px;padding:10px;border-radius:8px;font-size:13px;display:none}
  .msg.err{background:#FEF2F2;color:#DC2626;display:block}
  .msg.ok{background:#DCFCE7;color:#16A34A;display:block}
  .pane{display:none}.pane.active{display:block}
  a{color:#1B6EF3}
</style></head>
<body>
<div class="card">
  <div class="logo">LEGAL<span class="accent">PACERS</span></div>
  <h1>Ingresá al portal</h1>
  <div class="tabs">
    <div class="tab active" data-pane="magic">Por email</div>
    <div class="tab" data-pane="password">Con contraseña</div>
    <div class="tab" data-pane="signup">Crear cuenta</div>
  </div>

  <div class="pane active" id="pane-magic">
    <form onsubmit="event.preventDefault();sendMagic()">
      <label>Tu email</label>
      <input type="email" id="m_email" placeholder="vos@empresa.com" required>
      <button>Enviarme un enlace</button>
      <p class="hint">Te llegará un enlace válido por 15 minutos. Sin contraseña.</p>
    </form>
  </div>

  <div class="pane" id="pane-password">
    <form onsubmit="event.preventDefault();doLogin()">
      <label>Email</label>
      <input type="email" id="l_email" required>
      <label>Contraseña</label>
      <input type="password" id="l_password" required>
      <button>Ingresar</button>
    </form>
  </div>

  <div class="pane" id="pane-signup">
    <form onsubmit="event.preventDefault();doSignup()">
      <label>Email</label>
      <input type="email" id="s_email" required>
      <label>Nombre</label>
      <input type="text" id="s_nombre">
      <label>Teléfono (opcional)</label>
      <input type="tel" id="s_telefono">
      <label>Contraseña (mínimo 8)</label>
      <input type="password" id="s_password" minlength="8" required>
      <button>Crear cuenta</button>
    </form>
  </div>

  <div id="msg" class="msg"></div>
</div>

<script>
  document.querySelectorAll('.tab').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('pane-'+t.dataset.pane).classList.add('active');
      msg('');
    };
  });
  function msg(text, ok=false){
    const el=document.getElementById('msg');
    if(!text){el.className='msg';el.textContent='';return;}
    el.className='msg '+(ok?'ok':'err');
    el.textContent=text;
  }
  async function post(url, body){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status, body: await r.json()};
  }
  async function sendMagic(){
    msg('');
    const email=document.getElementById('m_email').value;
    const r=await post('/api/auth/magic/request',{email});
    if(r.body.ok) msg('Te enviamos un enlace a '+email+'. Revisá tu bandeja.', true);
    else msg(r.body.error||'Error');
  }
  async function doLogin(){
    msg('');
    const email=document.getElementById('l_email').value;
    const password=document.getElementById('l_password').value;
    const r=await post('/api/auth/login',{email,password});
    if(r.body.ok){window.location.href=new URLSearchParams(location.search).get('next')||'/dashboard';}
    else msg(r.body.error||'Error');
  }
  async function doSignup(){
    msg('');
    const body={
      email:document.getElementById('s_email').value,
      nombre:document.getElementById('s_nombre').value,
      telefono:document.getElementById('s_telefono').value,
      password:document.getElementById('s_password').value,
    };
    const r=await post('/api/auth/signup',body);
    if(r.body.ok){window.location.href=new URLSearchParams(location.search).get('next')||'/dashboard';}
    else msg(r.body.error||'Error');
  }
</script>
</body></html>"""


@bp.route("/login")
def login_page():
    return render_template_string(LOGIN_PAGE)


@bp.route("/auth/magic/<token>")
def magic_link(token: str):
    user = consume_magic_token(token)
    if not user:
        return render_template_string("""
            <div style="font-family:system-ui;max-width:480px;margin:80px auto;padding:32px;
                 background:#FEF2F2;border-radius:12px;color:#991B1B;text-align:center">
              <h2>Enlace inválido o vencido</h2>
              <p>Pedí uno nuevo desde la página de ingreso.</p>
              <a href="{{ url_for('auth.login_page') }}"
                 style="display:inline-block;margin-top:12px;padding:10px 20px;
                 background:#DC2626;color:#fff;text-decoration:none;border-radius:8px">
                Volver al login
              </a>
            </div>
        """)

    login_user(user)
    link_pending_records(user)
    next_url = request.args.get("next") or "/dashboard"
    return redirect(next_url)


@bp.route("/logout", methods=["GET", "POST"])
def logout_page():
    logout_user()
    return redirect("/")
