# Deploy a Railway — paso a paso

Esta guía te lleva de un repo local a una app productiva en Railway con
PostgreSQL gestionado y dominio HTTPS. Tiempo estimado: 15-20 min.

## Pre-requisitos

- Cuenta en https://railway.app (login con GitHub recomendado)
- El repo subido a GitHub
- Las variables sensibles a mano (Anthropic key, MercadoPago token, SMTP, etc.)

## 1. Crear el proyecto

1. En Railway → **New Project** → **Deploy from GitHub repo**
2. Autorizá Railway a leer tus repos y elegí éste
3. Railway detecta `nixpacks.toml` y `Procfile` automáticamente y empieza el primer build (va a fallar porque falta DB y env vars — es esperable)

## 2. Agregar PostgreSQL

1. En el dashboard del proyecto → **+ New** → **Database** → **Add PostgreSQL**
2. Esperá ~30s a que se aprovisione
3. Railway crea automáticamente la variable `DATABASE_URL` y la inyecta al servicio web — no hace falta copiarla a mano

## 3. Configurar variables de entorno

En el servicio web → pestaña **Variables** → **Raw Editor**. Pegá esto adaptando los valores:

```
ANTHROPIC_API_KEY=sk-ant-xxxxx
FLASK_SECRET_KEY=<un string aleatorio largo>
ADMIN_KEY=<otro string aleatorio>

# Email transaccional
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@tudominio.com
SMTP_PASS=<app password>
FROM_EMAIL=noreply@tudominio.com
INTERNAL_NOTIFY_EMAIL=contacto@tudominio.com

# MercadoPago
MP_ACCESS_TOKEN=APP_USR-xxxxx
PUBLIC_BASE_URL=https://<tu-app>.up.railway.app
PREMIUM_PRICE_ARS=9900
PREMIUM_DAYS=30

# Producción
DEBUG=False
SESSION_COOKIE_SECURE=true
AUTO_IMPORT=true
```

> Para generar secretos rápido: `python -c "import secrets; print(secrets.token_urlsafe(32))"`

## 4. Generar dominio público

1. Servicio web → **Settings** → **Networking** → **Generate Domain**
2. Te da una URL `https://tu-app.up.railway.app`
3. **Importante**: copiá esa URL y actualizá `PUBLIC_BASE_URL` en Variables

## 5. Migrar datos a Postgres

Tu `marcas.db` local (SQLite) tiene 300k+ marcas que necesitás llevar al Postgres de Railway. El repo incluye `migrate_to_postgres.py` para esto.

### Opción A: Migración directa desde tu máquina local (recomendado)

1. Copiá la `DATABASE_URL` de Railway (ícono de ojito en Variables)
2. En tu PC, con el venv activado:

```powershell
$env:DATABASE_URL = "postgresql://...railway..."
python migrate_to_postgres.py
```

3. Lleva entre 5 y 30 min según tu conexión. El script imprime progreso.

### Opción B: Dejar que el auto-import reconstruya

Si tenés `AUTO_IMPORT=true`, al primer arranque Railway empieza a bajar boletines del INPI y los carga. Funciona pero tarda **varias horas** (cientos de boletines, 2k+ marcas cada uno). Solo conviene si vas a empezar de cero. Ojo: si Railway tiene la IP bloqueada por el INPI, esta opción no funciona — usá la Opción A.

## 6. Verificar el deploy

1. Andá a `https://tu-app.up.railway.app` — tendría que cargar el portal
2. Probá una búsqueda. Si Postgres está bien migrado, responde en <1 segundo (usa el índice GIN trigram)
3. Endpoint de salud (admin):
   `https://tu-app.up.railway.app/api/db/status?key=<ADMIN_KEY>`
   Te muestra cantidad de marcas, último boletín, índices.

## 7. Cron semanal de importación (opcional)

Para que importe boletines nuevos cada miércoles automáticamente:

1. **+ New** → **Cron Job**
2. Schedule: `0 12 * * 3` (miércoles 12 UTC)
3. Command: `python cron_weekly.py`
4. En Variables del cron, copiá las mismas que el web service (especialmente `DATABASE_URL` y `ANTHROPIC_API_KEY`)

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| 502 Bad Gateway | App no arranca | Logs → buscar excepción en startup. Suele ser env var faltante. |
| Búsqueda vacía | DB sin datos | Ejecutar `migrate_to_postgres.py` |
| MercadoPago 401 | Token expirado | Renovar en panel MP, actualizar `MP_ACCESS_TOKEN` |
| INPI bloquea Railway | IP de RW en lista negra | Importar desde local y migrar (Opción A) |
| Pago no acredita | Webhook MP mal configurado | En MP, configurar `https://tu-app.up.railway.app/api/pagos/webhook` |

## Logs y debugging

```bash
# CLI de Railway (instalá con: npm i -g @railway/cli)
railway login
railway link            # asociá la carpeta al proyecto
railway logs            # logs en vivo
railway run python ...  # correr scripts contra la DB de RW
```
