require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./src/db');
const audit = require('./src/audit');
const { buscarEnINPI, listaCorta, buscarPalabraEmbebida, enmascararActa, enmascararDenominacion } = require('./src/inpi');
const { crearPreferencia, obtenerPago } = require('./src/pagos');
const { mountAuthRoutes } = require('./src/auth');
const { mountAdminRoutes } = require('./src/admin');
const { mountClienteRoutes } = require('./src/cliente');
const scheduler = require('./src/jobs/scheduler');
const { securityHeaders, limiters } = require('./src/middleware/seguridad');

const app = express();
// Confiar en el proxy de Railway para leer la IP real (x-forwarded-for) y
// el protocolo (x-forwarded-proto) — necesario para rate limiting y HSTS.
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000', 10);
const PRECIO_INFORME = parseInt(process.env.PRECIO_INFORME || '19900', 10);
const PRECIO_REGISTRO = parseInt(process.env.PRECIO_REGISTRO || '120000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROOT_DIR = __dirname;

app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));

// Rate limiting en endpoints sensibles (antes de montar las rutas).
// Login: anti brute force.
app.use('/api/auth/login', limiters.login);
// Recuperación de contraseña: anti-mailbombing.
app.use('/api/auth/forgot-password', limiters.lead);
// Chequeo gratis: anti-scraping.
app.use('/api/marca/check', limiters.check);
// Captura de leads: anti-spam.
app.use('/api/marca/lead-free', limiters.lead);
// Creación de pagos/suscripciones/registros: anti-abuso.
app.use('/api/marca/consulta/iniciar', limiters.pago);
app.use('/api/marca/registro/iniciar', limiters.pago);
app.use('/api/cliente/vigilancia/iniciar', limiters.pago);

mountAuthRoutes(app);
mountAdminRoutes(app);
mountClienteRoutes(app);

// Detectar clases Niza por rubro — espejo de la lógica del front (detectarClases).
// Mapeo declarativo rubro → clases del nomenclador de Niza. Cada entrada lista
// palabras clave (lowercase, sin acentos) y las clases más típicas para ese rubro.
// Cuando ningún patrón machea, devolvemos [] y dejamos que el frontend pida
// "necesita análisis" en vez de inventar una clase 35 por defecto (que era el
// bug de "gaseosa" → 35 en lugar de 32).
const RUBRO_CLASES = [
  // Bebidas
  { re: /(gaseosa|bebida|agua mineral|jugo|refresco|smoothie|isotonica)/, clases: [32] },
  { re: /(cerveza|sidra)/,                                                clases: [32] },
  { re: /(vino|champagne|espumante|licor|whisky|aguardiente|gin|vermut)/, clases: [33] },
  // Alimentación
  { re: /(restaurante|delivery|gastronom|comida|catering|food truck|bar\b)/, clases: [43] },
  { re: /(cafe|café|pasteler|panader|conf?iter|helader|chocolater)/,      clases: [30, 43] },
  { re: /(carne|fiambre|embutid|pescado|lacte|lácteo|queso|yogur)/,        clases: [29] },
  { re: /(pan |harina|fideo|pasta|arroz|cereal|galletit|snack|condiment|salsa)/, clases: [30] },
  { re: /(verdura|hortaliza|fruta|granos|semilla|forraje)/,                clases: [31] },
  // Indumentaria y accesorios
  { re: /(ropa|indumentaria|remera|jean|pantalon|moda|vestido|abrig|camis)/, clases: [25, 35] },
  { re: /(calzado|zapatilla|zapato|botin|sandalia)/,                       clases: [25] },
  { re: /(joyer|reloj|bijou|accesorio)/,                                   clases: [14] },
  { re: /(cartera|mochila|valija|marroquin|bolso)/,                        clases: [18] },
  // Cosmética y salud
  { re: /(cosmetic|cosmética|skincare|maquillaje|perfume|fragancia|jabon)/, clases: [3, 44] },
  { re: /(peluquer|barber|estetic|spa|masaje|salon de belleza)/,            clases: [44] },
  { re: /(medicamento|farmaceut|suplemento|vitamina|salud)/,                clases: [5] },
  { re: /(clinica|consultorio|odontolog|medico|kinesi|psicolog|terapia)/,   clases: [44] },
  // Tecnología
  { re: /(app|software|saas|tecnologi|tecnología|web|sistema|plataforma|aplicacion)/, clases: [9, 42] },
  { re: /(educacion|educación|curso|capacitacion|colegio|instituto|escuela|talleres)/, clases: [41] },
  // Comercio y servicios
  { re: /(tienda online|ecommerce|marketplace|reventa|venta minorista|comercio)/, clases: [35] },
  { re: /(logistic|transporte|cadeter|distribu|courier|mudanza)/,           clases: [39] },
  { re: /(inmobiliari|alquiler|hospedaje|hotel|hosteler|hostel|airbnb)/,    clases: [36, 43] },
  { re: /(financ|finanz|banco|bancari|seguro|inversi|fintech|cripto|contab|impuesto|tributar)/, clases: [36] },
  { re: /(comercio exterior|comex|aduan|import|export|despachante)/,        clases: [35] },
  { re: /(construc|albañiler|reforma|pintur)/,                              clases: [37] },
  // Industria y materiales
  { re: /(automotor|auto |moto |vehiculo|bici|repuestos)/,                  clases: [12] },
  { re: /(juguet|juego de mesa|peluche)/,                                   clases: [28] },
  { re: /(libro|editorial|revista|imprenta)/,                               clases: [16] },
  { re: /(mueble|colchon|decoracion|hogar)/,                                clases: [20] },
  { re: /(mascota|petshop|veterinari|alimento balanceado)/,                 clases: [31, 44] },
  // Genérico al final: solo cae acá si ninguna regla de rubro específico matcheó
  // (ej "consultoría en finanzas" matchea finanzas → 36 antes que esto). Clase 35
  // (gestión de negocios) es el default razonable para consultoría/asesoría a secas.
  { re: /(consultor|asesor|servicio profesional|gestor)/,                   clases: [35] },
];

function detectarClasesPorRubro(rubro) {
  const q = (rubro || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return [];
  for (const r of RUBRO_CLASES) {
    if (r.re.test(q)) return r.clases;
  }
  return [];
}

// Predicado: ¿el rubro ingresado matchea alguno de los patrones conocidos?
// Si no, el backend marca el chequeo como "necesita_analisis" para no devolver
// un falso "LIBRE" en una clase equivocada.
function rubroEsConocido(rubro) {
  return detectarClasesPorRubro(rubro).length > 0;
}

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400) { return { ok: false, error: msg, code }; }

// ===== Healthcheck =====
app.get('/api/health', (req, res) => {
  try {
    const checks = {
      db: db.prepare('SELECT 1 AS ok').get()?.ok === 1,
      marcas_inpi: db.prepare('SELECT COUNT(*) AS n FROM marcas_inpi').get().n,
      usuarios: db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n,
    };
    res.json(ok({ status: 'up', ts: Date.now(), checks }));
  } catch (err) {
    res.status(503).json({ ok: false, status: 'degraded', error: err.message });
  }
});

// ===== 2.1 Precio del informe =====
app.get('/api/marca/precio-informe', (req, res) => {
  res.json(ok({ precio: PRECIO_INFORME, moneda: 'ARS' }));
});

// ===== 2.2 Pre-check gratis =====
app.post('/api/marca/check', (req, res) => {
  const { marca, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) {
    return res.status(400).json(fail('Falta la marca a chequear'));
  }

  const clasesUsuario = Array.isArray(clases) ? clases.filter(Number.isFinite) : [];
  const clasesSugeridas = detectarClasesPorRubro(rubro);

  // Búsqueda en las clases que pidió el frontend (las "sugeridas").
  const hitsClase = buscarEnINPI(marca, clasesUsuario);
  // Búsqueda global (cualquier clase) para detectar coincidencias fuera de las clases buscadas.
  const hitsTodos = buscarEnINPI(marca, null);

  const rubroConocido = !!rubro && rubroEsConocido(rubro);
  const rubroIngresado = !!(rubro && String(rubro).trim());
  const clasesNoMatchean = rubroIngresado && !rubroConocido;

  // Búsqueda complementaria: la palabra consultada dentro de denominaciones
  // compuestas, en las clases del usuario. Atrapa los casos como "CORE" vs
  // "CORE FIT SA CORE PILATES" que el matching normal no detecta porque la
  // normalización los colapsa en un string largo.
  const hitsPalabraClase = clasesUsuario.length ? buscarPalabraEmbebida(marca, clasesUsuario) : [];

  let veredicto, mensaje, muestras = [];

  if (hitsClase.length > 0) {
    veredicto = 'no_disponible';
    const top = hitsClase[0];
    mensaje = `Encontramos <strong>${hitsClase.length} acta${hitsClase.length === 1 ? '' : 's'}</strong> que coincide${hitsClase.length === 1 ? '' : 'n'} de forma exacta en la clase ${top.clase}.`;
    muestras = hitsClase.slice(0, 5);
  } else if (hitsPalabraClase.length > 0) {
    // La palabra aparece DENTRO de denominaciones compuestas en la misma clase.
    // Es más relevante que "exact en otras clases" porque comparte mercado.
    veredicto = 'necesita_analisis';
    mensaje = `Detectamos <strong>${hitsPalabraClase.length} acta${hitsPalabraClase.length === 1 ? '' : 's'}</strong> que contiene${hitsPalabraClase.length === 1 ? '' : 'n'} la palabra "${String(marca).trim()}" en la${clasesUsuario.length === 1 ? '' : 's'} clase${clasesUsuario.length === 1 ? '' : 's'} ${clasesUsuario.join(', ')} (denominaciones compuestas). Conviene analizarlas con un profesional antes de presentar.`;
    muestras = hitsPalabraClase.slice(0, 5);
  } else if (hitsTodos.length > 0) {
    // Hay coincidencias en otras clases. Aviso de "necesita_analisis" para que el cliente
    // entienda que aunque la clase pedida está libre, el nombre existe registrado en otras.
    veredicto = 'necesita_analisis';
    mensaje = `La denominación no choca en la${clasesUsuario.length === 1 ? '' : 's'} clase${clasesUsuario.length === 1 ? '' : 's'} ${clasesUsuario.join(', ') || 'consultada'}, pero <strong>existen ${hitsTodos.length} registro${hitsTodos.length === 1 ? '' : 's'}</strong> con la misma denominación en otras clases. Necesita análisis profesional para confirmar viabilidad.`;
    muestras = hitsTodos.slice(0, 5);
  } else if (clasesNoMatchean) {
    // Regla UX del cliente: si no podemos mapear el rubro a una clase conocida,
    // no podemos dar un "LIBRE" honesto — devolvemos necesita_analisis.
    veredicto = 'necesita_analisis';
    mensaje = `No identificamos automáticamente la clase Niza correcta para "${String(rubro).slice(0, 60)}". Para evitar un falso "LIBRE" en la clase equivocada, te recomendamos auditar la viabilidad con nuestro equipo.`;
  } else {
    // Último intento: palabra embebida en CUALQUIER clase (cuando el usuario no
    // pasó clase, o ninguna de las anteriores encontró nada).
    const hitsPalabraGlobal = clasesUsuario.length ? [] : buscarPalabraEmbebida(marca, null);
    if (hitsPalabraGlobal.length > 0) {
      veredicto = 'necesita_analisis';
      mensaje = `Detectamos <strong>${hitsPalabraGlobal.length} acta${hitsPalabraGlobal.length === 1 ? '' : 's'}</strong> con la palabra "${String(marca).trim()}" en denominaciones compuestas del INPI. Conviene analizarlas con un profesional antes de presentar.`;
      muestras = hitsPalabraGlobal.slice(0, 5);
    } else {
      veredicto = 'probablemente_disponible';
      mensaje = `No encontramos coincidencias exactas en la${clasesUsuario.length === 1 ? '' : 's'} clase${clasesUsuario.length === 1 ? '' : 's'} ${clasesUsuario.join(', ') || 'consultada'} del INPI. El pre-check no analiza similitud fonética ni conceptual.`;
    }
  }

  // Tease siempre — incluso cuando el veredicto es "probablemente disponible".
  // Cuando no hay match exacto, corremos la búsqueda más amplia (fonética +
  // ortográfica + trigramas) para mostrar al usuario marcas similares que un
  // examinador del INPI podría detectar. Sirve como prueba de valor del informe pago.
  let similares = muestras;
  let riesgoEstimado = null;
  if (veredicto === 'probablemente_disponible') {
    const cercanos = listaCorta(marca, clasesUsuario.length ? clasesUsuario : null, { minScore: 55 });
    similares = cercanos.slice(0, 5);
    riesgoEstimado = similares.length ? similares[0].score : 0;
  } else if (muestras.length) {
    riesgoEstimado = Math.max(...muestras.map(m => m.score || 0));
  }

  // En el preview de "probablemente disponible" enmascaramos parcialmente la
  // denominación para que el valor del informe pago no se diluya en el chequeo gratis.
  const enmascarar = veredicto === 'probablemente_disponible';
  const tease = {
    muestras: similares.map(m => ({
      denominacion: enmascarar ? enmascararDenominacion(m.denominacion) : m.denominacion,
      clase: m.clase,
      acta: enmascararActa(m.acta),
      estado: m.estado || 'Concedida',
      titular: enmascarar ? '—' : (m.titular || '—'),
      similitud: m.score || null,
    })),
    riesgo_estimado: riesgoEstimado,
  };

  // Registramos el chequeo (incluye los anónimos) para medir demanda. No debe
  // romper la respuesta si algo falla.
  try {
    const xff = req.headers['x-forwarded-for'];
    const ip = xff ? String(xff).split(',')[0].trim() : (req.socket?.remoteAddress || null);
    const utm = extraerUtm(req.body);
    db.prepare(`
      INSERT INTO chequeos (marca, clases, rubro, veredicto, riesgo, utm_source, utm_medium, utm_campaign, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(marca).trim(),
      JSON.stringify(clasesUsuario),
      rubro ? String(rubro).slice(0, 200) : null,
      veredicto,
      Number.isFinite(Number(riesgoEstimado)) ? Math.round(Number(riesgoEstimado)) : null,
      utm.utm_source, utm.utm_medium, utm.utm_campaign,
      ip ? String(ip).slice(0, 60) : null,
    );
  } catch (err) {
    console.error('[check] no se pudo registrar el chequeo:', err.message);
  }

  res.json(ok({
    veredicto,
    mensaje,
    tease,
    meta: {
      clases_buscadas: clasesUsuario,
      clases_sugeridas: clasesSugeridas,
      coincidencias_clase: hitsClase.length,
      coincidencias_otras_clases: Math.max(0, hitsTodos.length - hitsClase.length),
    },
  }));
});

// ===== 2.5 Captación de lead free =====
// Se llama después del pre-check gratuito cuando el usuario elige "guardar este
// resultado por mail" en lugar de pagar el informe. Guarda el lead para el
// follow-up de 48h y le envía una copia del veredicto al cliente.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Extrae y sanitiza UTMs del body del request. El front los manda en `utm`
// pero también aceptamos campos sueltos por compatibilidad. Trunca a 100
// chars (suficiente para identificadores de campaña razonables).
function extraerUtm(body) {
  const u = body?.utm || {};
  const limpiar = v => {
    if (v == null) return null;
    const s = String(v).trim().slice(0, 100);
    return s || null;
  };
  return {
    utm_source:   limpiar(u.source   ?? body?.utm_source),
    utm_medium:   limpiar(u.medium   ?? body?.utm_medium),
    utm_campaign: limpiar(u.campaign ?? body?.utm_campaign),
    utm_content:  limpiar(u.content  ?? body?.utm_content),
    utm_term:     limpiar(u.term     ?? body?.utm_term),
  };
}

app.post('/api/marca/lead-free', async (req, res) => {
  const { marca, email, telefono, clases, rubro, veredicto, mensaje, riesgo } = req.body || {};
  if (!marca || !String(marca).trim()) return res.status(400).json(fail('Falta la marca'));
  if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json(fail('Email inválido'));

  const marcaLimpia = String(marca).trim();
  const emailLimpio = String(email).trim().toLowerCase();
  const clasesArr = Array.isArray(clases) ? clases.filter(Number.isFinite) : [];
  // Guardamos el resultado del chequeo para verlo en el panel (no solo la marca).
  const VEREDICTOS_OK = ['probablemente_disponible', 'necesita_analisis', 'no_disponible'];
  const veredictoFree = VEREDICTOS_OK.includes(veredicto) ? veredicto : null;
  const riesgoFree = Number.isFinite(Number(riesgo)) ? Math.round(Number(riesgo)) : null;

  // Dedupe: si la persona ya guardó esta misma marca, refrescamos created_at
  // (vuelve a entrar al tope de la cola de follow-up) en vez de duplicar el lead.
  const existente = db.prepare(`
    SELECT id FROM leads WHERE tipo = 'free' AND email = ? AND lower(marca) = lower(?) LIMIT 1
  `).get(emailLimpio, marcaLimpia);

  const utm = extraerUtm(req.body);
  let leadId;
  if (existente) {
    // Si el lead refresca y ya tenía UTMs, mantenemos los originales (primer
    // touch). Si no tenía, escribimos los actuales.
    db.prepare(`
      UPDATE leads SET
        telefono = COALESCE(?, telefono),
        clases = ?, rubro = ?, created_at = datetime('now'),
        veredicto_free = COALESCE(?, veredicto_free),
        riesgo_free = COALESCE(?, riesgo_free),
        utm_source   = COALESCE(utm_source, ?),
        utm_medium   = COALESCE(utm_medium, ?),
        utm_campaign = COALESCE(utm_campaign, ?),
        utm_content  = COALESCE(utm_content, ?),
        utm_term     = COALESCE(utm_term, ?)
      WHERE id = ?
    `).run(telefono || null, JSON.stringify(clasesArr), rubro || null,
           veredictoFree, riesgoFree,
           utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term,
           existente.id);
    leadId = existente.id;
  } else {
    const externalReference = `free-${crypto.randomBytes(8).toString('hex')}`;
    const info = db.prepare(`
      INSERT INTO leads (tipo, marca, email, telefono, clases, rubro, estado, external_reference,
                         veredicto_free, riesgo_free,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES ('free', ?, ?, ?, ?, ?, 'lead_free', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(marcaLimpia, emailLimpio, telefono || null, JSON.stringify(clasesArr), rubro || null, externalReference,
           veredictoFree, riesgoFree,
           utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term);
    leadId = info.lastInsertRowid;
  }

  // Marcamos como "convertido" el chequeo anónimo más reciente de esta marca,
  // para medir cuántos chequeos terminan dejando el mail (best-effort).
  try {
    db.prepare(`
      UPDATE chequeos SET con_email = 1
      WHERE id = (SELECT id FROM chequeos WHERE lower(marca) = lower(?) AND con_email = 0 ORDER BY id DESC LIMIT 1)
    `).run(marcaLimpia);
  } catch {}

  // Mail al usuario con el resumen + CTA al informe pago. No bloquea el response.
  const { enviarMailGenerico } = require('./src/notificaciones');
  const veredictoColor = veredicto === 'probablemente_disponible' ? '#059669'
    : veredicto === 'no_disponible' ? '#dc2626' : '#d97706';
  const veredictoTxt = veredicto === 'probablemente_disponible' ? 'Sin coincidencias exactas'
    : veredicto === 'no_disponible' ? 'Coincidencia exacta detectada'
    : 'Requiere análisis profesional';

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">Guardamos tu chequeo</h2>
      <p>Hola, te dejamos el resumen del pre-check gratuito que hiciste para
         <strong>${marcaLimpia}</strong>.</p>
      <div style="background:#f8fafc;border-left:4px solid ${veredictoColor};padding:14px 18px;border-radius:8px;margin:18px 0">
        <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Resultado preliminar</div>
        <div style="font-size:16px;font-weight:700;color:${veredictoColor};margin-top:4px">${veredictoTxt}</div>
        ${mensaje ? `<div style="margin-top:10px;font-size:13px">${String(mensaje).slice(0, 600)}</div>` : ''}
      </div>
      <p><strong>Importante:</strong> el pre-check gratuito solo busca coincidencias
         <em>exactas</em> en la base del INPI. No analiza similitud fonética, conceptual,
         marcas notorias ni leyes especiales — y son justamente esas verificaciones las
         que en la práctica determinan si una marca llega a registrarse o se rechaza.</p>
      <p style="margin-top:24px">
        <a href="https://legalpacers.com#informe"
           style="background:#1B6EF3;color:#fff;padding:11px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Quiero el informe completo de viabilidad
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;margin-top:16px">
        Incluye análisis fonético, ideológico, choque con marcas notorias, chequeo de
        leyes especiales, disponibilidad de dominios y redes. Lo firma un Agente de la
        Propiedad Industrial matriculado y queda en tu poder en 24 horas hábiles.
      </p>
      <p style="margin-top:24px">¿Preferís contarnos tu caso primero?
         <a href="https://calendar.app.google/rx6vHWyyjFoEr7Vx9">Agendá una llamada</a>
         o respondé este mail.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial<br>
        contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
      </p>
    </div>`;

  enviarMailGenerico({
    to: emailLimpio,
    subject: `Tu chequeo de "${marcaLimpia}" — guardado`,
    html,
    tag: 'lead_free_acuse',
  }).catch(err => console.error('[lead-free] mail:', err.message));

  res.json(ok({ id: leadId, dedup: !!existente }));
});

// ===== 2.6 Captación de lead de suscripción (vigilancia) =====
// El visitante de la landing elige un pack (3/10/20 marcas) y nos deja sus
// datos. Lo encolamos como lead 'suscripcion' para que el equipo legal lo
// contacte en 24h con el link de pago de MP. Sin self-signup todavía.
const PACKS_VALIDOS = new Set(['vigilancia_3', 'vigilancia_10', 'vigilancia_20']);

const CICLOS_VALIDOS = new Set(['mensual', 'anual']);

app.post('/api/cliente/vigilancia/iniciar', async (req, res) => {
  const { pack_codigo, email, nombre, telefono, marcas_a_vigilar, ciclo: cicloRaw } = req.body || {};
  if (!PACKS_VALIDOS.has(String(pack_codigo))) return res.status(400).json(fail('Pack inválido'));
  if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json(fail('Email inválido'));
  if (!nombre || !String(nombre).trim()) return res.status(400).json(fail('Falta tu nombre'));

  const ciclo = CICLOS_VALIDOS.has(String(cicloRaw)) ? String(cicloRaw) : 'mensual';
  const pack = db.prepare('SELECT * FROM packs WHERE codigo = ?').get(pack_codigo);
  if (!pack) return res.status(404).json(fail('Pack no encontrado'));

  // Política anual: 10× el mensual (2 meses bonificados).
  const precioMensual = pack.precio_mensual;
  const precioAnual = precioMensual * 10;
  const precioCobrado = ciclo === 'anual' ? precioAnual : precioMensual;
  const periodoTxt = ciclo === 'anual'
    ? `$${precioAnual.toLocaleString('es-AR')}/año (10 meses, 2 bonificados)`
    : `$${precioMensual.toLocaleString('es-AR')}/mes`;

  const emailLimpio = String(email).trim().toLowerCase();
  const nombreLimpio = String(nombre).trim();
  const telefonoLimpio = telefono ? String(telefono).trim() : null;
  const marcasTxt = marcas_a_vigilar ? String(marcas_a_vigilar).trim().slice(0, 1000) : null;
  const externalReference = `vig-${crypto.randomBytes(8).toString('hex')}`;

  // Si hay link de MP para el pack + ciclo, lo redirigimos directo al
  // checkout (flujo más limpio). Si no, queda como lead manual y el equipo
  // legal arma la cuenta a mano.
  const { linkPackSuscripcion } = require('./src/pagos');
  const initPoint = linkPackSuscripcion(pack.codigo, externalReference, ciclo);

  const utm = extraerUtm(req.body);
  const info = db.prepare(`
    INSERT INTO leads (tipo, marca, email, telefono, clases, rubro, monto, estado, external_reference, notas, init_point,
                       utm_source, utm_medium, utm_campaign, utm_content, utm_term)
    VALUES ('suscripcion', ?, ?, ?, '[]', NULL, ?, 'lead_suscripcion', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pack.codigo,
    emailLimpio,
    telefonoLimpio,
    precioCobrado,
    externalReference,
    [
      `Solicitante: ${nombreLimpio}`,
      `Pack solicitado: ${pack.nombre} — ciclo ${ciclo.toUpperCase()} (${periodoTxt})`,
      marcasTxt ? `Marcas a vigilar:\n${marcasTxt}` : null,
      initPoint ? `Init point MP: ${initPoint}` : 'Sin link MP configurado — coordinar manualmente.',
    ].filter(Boolean).join('\n\n'),
    initPoint,
    utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term,
  );
  const leadId = info.lastInsertRowid;

  const { enviarMailGenerico } = require('./src/notificaciones');
  const mailEquipo = (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim();
  const calendly = 'https://calendar.app.google/rx6vHWyyjFoEr7Vx9';

  // Mail al usuario. Si tenemos el init_point del plan, le mandamos el link
  // de pago directo para que pueda activarlo solo, sin esperar 24h.
  const ctaPago = initPoint
    ? `<p style="margin-top:24px">
         <a href="${initPoint}"
            style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                   text-decoration:none;display:inline-block;font-weight:600">
           Activar mi suscripción ahora
         </a>
       </p>
       <p style="font-size:13px;color:#64748b">El cobro se hace por Mercado Pago.
       Cancelás cuando quieras desde tu cuenta de MP.</p>`
    : `<p>Un Agente de la Propiedad Industrial te contacta dentro de las próximas
          24 horas hábiles para confirmar las marcas a vigilar y enviarte el link
          de pago de Mercado Pago.</p>`;

  enviarMailGenerico({
    to: emailLimpio,
    subject: `Tu solicitud de monitoreo — ${pack.nombre} (${ciclo})`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
        <h2 style="color:#1B6EF3">${initPoint ? '¡Estás a un paso!' : 'Recibimos tu solicitud'}</h2>
        <p>Hola ${nombreLimpio}, gracias por confiar en LegalPacers.</p>
        <p><strong>Pack:</strong> ${pack.nombre} — ${periodoTxt}.</p>
        ${ctaPago}
        ${marcasTxt ? `<p style="background:#f8fafc;border-left:3px solid #1B6EF3;padding:10px 14px;border-radius:6px;font-size:13px"><strong>Marcas que nos pasaste:</strong><br>${esc(marcasTxt).replace(/\n/g, '<br>')}</p>` : ''}
        <p>Si querés adelantar la conversación,
           <a href="${calendly}">agendá una llamada</a>
           o respondé este mail.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="font-size:12px;color:#64748b">
          LegalPacers · Consultora de Propiedad Industrial<br>
          contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
        </p>
      </div>`,
    tag: 'lead_suscripcion_acuse',
  }).catch(err => console.error('[vigilancia/iniciar] mail cliente:', err.message));

  // Mail al equipo.
  enviarMailGenerico({
    to: mailEquipo,
    subject: `[Lead vigilancia ${ciclo.toUpperCase()}] ${pack.nombre} · ${nombreLimpio}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
        <h2>Nuevo lead de suscripción</h2>
        <p><strong>Solicitante:</strong> ${nombreLimpio} &lt;${emailLimpio}&gt;
           ${telefonoLimpio ? '· tel. ' + esc(telefonoLimpio) : ''}</p>
        <p><strong>Pack:</strong> ${pack.nombre} — ciclo ${ciclo.toUpperCase()} (${periodoTxt})</p>
        ${marcasTxt ? `<p><strong>Marcas a vigilar:</strong><br>${esc(marcasTxt).replace(/\n/g, '<br>')}</p>` : ''}
        <p style="margin-top:18px">
          ${initPoint
            ? 'El cliente recibió el link de pago directo. Esperar webhook MP para crear cuenta y asignar pack.'
            : 'Crear el usuario en el panel y enviar link de pago de MP manualmente.'}
        </p>
        <p style="font-size:12px;color:#64748b">Lead #${leadId} · external_ref ${externalReference}</p>
      </div>`,
    tag: 'lead_suscripcion_equipo',
  }).catch(err => console.error('[vigilancia/iniciar] mail equipo:', err.message));

  res.json(ok({ id: leadId, pack: pack.codigo, ciclo, init_point: initPoint }));
});

// helper de escape para HTML inline (usado solo en plantillas de mail server-side).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 2.3 / 2.4 helpers =====
function crearLead({ tipo, marca, email, telefono, clases, rubro, monto, utm }) {
  const externalReference = `${tipo}-${crypto.randomBytes(8).toString('hex')}`;
  const u = utm || {};
  const stmt = db.prepare(`
    INSERT INTO leads (tipo, marca, email, telefono, clases, rubro, monto, external_reference,
                       utm_source, utm_medium, utm_campaign, utm_content, utm_term)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    tipo, marca, email || null, telefono || null,
    JSON.stringify(clases || []), rubro || null, monto, externalReference,
    u.utm_source || null, u.utm_medium || null, u.utm_campaign || null,
    u.utm_content || null, u.utm_term || null,
  );
  return { id: info.lastInsertRowid, externalReference };
}

function actualizarInitPoint(id, initPoint, preferenceId) {
  db.prepare('UPDATE leads SET init_point = ?, payment_ref = COALESCE(payment_ref, ?) WHERE id = ?')
    .run(initPoint, preferenceId || null, id);
}

// ===== 2.3 Checkout informe $19.900 =====
app.post('/api/marca/consulta/iniciar', async (req, res) => {
  const { marca, email, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) return res.status(400).json(fail('Falta la marca'));
  if (!email || !String(email).includes('@')) return res.status(400).json(fail('Email inválido'));

  const lead = crearLead({
    tipo: 'informe', marca: String(marca).trim(), email: String(email).trim(),
    telefono: null, clases: clases || [], rubro: rubro || null, monto: PRECIO_INFORME,
    utm: extraerUtm(req.body),
  });

  try {
    const pref = await crearPreferencia({
      tipo: 'informe',
      titulo: `LegalPacers · Informe de viabilidad de marca "${String(marca).slice(0, 60)}"`,
      precio: PRECIO_INFORME,
      externalReference: lead.externalReference,
      email,
      baseUrl: BASE_URL,
    });
    actualizarInitPoint(lead.id, pref.init_point, pref.preference_id);
    return res.json(ok({ init_point: pref.init_point, lead_id: lead.id, stub: !!pref.stub }));
  } catch (err) {
    console.error('[consulta/iniciar] error MP:', err.message);
    return res.status(502).json(fail('No pudimos crear la preferencia de pago.'));
  }
});

// ===== 2.4 Checkout registro $120.000 =====
app.post('/api/marca/registro/iniciar', async (req, res) => {
  const { marca, email, telefono, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) return res.status(400).json(fail('Falta la marca'));
  if (!email || !String(email).includes('@')) return res.status(400).json(fail('Email inválido'));
  if (!telefono || !String(telefono).trim()) return res.status(400).json(fail('Falta el teléfono'));

  const lead = crearLead({
    tipo: 'registro', marca: String(marca).trim(), email: String(email).trim(),
    telefono: String(telefono).trim(), clases: clases || [], rubro: rubro || null,
    monto: PRECIO_REGISTRO,
    utm: extraerUtm(req.body),
  });

  // Notificación interna (WhatsApp / log) para acelerar el flujo humano del cliente.
  if (process.env.WHATSAPP_NOTIFY) {
    console.log(`[lead:registro] Nuevo lead id=${lead.id} marca="${marca}" tel=${telefono} → notificar ${process.env.WHATSAPP_NOTIFY}`);
  }

  try {
    const pref = await crearPreferencia({
      tipo: 'registro',
      titulo: `LegalPacers · Honorarios registro de marca "${String(marca).slice(0, 60)}"`,
      precio: PRECIO_REGISTRO,
      externalReference: lead.externalReference,
      email,
      baseUrl: BASE_URL,
    });
    actualizarInitPoint(lead.id, pref.init_point, pref.preference_id);
    return res.json(ok({ init_point: pref.init_point, lead_id: lead.id, stub: !!pref.stub }));
  } catch (err) {
    console.error('[registro/iniciar] error MP:', err.message);
    return res.status(502).json(fail('No pudimos crear la preferencia de pago.'));
  }
});

// ===== Webhook de Mercado Pago =====
// Soporta dos tipos de eventos:
//   - { type: "payment", data: { id } }         → pagos únicos (informe, registro)
//   - { type: "subscription_preapproval", ... } → activación de plan de suscripción (packs)
async function manejarWebhookMP(req, res) {
  // MP notifica de dos formas: Webhooks (POST body {type, data:{id}}) e IPN de la
  // notification_url de la preferencia (GET/POST con ?topic=payment&id=). Leemos
  // el tipo y el id de TODAS las variantes (body y query).
  const type = req.body?.type || req.query?.type || req.body?.topic || req.query?.topic;
  const externalId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

  res.status(200).json({ ok: true }); // ACK rápido a MP

  const esRelevante = ['payment', 'subscription_preapproval', 'preapproval', 'subscription_authorized_payment'].includes(type);
  if (esRelevante) {
    try { audit.log(null, 'webhook.recibido', { detalle: { type, externalId, metodo: req.method } }); } catch {}
  }

  try {
    if (type === 'payment' && externalId) {
      await procesarPago(externalId);
    } else if ((type === 'subscription_preapproval' || type === 'preapproval') && externalId) {
      await procesarSuscripcion(externalId);
    } else if (type === 'subscription_authorized_payment' && externalId) {
      console.log(`[webhook] cobro recurrente de suscripción ${externalId}`);
    }
  } catch (err) {
    console.error('[webhook] error:', err.message);
    try { audit.log(null, 'webhook.error', { detalle: { type, externalId, error: err.message } }); } catch {}
  }
}
// Aceptamos POST (Webhooks) y GET (IPN de la notification_url de la preferencia).
app.post('/api/pagos/webhook', express.json(), manejarWebhookMP);
app.get('/api/pagos/webhook', manejarWebhookMP);

async function procesarPago(paymentId) {
  const { obtenerPago } = require('./src/pagos');
  const pago = await obtenerPago(paymentId);
  if (!pago) return;
  const ref = pago.external_reference;
  const estado = pago.status;
  if (!ref) return;

  const lead = db.prepare('SELECT * FROM leads WHERE external_reference = ?').get(ref);
  if (!lead) return;

  if (estado === 'approved' && lead.estado !== 'pagado') {
    db.prepare(`UPDATE leads SET estado = 'pagado', payment_ref = ?, pagado_at = datetime('now') WHERE id = ?`)
      .run(String(paymentId), lead.id);
    console.log(`[webhook] lead ${lead.id} (${lead.tipo}, ${lead.marca}) marcado pagado.`);
    try {
      audit.log(null, 'webhook.pago_aprobado', {
        entidad: 'leads', entidad_id: lead.id,
        detalle: { marca: lead.marca, tipo: lead.tipo, payment_ref: String(paymentId), dispara_informe: lead.tipo === 'informe' },
      });
    } catch {}

    // Aviso al ADMIN (a vos) por CUALQUIER pago — informe, registro o lo que sea.
    // Va aparte del mail de equipo (contacto@) para que no dependa de que revises
    // esa casilla. Configurable con MAIL_ADMIN.
    try {
      const MAIL_ADMIN = (process.env.MAIL_ADMIN || 'tomas@legalpacers.com').trim();
      const { enviarMailGenerico } = require('./src/notificaciones');
      const tipoTxt = lead.tipo === 'informe' ? 'Informe de viabilidad'
        : lead.tipo === 'registro' ? 'Registro de marca' : (lead.tipo || 'Pago');
      const montoTxt = lead.monto ? ` · $${Number(lead.monto).toLocaleString('es-AR')}` : '';
      // Botón "Escribile por WhatsApp" con el teléfono del cliente + mensaje.
      let waBtn = '';
      if (lead.telefono) {
        let d = String(lead.telefono).replace(/\D/g, '');
        if (d && !d.startsWith('54')) { d = d.replace(/^0/, ''); if (!d.startsWith('9')) d = '9' + d; d = '54' + d; }
        const msg = lead.tipo === 'registro'
          ? `Hola, te escribo de LegalPacers por el registro de tu marca "${lead.marca}". Recibimos tu pago. Para arrancar el trámite necesito confirmarte algunos datos.`
          : `Hola, te escribo de LegalPacers por tu marca "${lead.marca}".`;
        if (d) waBtn = `<p style="margin-top:16px"><a href="https://wa.me/${d}?text=${encodeURIComponent(msg)}" style="background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">💬 Escribile por WhatsApp</a></p>`;
      }
      enviarMailGenerico({
        to: MAIL_ADMIN,
        subject: `💰 Pago acreditado: ${tipoTxt} — "${lead.marca}"`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#0f1f3d">
          <h2 style="color:#1B6EF3">Se acreditó un pago</h2>
          <p><strong>Tipo:</strong> ${tipoTxt}${montoTxt}</p>
          <p><strong>Marca:</strong> ${lead.marca}</p>
          <p><strong>Cliente:</strong> ${lead.email || '—'}${lead.telefono ? ' · ' + lead.telefono : ''}</p>
          <p><strong>Pago MP:</strong> ${paymentId}</p>
          <p style="margin-top:14px">${lead.tipo === 'informe'
            ? 'El informe se está generando — revisalo y aprobalo en el panel.'
            : 'Contactá al cliente para arrancar el trámite.'}</p>
          ${waBtn}
        </div>`,
        replyTo: lead.email || undefined,
        tag: 'admin_pago',
      }).catch(err => console.error('[webhook] mail admin pago:', err.message));
    } catch (err) {
      console.error('[webhook] no se pudo avisar al admin del pago:', err.message);
    }

    // Dispara el orquestador del informe pago en background — sin await,
    // para no demorar el ACK al webhook de MP (que tiene timeout corto).
    if (lead.tipo === 'informe') {
      const { procesarInformePago } = require('./src/jobs/informe-pago');
      setImmediate(() => {
        procesarInformePago(lead.id).catch(err =>
          console.error(`[webhook] orquestador informe lead ${lead.id} falló:`, err),
        );
      });
    } else if (lead.tipo === 'registro' && lead.email) {
      // Registro: no genera PDF, pero le avisamos al cliente que recibimos el pago.
      const { enviarConfirmacionRegistro } = require('./src/notificaciones');
      enviarConfirmacionRegistro({ email: lead.email, marca: lead.marca })
        .catch(err => console.error(`[webhook] acuse registro lead ${lead.id}:`, err.message));
    }
  } else {
    db.prepare(`UPDATE leads SET estado = ?, payment_ref = ? WHERE id = ?`)
      .run(estado || lead.estado, String(paymentId), lead.id);
  }
}

async function procesarSuscripcion(preapprovalId) {
  const { obtenerPreapproval } = require('./src/pagos');
  const sub = await obtenerPreapproval(preapprovalId);
  if (!sub) return;
  const ref = sub.external_reference;
  const estado = sub.status; // authorized | paused | cancelled | pending
  if (!ref) return;

  const lead = db.prepare("SELECT * FROM leads WHERE external_reference = ? AND tipo = 'suscripcion'")
    .get(ref);
  if (!lead) {
    console.log(`[webhook] suscripción ${preapprovalId} ref=${ref}: lead no encontrado.`);
    return;
  }

  // Dos formatos de external_reference posibles:
  //   - "pack-<userId>-<vigilancia>-<3|10|20>-<rand>" → cliente ya existente (legacy).
  //   - "vig-<rand>" → lead público del nuevo flow. Hay que self-signup.
  let usuarioId = null;
  let codigoPack = lead.marca; // en este tipo de lead guardamos el pack en lead.marca

  if (ref.startsWith('pack-')) {
    const partes = ref.split('-');
    usuarioId = parseInt(partes[1], 10);
    codigoPack = partes[2] + '_' + partes[3];
  }

  const pack = db.prepare('SELECT id FROM packs WHERE codigo = ?').get(codigoPack);
  if (!pack) {
    console.warn(`[webhook] pack ${codigoPack} no encontrado para lead ${lead.id}.`);
    return;
  }

  if (estado === 'authorized') {
    // Self-signup: si todavía no hay usuario asociado, lo creamos con el email
    // del lead y le mandamos las credenciales por mail. Si ya existía
    // (re-suscripción o reactivación), solo asignamos el pack.
    if (!usuarioId) {
      usuarioId = await activarCuentaSuscriptor(lead, pack);
      if (!usuarioId) return; // Hubo error: el helper ya logueó.
    } else {
      db.prepare('UPDATE usuarios SET pack_id = ? WHERE id = ?').run(pack.id, usuarioId);
    }

    db.prepare(`UPDATE leads SET estado = 'pagado', payment_ref = ?, pagado_at = datetime('now') WHERE id = ?`)
      .run(String(preapprovalId), lead.id);
    console.log(`[webhook] suscripción autorizada · user ${usuarioId} → pack ${codigoPack} (lead ${lead.id})`);
  } else {
    db.prepare(`UPDATE leads SET estado = ?, payment_ref = ? WHERE id = ?`)
      .run(estado || lead.estado, String(preapprovalId), lead.id);
    console.log(`[webhook] suscripción ${preapprovalId} estado: ${estado}`);
  }
}

// Crea (o reutiliza) la cuenta del cliente cuando MP confirma la suscripción.
// Si el email ya existe como cliente, solo le asigna el pack. Si es nuevo,
// genera una contraseña aleatoria y le manda mail con las credenciales.
async function activarCuentaSuscriptor(lead, pack) {
  const email = lead.email;
  if (!email) {
    console.warn(`[webhook] lead ${lead.id} sin email — no puedo crear cuenta.`);
    return null;
  }

  // ¿Ya existe el usuario? Si ya es cliente, asignamos el pack y listo.
  const existente = db.prepare('SELECT id, rol FROM usuarios WHERE email = ?').get(email);
  if (existente) {
    if (existente.rol !== 'cliente') {
      console.warn(`[webhook] lead ${lead.id} email=${email} ya existe como ${existente.rol}, no se toca.`);
      return existente.id;
    }
    db.prepare('UPDATE usuarios SET pack_id = ? WHERE id = ?').run(pack.id, existente.id);
    avisarSuscripcionActiva({ email, leadId: lead.id, pack, esNuevo: false }).catch(err =>
      console.error('[webhook] aviso reactivación:', err.message),
    );
    return existente.id;
  }

  // Self-signup: nombre/teléfono del lead (los pedimos en el modal).
  const { hashPassword } = require('./src/auth');
  const nombreLead = (lead.notas || '').match(/Solicitante:\s*([^\n]+)/)?.[1]?.trim() || null;
  const tempPass = crypto.randomBytes(9).toString('base64url'); // 12 chars, urlsafe
  const hash = await hashPassword(tempPass);
  const info = db.prepare(`
    INSERT INTO usuarios (email, password_hash, rol, nombre, telefono, pack_id, activo)
    VALUES (?, ?, 'cliente', ?, ?, ?, 1)
  `).run(email, hash, nombreLead, lead.telefono, pack.id);
  const usuarioId = info.lastInsertRowid;

  audit.log(null, 'usuario.self_signup', {
    entidad: 'usuarios', entidad_id: usuarioId,
    detalle: { lead_id: lead.id, pack_codigo: pack.codigo, source: 'webhook_mp' },
  });

  avisarSuscripcionActiva({ email, leadId: lead.id, pack, esNuevo: true, tempPass, nombre: nombreLead })
    .catch(err => console.error('[webhook] aviso bienvenida:', err.message));
  return usuarioId;
}

// Mail post-pago. Si es nuevo cliente, manda credenciales temporales y le
// pide cambiar la contraseña al primer login. Si es reactivación, solo confirma.
async function avisarSuscripcionActiva({ email, leadId, pack, esNuevo, tempPass, nombre }) {
  const { enviarMailGenerico } = require('./src/notificaciones');
  const baseUrl = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');
  const saludo = nombre ? `Hola ${esc(nombre)},` : 'Hola,';

  const html = esNuevo ? `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">¡Listo! Tu suscripción está activa.</h2>
      <p>${saludo} gracias por confiar en LegalPacers para el monitoreo de tus marcas.</p>
      <p><strong>Pack activado:</strong> ${esc(pack.nombre)}.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:18px 0">
        <div style="font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Acceso al portal cliente</div>
        <div style="font-size:14px;line-height:1.7">
          <strong>URL:</strong> <a href="${baseUrl}/cliente/">${baseUrl}/cliente/</a><br>
          <strong>Email:</strong> ${esc(email)}<br>
          <strong>Contraseña temporal:</strong> <code style="background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #e2e8f0;font-family:ui-monospace,monospace">${esc(tempPass)}</code>
        </div>
        <p style="font-size:12.5px;color:#64748b;margin-top:10px;margin-bottom:0">
          Por seguridad, cambiala la primera vez que entres.
        </p>
      </div>

      <p>Desde el portal podés cargar las marcas a vigilar, ver las alertas que
         generamos en cada boletín y descargar tus reportes.</p>

      <p style="margin-top:24px">
        <a href="${baseUrl}/cliente/"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Entrar a mi portal
        </a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial<br>
        contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
      </p>
    </div>` : `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">Tu suscripción está activa otra vez</h2>
      <p>${saludo} confirmamos que tu plan <strong>${esc(pack.nombre)}</strong> quedó activo.</p>
      <p>Entrá al portal cuando quieras para ver el estado de tu cartera:</p>
      <p style="margin-top:18px">
        <a href="${baseUrl}/cliente/"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Ir al portal
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial
      </p>
    </div>`;

  await enviarMailGenerico({
    to: email,
    subject: esNuevo ? '¡Bienvenido! Tu cuenta y tu suscripción están listas' : 'Suscripción reactivada — LegalPacers',
    html,
    tag: esNuevo ? 'suscripcion_bienvenida' : 'suscripcion_reactivacion',
  });
}

// ===== Endpoints stub para Mercado Pago en modo sin credenciales =====
app.get('/pagos/stub', (req, res) => {
  const { ref, monto, titulo } = req.query;
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Stub MP</title>
<style>body{font-family:system-ui;background:#030712;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{background:#0f172a;border:1px solid #334155;border-radius:14px;padding:32px;max-width:480px;text-align:center}
button{background:#1b6ef3;color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin:4px}
button.bad{background:#334155}</style>
<div class="box">
<h2>Stub Mercado Pago</h2>
<p style="opacity:.75">No hay <code>MP_ACCESS_TOKEN</code> configurado. Esta pantalla simula Checkout Pro.</p>
<p><strong>${(titulo || '').toString().replace(/[<>]/g, '')}</strong></p>
<p style="font-size:28px;font-weight:800">$ ${Number(monto || 0).toLocaleString('es-AR')}</p>
<p style="font-size:12px;opacity:.7">ref: ${(ref || '').toString().replace(/[<>]/g, '')}</p>
<form method="POST" action="/pagos/stub/confirmar" style="display:inline">
  <input type="hidden" name="ref" value="${(ref || '').toString().replace(/"/g, '')}">
  <input type="hidden" name="estado" value="approved">
  <button>Aprobar pago (stub)</button>
</form>
<form method="POST" action="/pagos/stub/confirmar" style="display:inline">
  <input type="hidden" name="ref" value="${(ref || '').toString().replace(/"/g, '')}">
  <input type="hidden" name="estado" value="rejected">
  <button class="bad">Rechazar pago</button>
</form>
</div>`);
});

app.post('/pagos/stub/confirmar', express.urlencoded({ extended: false }), (req, res) => {
  const { ref, estado } = req.body || {};
  if (!ref) return res.status(400).send('ref requerido');
  const lead = db.prepare('SELECT * FROM leads WHERE external_reference = ?').get(ref);
  if (!lead) return res.status(404).send('lead no encontrado');
  if (estado === 'approved') {
    db.prepare(`UPDATE leads SET estado = 'pagado', payment_ref = ?, pagado_at = datetime('now') WHERE id = ?`)
      .run(`STUB-PAY-${Date.now()}`, lead.id);
    console.log(`[stub-pago] lead ${lead.id} (${lead.tipo}, ${lead.marca}) marcado pagado vía stub.`);
    return res.redirect(`/pagos/exito?ref=${encodeURIComponent(ref)}`);
  }
  db.prepare(`UPDATE leads SET estado = 'rechazado' WHERE id = ?`).run(lead.id);
  return res.redirect(`/pagos/error?ref=${encodeURIComponent(ref)}`);
});

function paginaResultado(titulo, mensaje, color) {
  return `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<style>body{font-family:system-ui;background:#030712;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{background:#0f172a;border:1px solid ${color};border-radius:14px;padding:32px;max-width:480px;text-align:center}
a{color:#60a5fa}</style>
<div class="box"><h2>${titulo}</h2><p>${mensaje}</p><p><a href="/">Volver al inicio</a></p></div>`;
}

app.get('/pagos/exito', (req, res) =>
  res.type('html').send(paginaResultado('Pago aprobado', 'En breve nos contactamos por WhatsApp / email.', '#10b981')));
app.get('/pagos/error', (req, res) =>
  res.type('html').send(paginaResultado('Pago rechazado', 'No se pudo procesar el pago.', '#ef4444')));
app.get('/pagos/pendiente', (req, res) =>
  res.type('html').send(paginaResultado('Pago pendiente', 'Te avisamos cuando se acredite.', '#f59e0b')));

// ===== Landing estática =====
// no-cache: el navegador puede guardar la copia pero DEBE revalidar con el
// server (via ETag) antes de usarla. Así, apenas redeployamos, los usuarios
// toman el HTML/CSS nuevo sin quedarse con una versión vieja cacheada.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'landing-legalpacers.html'));
});

// ===== SEO: robots.txt + sitemap.xml =====
// robots.txt: permite indexar el sitio público, bloquea el crawl del panel
// admin, el portal cliente y la API, y apunta al sitemap.
app.get('/robots.txt', (req, res) => {
  const base = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cliente\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

// sitemap.xml: las URLs públicas indexables (landing + páginas legales).
app.get('/sitemap.xml', (req, res) => {
  const base = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');
  const urls = [
    { loc: '/',           prio: '1.0', freq: 'weekly' },
    { loc: '/terminos',   prio: '0.4', freq: 'yearly' },
    { loc: '/privacidad', prio: '0.4', freq: 'yearly' },
    { loc: '/cookies',    prio: '0.4', freq: 'yearly' },
  ];
  const body = urls.map(u =>
    `  <url><loc>${base}${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`
  ).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
});
// Algunos browsers piden /favicon.ico de forma incondicional (sin importar
// el <link rel="icon"> del HTML). Lo aliaseamos al PNG del logo.
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'static', 'logo-icon.png'));
});
app.use('/static', express.static(path.join(ROOT_DIR, 'static')));

// Páginas legales. /terminos, /privacidad y /cookies aliasean a los HTML
// estáticos de public/legal — más amigable que la URL .html.
app.get('/reset-password', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'auth', 'reset-password.html')));
app.get('/terminos',   (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'legal', 'terminos.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'legal', 'privacidad.html')));
app.get('/cookies',    (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'legal', 'cookies.html')));
app.use('/legal', express.static(path.join(ROOT_DIR, 'public', 'legal')));

// Panel admin (HTML estático). Las rutas /api/admin/* viven en src/admin.js.
app.use('/admin', express.static(path.join(ROOT_DIR, 'public', 'admin')));
// Portal cliente (HTML estático). Las rutas /api/cliente/* viven en src/cliente.js.
app.use('/cliente', express.static(path.join(ROOT_DIR, 'public', 'cliente')));

app.use((req, res) => res.status(404).json(fail('Not found', 404)));

app.listen(PORT, () => {
  const mpMode = (process.env.MP_ACCESS_TOKEN || '').trim() ? 'real' : 'STUB';
  console.log(`[legalpacers] escuchando en ${BASE_URL} (PORT=${PORT}, MP=${mpMode})`);
  scheduler.iniciar();
});
