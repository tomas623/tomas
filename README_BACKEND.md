# LegalPacers — Backend Node + Express

Backend que hace ejecutable la landing `landing-legalpacers.html` según el contrato definido en `BUILD_SPEC.md`.

> Convive con la app Python/Flask preexistente (`app.py`, `database.py`, etc.) sin pisarla. Cada runtime corre en su propio proceso/puerto.

## Stack

- **Node.js ≥ 18** + **Express 4**
- **SQLite** via `better-sqlite3` (DB local en `data/legalpacers.db`)
- **Mercado Pago Checkout Pro** detrás de un módulo aislado (`src/pagos.js`) con **modo stub** cuando no hay credenciales.
- Sin build step, sin frontend framework — la landing es estática y se sirve tal cual.

## Setup

```bash
cp .env.example .env        # editá lo que necesites; vacío también funciona
npm install
npm run seed                # carga ~22 marcas ficticias en marcas_inpi
npm start                   # levanta en http://localhost:3000
# (dev con auto-reload: npm run dev)
```

`GET /` sirve `landing-legalpacers.html` sin modificarla.

## Variables de entorno (sección 5 del spec)

| Variable | Default | Notas |
| --- | --- | --- |
| `PORT` | `3000` | |
| `BASE_URL` | `http://localhost:3000` | Usado en back_urls y notification_url de MP |
| `MP_ACCESS_TOKEN` | *(vacío)* | Vacío ⇒ **modo stub**, los `init_point` apuntan a una pantalla local que simula el checkout |
| `PRECIO_INFORME` | `19900` | |
| `PRECIO_REGISTRO` | `120000` | |
| `WHATSAPP_NOTIFY` | *(vacío)* | Sólo loguea por ahora; el envío real queda pendiente |
| `SQLITE_PATH` | `./data/legalpacers.db` | Override opcional |
| `ADMIN_TOKEN` | *(vacío)* | Si se setea, habilita `GET /api/admin/leads?token=...` para inspeccionar leads |

## Endpoints (contrato de la sección 2)

Todos devuelven `{ ok, data }`.

| Método | Path | Descripción |
| --- | --- | --- |
| `GET`  | `/api/marca/precio-informe` | Precio vigente del informe |
| `POST` | `/api/marca/check` | Pre-check gratis (coincidencia exacta / casi exacta) |
| `POST` | `/api/marca/consulta/iniciar` | Crea lead "informe" y devuelve `init_point` |
| `POST` | `/api/marca/registro/iniciar` | Crea lead "registro" y devuelve `init_point` |
| `POST` | `/api/pagos/webhook` | Webhook de Mercado Pago (marca el lead como pagado) |
| `GET`  | `/pagos/{exito,error,pendiente,stub}` | Pantallas de retorno + stub local |

### Reglas del pre-check (sección 2.2)

- Normalización antes de comparar: minúsculas, sin acentos, sin signos, sin espacios, sin sufijos societarios (`SA/SRL/SAS/...`).
- Match exacto **o** "casi exacto" (Levenshtein ≤ 1, sólo si la denominación tiene ≥ 5 caracteres) en la base seedeada.
- **Veredictos**:
  - `no_disponible` → hay coincidencias en alguna de las clases consultadas.
  - `necesita_analisis` → (a) hay coincidencias en otras clases distintas a las consultadas, **o** (b) el `rubro` no se puede mapear automáticamente a una clase Niza conocida (regla UX clave: no devolver falso "LIBRE" por medir en la clase equivocada).
  - `probablemente_disponible` → no hay coincidencias y el rubro mapea a clases conocidas.
- `tease.muestras[].acta` va **enmascarado** (`41XXXXX`); el número real queda reservado para el informe pago.

## Mercado Pago

`src/pagos.js` encapsula la integración. Si `MP_ACCESS_TOKEN` está vacío, la función `crearPreferencia` devuelve un `init_point` que apunta a `/pagos/stub`, una pantalla local con dos botones (aprobar / rechazar) que dispara el mismo flujo de webhook que MP real. Esto permite testear el ciclo completo sin credenciales.

Con `MP_ACCESS_TOKEN` real, MP llama al `notification_url = ${BASE_URL}/api/pagos/webhook`. El handler consulta `/v1/payments/{id}` y, si `status === 'approved'`, marca el lead como `pagado`. **Importante**: para que MP pueda alcanzar el webhook hay que exponer `BASE_URL` con HTTPS (ej. túnel ngrok o el dominio público).

## Base de datos del INPI (sección 4)

- Para el MVP usamos un **dataset local CSV** (`data/marcas_seed.csv`, 22 marcas ficticias) cargado vía `npm run seed`. Para reemplazar el dataset basta con pasar otro path: `node src/seed.js ruta/al/otro.csv` (re-importa de cero).
- `src/inpi.js` exporta `buscarEnINPI(marca, clases)` aislada. Para enchufar la fuente real (export oficial del INPI, API de tercero, scraping autorizado) sólo hay que cambiar esa función — los endpoints no se tocan. **No se scrapea ningún sitio sin autorización del cliente.**

## Decisiones tomadas en el camino (lo "ambiguo" del spec)

1. **`necesita_analisis` por hit en otras clases**: el spec lista los tres veredictos posibles pero sólo describe explícitamente el caso "rubro no matchea". Agregamos también la ramificación "no hay coincidencia en la clase consultada pero sí en otras", porque dar `probablemente_disponible` cuando el nombre exacto ya existe en otra clase sería engañoso y va contra el espíritu del cliente.
2. **Casi-exacto**: implementado con Levenshtein ≤ 1 sobre la versión normalizada. Es la mínima tolerancia para errores de tipeo; **no** corre fonética/ideológica (eso es el informe pago).
3. **Enmascarado de acta**: dejamos los primeros 2 caracteres + `X`s. Suficiente para que el frontend lo difumine sin revelar el número real.
4. **Modo stub MP**: en vez de devolver un `init_point` inválido, abrimos una mini-página local con dos botones (aprobar / rechazar). Así el flujo "redirect → confirmación → webhook → lead pagado" se prueba end-to-end sin credenciales.
5. **Notificación WhatsApp**: si `WHATSAPP_NOTIFY` está seteado, sólo loguea (la integración real depende del proveedor que elija el cliente — Twilio, 360dialog, WhatsApp Cloud API). El hook está listo en `server.js`.
6. **Auth admin**: `/api/admin/leads` requiere `ADMIN_TOKEN`; si la env var está vacía, el endpoint queda cerrado.

## Criterios de aceptación (sección 6 del spec)

- [x] `npm install && npm run seed && npm start` levanta el server.
- [x] `GET /` sirve `landing-legalpacers.html` sin modificarlo.
- [x] El buscador devuelve los 3 veredictos según los datos seed.
- [x] Rubro no mapeable → `necesita_analisis` (no falso LIBRE).
- [x] Los dos botones de pago redirigen a un `init_point` (real con token, stub sin token).
- [x] Webhook de MP marca el lead como `pagado` (idem el flujo stub).
- [x] Sin credenciales, todo el flujo es testeable.
- [x] README con setup, seed y cómo enchufar la fuente real del INPI.

## Probar a mano con curl

```bash
# Precio vigente
curl -s http://localhost:3000/api/marca/precio-informe

# Pre-check — 'Acme' clase 35 → no_disponible
curl -s -X POST http://localhost:3000/api/marca/check \
  -H 'Content-Type: application/json' \
  -d '{"marca":"Acme","clases":[35],"rubro":"cafetería"}'

# Pre-check — rubro no reconocido → necesita_analisis
curl -s -X POST http://localhost:3000/api/marca/check \
  -H 'Content-Type: application/json' \
  -d '{"marca":"Belugatron","clases":[35],"rubro":"fabrica de zapatos espaciales"}'

# Iniciar informe (devuelve init_point — stub si no hay token MP)
curl -s -X POST http://localhost:3000/api/marca/consulta/iniciar \
  -H 'Content-Type: application/json' \
  -d '{"marca":"Acme","email":"vos@empresa.com","clases":[35],"rubro":"cafetería"}'

# Iniciar registro
curl -s -X POST http://localhost:3000/api/marca/registro/iniciar \
  -H 'Content-Type: application/json' \
  -d '{"marca":"Acme","email":"vos@empresa.com","telefono":"+5491100000000","clases":[35],"rubro":"cafetería"}'
```

## Deploy

- Cualquier PaaS Node funciona (Railway, Render, Fly, Heroku). Asegurate de:
  1. Tener Node ≥ 18 disponible.
  2. Setear las variables de la sección 5.
  3. Correr `npm run seed` una sola vez (o desactivarlo si vas a usar un import distinto).
  4. Si vas a recibir pagos reales, exponer `BASE_URL` por HTTPS y configurar la URL de webhook en MP.
- El archivo `Procfile` existente del repo apunta a la app Python; si el target es desplegar este backend Node, reemplazá la línea o usá un `Procfile` específico (`web: node server.js`).

---

## Parte 2 — Motor de vigilancia (avance: Slice 1)

Implementado de `BUILD_SPEC_MOTOR.md`:

- **Schema completo** (las 9 tablas de §9): `packs`, `usuarios`, `boletines`, `marcas_boletin`, `marcas_vigiladas`, `alertas`, `alerta_candidatos`, `audit_log`, `notificaciones` + `sesiones`. Todo idempotente (`CREATE TABLE IF NOT EXISTS`).
- **Seed extendido**: `npm run seed` ahora carga marcas INPI + los 3 packs (`vigilancia_3`, `vigilancia_10`, `vigilancia_20`) + un usuario admin (`admin@legalpacers.com` / `admin12345`, configurable con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`).
- **Auth con roles** (`src/auth.js`): `bcryptjs` para passwords + cookie de sesión firmada (HMAC-SHA256) + tabla `sesiones`. Endpoints:
  - `POST /api/auth/register` — alta de `cliente` libre; alta de `admin`/`operador` requiere header `X-Admin-Token`.
  - `POST /api/auth/login` → setea cookie `lp_sid` httpOnly.
  - `POST /api/auth/logout`.
  - `GET /api/auth/me`.
  - Helper `requireAuth('admin','operador')` para proteger rutas.
- **Etapa 1 del matching** (`src/matching/etapa1.js`): normalización + código fonético español (ll/y, b/v, c/s/z, g/j, h muda) + Levenshtein + similitud por trigramas + clases relacionadas. Devuelve score 0–100 y motivos. Reemplaza la lógica interna del pre-check (`/api/marca/check` ahora se apoya en ella).
- **Etapa 2 (Gemini)** en stub (`src/matching/etapa2.js`): devuelve el JSON estructurado pedido por el spec (`nivel_riesgo` / `notoria` / `fundamento` / `recomendacion`). Con `GEMINI_API_KEY` real llama a `gemini-2.5-pro`. Cache por par marca-candidata en `audit_log`.
- **`audit_log`** (`src/audit.js`): hook listo, ya registra altas de usuario, login, logout y los hits de cache de Gemini.

### Slice 2 — Panel admin

- **Endpoints** (`src/admin.js`, todos detrás de `requireAuth('admin','operador')`):
  - `GET /api/admin/resumen` — métricas de dashboard.
  - `GET /api/admin/alertas[?estado=]` — bandeja con candidatos + JSON de Etapa 2 (stub).
  - `PATCH /api/admin/alertas/:id` — cambiar estado (`revisada` / `accion_tomada` / `descartada`), queda registrado en `audit_log`.
  - `GET /api/admin/{leads,usuarios,packs,marcas-vigiladas,boletines,audit}` — lectura.
- **UI estática** en `public/admin/index.html`, montada en `GET /admin`. Vanilla JS, mismo tema dark que la landing. Login → tabs (Resumen / Alertas / Leads / Usuarios / Marcas vigiladas / Packs / Boletines / Auditoría).
- **Seed demo**: además del admin, ahora crea un cliente (`demo.cliente@legalpacers.com / demo12345`), una marca vigilada `Focca`, un boletín ficticio y una alerta con 2 candidatos (FOKKA / FOCA) ya analizados por Etapa 2 stub — para que la bandeja muestre algo al primer arranque.

### Slice 3 — Portal cliente

- **Endpoints** (`src/cliente.js`, todos detrás de `requireAuth('cliente')`):
  - `GET /api/cliente/me` — info del usuario + pack + cupo (`cupo_marcas`, `marcas_activas`, `cupo_disponible`).
  - `GET /api/cliente/marcas` — sus marcas + estado del pack.
  - `POST /api/cliente/marcas` — alta de marca. **El cupo se valida acá**: si `marcas_activas >= cupo_marcas` devuelve 403 con `{ cupo_excedido: true }` para que el front muestre CTA a upgrade. Nunca confía en el front.
  - `PATCH /api/cliente/marcas/:id` — pausar/reactivar. Al reactivar revalida cupo.
  - `DELETE /api/cliente/marcas/:id` — baja.
  - `GET /api/cliente/alertas` — sus alertas, con candidatos resumidos. No expone el JSON crudo de Gemini ni los motivos técnicos (eso queda en el panel admin).
  - `GET /api/cliente/packs` — catálogo para mostrar opciones de upgrade.
- **UI estática** en `public/cliente/index.html`, montada en `GET /cliente`. Login → tabs: Mis marcas / Mis alertas / Mi pack. Banner con barra de cupo que se pone roja cuando llega al tope y deshabilita el formulario de alta.
- Todas las acciones quedan registradas en `audit_log` (`vigilancia.alta`, `vigilancia.cambio_estado`, `vigilancia.baja`).

### Slice 4 — Ingesta de boletines + scheduler

- **Parser** (`src/ingesta/parser.js`): soporta **CSV nativo** y **PDF** (con `pdf-parse` opcional). El PDF queda con un regex heurístico — los boletines reales del INPI tienen layout tabular y van a requerir ajustar el regex con un boletín real de muestra.
- **Pipeline** (`src/ingesta/index.js`): hash SHA-256 del archivo → si ya se ingirió, deduplica. Inserta filas en `marcas_boletin` y registra en `boletines` (`estado`, `total_actas`). Todo dentro de una transacción.
- **Comandos**:
  - `npm run ingesta -- ./data/boletin-fixture.csv` (un archivo o una carpeta).
  - `npm run monitoreo` — corre Etapa 1 + Etapa 2 contra el último boletín procesado. Flags: `--boletin <id>`, `--no-notify`.
- **Job** (`src/jobs/monitoreo-semanal.js`): por cada marca vigilada activa, corre matching contra las actas del boletín, descarta lo que quede en nivel `bajo` (Etapa 2) y genera una alerta + candidatos. **Idempotente** vía índice único `(usuario_id, marca_vigilada_id, boletin_id)`: re-correr el job sobre el mismo boletín no duplica nada.
- **Notificaciones** (`src/notificaciones.js`): mail con **Resend** y WhatsApp con **Cloud API**. Modo stub si faltan credenciales — loguea y registra en `notificaciones` con estado `enviada_stub`. Todo envío (real o stub) queda auditado en la tabla.
- **Endpoints admin nuevos**:
  - `POST /api/admin/boletines/ingestar` — ingestar por path.
  - `POST /api/admin/monitoreo/run` — correr el monitoreo a demanda (lo mismo que el comando CLI).
- **Panel admin** → tab "Boletines": ahora tiene un campo de path + botón "Ingestar boletín" + botón "Correr monitoreo ahora".
- **Fix de Etapa 1**: el código fonético español ahora distingue `c+e/i` (suena `s`) de `c+otra` (suena `k`) y colapsa `ll ↔ y` (yeísmo). Antes "Focca" no matcheaba "FOKKA" — ahora sí (score 96, "coincidencia_fonetica + misma_clase").
- **Fixture** en `data/boletin-fixture.csv` con 15 actas pensadas para disparar alertas contra el cliente demo.

### Slice 6 — Import de la DB Python + puente automático

**Importación inicial** (`src/import-python-db.js`):
- Lee `marcas.db` (la DB de la app Python heredada) en read-only y vuelca a
  las tablas del backend Node:
  - `boletin_log` (502 filas) → `boletines`
  - `marcas` (408 197 filas) → `marcas_inpi` + `marcas_boletin`
- Idempotente: índices únicos parciales en `marcas_inpi(acta, clase)` y
  `marcas_boletin(boletin_id, acta)`. Re-correr el script no duplica.
- Transacciones por batches de 5 000 filas + prepared statements →
  ~27 segundos en local para 408 k filas.
- Configurable con `PYTHON_DB_PATH` en `.env`. Flags `--limit N` y
  `--no-boletin` para pruebas.
- `npm run import-python` lo dispara.

**Backfill** (`src/run-backfill.js` / `npm run backfill`):
- Corre el monitoreo retroactivo sobre los últimos N boletines reales
  (default 8) sin enviar notificaciones, para poblar el panel con
  alertas históricas a la vista. Flag `--n N` para ajustar.

**Puente automático** (`src/jobs/puente-python.js`):
- Si `PYTHON_DB_PATH` está seteado, el scheduler programa un job
  adicional (`CRON_PUENTE_PYTHON`, default cada hora en punto) que:
  1. Lista en `marcas.db` los boletines `status='ok'` que aún no
     existen en `boletines`.
  2. Para cada nuevo: inserta `boletines` + `marcas_boletin` + actualiza
     `marcas_inpi`.
  3. Dispara `monitoreo-semanal` sobre ese boletín específico
     (idempotente por el UNIQUE de alertas).
  4. Audita el resultado.
- El scraper Python sigue siendo el dueño de descargar los boletines
  oficiales — el backend Node sólo los consume.

**Fix de fonético**: eliminar todas las vocales era muy agresivo —
generaba falsos positivos absurdos (KAIROS ≡ CURAZAO, NOVA ≡ NUVIA).
Ahora se conservan las vocales y se confía en Levenshtein + trigramas
para captar variantes ortográficas. Verificado contra 6 boletines
reales: bajó de 8 alertas con falsos positivos a 4 alertas todas
legítimas (incluyendo una **coincidencia exacta real** de NOVA con un
titular registrado en el INPI, clase 35).

### Slice 5 — Scheduler automático

- `src/jobs/scheduler.js`: programa el monitoreo semanal con **`node-cron`**. Default `0 9 * * 3` (miércoles 9:00, TZ `America/Argentina/Buenos_Aires`), configurable con `CRON_MONITOREO` y `TZ`. Toda corrida queda en `audit_log` como `cron.monitoreo` (o `cron.monitoreo.error`).
- Se desactiva con `CRON_ENABLED=false` (útil en dev/CI). Expresión inválida ⇒ logueo del error y el server arranca igual sin cron.
- Endpoint `GET /api/admin/scheduler` para inspeccionar estado.
- En el dashboard del panel admin aparece un chip "cron activo" + lista de tasks programadas.

**Con esto el BUILD_SPEC_MOTOR.md queda cubierto end-to-end en modo stub**. Para producción sólo falta enchufar credenciales reales:
- `GEMINI_API_KEY` → Etapa 2 deja de devolver el mock.
- `RESEND_API_KEY` + `MAIL_FROM` verificado → mail real.
- `WA_TOKEN` + `WA_PHONE_NUMBER_ID` + plantilla aprobada → WhatsApp real.
- `MP_ACCESS_TOKEN` real → checkout productivo de Mercado Pago.
- Conectar la fuente de boletines real (CSV oficial / export INPI / scraping autorizado) reemplazando `src/inpi.js` o ingestando vía `npm run ingesta`.

### Probar el slice

```bash
npm run seed       # ahora crea admin + packs
npm start

# Login admin
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@legalpacers.com","password":"admin12345"}'

# Quién soy
curl -b cookies.txt http://localhost:3000/api/auth/me

# Pre-check con la nueva Etapa 1 (mismo endpoint, ahora con score interno y motivos)
curl -X POST http://localhost:3000/api/marca/check -H 'Content-Type: application/json' \
  -d '{"marca":"Brío","clases":[25],"rubro":"ropa de diseño"}'
```

### Notas de diseño

- El pre-check público sigue usando `minScore: 80` para mantener el espíritu "sólo coincidencia exacta o casi exacta" del check gratis. La función `listaCorta()` expone el matching completo (con fonético + trigramas) para el motor de vigilancia interno.
- La etapa 2 **no decide**: siempre se loguea prompt + respuesta y la salida es señal para revisión humana, alineado con la condición del spec ("ninguna determinación legal quede decidida por la IA sin revisión humana").
- `SESSION_SECRET` debe setearse en prod — el default `dev-session-secret-cambiame` está pensado para que el server arranque local sin fricción, no para producción.

---

## Estructura

```
.
├── landing-legalpacers.html   # frontend (no se toca)
├── BUILD_SPEC.md              # contrato
├── server.js                  # entrypoint Express
├── package.json
├── src/
│   ├── db.js                  # better-sqlite3 + schema (Parte 1 + Parte 2)
│   ├── inpi.js                # adaptador de fuente INPI (sobre Etapa 1)
│   ├── pagos.js               # Mercado Pago (con modo stub)
│   ├── auth.js                # bcrypt + cookies firmadas + middleware
│   ├── audit.js               # audit_log helper
│   ├── admin.js               # endpoints del panel admin
│   ├── cliente.js             # endpoints del portal cliente (cupo del pack)
│   ├── notificaciones.js      # mail (Resend) + WhatsApp Cloud API (stub)
│   ├── matching/
│   │   ├── etapa1.js          # determinístico: fonético ES + Lev + trigramas + clases
│   │   └── etapa2.js          # Gemini (stub sin API key)
│   ├── ingesta/
│   │   ├── parser.js          # CSV nativo + PDF (con pdf-parse opcional)
│   │   └── index.js           # pipeline con dedup por hash
│   ├── jobs/
│   │   ├── monitoreo-semanal.js  # Etapa 1 + Etapa 2 + alertas idempotentes + notif
│   │   └── scheduler.js          # node-cron, programa el monitoreo a los miércoles
│   ├── run-ingesta.js         # CLI: npm run ingesta -- archivo.csv
│   ├── run-monitoreo.js       # CLI: npm run monitoreo
│   └── seed.js                # marcas + packs + admin + demo
├── public/
│   ├── admin/index.html       # UI del panel admin (vanilla JS)
│   └── cliente/index.html     # UI del portal cliente (vanilla JS)
└── data/
    ├── marcas_seed.csv        # dataset INPI de ejemplo
    └── boletin-fixture.csv    # boletín de prueba para ingesta + monitoreo
```
