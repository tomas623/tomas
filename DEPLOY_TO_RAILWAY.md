# Cómo Copiar Base de Datos a Railway (Production)

## Cuando se completa la importación local:

### Opción 1: PostgreSQL Dump (Recomendado)

```bash
# 1. Exportar DB local a SQL
pg_dump -h localhost -U postgres -d marcas > marcas_backup.sql

# 2. Copiar a Railway
# Obtén la DATABASE_URL de Railway y ejecuta:
psql <DATABASE_URL> < marcas_backup.sql
```

### Opción 2: Usando SQLite (Si usas SQLite localmente)

```bash
# 1. Copiar el archivo marcas.db a Railway
scp marcas.db railway_user@railway_server:/path/to/app/

# 2. O en Railway console:
# cp /local/marcas.db /app/marcas.db
```

### Opción 3: Directamente en Railway Console

```bash
# 1. Ver DATABASE_URL en Railway
echo $DATABASE_URL

# 2. Hacer dump remoto si necesario
pg_dump $DATABASE_URL > production_backup.sql
```

## Verificar que funcionó

Después de copiar:

```bash
# En local, verificar antes de copiar:
python fix_stuck_bulletin.py --status

# En production (https://tomas-production.up.railway.app/admin):
# Debería mostrar Total marcas = X
```

## Automatización (Para futuras importaciones)

Si quieres que Railway importe automáticamente cuando INPI sea accesible:

1. Mergea la rama `claude/fix-database-loading-wicKP` a `main`
2. En Railway, el cron semanal ejecutará: `python bulk_importer.py --new-only`
3. El sistema importará nuevos boletines automáticamente cada semana

## Resolución del bloqueo INPI en Railway

Contacta a Railway para:
- Whitelist la IP de Railway en INPI
- O: usar un proxy/VPN que no esté bloqueado

Alternativa: Continuar importando desde local (donde tengas acceso) y copiar periódicamente.
