"""
GenerarSí — Backend (Etapa 1)
-----------------------------
Un servidor chiquito que recibe un mensaje del vecino, se lo pasa a la IA de
Google (Gemini) con las instrucciones del copiloto, y devuelve la respuesta.

NO guarda nada todavía (eso es la Etapa 2).
La clave de Gemini se lee de una variable de entorno — NUNCA va escrita acá.
"""

import os
import logging

from google import genai
from google.genai import types
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Registros (para ver qué pasa en los logs de Railway) ---
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("generarsi")

# --- Configuración ---
app = Flask(__name__)
CORS(app)  # permite que tu página web (en otro dominio) le hable a este servidor

# La clave se lee del entorno de Railway. Si no está, avisa con claridad.
API_KEY = os.environ.get("GEMINI_API_KEY")
cliente = genai.Client(api_key=API_KEY) if API_KEY else None

# Modelos a intentar, en orden, hasta que uno funcione. Los nombres de Gemini
# cambian con el tiempo; probamos varios para no depender de uno solo.
# Se puede forzar uno concreto con la variable de entorno GEMINI_MODEL.
_modelo_fijo = os.environ.get("GEMINI_MODEL")
MODELOS = ([_modelo_fijo] if _modelo_fijo else []) + [
    "gemini-3.6-flash",       # recomendado por Google como reemplazo actual
    "gemini-3.5-flash",
    "gemini-3.8-flash",
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
6. NORMATIVA: ¿alcanza con gestión, o hace falta una ordenanza nueva o cambiar
   una existente? ¿A qué nivel (municipal, provincial, nacional)? Orientá el
   razonamiento, pero NO inventes números de ordenanza ni leyes: si hay que
   verificarlo, decí "a confirmar en la fuente oficial (Digesto/Boletín Oficial
   del municipio o sanisidro.gob.ar)".
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


@app.route("/chat", methods=["POST"])
def chat():
    if not cliente:
        return jsonify({"ok": False, "error": "Falta configurar la clave de Gemini."}), 500

    datos = request.get_json(force=True, silent=True) or {}
    mensaje = (datos.get("mensaje") or "").strip()
    if not mensaje:
        return jsonify({"ok": False, "error": "No llegó ningún mensaje."}), 400

    ultimo_error = None
    for modelo in MODELOS:
        try:
            respuesta = cliente.models.generate_content(
                model=modelo,
                contents=mensaje,
                config=types.GenerateContentConfig(system_instruction=SISTEMA),
            )
            texto = (respuesta.text or "").strip()
            if texto:
                return jsonify({"ok": True, "respuesta": texto, "modelo": modelo})
            ultimo_error = f"El modelo {modelo} devolvió una respuesta vacía."
            log.warning(ultimo_error)
        except Exception as e:  # noqa: BLE001 — queremos capturar cualquier error de la IA
            ultimo_error = f"{modelo}: {e}"
            log.warning("Fallo con el modelo %s: %s", modelo, e)

    log.error("Ningún modelo funcionó. Último error: %s", ultimo_error)
    return jsonify({"ok": False, "error": ultimo_error or "No se pudo generar la respuesta."}), 500


if __name__ == "__main__":
    # Railway define el puerto en la variable PORT.
    puerto = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=puerto)
