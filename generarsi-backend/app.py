"""
GenerarSí — Backend (Etapa 1)
-----------------------------
Un servidor chiquito que recibe un mensaje del vecino, se lo pasa a la IA de
Google (Gemini) con las instrucciones del copiloto, y devuelve la respuesta.

NO guarda nada todavía (eso es la Etapa 2).
La clave de Gemini se lee de una variable de entorno — NUNCA va escrita acá.
"""

import os
import time
import logging

from google import genai
from google.genai import types
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

import db  # nuestro módulo de base de datos (Etapa 2)

# --- Registros (para ver qué pasa en los logs de Railway) ---
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("generarsi")

# --- Configuración ---
app = Flask(__name__)
CORS(app)  # permite que tu página web (en otro dominio) le hable a este servidor

# La clave se lee del entorno de Railway. Si no está, avisa con claridad.
API_KEY = os.environ.get("GEMINI_API_KEY")
cliente = genai.Client(api_key=API_KEY) if API_KEY else None

# Token de administración para borrar casos/aportes (moderación). Se pone como
# variable de entorno ADMIN_TOKEN en Railway. Si no está, nadie puede borrar.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN")

# Preparamos las tablas al arrancar (si hay base). Si algo falla, el servidor
# igual arranca: el chat funciona aunque la base todavía no esté lista.
if db.hay_base():
    try:
        db.crear_tablas()
        log.info("Base de datos lista.")
    except Exception as e:  # noqa: BLE001
        log.warning("No pude preparar la base al arrancar: %s", e)

# Modelos a intentar, en orden, hasta que uno funcione. Los nombres de Gemini
# cambian con el tiempo; probamos varios para no depender de uno solo.
# Se puede forzar uno concreto con la variable de entorno GEMINI_MODEL.
_modelo_fijo = os.environ.get("GEMINI_MODEL")
MODELOS = ([_modelo_fijo] if _modelo_fijo else []) + [
    "gemini-3.5-flash-lite",  # liviano y rápido: ideal para un chat ágil
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",       # más completo, de respaldo si falla el liviano
    "gemini-3.5-flash",
    "gemini-flash-latest",    # alias de respaldo (a veces se satura: 503)
]

# Instrucciones del asistente: quién es y cómo se comporta.
SISTEMA = """
Sos el copiloto de GenerarSí, una herramienta de la organización vecinal
Generación Sí, de San Isidro (Buenos Aires, Argentina).

NO sos un centro de reclamos. Tu trabajo es ayudar a un vecino a transformar
algo que le importa de su barrio en una PROPUESTA concreta para mejorarlo:
una pequeña política pública, ordenada y presentable. El vecino conoce su
ciudad; vos ponés el método. Lo acompañás a pasar de "esto no anda" a
"tengo una propuesta clara para que funcione".

Cómo hablás:
- Cercano, claro, de barrio. Tuteás. Nada de lenguaje técnico ni burocrático.
- Frases cortas, cálidas y directas. Explicás lo difícil en simple.
- MUY IMPORTANTE (rapidez): cada respuesta del chat es CORTA — 2 a 4 frases,
  y como mucho una o dos preguntas. Vas de a poco, un paso por vez. La ÚNICA
  respuesta larga es la PROPUESTA FINAL (paso 7), cuando ya juntaste todo.
- Combativo con la barrera, generoso con la gente: el problema es el obstáculo
  (la traba, la exclusión, lo que no funciona), NUNCA una persona, un partido
  o una empresa con nombre. Esto no es partidario: no nombrás ni defendés
  partidos.

EL MÉTODO (guialo de a poco, conversando, NO como un formulario):
Hacé una o dos preguntas por vez y avanzá según lo que el vecino trae. No
dispares todas las preguntas juntas. Los pasos son:
1. QUÉ MEJORAR: qué le importa cambiar (su cuadra, la plaza, un tema del barrio).
2. A QUIÉN AFECTA Y POR QUÉ PASA: quiénes sufren hoy la barrera y qué la causa.
3. QUÉ PROPONER: ayudalo a pensar de 1 a 3 caminos posibles, con sus pros y
   contras en criollo.
4. CÓMO SE HARÍA: quién tendría que hacerlo, con qué, y los primeros pasos
   realistas.
5. PRESUPUESTO: ¿implica plata? Un orden de magnitud (poco / medio / mucho) y
   de dónde podría salir. NO inventes cifras exactas: si no se sabe, decilo.
6. NORMATIVA (importante): ¿alcanza con gestión, o hace falta una ordenanza
   nueva o cambiar una existente? ¿A qué nivel (municipal, provincial,
   nacional)? Cuando toques normativa, USÁ la búsqueda web para encontrar
   ordenanzas o leyes REALES y vigentes, y CITÁ la fuente (nombre/número y de
   dónde salió). NUNCA inventes números de ordenanza ni artículos: si la
   búsqueda no te da algo confiable, decilo con honestidad y marcá "a confirmar
   en la fuente oficial (Digesto/Boletín Oficial del municipio o
   sanisidro.gob.ar)". Igual, no frenes la charla por esto: se puede seguir y
   dejar la normativa "a revisar".
7. PROPUESTA FINAL: cuando haya material suficiente, armá un texto ordenado y
   presentable, con estas secciones cortas: Título · El problema · A quién
   afecta · La propuesta · Cómo se haría · Presupuesto (estimado) · Normativa
   (a revisar) · Primeros pasos. Que se pueda llevar al Concejo Deliberante,
   a una junta vecinal, o compartir.

REGLA DE ORO — NO INVENTAR:
Nunca inventes datos, números de ordenanza, artículos de ley, cifras de
presupuesto, teléfonos ni oficinas. Si no lo sabés con certeza, decilo con
honestidad y marcá que hay que confirmarlo en la fuente oficial. Para datos
del municipio remitís al 147 (atención al vecino, 24 hs) o a sanisidro.gob.ar.

Nunca prometas que el municipio va a resolver. Ayudás a que el vecino dé el
primer paso bien dado y con una propuesta sólida. Cerrás siempre con aliento,
sin exagerar.
"""


# Búsqueda web (grounding con Google) para el cruce con legislación.
# Si la SDK o el plan no la soportan, queda en None y el chat funciona igual.
def _armar_busqueda():
    if os.environ.get("GEMINI_SIN_BUSQUEDA"):  # permite apagarla por variable
        return None
    try:
        return [types.Tool(google_search=types.GoogleSearch())]
    except Exception as e:  # noqa: BLE001
        log.warning("No pude preparar la búsqueda web: %s", e)
        return None


HERRAMIENTAS = _armar_busqueda()


def _config(con_busqueda):
    opciones = {"system_instruction": SISTEMA}
    if con_busqueda and HERRAMIENTAS:
        opciones["tools"] = HERRAMIENTAS
    return types.GenerateContentConfig(**opciones)


# La búsqueda web solo se activa cuando el mensaje roza la normativa/legislación.
# Así los turnos comunes del chat quedan rápidos (una sola consulta, sin búsqueda).
_CLAVES_NORMATIVA = ("norma", "ordenanza", " ley", "legisla", "reglament",
                     "permiso", "habilita", "código", "decreto", "concejo",
                     "propuesta final", "armá la propuesta", "arma la propuesta")


def _intentos_busqueda(mensaje):
    if HERRAMIENTAS and any(c in mensaje.lower() for c in _CLAVES_NORMATIVA):
        return (True, False)   # primero con búsqueda; si falla, sin
    return (False,)            # turno común: rápido, sin búsqueda


@app.route("/")
def home():
    # Ruta de prueba: si entrás a la URL en el navegador, ves esto.
    estado = "con clave" if API_KEY else "SIN CLAVE (falta configurar GEMINI_API_KEY)"
    return f"GenerarSí backend andando ✔ ({estado})"


@app.route("/diag")
def diag():
    # Página de diagnóstico: abrila en el navegador y pegale el texto a quien
    # arma la herramienta. Muestra qué modelos acepta la clave y el error real.
    # NO muestra la clave.
    if not cliente:
        return "SIN CLAVE (falta configurar GEMINI_API_KEY)", 500

    lineas = ["== MODELOS DISPONIBLES =="]
    try:
        encontrados = []
        for m in cliente.models.list():
            nombre = getattr(m, "name", None) or str(m)
            encontrados.append(nombre)
        lineas.extend(encontrados if encontrados else ["(la lista vino vacía)"])
    except Exception as e:  # noqa: BLE001
        lineas.append("No pude listar los modelos: " + str(e))

    lineas.append("")
    lineas.append("== PRUEBA DE RESPUESTA ==")
    for modelo in MODELOS:
        try:
            r = cliente.models.generate_content(
                model=modelo, contents="Respondé solo la palabra: hola"
            )
            lineas.append(f"OK  {modelo}: {(r.text or '').strip()[:80]}")
            break
        except Exception as e:  # noqa: BLE001
            lineas.append(f"FALLO  {modelo}: {e}")

    return "\n".join(lineas), 200, {"Content-Type": "text/plain; charset=utf-8"}


# ─────────────────────────────────────────────────────────────
#  Base de datos: casos (problemas/propuestas) y aportes
# ─────────────────────────────────────────────────────────────

REQUERIDOS_CASO = ("tipo", "titulo", "descripcion", "autor_nombre", "autor_edad", "autor_barrio")
REQUERIDOS_APORTE = ("texto", "autor_nombre", "autor_edad", "autor_barrio")


def _faltan(datos, campos):
    return [c for c in campos if not str(datos.get(c) or "").strip()]


def _es_admin(req):
    if not ADMIN_TOKEN:
        return False
    tok = (req.headers.get("X-Admin-Token")
           or req.args.get("token")
           or (req.get_json(silent=True) or {}).get("token"))
    return tok == ADMIN_TOKEN


@app.route("/diag_db")
def diag_db():
    # Diagnóstico de la base: abrila en el navegador para confirmar que anda.
    if not db.hay_base():
        return ("SIN BASE DE DATOS: falta la variable DATABASE_URL en Railway.\n"
                "Agregá una base PostgreSQL y su variable, y volvé a probar.",
                500, {"Content-Type": "text/plain; charset=utf-8"})
    lineas = []
    try:
        db.crear_tablas()
        lineas.append("Conexión a la base: OK ✔")
    except Exception as e:  # noqa: BLE001
        return ("No pude conectar a la base:\n" + str(e),
                500, {"Content-Type": "text/plain; charset=utf-8"})
    try:
        id_test = db.crear_caso({
            "tipo": "problema", "titulo": "PRUEBA (se borra sola)",
            "descripcion": "fila de prueba de diagnóstico", "barrio": "-",
            "autor_nombre": "test", "autor_edad": 0, "autor_barrio": "-",
        })
        total = len(db.listar_casos())
        db.borrar_caso(id_test)
        lineas.append(f"Escritura y lectura: OK ✔ (probé guardar y borrar una fila; había {total} caso/s)")
        lineas.append("")
        lineas.append("La base está lista para guardar casos y aportes. 🎉")
    except Exception as e:  # noqa: BLE001
        lineas.append("Falló la prueba de escritura/lectura:\n" + str(e))
    return "\n".join(lineas), 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/casos", methods=["GET"])
def listar_casos_endpoint():
    if not db.hay_base():
        return jsonify({"ok": True, "casos": []})
    try:
        return jsonify({"ok": True, "casos": db.listar_casos()})
    except Exception as e:  # noqa: BLE001
        log.error("Error listando casos: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/casos", methods=["POST"])
def crear_caso_endpoint():
    if not db.hay_base():
        return jsonify({"ok": False, "error": "La base de datos todavía no está configurada."}), 503
    datos = request.get_json(force=True, silent=True) or {}
    faltan = _faltan(datos, REQUERIDOS_CASO)
    if faltan:
        return jsonify({"ok": False, "error": "Faltan datos: " + ", ".join(faltan)}), 400
    if datos.get("tipo") not in ("problema", "propuesta"):
        return jsonify({"ok": False, "error": "El tipo debe ser 'problema' o 'propuesta'."}), 400
    try:
        nuevo = db.crear_caso(datos)
        return jsonify({"ok": True, "id": nuevo})
    except Exception as e:  # noqa: BLE001
        log.error("Error creando caso: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/casos/<int:caso_id>", methods=["GET"])
def obtener_caso_endpoint(caso_id):
    if not db.hay_base():
        return jsonify({"ok": False, "error": "Sin base de datos."}), 503
    try:
        caso = db.obtener_caso(caso_id)
        if not caso:
            return jsonify({"ok": False, "error": "No existe ese caso."}), 404
        return jsonify({"ok": True, "caso": caso})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/casos/<int:caso_id>/aportes", methods=["POST"])
def crear_aporte_endpoint(caso_id):
    if not db.hay_base():
        return jsonify({"ok": False, "error": "Sin base de datos."}), 503
    datos = request.get_json(force=True, silent=True) or {}
    faltan = _faltan(datos, REQUERIDOS_APORTE)
    if faltan:
        return jsonify({"ok": False, "error": "Faltan datos: " + ", ".join(faltan)}), 400
    try:
        nuevo = db.crear_aporte(caso_id, datos)
        return jsonify({"ok": True, "id": nuevo})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/casos/<int:caso_id>", methods=["DELETE"])
def borrar_caso_endpoint(caso_id):
    if not _es_admin(request):
        return jsonify({"ok": False, "error": "No autorizado."}), 403
    try:
        db.borrar_caso(caso_id)
        return jsonify({"ok": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/aportes/<int:aporte_id>", methods=["DELETE"])
def borrar_aporte_endpoint(aporte_id):
    if not _es_admin(request):
        return jsonify({"ok": False, "error": "No autorizado."}), 403
    try:
        db.borrar_aporte(aporte_id)
        return jsonify({"ok": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/chat_stream", methods=["POST"])
def chat_stream():
    # Igual que /chat pero devuelve la respuesta "de a poco" (streaming), para
    # que en la página aparezca escribiéndose y se sienta más rápido.
    if not cliente:
        return jsonify({"ok": False, "error": "Falta configurar la clave de Gemini."}), 500

    datos = request.get_json(force=True, silent=True) or {}
    mensaje = (datos.get("mensaje") or "").strip()
    if not mensaje:
        return jsonify({"ok": False, "error": "No llegó ningún mensaje."}), 400

    def generar():
        for modelo in MODELOS:
            # Según el mensaje, decidimos si probar con búsqueda web (para citar
            # legislación real) y, si falla, sin búsqueda (más robusto).
            for con_busqueda in _intentos_busqueda(mensaje):
                enviado = False
                try:
                    flujo = cliente.models.generate_content_stream(
                        model=modelo,
                        contents=mensaje,
                        config=_config(con_busqueda),
                    )
                    for parte in flujo:
                        texto = getattr(parte, "text", "") or ""
                        if texto:
                            enviado = True
                            yield texto
                    return  # terminó bien
                except Exception as e:  # noqa: BLE001
                    log.warning("Streaming falló (modelo=%s, busqueda=%s): %s",
                                modelo, con_busqueda, e)
                    if enviado:
                        # Ya mandamos parte de la respuesta; no arrancamos de nuevo.
                        return
                    continue
        # Si ninguno funcionó no mandamos nada: la página reintenta por /chat.

    return Response(
        stream_with_context(generar()),
        mimetype="text/plain; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.route("/chat", methods=["POST"])
def chat():
    if not cliente:
        return jsonify({"ok": False, "error": "Falta configurar la clave de Gemini."}), 500

    datos = request.get_json(force=True, silent=True) or {}
    mensaje = (datos.get("mensaje") or "").strip()
    if not mensaje:
        return jsonify({"ok": False, "error": "No llegó ningún mensaje."}), 400

    # Palabras que indican "saturación pasajera" de Google (conviene reintentar).
    transitorios = ("503", "unavailable", "429", "resource_exhausted",
                    "overloaded", "high demand")

    def es_transitorio(msg):
        m = str(msg).lower()
        return any(t in m for t in transitorios)

    ultimo_error = None
    # Hacemos hasta 3 pasadas por la lista de modelos. Si el error es de
    # saturación (503), esperamos un toque y reintentamos; así aguantamos picos.
    for pasada in range(3):
        for modelo in MODELOS:
            for con_busqueda in _intentos_busqueda(mensaje):
                try:
                    respuesta = cliente.models.generate_content(
                        model=modelo,
                        contents=mensaje,
                        config=_config(con_busqueda),
                    )
                    texto = (respuesta.text or "").strip()
                    if texto:
                        return jsonify({"ok": True, "respuesta": texto, "modelo": modelo})
                    ultimo_error = f"El modelo {modelo} devolvió una respuesta vacía."
                    log.warning(ultimo_error)
                except Exception as e:  # noqa: BLE001 — capturamos cualquier error de la IA
                    ultimo_error = f"{modelo} (busqueda={con_busqueda}): {e}"
                    log.warning("Fallo (modelo=%s, busqueda=%s): %s", modelo, con_busqueda, e)

        # Toda la pasada falló. Si fue por saturación, esperamos y reintentamos.
        if pasada < 2 and es_transitorio(ultimo_error):
            time.sleep(1.5 * (pasada + 1))
            continue
        break

    log.error("Ningún modelo funcionó. Último error: %s", ultimo_error)
    return jsonify({"ok": False, "error": ultimo_error or "No se pudo generar la respuesta."}), 500


if __name__ == "__main__":
    # Railway define el puerto en la variable PORT.
    puerto = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=puerto)
