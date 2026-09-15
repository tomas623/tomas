# GenerarSí — Etapa 1: que la IA conteste desde tu servidor

Objetivo: poner andando un servidor en Railway que le pregunta a Gemini y
devuelve la respuesta. Sin base de datos todavía. Cuando esto funcione,
tenés lo más difícil resuelto.

Tiempo estimado: 30-45 min la primera vez. Paciencia: algo va a fallar,
es normal, está previsto abajo en "Si algo sale mal".

Archivos que vas a subir (están en esta carpeta `backend`):
- app.py            → el servidor
- requirements.txt  → qué necesita para funcionar
- Procfile          → cómo se arranca

---

## PARTE 1 — Subir el código a Railway

Railway toma el código desde GitHub. Si no usás GitHub, la forma más simple:

### Opción A — Con GitHub (recomendada)
1. Creá un repositorio nuevo en github.com (botón New, ponele "generarsi-backend").
2. Subí los tres archivos (app.py, requirements.txt, Procfile) a ese repo.
   (Se pueden arrastrar en la web de GitHub: "Add file" → "Upload files".)
3. En Railway: New Project → Deploy from GitHub repo → elegí ese repo.

### Opción B — Sin GitHub (Railway CLI)
Si preferís, Railway tiene una herramienta de línea de comandos, pero para
tu nivel la Opción A es más simple. Quedate con GitHub.

---

## PARTE 2 — LA CLAVE DE GEMINI (lo más importante)

**Nunca** escribas la clave dentro de app.py. Va como "variable de entorno",
que es un lugar secreto que Railway guarda aparte del código.

1. En tu proyecto de Railway, entrá a la pestaña **Variables**.
2. Agregá una variable nueva:
   - Nombre (Name):  `GEMINI_API_KEY`
   - Valor (Value):  (pegá acá tu clave de Gemini)
3. Guardá.

Eso es todo. El código busca `GEMINI_API_KEY` solo, sin que la clave aparezca
nunca escrita en ningún archivo. Así nadie puede robártela.

---

## PARTE 3 — Que arranque

1. Railway detecta que es un proyecto Python y lo construye solo
   (usa requirements.txt y el Procfile).
2. Esperá a que el "deploy" termine (unos minutos, vas viendo el progreso).
3. En Settings → Networking → "Generate Domain": Railway te da una URL
   pública, algo tipo `https://generarsi-backend-production.up.railway.app`
   **COPIÁ ESA URL. La vas a necesitar para conectar la web.**

---

## PARTE 4 — Probar que anda

1. Abrí esa URL en el navegador (la de Railway, tal cual).
   - Si ves: **"GenerarSí backend andando ✔ (con clave)"** → ¡funciona!
   - Si ves: "...(SIN CLAVE...)" → la variable de la Parte 2 no quedó bien.
     Revisá que se llame exactamente `GEMINI_API_KEY`.

2. Prueba real de la IA (opcional, más técnica): se puede probar la ruta
   /chat, pero eso lo hacemos cuando conectemos la web. Por ahora, que la
   URL diga "andando ✔ (con clave)" es suficiente para saber que está listo.

---

## Si algo sale mal (lo más común)

- **"Application failed to respond" / error al abrir la URL:**
  Casi siempre es que el deploy todavía no terminó, o falló la construcción.
  Mirá la pestaña "Deployments" → "View logs" y fijate el error en rojo.

- **Dice "SIN CLAVE":** la variable de la Parte 2 no está o está mal escrita.
  Tiene que ser EXACTAMENTE `GEMINI_API_KEY` (todo en mayúsculas, con guiones bajos).

- **Error sobre "gunicorn" o "module not found":** revisá que el Procfile
  y el requirements.txt se hayan subido bien y sin cambiarles el nombre.

- **Cuando no entiendas un error:** copiá el texto rojo de los logs y
  pegámelo. Con eso te digo qué es.

---

## Qué sigue (Etapa 2, cuando esto funcione)

Cuando la URL diga "andando ✔ (con clave)", avisame y hacemos:
1. Conectar la web (GenerarSí) a esta URL, para que el vecino chatee de verdad.
2. Sumar la base de datos, para guardar las conversaciones y los reclamos.

Un ladrillo a la vez. Este es el más difícil. Si lo lográs, el resto es cuesta abajo.
