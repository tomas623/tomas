# Solución: Database Loading Stuck (Boletín 5498)

## El Problema
El sistema de importación de boletines se colgaba indefinidamente en el boletín 5498 sin poder recuperarse. Esto impedía cargar la base de datos completa de marcas del INPI.

**Causa raíz:** Falta de timeouts absolutos. Si la descarga de un PDF se quedaba esperando una respuesta que nunca llegaba, el sistema se colgaba para siempre.

## La Solución (Implementada)

### 1. Timeouts Agresivos
- **Timeout absoluto por boletín:** 90 segundos máximo (download + parse + import)
- **Curl timeout:** 20 segundos con connect-timeout redundante
- **Reintentos mejorados:** 3 intentos con recovery automático

### 2. Endpoints de Administración Nuevos

#### Resetear estado completamente
```bash
curl -X POST http://localhost:5000/api/admin/reset \
  -H "Content-Type: application/json" \
  -d '{"key": "YOUR_ADMIN_KEY"}'
```

#### Forzar reinicio (mata procesos colgados)
```bash
curl -X POST http://localhost:5000/api/admin/restart-import \
  -H "Content-Type: application/json" \
  -d '{"key": "YOUR_ADMIN_KEY", "years": 10}'
```

#### Saltar boletín problemático
```bash
curl -X POST http://localhost:5000/api/admin/skip-bulletin \
  -H "Content-Type: application/json" \
  -d '{"key": "YOUR_ADMIN_KEY", "num": 5498}'
```

### 3. CLI Utility: `fix_stuck_bulletin.py`

**Ver estado actual:**
```bash
python fix_stuck_bulletin.py --status
```

**Resetear estado:**
```bash
python fix_stuck_bulletin.py --reset
```

**Saltar boletín problemático:**
```bash
python fix_stuck_bulletin.py --skip 5498
```

**Saltar rango:**
```bash
python fix_stuck_bulletin.py --skip-range 5498 5510
```

**Limpiar y comenzar desde boletín específico:**
```bash
python fix_stuck_bulletin.py --fresh --from 5500
```

## Cambios en el Código

### `bulk_importer.py`
- Agregado timeout absoluto con `signal.SIGALRM` en `import_bulletin()`
- Mejorado `_download_curl()` con `--connect-timeout` redundante
- Aumentados reintentos de 2 a 3 con delays más cortos (1s vs 2s)

### `app.py`
- Nuevo endpoint: `/api/admin/restart-import` (fuerza kill de procesos colgados)
- Nuevo endpoint: `/api/admin/skip-bulletin` (salta boletines problemáticos)
- Mejora en `/api/db/status` con auto-fix de estado colgado
- Parámetro `force=True` en `_trigger_bulk_import()` para bypass de flag

### `fix_stuck_bulletin.py` (NUEVO)
- CLI utility para gestionar estado de importación
- Funciones: reset, skip, skip-range, fresh start
- Diagnóstico de estado actual

## Cómo Usarlo en Producción

### Opción 1: Vía Admin Panel (Recomendado)
1. Abre `https://tuapp.com/admin`
2. Ingresa tu ADMIN_KEY
3. Elige una opción:
   - **"Importar últimos N años"** - Importación normal con timeouts seguros
   - **"Forzar reset"** - Si está completamente colgado

### Opción 2: Vía cURL (Si tienes acceso a servidor)
```bash
# Reset
curl -X POST https://tuapp.com/api/admin/reset \
  -H "Content-Type: application/json" \
  -d '{"key": "ADMIN_KEY_SECRET"}'

# Restart forzado
curl -X POST https://tuapp.com/api/admin/restart-import \
  -H "Content-Type: application/json" \
  -d '{"key": "ADMIN_KEY_SECRET", "years": 10}'
```

### Opción 3: Vía CLI (Si tienes SSH)
```bash
python fix_stuck_bulletin.py --reset
python bulk_importer.py --years 10
```

## Monitorear Progreso

### Vía Admin Panel
- Abre `/admin` y observa "Boletín en proceso" y "Total marcas en DB"
- Se actualiza cada 15 segundos automáticamente

### Vía API
```bash
curl http://localhost:5000/api/db/status | jq .
```

Respuesta:
```json
{
  "total_marcas": 15234,
  "last_boletin": 5501,
  "db_ready": true,
  "import_running": true,
  "import_boletin": 5550,
  "import_error": null
}
```

## Comportamiento Después de la Fix

1. **Boletín colgado (25+ segundos):** Sistema detecta timeout → registra como error → continúa con el siguiente
2. **Error de conexión:** Reintenta 3 veces con delays cortos → si falla, registra y continúa
3. **Boletín con 0 registros:** Registra como "ok" con 0 records y continúa
4. **Importación completada:** Sistema se detiene automáticamente

## Verificación: ¿Funciona?

Después de que termine:
```bash
python fix_stuck_bulletin.py --status
```

Deberías ver:
- ✓ Running: False
- ✓ Last imported: 5501 (o más alto)
- ✓ Total marcas: 50,000+ (depende del rango)

Luego en la web:
```bash
curl http://localhost:5000/api/verificar \
  -H "Content-Type: application/json" \
  -d '{"marca": "GOOGLE", "clase": 35}'
```

Debería retornar resultados de la BD local en lugar de ir a INPI.

## Si Sigue Fallando

1. Verifica logs: `tail -f import.log`
2. Chequea red: `curl -I https://portaltramites.inpi.gob.ar/Boletines`
3. Salta boletín problemático: `python fix_stuck_bulletin.py --skip 5498`
4. Intenta rango más pequeño: `python bulk_importer.py --from 5000 --to 5100`
