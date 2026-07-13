// Seguridad HTTP: security headers + rate limiting en memoria.
//
// El rate limiter es in-memory (suficiente para un único proceso en Railway).
// Si en el futuro se escala a múltiples instancias, habría que moverlo a Redis.
// Para el MVP, in-memory protege de los abusos reales: brute force al login,
// spam al chequeo, mail-bombing vía lead-free/forgot-password.

// ===== Security headers =====
function securityHeaders(req, res, next) {
  // Evita que el sitio se embeba en iframes de TERCEROS (clickjacking), pero
  // permite el mismo origen — el panel admin embebe el visor de PDF del informe.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Evita MIME sniffing.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // No filtrar el referer completo a sitios externos.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Desactiva APIs sensibles del browser que no usamos.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self)');
  // HSTS: fuerza HTTPS por un año (solo tiene efecto sobre HTTPS).
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP permisivo pero útil: bloquea inyección de scripts de orígenes no
  // esperados. Permitimos inline (la landing usa Alpine + estilos inline) y
  // los dominios de GA, LinkedIn y Mercado Pago que sí cargamos.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://snap.licdn.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://www.google-analytics.com https://px.ads.linkedin.com https://region1.google-analytics.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self' https://www.mercadopago.com.ar https://mpago.la",
  ].join('; '));
  next();
}

// ===== Rate limiter en memoria =====
// Ventana deslizante por ventana fija (fixed window) — simple y suficiente.
const buckets = new Map();

// Limpieza periódica de buckets vencidos para no crecer infinito.
setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of buckets) {
    if (v.reset < ahora) buckets.delete(k);
  }
}, 60_000).unref?.();

function clienteIP(req) {
  // Railway/proxies ponen la IP real en x-forwarded-for.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconocida';
}

// Factory: crea un middleware que limita a `max` requests por `ventanaMs` por
// IP (+ un sufijo opcional para separar contadores por endpoint).
function rateLimit({ max, ventanaMs, nombre = 'rl', mensaje }) {
  return (req, res, next) => {
    const key = `${nombre}:${clienteIP(req)}`;
    const ahora = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < ahora) {
      b = { count: 0, reset: ahora + ventanaMs };
      buckets.set(key, b);
    }
    b.count++;
    const restantes = Math.max(0, max - b.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', restantes);
    if (b.count > max) {
      const retrySec = Math.ceil((b.reset - ahora) / 1000);
      res.setHeader('Retry-After', retrySec);
      return res.status(429).json({
        ok: false,
        error: mensaje || `Demasiadas solicitudes. Probá de nuevo en ${retrySec} segundos.`,
        code: 429,
      });
    }
    next();
  };
}

// Limiters pre-armados para los casos del sitio.
const limiters = {
  // Login: brute force. 8 intentos / 15 min por IP.
  login: rateLimit({ nombre: 'login', max: 8, ventanaMs: 15 * 60_000,
    mensaje: 'Demasiados intentos de login. Esperá 15 minutos.' }),
  // Chequeo gratis: 40 / minuto por IP (uso legítimo intenso, pero corta scrapers).
  check: rateLimit({ nombre: 'check', max: 40, ventanaMs: 60_000 }),
  // Captura de lead / recuperación de pass: anti-spam y anti-mailbombing.
  // 6 / hora por IP.
  lead: rateLimit({ nombre: 'lead', max: 6, ventanaMs: 60 * 60_000,
    mensaje: 'Demasiadas solicitudes. Probá de nuevo más tarde.' }),
  // Registro / suscripción / pagos: 15 / hora.
  pago: rateLimit({ nombre: 'pago', max: 15, ventanaMs: 60 * 60_000 }),
};

module.exports = { securityHeaders, rateLimit, limiters };
