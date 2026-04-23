"""
Legal Pacers - Brand Monitoring & Trademark Verification Flask App
"""

import os
import re
import json
import uuid
import logging
import smtplib
import threading
from datetime import datetime, timedelta
from functools import wraps
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv
from anthropic import Anthropic

from posiciones_data import POSICIONES
from inpi_scraper import search_inpi, batch_search
from pdf_generator import LegalPacersPDF, build_disponibilidad_report
from database import (
    init_db, search_marcas, count_marcas,
    verificar_denominacion, upsert_user, is_user_premium,
    set_subscription, update_subscription_status, apply_payment,
    grant_premium, bump_user_search, get_or_set_risk_cache,
    _normalize, get_session, User,
)

# Load environment
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Flask app
app = Flask(__name__)
CORS(app, supports_credentials=True)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-key-change-in-production")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "true").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# Premium pricing / MP config
PREMIUM_PRICE_ARS = float(os.getenv("PREMIUM_PRICE_ARS", "9900"))
PREMIUM_DAYS = int(os.getenv("PREMIUM_DAYS", "30"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://marcas.legalpacers.com").rstrip("/")

# Simple in-process cache of the last verification batch per session, keyed by batch_id.
# Used by /api/reporte/email to regenerate the PDF without re-running the fuzzy search.
_batch_cache: dict = {}

# Init DB on startup
try:
    init_db()
except Exception as e:
    logger.warning(f"DB init warning: {e}")

# Background import thread state
_import_running = False


def _trigger_bulk_import(years=10, from_override=None, to_override=None, limit=None, force=False) -> bool:
    """Start the bulk import background thread. Returns False if already running."""
    global _import_running
    if _import_running and not force:
        return False

    def _run():
        global _import_running
        _import_running = True
        try:
            from database import init_db, set_import_state, get_last_imported_boletin
            from bulk_importer import bulk_import, detect_latest_bulletin, BULLETINS_PER_YEAR
            init_db()
            set_import_state(running=True)
            to_num = int(to_override) if to_override else detect_latest_bulletin()
            from_num = int(from_override) if from_override else max(1, to_num - (int(years) * BULLETINS_PER_YEAR))
            if limit:
                to_num = min(to_num, from_num + int(limit) - 1)
            # Clamp to valid INPI bulletin range
            from_num = max(1, min(from_num, 10000))
            to_num   = max(1, min(to_num,   10000))
            if from_num > to_num:
                raise ValueError(f"Invalid range: {from_num}–{to_num}")
            # Resume logic: skip past both already-imported AND error-logged bulletins.
            # last_ok: highest bulletin with real records (don't go back before this)
            # last_attempted: highest bulletin we've touched at all (skip permanently-failing ones)
            # We resume from max(last_ok, last_attempted) + 1.
            if not from_override:
                from database import get_last_attempted_boletin
                last_ok = get_last_imported_boletin()
                last_attempted = get_last_attempted_boletin()
                resume_from = max(last_ok, last_attempted) + 1
                if resume_from <= to_num and (last_ok or last_attempted):
                    logger.info(
                        f"Resuming from bulletin {resume_from} "
                        f"(last OK: {last_ok}, last attempted: {last_attempted})"
                    )
                    from_num = resume_from
            logger.info(f"Bulk import: {from_num}–{to_num}")
            bulk_import(from_num, to_num)
            logger.info("Bulk import complete")
        except Exception as e:
            logger.error(f"Bulk import error: {e}")
            try:
                from database import set_import_state
                set_import_state(running=False, last_error=str(e))
            except Exception:
                pass
        finally:
            _import_running = False

    threading.Thread(target=_run, daemon=True).start()
    return True


# Auto-start import on every deploy — resume logic skips already-imported bulletins quickly
try:
    logger.info("Startup: auto-starting import (will skip already-imported bulletins)")
    _trigger_bulk_import()
except Exception as _e:
    logger.warning(f"Auto-start failed: {_e}")


# Global state
search_cache = {}  # {search_id: {data}}
client = Anthropic()

# ─────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────

def error_response(msg: str, status: int = 400):
    """Return error JSON response."""
    return jsonify({"error": msg}), status

def success_response(data: dict):
    """Return success JSON response."""
    return jsonify(data), 200

def require_env(*keys):
    """Decorator to check required env vars."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            missing = [k for k in keys if not os.getenv(k)]
            if missing:
                return error_response(f"Missing env vars: {', '.join(missing)}", 500)
            return f(*args, **kwargs)
        return decorated_function
    return decorator


def require_email(f):
    """Decorator: require a valid email in session (set by /api/gate)."""
    @wraps(f)
    def wrapped(*args, **kwargs):
        email = (session.get("email") or "").strip().lower()
        if not email:
            return error_response("Email gate required", 401)
        return f(*args, **kwargs)
    return wrapped


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _get_current_user() -> "User | None":
    email = (session.get("email") or "").strip().lower()
    if not email:
        return None
    with get_session() as s:
        u = s.query(User).filter(User.email == email).first()
        if u:
            s.expunge(u)
        return u


def _get_mp_sdk():
    """Return a Mercado Pago SDK instance, or None if unconfigured."""
    token = os.getenv("MP_ACCESS_TOKEN")
    if not token:
        return None
    try:
        import mercadopago
        return mercadopago.SDK(token)
    except Exception as e:
        logger.error(f"MP SDK init failed: {e}")
        return None

def send_email(to: str, subject: str, body: str, attachment_bytes: bytes = None, 
               filename: str = None) -> bool:
    """Send email with optional attachment."""
    
    try:
        smtp_host = os.getenv("SMTP_HOST")
        smtp_port = int(os.getenv("SMTP_PORT", 587))
        smtp_user = os.getenv("SMTP_USER")
        smtp_pass = os.getenv("SMTP_PASS")
        from_email = os.getenv("FROM_EMAIL")
        
        msg = MIMEMultipart()
        msg["From"] = from_email
        msg["To"] = to
        msg["Subject"] = subject
        
        msg.attach(MIMEText(body, "plain", "utf-8"))
        
        if attachment_bytes and filename:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(attachment_bytes)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f"attachment; filename= {filename}")
            msg.attach(part)
        
        # Send
        if smtp_port == 587:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        
        logger.info(f"Email sent to {to}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False

def save_lead(nombre: str, email: str, telefono: str, marca: str, descripcion: str):
    """Save lead to leads.json."""
    
    try:
        leads_file = "leads.json"
        leads = []
        
        if os.path.exists(leads_file):
            with open(leads_file, "r") as f:
                leads = json.load(f)
        
        lead = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "nombre": nombre,
            "email": email,
            "telefono": telefono,
            "marca": marca,
            "descripcion": descripcion,
        }
        
        leads.append(lead)
        
        with open(leads_file, "w") as f:
            json.dump(leads, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Lead saved: {marca} ({email})")
        return True
    except Exception as e:
        logger.error(f"Lead save failed: {e}")
        return False

# ─────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve main SPA."""
    return render_template("index.html")

@app.route("/api/verificar", methods=["POST"])
def verificar_marca():
    """Quick brand verification (Module A). Uses local DB if available, falls back to live INPI."""

    try:
        data = request.json
        marca = data.get("marca", "").strip()
        clase = data.get("clase")

        if not marca:
            return error_response("Brand name required")

        classes = [int(clase)] if clase else list(range(1, 46))

        # Use local DB only if it has enough records to be reliable (>= 50,000)
        # A partial/incomplete DB will show false "available" results for famous marks
        DB_MIN_RECORDS = 50_000
        db_count = count_marcas()
        if db_count >= DB_MIN_RECORDS:
            results = search_marcas(marca, classes, limit=50)
            source = "db"
        else:
            # DB is empty or incomplete — use live INPI scraping for accurate results
            results = search_inpi(marca, classes)
            source = "inpi_live"

        return success_response({
            "marca": marca,
            "disponible": len(results) == 0,
            "resultados": results,
            "count": len(results),
            "source": source,
            "db_records": db_count,
        })

    except Exception as e:
        logger.error(f"Verification error: {e}")
        return error_response(str(e), 500)

@app.route("/api/gate", methods=["POST"])
def api_gate():
    """Email gate. Stores email in session + upserts User row."""
    try:
        data = request.json or {}
        email = (data.get("email") or "").strip().lower()
        if not EMAIL_RE.match(email):
            return error_response("Email inválido")
        u = upsert_user(email)
        session.permanent = True
        session["email"] = email
        return success_response({
            "ok": True,
            "email": email,
            "is_premium": is_user_premium(email),
            "premium_until": u.premium_until.isoformat() if u.premium_until else None,
        })
    except Exception as e:
        logger.error(f"Gate error: {e}")
        return error_response(str(e), 500)


@app.route("/api/session", methods=["GET"])
def api_session():
    """Return current session state (email + premium flag)."""
    email = (session.get("email") or "").strip().lower()
    if not email:
        return success_response({"email": None, "is_premium": False})
    u = _get_current_user()
    return success_response({
        "email": email,
        "is_premium": is_user_premium(email),
        "premium_until": u.premium_until.isoformat() if (u and u.premium_until) else None,
        "subscription_status": u.subscription_status if u else None,
    })


RATE_LIMIT_WINDOW_MIN = 10
RATE_LIMIT_MAX = 30


def _rate_limit_ok(email: str) -> bool:
    """Basic DB-backed rate limit: max RATE_LIMIT_MAX bumps in the last window."""
    from sqlalchemy import func as _func
    # Cheap approximation: use user.searches + last_search_at. If last_search_at is stale
    # (older than the window), allow; otherwise, if searches grew a lot in the window, deny.
    with get_session() as s:
        u = s.query(User).filter(User.email == email).first()
        if not u or not u.last_search_at:
            return True
        if datetime.utcnow() - u.last_search_at > timedelta(minutes=RATE_LIMIT_WINDOW_MIN):
            # reset window
            u.searches = 0
            s.commit()
            return True
        return (u.searches or 0) < RATE_LIMIT_MAX


@app.route("/api/verificar-batch", methods=["POST"])
@require_email
def verificar_batch():
    """Verify up to 3 denominations under a single Nice class for the current user."""
    try:
        email = session["email"]
        if not _rate_limit_ok(email):
            return error_response("Demasiadas búsquedas. Esperá unos minutos.", 429)

        data = request.json or {}
        denoms = [d.strip() for d in (data.get("denominaciones") or []) if d and d.strip()]
        denoms = denoms[:3]
        clase = data.get("clase")

        if not denoms:
            return error_response("Ingresá al menos una denominación")
        if not clase:
            return error_response("Seleccioná una clase Nice")
        try:
            clase = int(clase)
        except (TypeError, ValueError):
            return error_response("Clase inválida")
        if not (1 <= clase <= 45):
            return error_response("Clase inválida")

        premium = is_user_premium(email)

        full = []
        results = []
        for d in denoms:
            r = verificar_denominacion(d, clase)
            full.append({"marca": d, "clase": clase, **r})
            item = {
                "marca": d,
                "clase": clase,
                "disponible": r["disponible"],
                "similares_count": r["similares_count"],
                "exactas_count": len(r["exactas"]),
            }
            if premium:
                item["similares"] = r["similares"]
                item["exactas"] = r["exactas"]
            results.append(item)

        bump_user_search(email)

        batch_id = str(uuid.uuid4())
        _batch_cache[batch_id] = {
            "email": email,
            "clase": clase,
            "results_full": full,
            "created_at": datetime.utcnow().isoformat(),
        }
        session["last_batch_id"] = batch_id

        return success_response({
            "batch_id": batch_id,
            "clase": clase,
            "is_premium": premium,
            "results": results,
            "premium_price_ars": PREMIUM_PRICE_ARS,
            "premium_days": PREMIUM_DAYS,
        })
    except Exception as e:
        logger.error(f"verificar-batch error: {e}")
        return error_response(str(e), 500)


def _ai_risk_analysis(denom: str, clase: int, similares: list[dict]) -> dict:
    """Ask Claude for risk level + suggested classes for a denomination."""
    sample = "\n".join([
        f"- {s.get('denominacion','')[:60]} | clase {s.get('clase')} | {s.get('titulares','')[:40]}"
        for s in similares[:20]
    ]) or "(sin similares)"

    prompt = f"""Sos experto en propiedad intelectual argentina (INPI).

Denominación solicitada: "{denom}"
Clase Nice consultada: {clase}
Marcas similares encontradas (top 20):
{sample}

Devolvé SOLO un JSON válido con esta forma exacta:
{{"riesgo": "bajo"|"medio"|"alto",
  "justificacion": "1-2 oraciones sobre el riesgo de rechazo/oposicion",
  "clases_sugeridas": [{{"clase": N, "motivo": "por qué"}}, ...]}}

"clases_sugeridas" debe tener entre 3 y 5 clases Nice (1-45) adicionales a la consultada {clase},
relevantes para proteger el rubro inferido de la denominación.
NO incluyas texto fuera del JSON."""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        txt = (resp.content[0].text or "").strip()
        # strip code fences if any
        txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt, flags=re.IGNORECASE | re.MULTILINE).strip()
        return json.loads(txt)
    except Exception as e:
        logger.warning(f"AI risk analysis failed for {denom}/{clase}: {e}")
        return {"riesgo": "medio",
                "justificacion": "No se pudo generar análisis automático; revisá los similares manualmente.",
                "clases_sugeridas": []}


def _enrich_with_ai(batch: dict) -> list[dict]:
    """Produce enriched results including cached risk analysis (for the PDF)."""
    enriched = []
    for item in batch["results_full"]:
        denom = item["marca"]
        clase = int(item["clase"])
        similares = item.get("similares") or []
        denom_norm = _normalize(denom)
        ai = get_or_set_risk_cache(
            denom_norm, clase,
            lambda d=denom, c=clase, s=similares: _ai_risk_analysis(d, c, s),
        )
        enriched.append({
            "marca": denom,
            "clase": clase,
            "disponible": item.get("disponible", False),
            "exactas": item.get("exactas", []),
            "similares": similares,
            "similares_count": len(similares),
            "ai_riesgo": ai.get("riesgo"),
            "ai_justificacion": ai.get("justificacion"),
            "ai_clases_sugeridas": ai.get("clases_sugeridas", []),
        })
    return enriched


@app.route("/api/reporte/email", methods=["POST"])
@require_email
def reporte_email():
    """Send the premium PDF report (with AI risk + suggested classes) to the user's email."""
    try:
        email = session["email"]
        if not is_user_premium(email):
            return error_response("Requiere suscripción premium", 402)

        batch_id = (request.json or {}).get("batch_id") or session.get("last_batch_id")
        if not batch_id or batch_id not in _batch_cache:
            return error_response("Batch no encontrado — volvé a verificar las marcas", 404)

        batch = _batch_cache[batch_id]
        if batch.get("email") != email:
            return error_response("Batch pertenece a otro usuario", 403)

        enriched = _enrich_with_ai(batch)
        pdf_bytes = build_disponibilidad_report(email, batch["clase"], enriched)

        subject = f"Reporte de disponibilidad — {len(enriched)} marca(s)"
        body = ("Hola,\n\nAdjuntamos tu reporte completo de disponibilidad de marca con análisis "
                "de riesgo y clases Nice sugeridas por IA.\n\nLegal Pacers\nhttps://legalpacers.com\n")
        ok = send_email(email, subject, body,
                        attachment_bytes=pdf_bytes,
                        filename="Reporte_Disponibilidad.pdf")
        if not ok:
            return error_response("No se pudo enviar el email", 500)
        return success_response({"ok": True})
    except Exception as e:
        logger.error(f"reporte/email error: {e}")
        return error_response(str(e), 500)


# ─────────────────────────────────────────────────────────────────────
# MERCADO PAGO — subscription (preapproval)
# ─────────────────────────────────────────────────────────────────────

@app.route("/api/mp/create-subscription", methods=["POST"])
@require_email
def mp_create_subscription():
    """Create an MP preapproval (recurring monthly subscription). Returns init_point."""
    try:
        sdk = _get_mp_sdk()
        if not sdk:
            return error_response("Pagos no configurados (MP_ACCESS_TOKEN missing)", 500)

        email = session["email"]
        u = _get_current_user()
        if not u:
            return error_response("Usuario no encontrado", 404)

        payload = {
            "reason": "Legal Pacers — Disponibilidad Premium",
            "auto_recurring": {
                "frequency": 1,
                "frequency_type": "months",
                "transaction_amount": PREMIUM_PRICE_ARS,
                "currency_id": "ARS",
            },
            "payer_email": email,
            "back_url": f"{PUBLIC_BASE_URL}/premium/success",
            "external_reference": str(u.id),
            "notification_url": f"{PUBLIC_BASE_URL}/api/mp/webhook",
            "status": "pending",
        }
        resp = sdk.preapproval().create(payload)
        body = resp.get("response") or {}
        if resp.get("status") not in (200, 201):
            logger.error(f"MP preapproval failed: {resp}")
            return error_response(f"Mercado Pago: {body.get('message','error')}", 502)

        preapproval_id = body.get("id")
        init_point = body.get("init_point") or body.get("sandbox_init_point")
        set_subscription(u.id, preapproval_id, status="pending")
        return success_response({"init_point": init_point, "preapproval_id": preapproval_id})
    except Exception as e:
        logger.error(f"mp/create-subscription error: {e}")
        return error_response(str(e), 500)


@app.route("/api/mp/cancel-subscription", methods=["POST"])
@require_email
def mp_cancel_subscription():
    """Cancel the user's active MP preapproval. Existing premium_until is preserved."""
    try:
        sdk = _get_mp_sdk()
        u = _get_current_user()
        if not u or not u.mp_preapproval_id:
            return error_response("No hay suscripción activa", 404)
        if sdk:
            try:
                sdk.preapproval().update(u.mp_preapproval_id, {"status": "cancelled"})
            except Exception as e:
                logger.warning(f"MP cancel call failed (will still mark cancelled): {e}")
        update_subscription_status(u.mp_preapproval_id, "cancelled")
        return success_response({"ok": True})
    except Exception as e:
        logger.error(f"mp/cancel error: {e}")
        return error_response(str(e), 500)


@app.route("/api/mp/webhook", methods=["POST", "GET"])
def mp_webhook():
    """Mercado Pago webhook. Handles preapproval status and authorized_payment events."""
    try:
        sdk = _get_mp_sdk()
        if not sdk:
            return jsonify({"ok": False, "reason": "MP not configured"}), 200

        # MP sends info both as query string and JSON body depending on topic
        topic = (request.args.get("topic") or request.args.get("type")
                 or (request.json or {}).get("type") or (request.json or {}).get("topic") or "")
        resource_id = (request.args.get("id") or request.args.get("data.id")
                       or ((request.json or {}).get("data") or {}).get("id"))

        logger.info(f"MP webhook: topic={topic} id={resource_id}")

        if not resource_id:
            return jsonify({"ok": True}), 200

        if topic == "preapproval":
            r = sdk.preapproval().get(resource_id)
            body = r.get("response") or {}
            status = body.get("status")  # authorized/paused/cancelled
            if status:
                update_subscription_status(str(resource_id), status)

        elif topic in ("authorized_payment", "subscription_authorized_payment", "payment"):
            # Fetch payment to get amount + external_reference
            r = sdk.payment().get(resource_id)
            body = r.get("response") or {}
            status = body.get("status")
            amount = float(body.get("transaction_amount") or 0)
            preapproval_id = (body.get("metadata") or {}).get("preapproval_id")
            # external_reference can come on payment or on the parent preapproval
            ext_ref = body.get("external_reference") or ""
            user_id = None
            try:
                user_id = int(ext_ref)
            except (TypeError, ValueError):
                # Resolve through preapproval_id if we have it
                if preapproval_id:
                    with get_session() as s:
                        u = s.query(User).filter(User.mp_preapproval_id == str(preapproval_id)).first()
                        if u:
                            user_id = u.id
            if user_id:
                apply_payment(
                    user_id=user_id,
                    mp_payment_id=str(resource_id),
                    mp_preapproval_id=str(preapproval_id or ""),
                    status=status or "unknown",
                    amount=amount,
                    raw=json.dumps(body)[:10000],
                    extend_days=PREMIUM_DAYS,
                )

        return jsonify({"ok": True}), 200
    except Exception as e:
        logger.error(f"mp/webhook error: {e}")
        # Always 200 so MP doesn't retry endlessly on transient errors
        return jsonify({"ok": False, "error": str(e)}), 200


@app.route("/premium/success")
def premium_success():
    """Landing page after MP checkout. Redirects back to /."""
    return """<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Activando premium…</title>
<style>body{font-family:system-ui,sans-serif;background:#F7F9FC;color:#0D1B4B;
text-align:center;padding:4rem 1rem}h1{color:#16A34A}.card{max-width:480px;margin:0 auto;
background:#fff;padding:2rem;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.06)}</style>
</head><body><div class="card"><div style="font-size:3rem">✓</div>
<h1>¡Listo!</h1>
<p>Estamos activando tu acceso premium. Puede tardar unos segundos mientras Mercado Pago
nos confirma el pago.</p>
<p><a href="/" style="color:#1B6EF3;font-weight:600">Volver a verificar marcas →</a></p>
</div><script>setTimeout(()=>location.href='/',4000);</script></body></html>"""


# ─────────────────────────────────────────────────────────────────────
# ADMIN — users / manual premium grant
# ─────────────────────────────────────────────────────────────────────

@app.route("/admin/users")
def admin_users_page():
    """Admin view of users + premium status. Query param ?key=ADMIN_KEY."""
    key = request.args.get("key", "")
    if key != os.getenv("ADMIN_KEY", ""):
        return error_response("Unauthorized", 401)
    with get_session() as s:
        rows = s.query(User).order_by(User.created_at.desc()).limit(500).all()
        out = []
        for u in rows:
            out.append({
                "id": u.id,
                "email": u.email,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "searches": u.searches or 0,
                "subscription_status": u.subscription_status,
                "premium_until": u.premium_until.isoformat() if u.premium_until else None,
                "is_premium": bool(u.premium_until and u.premium_until > datetime.utcnow()),
            })
    return jsonify({"users": out}), 200


@app.route("/api/admin/grant-premium", methods=["POST"])
def admin_grant_premium():
    """Manually extend a user's premium by N days. Body: {key, user_id, days?}."""
    data = request.json or {}
    if data.get("key") != os.getenv("ADMIN_KEY", ""):
        return error_response("Unauthorized", 401)
    user_id = data.get("user_id")
    days = int(data.get("days") or PREMIUM_DAYS)
    if not user_id:
        return error_response("user_id requerido")
    ok = grant_premium(int(user_id), days=days)
    if not ok:
        return error_response("Usuario no encontrado", 404)
    return success_response({"ok": True, "days_added": days})


@app.route("/api/lead", methods=["POST"])
def crear_lead():
    """Save lead and send notifications (Module A)."""
    
    try:
        data = request.json
        nombre = data.get("nombre", "").strip()
        email = data.get("email", "").strip()
        telefono = data.get("telefono", "").strip()
        marca = data.get("marca", "").strip()
        descripcion = data.get("descripcion", "").strip()
        
        if not all([nombre, email, telefono, marca]):
            return error_response("Missing required fields")
        
        # Save lead
        if not save_lead(nombre, email, telefono, marca, descripcion):
            return error_response("Could not save lead", 500)
        
        # Send internal notification
        internal_email = os.getenv("INTERNAL_NOTIFY_EMAIL")
        if internal_email:
            subject = f"Nuevo lead — {marca}"
            body = f"""Nuevo interesado en registrar marca:

Nombre: {nombre}
Email: {email}
Teléfono: {telefono}
Marca: {marca}
Descripción: {descripcion}

Portal: https://legalpacers.com
"""
            send_email(internal_email, subject, body)
        
        # Send user confirmation
        user_subject = f"Recibimos tu consulta sobre {marca}"
        user_body = f"""¡Hola {nombre}!

Recibimos tu solicitud de información sobre el registro de la marca "{marca}".

Un miembro de nuestro equipo de Legal Pacers se pondrá en contacto contigo pronto en {email} o {telefono}.

Mientras tanto, si tienes preguntas, puedes contactarnos por WhatsApp:
https://api.whatsapp.com/send/?phone=5491128774200

Gracias por confiar en Legal Pacers.

Saludos cordiales,
El equipo de Legal Pacers
https://legalpacers.com
"""
        send_email(email, user_subject, user_body)
        
        return success_response({"ok": True, "message": "Lead received"})
    
    except Exception as e:
        logger.error(f"Lead creation error: {e}")
        return error_response(str(e), 500)

@app.route("/api/relevamiento/suggest-classes", methods=["POST"])
@require_env("ANTHROPIC_API_KEY")
def suggest_classes():
    """AI-powered class suggestion (Module B Step 1)."""
    
    try:
        data = request.json
        marca = data.get("marca", "").strip()
        descripcion = data.get("descripcion", "").strip()
        email = data.get("email", "").strip()
        
        if not marca:
            return error_response("Brand name required")
        
        # Generate unique search_id
        search_id = str(uuid.uuid4())
        
        # Store in cache
        search_cache[search_id] = {
            "marca": marca,
            "descripcion": descripcion,
            "email": email,
            "timestamp": datetime.now().isoformat(),
        }
        
        # Call Claude for suggestions
        prompt = f"""Eres un experto en propiedad intelectual argentina y clasificación de marcas INPI.

Basado en:
- Marca: "{marca}"
- Descripción: "{descripcion}"

Devuelve SOLO un JSON array de enteros con las clases Nice (1-45) más relevantes para proteger esta marca en Argentina.
Máximo 5 clases. Sé preciso y rápido.

Responde SOLO con el JSON, sin explicaciones. Ejemplo: [35, 42, 45]
"""
        
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        
        # Parse JSON
        try:
            classes = json.loads(response_text)
            if not isinstance(classes, list):
                classes = [35]  # Default to advertising if parsing fails
        except json.JSONDecodeError:
            classes = [35]
        
        # Ensure valid classes
        classes = [c for c in classes if isinstance(c, int) and 1 <= c <= 45][:5]
        
        return success_response({
            "search_id": search_id,
            "classes": classes,
        })
    
    except Exception as e:
        logger.error(f"Class suggestion error: {e}")
        return error_response(str(e), 500)

@app.route("/api/relevamiento/search-inpi", methods=["POST"])
def search_inpi_api():
    """INPI search (Module B Step 2). Uses local DB when available."""

    try:
        data = request.json
        variants = data.get("variants", [])
        classes = data.get("selected_classes", [])
        search_id = data.get("search_id")

        if not variants or not classes:
            return error_response("Variants and classes required")

        DB_MIN_RECORDS = 50_000
        db_count = count_marcas()

        if db_count >= DB_MIN_RECORDS:
            # Fast local DB search for all variants
            all_results = {}
            for v in variants:
                all_results[v] = search_marcas(v, classes, limit=100)
        else:
            # DB incomplete — use live INPI portal scraping
            all_results = batch_search(variants, classes, delay=1.0)

        # Update cache
        if search_id and search_id in search_cache:
            search_cache[search_id]["inpi_results"] = all_results

        return success_response({
            "results": all_results,
            "source": "db" if db_count > 0 else "inpi_live",
            "db_records": db_count,
        })

    except Exception as e:
        logger.error(f"INPI search error: {e}")
        return error_response(str(e), 500)

@app.route("/api/relevamiento/posiciones/<int:class_num>", methods=["GET"])
def get_posiciones(class_num):
    """Get positions for a Nice class (Module B Step 3)."""
    
    try:
        if class_num not in POSICIONES:
            return error_response(f"Class {class_num} not found", 404)
        
        return success_response({
            "posiciones": POSICIONES[class_num],
        })
    
    except Exception as e:
        return error_response(str(e), 500)

@app.route("/api/relevamiento/suggest-posiciones", methods=["POST"])
@require_env("ANTHROPIC_API_KEY")
def suggest_posiciones():
    """AI-powered position suggestion (Module B Step 3)."""
    
    try:
        data = request.json
        class_num = data.get("class_num")
        posiciones = data.get("posiciones", [])
        marca = data.get("marca", "")
        descripcion = data.get("descripcion", "")
        
        if not class_num or not posiciones:
            return error_response("Class and positions required")
        
        # Build posiciones list for prompt
        pos_list = "\n".join([f"- {p['codigo']}: {p['partida']}" for p in posiciones[:20]])
        
        prompt = f"""Eres experto en clasificación INPI Argentina.

Marca: "{marca}"
Descripción: "{descripcion}"
Clase: {class_num}

Posiciones disponibles:
{pos_list}

Devuelve SOLO un JSON array de strings con los códigos más relevantes (máximo 10).
Responde SOLO con el JSON, sin explicaciones. Ejemplo: ["350001", "350005"]
"""
        
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        
        # Parse JSON
        try:
            codes = json.loads(response_text)
            if not isinstance(codes, list):
                codes = []
        except json.JSONDecodeError:
            codes = []
        
        # Filter valid codes
        valid_codes = [c["codigo"] for c in posiciones]
        codes = [c for c in codes if c in valid_codes][:10]
        
        return success_response({"codes": codes})
    
    except Exception as e:
        logger.error(f"Position suggestion error: {e}")
        return error_response(str(e), 500)

@app.route("/api/relevamiento/send-pdf", methods=["POST"])
@require_env("FROM_EMAIL", "SMTP_HOST")
def send_pdf():
    """Generate and email PDF report (Module B Step 3)."""
    
    try:
        data = request.json
        email = data.get("email", "").strip()
        marca = data.get("marca", "").strip()
        descripcion = data.get("descripcion", "").strip()
        variantes = data.get("variantes", [])
        posiciones = data.get("posiciones", {})
        resultados = data.get("resultados", {})
        
        if not email or not marca:
            return error_response("Email and brand name required")
        
        # Generate PDF
        pdf_gen = LegalPacersPDF()
        posiciones_dict = {int(k): v for k, v in posiciones.items()}
        pdf_bytes = pdf_gen.generate(marca, descripcion, variantes, resultados, posiciones_dict)
        
        # Send email
        subject = f"Informe de Relevamiento: {marca}"
        body = f"""Hola,

Adjuntamos tu informe de relevamiento de marca para "{marca}".

El documento incluye:
- Resultados de búsqueda en el portal del INPI
- Posiciones seleccionadas
- Información de costo para el registro

Si tienes preguntas o necesitas más información, contáctanos por WhatsApp:
https://api.whatsapp.com/send/?phone=5491128774200

Saludos cordiales,
Legal Pacers
https://legalpacers.com
"""
        
        success = send_email(email, subject, body, 
                           attachment_bytes=pdf_bytes.getvalue(),
                           filename="Informe_Relevamiento.pdf")
        
        if not success:
            return error_response("Could not send email", 500)
        
        return success_response({"ok": True, "message": "PDF sent"})
    
    except Exception as e:
        logger.error(f"PDF send error: {e}")
        return error_response(str(e), 500)

@app.route("/api/db/status", methods=["GET"])
def db_status():
    """Return database stats. Auto-fixes stale import state."""
    try:
        from database import get_last_imported_boletin, get_import_state, set_import_state
        total = count_marcas()
        last_boletin = get_last_imported_boletin()
        state = get_import_state()

        # Auto-fix stale state: DB says running but in-memory thread is not
        if state.get("running") and not _import_running:
            logger.info(f"Auto-fix: DB said running but thread is dead, resetting state")
            set_import_state(running=False, current_boletin=state.get("current_boletin", 0))
            state["running"] = False

        return success_response({
            "total_marcas": total,
            "last_boletin": last_boletin,
            "db_ready": total > 0,
            "import_running": state.get("running", False),
            "import_boletin": state.get("current_boletin", 0),
            "import_error": state.get("last_error"),
        })
    except Exception as e:
        logger.warning(f"Status check error: {e}")
        return success_response({"total_marcas": 0, "db_ready": False, "error": str(e)})


# ── Admin: bulk import trigger ──
@app.route("/api/admin/import", methods=["POST"])
def admin_import():
    """Trigger bulk import in background. Protected by ADMIN_KEY env var."""
    admin_key = os.getenv("ADMIN_KEY", "")
    provided_key = request.json.get("key", "") if request.json else ""
    if not admin_key or provided_key != admin_key:
        return error_response("Unauthorized", 401)

    if _import_running:
        return success_response({"ok": False, "message": "Import already running"})

    years = request.json.get("years", 10)
    limit = request.json.get("limit")
    from_override = request.json.get("from_num")
    to_override = request.json.get("to_num")

    started = _trigger_bulk_import(years=years, from_override=from_override,
                                    to_override=to_override, limit=limit)
    if not started:
        return success_response({"ok": False, "message": "Import already running"})

    return success_response({
        "ok": True,
        "message": f"Import started for last {years} years. Check /api/db/status for progress."
    })


@app.route("/api/admin/reset", methods=["GET", "POST"])
def admin_reset():
    """Force-reset the import state. GET: ?key=ADMIN_KEY  POST: {key}"""
    global _import_running
    admin_key = os.getenv("ADMIN_KEY", "")
    if request.method == "POST":
        provided = (request.json or {}).get("key", "")
    else:
        provided = request.args.get("key", "")
    if not admin_key or provided != admin_key:
        return error_response("Unauthorized", 401)
    try:
        from database import set_import_state
        logger.warning("ADMIN: Forcing import state reset")
        set_import_state(running=False, current_boletin=0, last_error=None)
        _import_running = False
        return success_response({"ok": True, "message": "Import state reset. Ahora podés iniciar una nueva importación."})
    except Exception as e:
        return error_response(str(e), 500)


@app.route("/api/admin/restart-import", methods=["POST"])
def admin_restart_import():
    """Force restart import even if one is supposedly running. Kills old process if needed."""
    global _import_running
    admin_key = os.getenv("ADMIN_KEY", "")
    provided = (request.json or {}).get("key", "")
    if not admin_key or provided != admin_key:
        return error_response("Unauthorized", 401)

    try:
        from database import set_import_state
        from bulk_importer import detect_latest_bulletin, BULLETINS_PER_YEAR

        logger.warning("ADMIN: Force restarting import")

        # Kill any supposedly-running import
        _import_running = False
        set_import_state(running=False, current_boletin=0, last_error=None)

        # Small delay to let cleanup happen
        import time
        time.sleep(0.5)

        # Start fresh import
        years = (request.json or {}).get("years", 10)
        from_override = (request.json or {}).get("from_num")
        to_override = (request.json or {}).get("to_num")
        limit = (request.json or {}).get("limit")

        started = _trigger_bulk_import(years=years, from_override=from_override,
                                      to_override=to_override, limit=limit, force=True)

        if not started:
            return error_response("Could not start import", 500)

        return success_response({
            "ok": True,
            "message": f"Import forcefully restarted. Check /api/db/status for progress."
        })
    except Exception as e:
        logger.error(f"Restart import error: {e}")
        return error_response(str(e), 500)


@app.route("/api/admin/test-parse")
def admin_test_parse():
    """Download and parse one bulletin, return diagnostic info (no DB write)."""
    import httpx
    num = request.args.get("num", 5000, type=int)
    url = f"https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.pdf"
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            r = client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; LegalPacers-research/1.0)",
                "Accept": "application/pdf,*/*",
            })
        if r.status_code != 200 or b'%PDF' not in r.content[:10]:
            return success_response({"error": f"Not a PDF — HTTP {r.status_code}"})

        from bulletin_parser import parse_bulletin_bytes
        records = parse_bulletin_bytes(r.content, num)

        # Sample a few records
        sample = []
        for rec in records[:5]:
            sample.append({
                "acta": rec.acta,
                "denominacion": rec.denominacion,
                "clase": rec.clase,
                "estado": rec.estado,
            })

        # Show raw text from pages 3-6 to see trademark entry format
        import pdfplumber, io
        with pdfplumber.open(io.BytesIO(r.content)) as pdf:
            first_page_text = pdf.pages[0].extract_text()[:800] if pdf.pages else ""
            data_pages_text = ""
            for i in range(2, min(6, len(pdf.pages))):
                t = pdf.pages[i].extract_text() or ""
                data_pages_text += f"\n\n--- PAGE {i+1} ---\n" + t[:1200]

        return success_response({
            "boletin": num,
            "total_records": len(records),
            "sample": sample,
            "cover_page": first_page_text,
            "data_pages": data_pages_text,
        })
    except Exception as e:
        import traceback
        return success_response({"error": str(e), "trace": traceback.format_exc()[-800:]})


@app.route("/api/admin/test-download")
def admin_test_download():
    """Test if INPI is reachable from Railway. Tries bulletin 5000."""
    import httpx
    num = request.args.get("num", 5000, type=int)
    url = f"https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.pdf"
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            r = client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; LegalPacers-research/1.0)",
                "Accept": "application/pdf,*/*",
            })
            is_pdf = r.content[:4] == b'%PDF' if r.content else False
            return success_response({
                "url": url,
                "status_code": r.status_code,
                "content_type": r.headers.get("content-type", ""),
                "content_length": len(r.content),
                "is_pdf": is_pdf,
                "preview": r.text[:300] if not is_pdf else "(PDF OK)",
            })
    except Exception as e:
        return success_response({"url": url, "error": str(e)})


@app.route("/api/admin/show-pages")
def admin_show_pages():
    """Show raw extracted text from specific pages of a bulletin PDF."""
    import httpx, pdfplumber, io
    num = request.args.get("num", 5494, type=int)
    start = request.args.get("start", 5, type=int)
    end = request.args.get("end", 15, type=int)
    url = f"https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.pdf"
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as hc:
            r = hc.get(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/pdf,*/*"})
        if r.status_code != 200 or b'%PDF' not in r.content[:10]:
            return success_response({"error": f"HTTP {r.status_code}"})
        pages_text = {}
        with pdfplumber.open(io.BytesIO(r.content)) as pdf:
            total = len(pdf.pages)
            for i in range(min(start, total), min(end + 1, total)):
                t = pdf.pages[i].extract_text() or ""
                pages_text[f"page_{i+1}"] = t[:1500]  # first 1500 chars per page
        return success_response({"bulletin": num, "total_pages": total, "pages": pages_text})
    except Exception as e:
        return success_response({"error": str(e)})


@app.route("/api/admin/probe-suffixes")
def admin_probe_suffixes():
    """Try all known URL suffix variants for a bulletin number to find the right type."""
    import httpx
    from bulletin_parser import parse_bulletin_bytes
    num = request.args.get("num", 5494, type=int)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; LegalPacers-research/1.0)",
        "Accept": "application/pdf,*/*",
    }
    results = {}
    # INPI uses Tipo_Item 1-6 for different bulletin types
    for suffix in ["1", "2", "3", "4", "5", "6"]:
        url = f"https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_{suffix}_.pdf"
        try:
            with httpx.Client(timeout=10, follow_redirects=True) as hc:
                r = hc.get(url, headers=headers)
            if r.status_code == 200 and b'%PDF' in r.content[:10]:
                # Quick parse to see how many records
                recs = parse_bulletin_bytes(r.content, num)
                results[f"_{suffix}_"] = {
                    "status": 200,
                    "size_kb": round(len(r.content) / 1024),
                    "records": len(recs),
                    "sample": recs[0].denominacion[:50] if recs else None,
                }
            else:
                results[f"_{suffix}_"] = {"status": r.status_code}
        except Exception as e:
            results[f"_{suffix}_"] = {"error": str(e)[:80]}
    return success_response({"bulletin": num, "suffixes": results})


@app.route("/api/admin/skip-bulletin", methods=["POST"])
def admin_skip_bulletin():
    """Mark a problematic bulletin as skipped so import can continue."""
    admin_key = os.getenv("ADMIN_KEY", "")
    provided = (request.json or {}).get("key", "")
    if not admin_key or provided != admin_key:
        return error_response("Unauthorized", 401)

    try:
        from database import get_session, BoletinLog
        from datetime import datetime

        num = (request.json or {}).get("num")
        if not num or not isinstance(num, int):
            return error_response("Bulletin number required", 400)

        with get_session() as s:
            existing = s.query(BoletinLog).filter_by(numero=num).first()
            if existing:
                existing.status = "skip"
                existing.error_msg = "Manually skipped by admin"
                existing.imported_at = datetime.utcnow()
            else:
                s.add(BoletinLog(
                    numero=num,
                    status="skip",
                    registros=0,
                    error_msg="Manually skipped by admin"
                ))
            s.commit()
            logger.info(f"ADMIN: Manually skipped bulletin {num}")

        return success_response({"ok": True, "message": f"Bulletin {num} marked as skipped"})
    except Exception as e:
        return error_response(str(e), 500)


@app.route("/api/admin/logs")
def admin_logs():
    """Return last 20 bulletin log entries to diagnose import issues."""
    try:
        from database import get_session, BoletinLog
        with get_session() as s:
            rows = s.query(BoletinLog).order_by(BoletinLog.numero.desc()).limit(20).all()
            return success_response([{
                "num": r.numero,
                "status": r.status,
                "records": r.registros,
                "error": r.error_msg,
                "at": r.imported_at.isoformat() if r.imported_at else None,
            } for r in rows])
    except Exception as e:
        return error_response(str(e), 500)


@app.route("/api/admin/diag")
def admin_diag():
    """Deep diagnostic: test DB write, check constraint, show recent logs."""
    key = request.args.get("key", "")
    if key != os.getenv("ADMIN_KEY", ""):
        return error_response("Unauthorized", 401)

    from database import engine, get_session, BoletinLog, Marca
    from sqlalchemy import text, insert as sql_insert
    out = {}

    # 1. Check if uq_acta_clase constraint exists
    try:
        with engine.connect() as conn:
            n = conn.execute(text(
                "SELECT COUNT(*) FROM pg_constraint WHERE conname = 'uq_acta_clase'"
            )).scalar()
            out["constraint_uq_acta_clase"] = "EXISTS" if n else "MISSING"
    except Exception as e:
        out["constraint_check_error"] = str(e)

    # 2. List all unique indexes on marcas
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='marcas'"
            )).fetchall()
            out["marcas_indexes"] = [{"name": r[0], "def": r[1]} for r in rows]
    except Exception as e:
        out["indexes_error"] = str(e)

    # 3. Test a plain INSERT
    try:
        test_acta = "DIAGTEST001"
        with engine.begin() as conn:
            conn.execute(sql_insert(Marca).values(
                acta=test_acta, denominacion="DIAG TEST", tipo="Test",
                clase=1, titular="Test", estado="test", estado_code="tramite",
            ))
        # Clean up
        with engine.begin() as conn:
            conn.execute(text(f"DELETE FROM marcas WHERE acta='{test_acta}'"))
        out["plain_insert_test"] = "OK"
    except Exception as e:
        out["plain_insert_error"] = str(e)

    # 4. Test a batch pg_insert ON CONFLICT DO NOTHING
    try:
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        test_acta2 = "DIAGTEST002"
        with engine.begin() as conn:
            stmt = pg_insert(Marca).values(
                acta=test_acta2, denominacion="DIAG TEST2", tipo="Test",
                clase=1, titular="Test", estado="test", estado_code="tramite",
            ).on_conflict_do_nothing()
            conn.execute(stmt)
        with engine.begin() as conn:
            conn.execute(text(f"DELETE FROM marcas WHERE acta='{test_acta2}'"))
        out["pg_upsert_test"] = "OK"
    except Exception as e:
        out["pg_upsert_error"] = str(e)

    # 5. Last 10 boletin_log entries
    try:
        with get_session() as s:
            rows = s.query(BoletinLog).order_by(BoletinLog.numero.desc()).limit(10).all()
            out["last_bolетines"] = [{
                "num": r.numero, "status": r.status,
                "records": r.registros, "error": r.error_msg,
                "at": r.imported_at.isoformat() if r.imported_at else None,
            } for r in rows]
            # Show entries for the ACTUAL import range (5000-7000), ordered by most recently imported
            range_rows = s.query(BoletinLog).filter(
                BoletinLog.numero.between(5000, 7000)
            ).order_by(BoletinLog.imported_at.desc()).limit(10).all()
            out["recent_imports_in_range"] = [{
                "num": r.numero, "status": r.status,
                "records": r.registros, "error": r.error_msg,
                "at": r.imported_at.isoformat() if r.imported_at else None,
            } for r in range_rows]
            # Count how many bulletins in range have records > 0
            with_records = s.query(BoletinLog).filter(
                BoletinLog.numero.between(5000, 7000),
                BoletinLog.registros > 0,
            ).count()
            out["bolетines_with_records_in_range"] = with_records
    except Exception as e:
        out["boletin_log_error"] = str(e)

    # 6. Current import state
    try:
        from database import get_import_state
        out["import_state"] = get_import_state()
        out["import_thread_running"] = _import_running
    except Exception as e:
        out["import_state_error"] = str(e)

    return success_response(out)


@app.route("/admin")
def admin_page():
    """Visual admin panel for DB management."""
    return """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Legal Pacers INPI DB</title>
<style>
  body{font-family:system-ui,sans-serif;background:#F7F9FC;margin:0;padding:40px;color:#0D1B4B}
  h1{color:#0D1B4B;margin-bottom:4px}
  .sub{color:#6B7A99;margin-bottom:32px;font-size:14px}
  .card{background:#fff;border-radius:12px;padding:24px;max-width:560px;box-shadow:0 1px 4px rgba(0,0,0,.1);margin-bottom:16px}
  .stat{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #E2E8F0;font-size:15px}
  .stat:last-of-type{border-bottom:none}
  .val{font-weight:600;color:#1B6EF3}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600}
  .badge.ok{background:#DCFCE7;color:#16A34A}
  .badge.warn{background:#FEF9C3;color:#B45309}
  .badge.run{background:#EEF3FF;color:#1B6EF3}
  label{display:block;margin:16px 0 6px;font-size:14px;font-weight:600}
  input[type=password],input[type=number],input[type=text]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px}
  .row{display:flex;gap:8px}.row input{flex:1}
  button{margin-top:12px;width:100%;padding:12px;background:#1B6EF3;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button.sec{background:#fff;color:#DC2626;border:1px solid #DC2626;margin-top:8px}
  button:disabled{background:#93AEDB;cursor:not-allowed}
  #msg{margin-top:12px;font-size:14px;min-height:20px}
  .err{color:#DC2626} .ok-msg{color:#16A34A}
  .errbanner{background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px;margin-top:12px;font-size:13px;color:#DC2626;word-break:break-all;display:none}
</style>
</head>
<body>
<h1>⚙ Admin Panel</h1>
<p class="sub">Legal Pacers — Base de datos INPI</p>
<div class="card">
  <div id="stats">Cargando estado…</div>
  <div id="errbanner" class="errbanner"></div>
</div>
<div class="card">
  <label>Clave de administrador</label>
  <input type="password" id="key" placeholder="ADMIN_KEY">
  <label>Importación completa (años de historial)</label>
  <input type="number" id="years" value="10" min="1" max="20" placeholder="Años" style="margin-bottom:8px">
  <button id="btn" onclick="startImport()">Importar últimos N años</button>
  <label style="margin-top:20px">— o importar rango específico (para probar) —</label>
  <input type="number" id="from_num" placeholder="Desde (ej: 5489)" style="margin-bottom:8px">
  <input type="number" id="to_num" placeholder="Hasta (ej: 5510)" style="margin-bottom:8px">
  <button onclick="startRange()" style="background:#4B5563">Probar rango</button>
  <button class="sec" onclick="resetImport()">⚠ Forzar reset del estado</button>
  <div id="msg"></div>
</div>
<div class="card" id="diagcard" style="display:none">
  <strong>Diagnóstico DB</strong>
  <pre id="diagout" style="font-size:12px;white-space:pre-wrap;margin-top:8px;background:#F7F9FC;padding:8px;border-radius:6px;max-height:300px;overflow:auto"></pre>
</div>
<p style="font-size:13px;text-align:center">
  <a href="/api/admin/logs" target="_blank" style="color:#1B6EF3">Ver boletin log (JSON) →</a>
  &nbsp;|&nbsp;
  <a href="#" onclick="runDiag()" style="color:#DC2626">🔍 Diagnosticar DB</a>
</p>
<script>
async function loadStatus(){
  try{
    const r=await fetch('/api/db/status');
    const d=await r.json();
    const s=d.data||d;
    const running=s.import_running;
    document.getElementById('stats').innerHTML=`
      <div class="stat"><span>Total marcas en DB</span><span class="val">${(s.total_marcas||0).toLocaleString('es-AR')}</span></div>
      <div class="stat"><span>Último boletín importado</span><span class="val">${s.last_boletin||'—'}</span></div>
      <div class="stat"><span>Boletín en proceso</span><span class="val">${s.import_boletin||'—'}</span></div>
      <div class="stat"><span>Estado DB</span><span class="badge ${s.db_ready?'ok':'warn'}">${s.db_ready?'Lista':'Vacía'}</span></div>
      <div class="stat"><span>Importación</span><span class="badge ${running?'run':'ok'}">${running?'⟳ En curso':'Inactiva'}</span></div>`;
    const eb=document.getElementById('errbanner');
    if(s.import_error){eb.style.display='block';eb.textContent='Último error: '+s.import_error;}
    else{eb.style.display='none';}
    const btn=document.getElementById('btn');
    if(running){btn.disabled=true;btn.textContent='Importando…';}
    else{btn.disabled=false;btn.textContent='Importar';}
  }catch(e){document.getElementById('stats').innerHTML='<p style="color:#DC2626">Error al cargar estado</p>';}
}
async function doImport(body){
  const msg=document.getElementById('msg');
  msg.className='';msg.textContent='Iniciando…';
  try{
    const r=await fetch('/api/admin/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(r.ok&&(d.ok||d.data?.ok)){
      msg.className='ok-msg';msg.textContent='✓ Iniciada. Se actualiza cada 15s.';
      poll();
    }else{
      msg.className='err';msg.textContent='Error: '+(d.error||d.message||'Clave incorrecta');
    }
  }catch(e){msg.className='err';msg.textContent='Error de red.';}
}
function startImport(){
  const key=document.getElementById('key').value.trim();
  const years=parseInt(document.getElementById('years').value)||10;
  if(!key){document.getElementById('msg').className='err';document.getElementById('msg').textContent='Ingresá la clave.';return;}
  doImport({key,years});
}
function startRange(){
  const key=document.getElementById('key').value.trim();
  const from_num=parseInt(document.getElementById('from_num').value);
  const to_num=parseInt(document.getElementById('to_num').value);
  if(!key){document.getElementById('msg').className='err';document.getElementById('msg').textContent='Ingresá la clave.';return;}
  if(!from_num||!to_num){document.getElementById('msg').className='err';document.getElementById('msg').textContent='Ingresá el rango.';return;}
  doImport({key,from_num,to_num});
}
async function runDiag(){
  const key=document.getElementById('key').value.trim();
  if(!key){alert('Ingresá la clave primero');return;}
  document.getElementById('diagcard').style.display='block';
  document.getElementById('diagout').textContent='Ejecutando diagnóstico…';
  try{
    const r=await fetch('/api/admin/diag?key='+encodeURIComponent(key));
    const d=await r.json();
    document.getElementById('diagout').textContent=JSON.stringify(d.data||d,null,2);
  }catch(e){document.getElementById('diagout').textContent='Error: '+e;}
}
async function resetImport(){
  const key=document.getElementById('key').value.trim();
  if(!key){alert('Ingresá la clave primero');return;}
  const r=await fetch('/api/admin/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
  const d=await r.json();
  alert(d.data?.message||d.message||'Reset OK');
  loadStatus();
}
function poll(){loadStatus();setTimeout(poll,15000);}
loadStatus();
</script>
</body>
</body>
</html>"""


@app.errorhandler(404)
def not_found(error):
    """404 handler."""
    return error_response("Not found", 404)

@app.errorhandler(500)
def server_error(error):
    """500 handler."""
    return error_response("Server error", 500)

if __name__ == "__main__":
    debug = os.getenv("DEBUG", "False").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=5000)
