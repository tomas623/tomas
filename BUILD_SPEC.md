# LegalPacers — Especificación de Backend (para Claude Code)

> **Cómo usar este archivo:** copialo a la raíz de un proyecto nuevo junto con
> `landing-legalpacers.html`, abrí Claude Code en esa carpeta y pegá el bloque
> "PROMPT PARA CLAUDE CODE" que está al final. El resto del documento es el
> contrato técnico que el frontend ya espera; no lo inventamos, lo extrajimos
> del HTML.

---

## 1. Qué tenemos hoy

`landing-legalpacers.html` es una landing single-page **funcionalmente completa en el frontend**:
- Dark mode, Alpine.js vía CDN, sin build step.
- Buscador de marca, modales de pago (informe $19.900 y registro $120.000), FAQ
  estático (no depende de JS), WhatsApp, JSON-LD para SEO.
- **Todo el estado vive en la función `landing()`** (al final del archivo, en el
  último `<script>`).

Lo que **falta** es el backend: el HTML llama a 4 endpoints `/api/...` que hoy no
existen. Sin ellos, el buscador y los botones de pago no responden.

> Nota: el frontend ya está validado (HTML/CSS/JS sin errores). **No hay que
> rediseñar la landing.** Solo se la sirve y se construye la API que espera.

---

## 2. Contrato de API (lo que el frontend YA llama)

Todas las respuestas usan el sobre `{ ok: boolean, data: {...} }`. El frontend
lee `r.data`. Para pagos acepta tanto `r.data.init_point` como `r.init_point`.

### 2.1 `GET /api/marca/precio-informe`
Devuelve el precio vigente del informe (permite cambiarlo sin tocar el front).
```json
{ "ok": true, "data": { "precio": 19900, "moneda": "ARS" } }
```

### 2.2 `POST /api/marca/check`  — Pre-check gratis
Request:
```json
{ "marca": "Acme", "clases": [35], "rubro": "cafetería" }
```
Response — el frontend renderiza según `veredicto`. Valores posibles:
`"probablemente_disponible"` | `"no_disponible"` | `"necesita_analisis"`.
```json
{
  "ok": true,
  "data": {
    "veredicto": "no_disponible",
    "mensaje": "Encontramos <strong>3 actas</strong> que coinciden de forma exacta en la clase 35.",
    "tease": {
      "muestras": [
        { "denominacion": "ACME", "clase": 35, "acta": "REDACTADO", "estado": "Concedida" }
      ]
    }
  }
}
```
Reglas de negocio del check (definidas en charla con el cliente):
- El pre-check gratis solo mide **coincidencia exacta / casi exacta** en la base
  del INPI (normalizar: minúsculas, sin acentos, sin espacios, sin sufijos
  societarios tipo "SA/SRL"). **No** corre fonética/ideológica (eso es el informe pago).
- Si el `rubro` no matchea las clases sugeridas del front, el resultado debe poder
  marcar `veredicto: "necesita_analisis"` para no dar un falso "LIBRE" por medir
  en la clase equivocada (regla UX clave del cliente).
- `tease.muestras[].acta` debe ir **enmascarado/redactado** en el check gratis
  (el número real es parte del valor del informe pago). El front ya difumina.

### 2.3 `POST /api/marca/consulta/iniciar` — Checkout informe $19.900
Request:
```json
{ "marca": "Acme", "email": "x@y.com", "clases": [35], "rubro": "cafetería" }
```
Response: crea preferencia de pago y devuelve la URL de checkout:
```json
{ "ok": true, "data": { "init_point": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=..." } }
```
El frontend hace `window.location.href = init_point`.

### 2.4 `POST /api/marca/registro/iniciar` — Checkout registro $120.000
Request:
```json
{ "marca": "Acme", "email": "x@y.com", "telefono": "+5491100000000", "clases": [35], "rubro": "cafetería" }
```
Response: igual que 2.3 (`init_point`).

> **Importante (flujo del cliente):** el registro NO promete aprobación. El flujo
> real es: paga → se lo deriva a WhatsApp → se verifica viabilidad ANTES de
> presentar → si no es viable, se define otro nombre o se devuelve el dinero. El
> backend solo necesita: registrar el lead, crear el cobro, y disparar la
> notificación. La verificación de viabilidad es humana/manual, no automática.

---

## 3. Stack sugerido (decisión del agente, pero con defaults)

- **Runtime:** Node.js + Express (simple, sin build, sirve el HTML estático tal cual).
- **DB:** SQLite vía better-sqlite3 para el MVP (cero infra). Tabla `leads` y
  tabla `marcas_inpi` (base de búsqueda). Migrable a Postgres después.
- **Pagos:** Mercado Pago (el `init_point` es de su SDK de Checkout Pro). Usar
  `MP_ACCESS_TOKEN` desde `.env`. Si no hay token, devolver un `init_point` de
  sandbox/stub para poder probar el flujo sin credenciales.
- **Notificaciones:** webhook de pago aprobado → marcar lead como pagado y
  (opcional) disparar WhatsApp/email. Para el MVP, loguear y dejar el hook listo.

---

## 4. Base de búsqueda del INPI (lo más importante y lo más delicado)

El pre-check necesita datos de marcas para comparar. Opciones, en orden de
preferencia para un MVP honesto:
1. **Dataset local (CSV/SQLite) cargable.** Crear un comando `npm run seed` que
   importe un CSV de marcas (denominación, clase, estado, acta) a la tabla
   `marcas_inpi`. Incluir un CSV de ejemplo con ~20 marcas ficticias para test.
2. Dejar una **interfaz `buscarEnINPI(marca, clases)`** aislada en un módulo
   (`src/inpi.js`) para luego enchufar la fuente real (export oficial, scraping
   autorizado, o API de un tercero) sin tocar los endpoints.

> No scrapear sitios sin autorización. Dejar el adaptador listo y documentado;
> la fuente real la decide el cliente.

---

## 5. Variables de entorno (`.env.example`)
```
PORT=3000
MP_ACCESS_TOKEN=            # Mercado Pago; vacío = modo stub
PRECIO_INFORME=19900
PRECIO_REGISTRO=120000
BASE_URL=http://localhost:3000
WHATSAPP_NOTIFY=            # opcional: número/endpoint para avisos de lead
```

## 6. Criterios de aceptación (definition of done)
- [ ] `npm install && npm run seed && npm start` levanta en `BASE_URL`.
- [ ] `GET /` sirve `landing-legalpacers.html` sin modificarlo.
- [ ] El buscador de la landing devuelve los 3 veredictos según los datos seed.
- [ ] El `rubro` que no matchea clase devuelve `necesita_analisis` (no falso LIBRE).
- [ ] Los dos botones de pago redirigen a un `init_point` (real si hay token, stub si no).
- [ ] Webhook de MP marca el lead como pagado.
- [ ] Sin credenciales, todo el flujo es testeable en modo stub.
- [ ] README con setup, seed, y cómo enchufar la fuente real del INPI.

---

## 7. PROMPT PARA CLAUDE CODE (pegá esto)

```
Sos un ingeniero full-stack. En esta carpeta hay dos archivos:
- landing-legalpacers.html  → frontend TERMINADO. NO lo modifiques salvo que sea
  imprescindible; si hay que tocarlo, explicá por qué primero.
- BUILD_SPEC.md             → el contrato técnico completo.

Tu tarea: construir el backend que hace ejecutable esa landing, siguiendo
BUILD_SPEC.md al pie. Específicamente:

1. Server Node + Express que sirve el HTML estático en GET / y expone los 4
   endpoints de la sección 2 con EXACTAMENTE el shape { ok, data } que el front espera.
2. SQLite (better-sqlite3) con tablas `leads` y `marcas_inpi`, más un `npm run seed`
   que carga un CSV de ejemplo (incluí uno con ~20 marcas ficticias).
3. Lógica del pre-check de la sección 2.2, incluida la regla de `necesita_analisis`
   para evitar falsos "LIBRE", y el enmascarado del número de acta.
4. Integración Mercado Pago Checkout Pro detrás de un módulo aislado, con MODO STUB
   cuando no hay MP_ACCESS_TOKEN (devolver un init_point de prueba) para poder
   testear sin credenciales. Webhook de pago aprobado que marca el lead.
5. Módulo `src/inpi.js` con la función `buscarEnINPI(marca, clases)` aislada, para
   enchufar la fuente real después. NO scrapees nada sin autorización.
6. .env.example (sección 5), README con setup/seed/deploy, y package.json con scripts
   install/seed/start/dev.

Cumplí TODOS los criterios de aceptación de la sección 6. Trabajá de forma autónoma:
creá la estructura de carpetas, escribí el código, corré la app, probá los 4 endpoints
con curl, y mostrame el resultado. Si algo del contrato es ambiguo, elegí la opción más
simple y dejala documentada en el README, no me frenes con preguntas evitables.
```
