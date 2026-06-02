FROM node:20-bookworm-slim

WORKDIR /app

# Dependencias del sistema mínimas para better-sqlite3 (precompila desde npm cache).
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Instalación de deps (capa cacheable).
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Código.
COPY server.js ./
COPY src ./src
COPY public ./public
COPY data ./data
COPY landing-legalpacers.html ./

# El volumen persistente del PaaS debe montarse en /app/data
# (donde vive `legalpacers.db`). En Railway: Volume → mountPath /app/data.
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck — Railway/Render/Fly lo respetan automáticamente.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

# El seed es idempotente: corre al boot y garantiza schema + packs + admin.
# Override con SKIP_SEED=true si querés saltarlo.
CMD ["sh", "-c", "if [ \"$SKIP_SEED\" != \"true\" ]; then node src/seed.js; fi && node server.js"]
