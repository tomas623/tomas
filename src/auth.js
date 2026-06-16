const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const audit = require('./audit');

const COOKIE_NAME = 'lp_sid';
const SESSION_DAYS = 30;

function getSecret() {
  return (process.env.SESSION_SECRET || 'dev-session-secret-cambiame').trim();
}

function sign(value) {
  const h = crypto.createHmac('sha256', getSecret()).update(value).digest('hex').slice(0, 24);
  return `${value}.${h}`;
}
function unsign(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx), sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(value).digest('hex').slice(0, 24);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    return i < 0 ? [s, ''] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))];
  }));
}

async function hashPassword(plain) { return bcrypt.hash(plain, 10); }
async function verifyPassword(plain, hash) { return bcrypt.compare(plain, hash); }

function crearSesion(usuarioId) {
  const sid = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  db.prepare('INSERT INTO sesiones (id, usuario_id, expires_at) VALUES (?, ?, ?)')
    .run(sid, usuarioId, expires.toISOString());
  return { sid, expires };
}

function revocarSesion(sid) {
  if (!sid) return;
  db.prepare('DELETE FROM sesiones WHERE id = ?').run(sid);
}

function buscarSesion(sid) {
  if (!sid) return null;
  const row = db.prepare(`
    SELECT s.id AS sid, s.expires_at, u.id, u.email, u.rol, u.nombre, u.pack_id, u.activo
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.id = ?
  `).get(sid);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sesiones WHERE id = ?').run(sid);
    return null;
  }
  if (!row.activo) return null;
  return row;
}

// Middleware: lee la sesión y la deja en req.user. No bloquea.
function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  const signed = cookies[COOKIE_NAME];
  const sid = signed ? unsign(signed) : null;
  if (!sid) return next();
  const sess = buscarSesion(sid);
  if (sess) req.user = { id: sess.id, email: sess.email, rol: sess.rol, nombre: sess.nombre, pack_id: sess.pack_id, sid };
  next();
}

function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (roles.length && !roles.includes(req.user.rol)) {
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    }
    next();
  };
}

function setCookie(res, sid, expires) {
  const isHttps = (process.env.BASE_URL || '').startsWith('https://');
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sign(sid))}`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Expires=${expires.toUTCString()}`,
  ];
  if (isHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// ===== Handlers Express =====
function mountAuthRoutes(app) {
  app.use(attachUser);

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, nombre, telefono, rol = 'cliente', pack_codigo = 'vigilancia_3' } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email y password son obligatorios' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'password muy corto (min 8)' });

    // Creación de admin/operador queda gated por ADMIN_TOKEN.
    if (rol === 'admin' || rol === 'operador') {
      const adminToken = (process.env.ADMIN_TOKEN || '').trim();
      const provided = req.headers['x-admin-token'] || req.body?.admin_token;
      if (!adminToken || provided !== adminToken) {
        return res.status(403).json({ ok: false, error: 'No autorizado a crear admin/operador' });
      }
    }
    if (!['admin', 'operador', 'cliente'].includes(rol)) {
      return res.status(400).json({ ok: false, error: 'rol inválido' });
    }

    const pack = db.prepare('SELECT id FROM packs WHERE codigo = ?').get(pack_codigo);
    const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ ok: false, error: 'Email ya registrado' });

    const hash = await hashPassword(password);
    const info = db.prepare(`
      INSERT INTO usuarios (email, password_hash, rol, nombre, telefono, pack_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email.toLowerCase().trim(), hash, rol, nombre || null, telefono || null, pack?.id || null);

    audit.log(info.lastInsertRowid, 'usuario.alta', { entidad: 'usuarios', entidad_id: info.lastInsertRowid, detalle: { rol } });
    res.json({ ok: true, data: { id: info.lastInsertRowid, email, rol } });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email y password son obligatorios' });
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
    if (!u || !u.activo) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    const okPass = await verifyPassword(password, u.password_hash);
    if (!okPass) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    const { sid, expires } = crearSesion(u.id);
    setCookie(res, sid, expires);
    audit.log(u.id, 'usuario.login');
    res.json({ ok: true, data: { id: u.id, email: u.email, rol: u.rol, nombre: u.nombre } });
  });

  // Promueve un usuario existente a otro rol (admin/operador/cliente) y opcionalmente
  // resetea su contraseña. Gated por ADMIN_TOKEN — útil para recuperación de
  // cuenta sin necesidad de tener admin previo logueado.
  // Body: { email, new_rol, new_password? }
  app.post('/api/auth/promote-user', async (req, res) => {
    const adminToken = (process.env.ADMIN_TOKEN || '').trim();
    if (!adminToken) return res.status(503).json({ ok: false, error: 'ADMIN_TOKEN no configurado en el server' });
    const provided = req.headers['x-admin-token'] || req.body?.admin_token;
    if (provided !== adminToken) return res.status(401).json({ ok: false, error: 'admin token inválido' });

    const { email, new_rol, new_password, new_nombre } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: 'email obligatorio' });
    if (!['admin','operador','cliente'].includes(new_rol)) {
      return res.status(400).json({ ok: false, error: 'new_rol inválido (admin/operador/cliente)' });
    }
    const u = db.prepare('SELECT id, email, rol FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
    if (!u) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const sets = ['rol = ?'];
    const vals = [new_rol];
    if (new_password) {
      if (String(new_password).length < 8) return res.status(400).json({ ok: false, error: 'password muy corto (min 8)' });
      sets.push('password_hash = ?'); vals.push(await hashPassword(String(new_password)));
    }
    if (new_nombre !== undefined) { sets.push('nombre = ?'); vals.push(new_nombre || null); }
    vals.push(u.id);
    db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(null, 'usuario.promote', { entidad: 'usuarios', entidad_id: u.id, detalle: { from: u.rol, to: new_rol, reset_password: !!new_password } });
    res.json({ ok: true, data: { id: u.id, email: u.email, rol_anterior: u.rol, rol_nuevo: new_rol, password_reseteada: !!new_password } });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.user?.sid) {
      revocarSesion(req.user.sid);
      audit.log(req.user.id, 'usuario.logout');
    }
    clearCookie(res);
    res.json({ ok: true, data: { logout: true } });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    res.json({ ok: true, data: req.user });
  });
}

module.exports = {
  mountAuthRoutes, requireAuth, attachUser,
  hashPassword, verifyPassword, crearSesion,
};
