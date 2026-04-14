"""
Legal Pacers - Brand Monitoring & Trademark Verification Flask App
"""

import os
import json
import uuid
import logging
import smtplib
import threading
from datetime import datetime
from functools import wraps
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from anthropic import Anthropic

from posiciones_data import POSICIONES
from inpi_scraper import search_inpi, batch_search
from pdf_generator import LegalPacersPDF
from database import init_db, search_marcas, count_marcas

# Load environment
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Flask app
app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-key-change-in-production")

# Init DB on startup
try:
    init_db()
except Exception as e:
    logger.warning(f"DB init warning: {e}")

# Background import thread state
_import_running = False


def _trigger_bulk_import(years=10, from_override=None, to_override=None, limit=None) -> bool:
    """Start the bulk import background thread. Returns False if already running."""
    global _import_running
    if _import_running:
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
            # Resume from last successfully imported bulletin
            if not from_override:
                last_ok = get_last_imported_boletin()
                if last_ok and from_num <= last_ok < to_num:
                    logger.info(f"Resuming from bulletin {last_ok + 1} (last OK: {last_ok})")
                    from_num = last_ok + 1
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
    """Return database stats."""
    try:
        from database import get_last_imported_boletin, get_import_state, set_import_state
        total = count_marcas()
        last_boletin = get_last_imported_boletin()
        state = get_import_state()

        # Auto-fix stale state: DB says running but in-memory thread is not
        if state.get("running") and not _import_running:
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
        set_import_state(running=False, current_boletin=0)
        _import_running = False
        return success_response({"ok": True, "message": "Import state reset. Ahora podés iniciar una nueva importación."})
    except Exception as e:
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
