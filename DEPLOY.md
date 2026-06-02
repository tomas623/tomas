# Deploy a producción — LegalPacers backend (Node)

Guía paso a paso. Recomendado: **Railway** (más amigable con Node + disco
persistente + dominio HTTPS automático). Render funciona igual con `render.yaml`.

Orden total: ~45 minutos de trabajo activo + esperas externas (WhatsApp tarda días).

---

## 0. Pre-requisitos en tu máquina

```powershell
git pull
node --version   # >= 20
git --version
```

---

## 1. Conseguir credenciales (lo que tarda)

| Servicio | Qué pedir | Dónde | Tiempo |
|---|---|---|---|
| **Mercado Pago** | Access token productivo | mercadopago.com.ar → Devs → Credenciales productivas | 10 min |
| **Resend** | API key + verificar dominio | resend.com → Domains → agregar `legalpacers.com` (SPF/DKIM) | 1-2 h, mayoría DNS |
| **WhatsApp Cloud API** | `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, plantilla `alerta_marca` aprobada | business.facebook.com → WhatsApp Manager | **3-15 días** (empezá YA) |
| **Gemini** | API key con billing | aistudio.google.com → API key | 5 min |

Los stub siguen funcionando si te falta alguna — el deploy podés hacerlo solo con Mercado Pago + dominio, y enchufar el resto después.

---

## 2. Deploy en Railway (recomendado)

### 2.1 Crear el servicio

1. Entrá a https://railway.app → **New Project** → **Deploy from GitHub repo**.
2. Elegí el repo `tomas623/tomas`, branch `claude/zen-wozniak-UhYXL`
   (o mergealo a `main` antes).
3. Railway detecta el `Dockerfile` automáticamente — no toca nada más.

### 2.2 Agregar el volumen persistente

1. Service → **Volumes** → **New Volume**.
2. Mount path: `/app/data`. Size: 5GB es de sobra para arrancar.
3. Eso preserva `legalpacers.db` entre deploys.

### 2.3 Variables de entorno

En Service → **Variables**, agregá:

```
NODE_ENV=production
BASE_URL=https://<tu-subdominio>.up.railway.app   # lo ves en Service → Settings → Networking
SESSION_SECRET=<corré: openssl rand -hex 32>
ADMIN_TOKEN=<corré: openssl rand -hex 16>
SEED_ADMIN_EMAIL=tomas@legalpacers.com
SEED_ADMIN_PASSWORD=<password fuerte, mínimo 12 chars>

# Mercado Pago productivo
MP_ACCESS_TOKEN=APP_USR-...

# Opcionales (sin ellos: stub)
GEMINI_API_KEY=
RESEND_API_KEY=
MAIL_FROM=alertas@legalpacers.com
WA_TOKEN=
WA_PHONE_NUMBER_ID=
```

> Para Mercado Pago: el webhook `/api/pagos/webhook` se configura solo
> porque el server lo pasa en `notification_url` al crear la preferencia.
> **Pero el `BASE_URL` tiene que ser HTTPS y públicamente alcanzable.**

### 2.4 Dominio custom (opcional pero recomendado)

Service → Settings → Networking → **Custom Domain** → `app.legalpacers.com`.
Railway te da el CNAME para apuntar en tu DNS. Una vez propagado, actualizá
`BASE_URL=https://app.legalpacers.com` y redeployá.

### 2.5 Primer boot

Railway corre `release: node src/seed.js` antes del `web` (Procfile). Eso
crea schema, packs y el admin. Verificá en los logs:

```
[seed] Marcas INPI: 22 insertadas desde marcas_seed.csv
[seed] Packs: 3 (vigilancia_3 / vigilancia_10 / vigilancia_20)
[seed] Admin creado: tomas@legalpacers.com / ...
[legalpacers] escuchando en http://localhost:3000 ...
[cron] monitoreo-semanal programado · "0 9 * * 3" ...
```

Visitá `https://<tu-dominio>/api/health` — tiene que devolver `{"ok":true,...}`.

### 2.6 Limpiar el demo y datos ficticios

Una vez todo arriba, abrí una **shell del servicio** en Railway
(Service → ⋮ → Shell) y corré:

```bash
npm run prep-prod -- --force
```

Eso borra el cliente demo, las marcas INPI del CSV ficticio, y deja sólo
tu admin real con el password de `.env`.

### 2.7 Importar la base real del INPI

Si tenés `marcas.db` (la DB de la app Python con 408k actas históricas),
subila a Railway:

1. Service → ⋮ → Shell → `mkdir -p /app/data && curl -L <url-de-marcas.db> -o /app/data/marcas.db`
   (o usá Railway CLI: `railway run --service backend npm run import-python`).
2. Setear `PYTHON_DB_PATH=/app/data/marcas.db` en Variables.
3. Redeploy.
4. En la shell: `npm run import-python` — ~30 segundos.
5. Setear `CRON_PUENTE_PYTHON=0 * * * *` para que detecte boletines nuevos cada hora.

---

## 3. Deploy en Render (alternativa)

Si preferís Render, hay `render.yaml` listo:

1. https://render.com → **New** → **Blueprint** → conectá el repo.
2. Render detecta `render.yaml` y crea Web Service + Disk de 5GB en `/app/data`.
3. En las variables marcadas como `sync: false` (BASE_URL, MP_ACCESS_TOKEN, etc.)
   pegá los valores en el dashboard.
4. Mismo flujo que Railway desde el paso 2.6 en adelante.

---

## 4. Apuntar la landing al backend

Si el frontend `landing-legalpacers.html` ya lo sirve el backend Node
(que es lo que hace en `GET /`), no hace falta hacer nada — `app.legalpacers.com` muestra todo.

Si querés que `www.legalpacers.com` sea el público y `app.legalpacers.com` solo
admin/cliente, te dejo dos opciones (avisame y armo):

- **Misma instancia, dos dominios apuntando al mismo deploy.** El servidor
  responde lo mismo en cualquiera, el branding lo decidís en DNS.
- **CDN/Vercel sirve la landing estática + proxy a `/api/*` y `/admin/*` al
  backend Railway.** Más rápido y barato, requiere un `vercel.json` extra
  que puedo armar.

---

## 5. Checklist final pre-anuncio

- [ ] `GET /` devuelve la landing.
- [ ] `GET /api/health` devuelve `ok` con conteos.
- [ ] Login en `/admin/` con tu admin real funciona.
- [ ] El demo `demo.cliente@legalpacers.com` NO existe (corriste `prep-prod`).
- [ ] El pre-check en la landing devuelve resultados (con base real importada).
- [ ] Un cobro de prueba en Mercado Pago abre el checkout real (no stub).
- [ ] El webhook MP marca el lead como `pagado` después del pago de prueba.
- [ ] (Cuando llegue) Resend manda mails reales — verificar en `/admin/audit`.
- [ ] (Cuando llegue) WhatsApp Cloud manda alertas reales.

---

## 6. Rollback

Si algo explota:

```bash
# En Railway: Deployments → último deploy verde → "Redeploy"
# En Render:   Deploys → click en el deploy anterior → "Rollback to here"
```

La DB sobrevive porque vive en el volume persistente. Los únicos datos
que se pierden si arrancás de cero son los logs en memoria — todo lo
importante (leads, alertas, audit) está en SQLite.
