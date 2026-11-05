// Rutas del servicio de términos y condiciones / política de privacidad:
// página /tyc-startups, catálogo con precios, formulario post-pago con link
// único y panel de pedidos. El inicio del pago (POST /api/lp/docs/iniciar) y
// el webhook siguen en server.js, junto a los de marcas.

const path = require('path');
const express = require('express');
const { requireAuth } = require('./auth');
const { rateLimit } = require('./middleware/seguridad');
const { CATALOGO, obtenerServicio, serviciosActivos } = require('./servicios-docs');
const pedidos = require('./docs-pedidos');
const { enviarArchivoSubido } = require('./subidas');

const ROOT_DIR = path.join(__dirname, '..');
const ok = (data) => ({ ok: true, data });
const fail = (msg, code = 400, extra) => ({ ok: false, error: msg, code, ...(extra || {}) });

// Rutas con parser JSON propio (más grande que el global de 256 KB). server.js
// las saltea en el parser global; si se agrega o renombra una, va acá.
const RUTA_SUBIDA_DOCS = /^\/api\/lp\/docs\/formulario\/archivos\/?$/i;
const RUTA_FINAL_ADMIN = /^\/api\/admin\/pedidos-docs\/\d+\/version-final\/?$/i;
function usaParserPropioDocs(req) {
  return req.method === 'POST' && (RUTA_SUBIDA_DOCS.test(req.path) || RUTA_FINAL_ADMIN.test(req.path));
}

function jsonConLimite(limit, mensaje) {
  const parser = express.json({ limit });
  return (req, res, next) => parser(req, res, (err) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json(fail(mensaje, 413));
    if (err) return res.status(400).json(fail('Envío inválido.'));
    next();
  });
}

const sinCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

// El token va en la cabecera X-Pedido-Token. Mensaje genérico si no sirve:
// no se distingue "no existe" de "vencido".
function conPedido(req, res, next) {
  const pedido = pedidos.pedidoPorToken(req.get('x-pedido-token'));
  if (!pedido) return res.status(404).json(fail('No encontramos tu pedido. Revisá el link del mail o escribinos por WhatsApp.', 404));
  req.pedido = pedido;
  next();
}

function mountDocsRoutes(app) {
  const guard = requireAuth('admin', 'operador');
  const limiteFormulario = rateLimit({ nombre: 'docs_form', max: 300, ventanaMs: 15 * 60_000 });
  const limiteSubida = rateLimit({ nombre: 'docs_subida', max: 60, ventanaMs: 60 * 60_000 });

  // ===== Página pública (apagada hasta SERVICIOS_DOCS_ACTIVOS) =====
  app.get(['/tyc-startups', '/tyc-startups/'], (req, res) => {
    if (!serviciosActivos()) return res.status(404).json(fail('Not found', 404));
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(ROOT_DIR, 'public', 'tyc-startups', 'index.html'));
  });

  // Servicios que se pueden comprar ahora, con el precio de su variable.
  app.get('/api/lp/docs/catalogo', (req, res) => {
    if (!serviciosActivos()) return res.status(404).json(fail('Not found', 404));
    const servicios = Object.keys(CATALOGO).map(c => obtenerServicio(c)).filter(Boolean)
      .map(s => ({ codigo: s.codigo, nombre: s.nombre, precio: s.precio, documentos: [...s.documentos] }));
    res.json(ok({ servicios, consentimiento: require('./docs-formulario').textoConsentimiento() }));
  });

  // ===== Formulario post-pago (link único) =====
  // La página no depende de SERVICIOS_DOCS_ACTIVOS: quien ya pagó tiene que
  // poder terminarlo aunque se apague la venta. Sin un token válido no muestra nada.
  app.get('/tyc-startups/formulario', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(ROOT_DIR, 'public', 'tyc-startups', 'formulario.html'));
  });

  app.get('/api/lp/docs/formulario', limiteFormulario, sinCache, conPedido, (req, res) => {
    res.json(ok(pedidos.vistaCliente(req.pedido)));
  });

  app.put('/api/lp/docs/formulario', limiteFormulario, sinCache, conPedido, async (req, res) => {
    const r = await pedidos.guardarRespuestas(req.pedido, req.body || {});
    if (!r.ok) return res.status(r.status || 400).json(fail(r.error, r.status || 400, r.faltan ? { faltan: r.faltan } : null));
    res.json(ok({ guardado: true, enviado: r.enviado }));
  });

  // Un archivo por envío, en base64 (20 MB de archivo son unos 27 MB de JSON).
  // El token se valida antes de leer el cuerpo.
  app.post('/api/lp/docs/formulario/archivos', limiteSubida, sinCache, conPedido,
    jsonConLimite('28mb', 'El archivo pesa demasiado. El máximo es 20 MB entre todos.'), (req, res) => {
      try {
        const r = pedidos.agregarArchivo(req.pedido, req.body || {});
        if (!r.ok) return res.status(r.status || 400).json(fail(r.error, r.status || 400));
        res.json(ok({ archivo: r.archivo }));
      } catch (err) {
        console.error('[docs/archivos]', err.message);
        res.status(500).json(fail('No pudimos guardar el archivo. Probá de nuevo en unos minutos.', 500));
      }
    });

  app.delete('/api/lp/docs/formulario/archivos/:id', limiteFormulario, sinCache, conPedido, (req, res) => {
    const r = pedidos.borrarArchivo(req.pedido, req.params.id);
    if (!r.ok) return res.status(r.status || 400).json(fail(r.error, r.status || 400));
    res.json(ok({ borrado: true }));
  });

  // ===== Panel admin =====
  const idValido = (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(404).json(fail('Pedido no encontrado', 404)));
  const responder = (res, r, data) => (r.ok ? res.json(ok(data || r)) : res.status(r.status || 400).json(fail(r.error, r.status || 400)));

  app.get('/api/admin/pedidos-docs', guard, sinCache, (req, res) => {
    res.json(ok({ pedidos: pedidos.listar(), estados: pedidos.ESTADOS, reunion: pedidos.REUNION }));
  });

  app.get('/api/admin/pedidos-docs/:id', guard, sinCache, idValido, (req, res) => {
    const d = pedidos.detalle(req.params.id);
    if (!d) return res.status(404).json(fail('Pedido no encontrado', 404));
    res.json(ok(d));
  });

  app.get('/api/admin/pedidos-docs/:id/archivos/:archivoId', guard, idValido, (req, res) => {
    const a = pedidos.archivoDePedido(req.params.id, req.params.archivoId);
    if (!a) return res.status(404).json(fail('Archivo no encontrado', 404));
    enviarArchivoSubido(res, a.ruta, a.nombre.replace(/\.[^.]*$/, ''));
  });

  app.post('/api/admin/pedidos-docs/:id/estado', guard, idValido, (req, res) => {
    responder(res, pedidos.cambiarEstado(req.params.id, String(req.body?.estado || ''), req.user.id));
  });

  app.post('/api/admin/pedidos-docs/:id/reunion', guard, idValido, (req, res) => {
    const e = req.body?.estado;
    responder(res, pedidos.cambiarReunion(req.params.id, e === '' || e == null ? null : String(e), req.user.id));
  });

  app.post('/api/admin/pedidos-docs/:id/borrador', guard, idValido, async (req, res) => {
    const r = await pedidos.enviarBorrador(req.params.id, { links: req.body?.links, previsualizar: req.body?.previsualizar === true }, req.user.id);
    responder(res, r);
  });

  // Parser propio de 40 MB (Word, PDF y guías en base64). Va después del
  // guard: sin sesión de admin no se lee el cuerpo.
  app.post('/api/admin/pedidos-docs/:id/version-final', guard, idValido,
    jsonConLimite('40mb', 'Los adjuntos pesan demasiado (máximo 28 MB entre todos).'), async (req, res) => {
      const r = await pedidos.enviarVersionFinal(req.params.id, { adjuntos: req.body?.adjuntos, previsualizar: req.body?.previsualizar === true }, req.user.id);
      responder(res, r);
    });

  app.post('/api/admin/pedidos-docs/:id/reenviar-link', guard, idValido, async (req, res) => {
    responder(res, await pedidos.reenviarLink(req.params.id, req.user.id));
  });
}

module.exports = { mountDocsRoutes, usaParserPropioDocs };
