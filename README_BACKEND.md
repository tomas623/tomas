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

## Estructura

```
.
├── landing-legalpacers.html   # frontend (no se toca)
├── BUILD_SPEC.md              # contrato
├── server.js                  # entrypoint Express
├── package.json
├── src/
│   ├── db.js                  # better-sqlite3 + schema
│   ├── inpi.js                # buscarEnINPI + normalización + enmascarado
│   ├── pagos.js               # Mercado Pago (con modo stub)
│   └── seed.js                # importador del CSV
└── data/
    └── marcas_seed.csv        # dataset de ejemplo
```
