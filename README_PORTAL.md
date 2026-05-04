# LegalPacers — Portal de marcas

Plataforma para verificar disponibilidad, registrar y vigilar marcas en el INPI Argentina.

## Stack

- **Web**: Flask 3 + Jinja + Alpine.js (sin build step).
- **DB**: PostgreSQL en Railway (con `pg_trgm` para similitud por trigramas).
  Cae a SQLite local si `DATABASE_URL` está vacía (solo dev).
- **IA**: Anthropic Claude (sugerencia de clases, similitud conceptual, pre-análisis legal).
- **Pagos**: MercadoPago Checkout Pro (pagos únicos) + Subscriptions/preapproval (vigilancia mensual).
- **Email**: Resend (preferido) con fallback SMTP.
- **Importador**: Python script invocado por Windows Task Scheduler en una PC local.

## Niveles de servicio

| Nivel | Qué es | Endpoint | Precio |
|-------|--------|----------|--------|
| 1 | Consulta gratuita (veredicto sin revelar nombres) | `POST /api/marca/check` | $0 |
| 2 | Análisis completo con IA + pre-análisis legal | `POST /api/marca/consulta/iniciar` | $25.000 ARS |
| 3 | Registro de marca (formulario, sin pago automático) | `POST /api/marca/cotizar-registro` | A cotizar |
| 4 | Vigilancia mensual del INPI | `POST /api/dashboard/vigilancia/activar` | $20.000 ARS / marca / mes |

## Estructura del proyecto

```
.
├── app.py                       # Flask app + admin existente
├── database.py                  # ORM (Marca, BoletinLog, ImportState +
│                                #  User, Lead, Consulta, Pago, MarcaCliente,
│                                #  SuscripcionVigilancia, AlertaVigilancia)
├── similarity.py                # Motor 3D: trigramas, fonética ES, conceptual IA
├── bulk_importer.py             # Importador (parser, upsert, retry)
├── inpi_scraper.py              # Scraping live del portal INPI (fallback)
├── pdf_generator.py             # ReportLab para informes PDF
├── posiciones_data.py           # Catálogo Nice 1-45
│
├── routes/
│   ├── auth.py                  # /login + /api/auth/{signup,login,magic,me,logout}
│   ├── marca.py                 # /api/marca/check + /consulta/iniciar + /cotizar-registro
│   ├── pagos.py                 # /api/pagos/webhook + simulador /dev/checkout
│   └── dashboard.py             # /dashboard + 5 tabs JSON
│
├── services/
│   ├── auth.py                  # bcrypt, magic links, sesiones
│   ├── email.py                 # Resend + SMTP fallback + 5 plantillas
│   ├── domains.py               # RDAP .com + DNS .com.ar
│   ├── mercadopago.py           # SDK + Checkout Pro + Subscriptions + webhook
│   ├── vigilancia.py            # Job post-import: detecta colisiones + emails
│   └── nurturing.py             # Secuencia D+1, D+4, D+10
│
├── scripts/
│   ├── import-boletin.py        # Entrypoint Python (idempotente)
│   ├── import-boletin.ps1       # Wrapper PowerShell (carga .env, activa venv)
│   └── install-task-scheduler.ps1  # Registra tarea (miércoles 21:00)
│
├── templates/
│   ├── index.html               # Landing nueva (hero + plans + FAQ + WhatsApp)
│   ├── informe.html             # Vista del informe Nivel 2 (paywall + desbloqueo)
│   └── relevamiento.html        # Wizard legacy (preservado)
│
├── logs/                        # logs/import-boletin-YYYYMMDD.log (gitignored)
└── requirements.txt
```

## Setup local

```bash
git clone https://github.com/tomas623/tomas.git
cd tomas
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# editar .env y completar al menos:
#   FLASK_SECRET_KEY  (string aleatorio)
#   ANTHROPIC_API_KEY (necesaria para Nivel 2)

python app.py
# http://localhost:5000
```

Sin `MP_ACCESS_TOKEN`, los pagos van al simulador `/dev/checkout` (3 botones para resolver el pago: approve / pending / reject).

## Deploy en Railway (web)

1. Provisionar Postgres en el proyecto. Railway setea `DATABASE_URL` automático.
2. Setear las demás variables de `.env.example` en Railway.
3. Procfile / start command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
4. La primera vez `/api/db/status` levanta el schema (incluye `CREATE EXTENSION pg_trgm`).
5. Configurar el webhook de MercadoPago apuntando a:
   `https://tu-dominio.railway.app/api/pagos/webhook`

## Importador de boletines (Windows local)

El INPI publica un boletín cada miércoles. La PC del estudio corre el importador conectándose al **mismo Postgres remoto** (Railway). Setup:

```powershell
# Una sola vez, como Administrador
.\scripts\install-task-scheduler.ps1
```

Crea una tarea programada `LegalPacers-Import-Boletin` que:
- Se ejecuta cada **miércoles a las 21:00** (después de la publicación habitual del INPI).
- Reintenta 3 veces con espera de 30 minutos si falla la red.
- Si la PC estaba apagada al horario, corre apenas se prenda.
- Logs persistentes en `logs/import-boletin-YYYYMMDD.log`.

Después de cada importación exitosa, dispara automáticamente:
1. **Vigilancia** (`services/vigilancia.py`): busca colisiones entre las marcas nuevas y las suscripciones activas, persiste `AlertaVigilancia`, manda emails.
2. **Lead nurturing** (`services/nurturing.py`): emails D+1, D+4, D+10 a leads gratuitos.
3. **Avisos de vencimiento**: 90 y 30 días antes del vencimiento de cada `MarcaCliente`.

### Probar manualmente

```powershell
.\scripts\import-boletin.ps1                 # corrida normal
.\scripts\import-boletin.ps1 -DryRun         # parsea sin escribir en DB
.\scripts\import-boletin.ps1 -ForceFrom 6000 # forzar desde un boletín específico
```

```powershell
# Ver el estado de la tarea
Get-ScheduledTaskInfo -TaskName 'LegalPacers-Import-Boletin'

# Correr ahora
Start-ScheduledTask -TaskName 'LegalPacers-Import-Boletin'
```

## Flujo de pagos

### Pago único (Nivel 2 / Registro)

1. Cliente completa el form → `POST /api/marca/consulta/iniciar`.
2. App crea `Consulta(paid=False)` + `Pago(status=pending)`.
3. App genera preferencia MP y devuelve `init_point`.
4. Cliente paga en `checkout.mercadopago.com.ar`.
5. MP llama al webhook `/api/pagos/webhook`.
6. La app re-consulta el `payment_id` a MP (validación), marca `paid=True`,
   dispara la generación del informe completo (con IA) y manda email.
7. Cliente vuelve por `back_url` a `/marca/consulta/<id>?status=success`. Si el
   webhook todavía no llegó, la página pollea cada 4s hasta 60s.

### Suscripción (Nivel 4)

1. Desde `/dashboard`, cliente activa vigilancia sobre una marca.
2. App crea `SuscripcionVigilancia(status=pending)` + preapproval MP.
3. Cliente autoriza el cobro recurrente en MP.
4. MP envía webhook `preapproval` → app marca `status=active`.
5. Cada mes MP cobra automáticamente y envía webhook `authorized_payment` → app guarda un `Pago` adicional.
6. Cancelación desde el dashboard → llama a MP con `status=cancelled`.

## Modo dev (sin credenciales MP)

Si `MP_ACCESS_TOKEN` no está seteada, **todos** los flujos de pago redirigen a `/dev/checkout`, una pantalla con 3 botones que simulan el resultado del pago:

- ✓ **Aprobar** → marca el pago como aprobado, dispara los mismos hooks que el webhook real.
- ⏳ **Pendiente** → simula un pago a la espera.
- ✕ **Rechazar** → simula rechazo.

Permite probar end-to-end sin generar costos ni cuenta de MP.

## Variables de entorno

Ver `.env.example` para la lista completa con comentarios.

| Variable | Requerida | Default |
|----------|-----------|---------|
| `FLASK_SECRET_KEY` | sí (prod) | `dev-key-...` |
| `DATABASE_URL` | recomendada | SQLite local |
| `ANTHROPIC_API_KEY` | para Nivel 2 | — |
| `MP_ACCESS_TOKEN` | para pagos reales | — (modo dev) |
| `RESEND_API_KEY` | para emails ricos | — (cae a SMTP) |
| `APP_BASE_URL` | sí (prod) | `request.host_url` |
| `PRECIO_CONSULTA_COMPLETA` | no | `25000` |
| `PRECIO_VIGILANCIA_MARCA` | no | `20000` |
| `PRECIO_VIGILANCIA_PORTFOLIO` | no | `50000` |

## Modelo de datos

```
User ─┬── Consulta ── Pago
      ├── MarcaCliente ── SuscripcionVigilancia ── AlertaVigilancia ── Marca (boletín)
      └── Pago

Lead              # capturas de Nivel 1 + Nivel 3, sin obligación de cuenta
MagicLinkToken    # tokens de un solo uso para login sin password
BoletinLog        # status de cada boletín importado (idempotencia)
ImportState       # flag global "hay importación en curso"
Marca             # 300k+ filas del INPI con índice GIN trigrama
```

## Troubleshooting

**Los pagos quedan "pending" para siempre**
Verificar que `APP_BASE_URL` apunte a una URL pública alcanzable por MP y que el webhook esté configurado en el panel de MP.

**No se mandan emails**
Sin `RESEND_API_KEY`, la app intenta SMTP. Sin SMTP tampoco, el envío falla pero la app no rompe (devuelve `False` y loguea el error).

**Búsqueda lenta en producción**
Verificar que la migración de `init_db()` haya creado el índice GIN:
```sql
SELECT * FROM pg_indexes WHERE tablename = 'marcas';
-- debe aparecer ix_marcas_denominacion_trgm
```

**El importador no encuentra boletines nuevos**
Los boletines a veces se publican el jueves o viernes en lugar del miércoles. La tarea reintenta 3 veces con 30 minutos entre intentos. Si igualmente falla, el script siguiente miércoles toma esa diferencia.

## Licencia

Privado — LegalPacers.
