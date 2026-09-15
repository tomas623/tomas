"""
GenerarSí — Backend mínimo (Etapa 1)
------------------------------------
Un servidor chiquito que recibe un mensaje del vecino, se lo pasa a Gemini
con las instrucciones del asistente, y devuelve la respuesta.

NO guarda nada todavía (eso es la Etapa 2).
La clave de Gemini se lee de una variable de entorno — NUNCA va escrita acá.
"""

import os
import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Configuración ---
app = Flask(__name__)
CORS(app)  # permite que tu página web (en otro dominio) le hable a este servidor

# La clave se lee del entorno de Railway. Si no está, avisa con claridad.
API_KEY = os.environ.get("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)

# Instrucciones del asistente: quién es y cómo se comporta.
SISTEMA = """
Sos el asistente de GenerarSí, una herramienta de la organización vecinal
Generación Sí, de San Isidro (Buenos Aires, Argentina).

Tu trabajo es ayudar a un vecino a convertir algo que le molesta o una idea
que tiene en algo concreto y presentable: un reclamo o una propuesta.

Cómo hablás:
- Cercano, claro, de barrio. Tuteás. Nada de lenguaje técnico ni burocrático.
- Frases cortas. Amable y directo.
- Nunca inventás datos. Si no sabés un teléfono o una oficina exacta de San
  Isidro, decís que se puede confirmar llamando al 147 (atención al vecino,
  24 horas) o en la web sanisidro.gob.ar. No te inventes números.

Qué hacés:
1. Escuchás lo que el vecino cuenta.
2. Le hacés como mucho una o dos preguntas para entender bien (dónde es,
   a quién afecta).
3. Le armás un texto ordenado y respetuoso que pueda presentar.
4. Le decís, en general, por dónde presentarlo (el 147 o la web del municipio
   para reclamos; el Concejo o una junta vecinal para propuestas más grandes).

Nunca prometas que el municipio va a resolver. Ayudás a que el vecino dé el
primer paso bien dado. Cerrás siempre con aliento, sin exagerar.
"""

@app.route("/")
def home():
    # Ruta de prueba: si entrás a la URL en el navegador, ves esto.
    estado = "con clave" if API_KEY else "SIN CLAVE (falta configurar GEMINI_API_KEY)"
    return f"GenerarSí backend andando ✔ ({estado})"

@app.route("/chat", methods=["POST"])
def chat():
    if not API_KEY:
        return jsonify({"ok": False, "error": "Falta configurar la clave de Gemini."}), 500

    try:
        datos = request.get_json(force=True)
        mensaje = (datos or {}).get("mensaje", "").strip()
        if not mensaje:
            return jsonify({"ok": False, "error": "No llegó ningún mensaje."}), 400

        modelo = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=SISTEMA,
        )
        respuesta = modelo.generate_content(mensaje)
        return jsonify({"ok": True, "respuesta": respuesta.text})

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Railway define el puerto en la variable PORT.
    puerto = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=puerto)
