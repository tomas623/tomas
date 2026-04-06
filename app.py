"""
Legal Pacers - Brand Monitoring & Trademark Verification Flask App
"""

import os
import json
import uuid
import logging
import smtplib
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

        # Try local DB first (fast)
        db_count = count_marcas()
        if db_count > 0:
            results = search_marcas(marca, classes, limit=50)
            source = "db"
        else:
            # Fallback to live INPI scraping
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

        db_count = count_marcas()

        if db_count > 0:
            # Fast local DB search for all variants
            all_results = {}
            for v in variants:
                all_results[v] = search_marcas(v, classes, limit=100)
        else:
            # Fallback to live INPI portal scraping
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
import threading
_import_running = False

@app.route("/api/admin/import", methods=["POST"])
def admin_import():
    """Trigger bulk import in background. Protected by ADMIN_KEY env var."""
    global _import_running

    admin_key = os.getenv("ADMIN_KEY", "")
    provided_key = request.json.get("key", "") if request.json else ""
    if not admin_key or provided_key != admin_key:
        return error_response("Unauthorized", 401)

    if _import_running:
        return success_response({"ok": False, "message": "Import already running"})

    years = request.json.get("years", 10)

    def run_import():
        global _import_running
        _import_running = True
        try:
            from database import init_db, set_import_state
            from bulk_importer import bulk_import, detect_latest_bulletin, BULLETINS_PER_YEAR
            init_db()
            set_import_state(running=True)
            to_num = detect_latest_bulletin()
            from_num = max(1, to_num - (int(years) * BULLETINS_PER_YEAR))
            logger.info(f"Admin bulk import started: {from_num}–{to_num}")
            bulk_import(from_num, to_num)
            logger.info("Admin bulk import complete")
        except Exception as e:
            logger.error(f"Admin bulk import error: {e}")
            try:
                from database import set_import_state
                set_import_state(running=False, last_error=str(e))
            except Exception:
                pass
        finally:
            _import_running = False

    thread = threading.Thread(target=run_import, daemon=True)
    thread.start()

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
  .card{background:#fff;border-radius:12px;padding:24px;max-width:520px;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  .stat{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #E2E8F0;font-size:15px}
  .stat:last-of-type{border-bottom:none}
  .val{font-weight:600;color:#1B6EF3}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600}
  .badge.ok{background:#DCFCE7;color:#16A34A}
  .badge.warn{background:#FEF9C3;color:#B45309}
  .badge.run{background:#EEF3FF;color:#1B6EF3}
  label{display:block;margin:20px 0 6px;font-size:14px;font-weight:600}
  input[type=password],input[type=number]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px}
  button{margin-top:16px;width:100%;padding:12px;background:#1B6EF3;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button:disabled{background:#93AEDB;cursor:not-allowed}
  #msg{margin-top:12px;font-size:14px;min-height:20px}
  .err{color:#DC2626} .ok-msg{color:#16A34A}
</style>
</head>
<body>
<h1>⚙ Admin Panel</h1>
<p class="sub">Legal Pacers — Base de datos INPI</p>
<div class="card">
  <div id="stats">Cargando estado…</div>
  <label>Clave de administrador</label>
  <input type="password" id="key" placeholder="ADMIN_KEY">
  <label>Años de historial a importar</label>
  <input type="number" id="years" value="10" min="1" max="20">
  <button id="btn" onclick="startImport()">Cargar boletines INPI</button>
  <div id="msg"></div>
</div>
<script>
async function loadStatus(){
  try{
    const r=await fetch('/api/db/status');
    const d=await r.json();
    const s=d.data||d;
    const running=s.import_running;
    const errHtml=s.import_error?`<div class="stat"><span>Último error</span><span style="color:#DC2626;font-size:12px;max-width:300px;word-break:break-all">${s.import_error}</span></div>`:'';
    document.getElementById('stats').innerHTML=`
      <div class="stat"><span>Total marcas en DB</span><span class="val">${(s.total_marcas||0).toLocaleString('es-AR')}</span></div>
      <div class="stat"><span>Último boletín importado</span><span class="val">${s.last_boletin||'—'}</span></div>
      <div class="stat"><span>Boletín en proceso</span><span class="val">${s.import_boletin||'—'}</span></div>
      <div class="stat"><span>Estado DB</span><span class="badge ${s.db_ready?'ok':'warn'}">${s.db_ready?'Lista':'Vacía'}</span></div>
      <div class="stat"><span>Importación</span><span class="badge ${running?'run':'ok'}">${running?'⟳ En curso':'Inactiva'}</span></div>
      ${errHtml}`;
    const btn=document.getElementById('btn');
    if(running){btn.disabled=true;btn.textContent='Importando… (puede tardar horas)';}
    else{btn.disabled=false;btn.textContent='Cargar boletines INPI';}
  }catch(e){document.getElementById('stats').innerHTML='<p style="color:#DC2626">Error al cargar estado</p>';}
}
async function startImport(){
  const key=document.getElementById('key').value.trim();
  const years=parseInt(document.getElementById('years').value)||10;
  const msg=document.getElementById('msg');
  if(!key){msg.className='err';msg.textContent='Ingresá la clave de administrador.';return;}
  document.getElementById('btn').disabled=true;
  msg.className='';msg.textContent='Iniciando importación…';
  try{
    const r=await fetch('/api/admin/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,years})});
    const d=await r.json();
    if(r.ok&&(d.ok||d.data?.ok)){
      msg.className='ok-msg';
      msg.textContent='✓ Importación iniciada. La página se actualiza cada 15 segundos.';
      poll();
    }else{
      msg.className='err';
      msg.textContent='Error: '+(d.error||d.message||'Clave incorrecta');
      document.getElementById('btn').disabled=false;
    }
  }catch(e){msg.className='err';msg.textContent='Error de red.';document.getElementById('btn').disabled=false;}
}
async function resetImport(){
  const key=document.getElementById('key').value.trim();
  if(!key){alert('Ingresá la clave primero');return;}
  if(!confirm('¿Resetear el estado de importación?')) return;
  const r=await fetch('/api/admin/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
  const d=await r.json();
  alert(d.data?.message||d.message||'Reset OK');
  loadStatus();
}
function poll(){loadStatus();setTimeout(poll,15000);}
loadStatus();
</script>
<p style="margin-top:12px;font-size:13px;text-align:center">
  <a href="#" onclick="resetImport();return false;" style="color:#DC2626">⚠ Forzar reset del estado →</a>
</p>
<p style="margin-top:4px;font-size:13px;text-align:center">
  <a href="/api/admin/logs" target="_blank" style="color:#1B6EF3">Ver log de errores (JSON) →</a>
</p>
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
