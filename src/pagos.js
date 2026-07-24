const crypto = require('crypto');

const MP_API = 'https://api.mercadopago.com';

// Si está seteado, el endpoint correspondiente devuelve este link fijo (Link de pago
// hosted por MP) en vez de generar una preferencia con Checkout Pro. Más simple:
// vos manejás el link desde el dashboard de MP, el backend solo redirige y procesa
// el webhook.
function linkConRef(baseUrl, externalReference) {
  if (!baseUrl) return null;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}external_reference=${encodeURIComponent(externalReference)}`;
}

function linkInformeUnico(externalReference) {
  return linkConRef((process.env.MP_LINK_INFORME || '').trim(), externalReference);
}
function linkRegistroUnico(externalReference) {
  return linkConRef((process.env.MP_LINK_REGISTRO || '').trim(), externalReference);
}

// Planes de suscripción (preapproval): un link fijo por pack + ciclo
// (mensual o anual). La activación del pack del cliente la hace el webhook
// al recibir un preapproval_authorized.
function linkPackSuscripcion(codigoPack, externalReference, ciclo = 'mensual') {
  const mapMensual = {
    vigilancia_3:  (process.env.MP_PLAN_VIG_3 || '').trim(),
    vigilancia_10: (process.env.MP_PLAN_VIG_10 || '').trim(),
    vigilancia_20: (process.env.MP_PLAN_VIG_20 || '').trim(),
  };
  const mapAnual = {
    vigilancia_3:  (process.env.MP_PLAN_VIG_3_ANUAL  || '').trim(),
    vigilancia_10: (process.env.MP_PLAN_VIG_10_ANUAL || '').trim(),
    vigilancia_20: (process.env.MP_PLAN_VIG_20_ANUAL || '').trim(),
  };
  const map = ciclo === 'anual' ? mapAnual : mapMensual;
  return linkConRef(map[codigoPack], externalReference);
}

async function crearPreferencia({ titulo, precio, externalReference, email, baseUrl, tipo }) {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();

  // Links de pago FIJOS: solo si se piden explícitamente (MP_USE_FIXED_LINKS=true).
  // Están DESACTIVADOS por defecto porque no atan el pago al lead: no llevan
  // external_reference ni notification_url, así que el webhook nunca matchea el
  // pago (el cliente paga y no se genera nada). Las preferencias dinámicas de
  // abajo sí lo resuelven.
  const usarLinksFijos = (process.env.MP_USE_FIXED_LINKS || '').toLowerCase() === 'true';
  if (usarLinksFijos) {
    if (tipo === 'informe') {
      const link = linkInformeUnico(externalReference);
      if (link) return { stub: false, preference_id: null, init_point: link, source: 'link_fijo' };
    }
    if (tipo === 'registro') {
      const link = linkRegistroUnico(externalReference);
      if (link) return { stub: false, preference_id: null, init_point: link, source: 'link_fijo' };
    }
  }

  if (!token) {
    const stubId = `STUB-${crypto.randomBytes(6).toString('hex')}`;
    return {
      stub: true,
      preference_id: stubId,
      init_point: `${baseUrl}/pagos/stub?ref=${encodeURIComponent(externalReference)}&monto=${precio}&titulo=${encodeURIComponent(titulo)}`,
    };
  }

  // Base pública para el aviso a MP: nunca localhost.
  const publica = (process.env.PUBLIC_URL || process.env.BASE_URL || baseUrl || '').replace(/\/+$/, '');
  const notifBase = (!publica || /localhost|127\.0\.0\.1/.test(publica))
    ? 'https://marcas.legalpacers.com'
    : publica;

  const body = {
    items: [{
      title: titulo,
      quantity: 1,
      currency_id: 'ARS',
      unit_price: Number(precio),
    }],
    external_reference: externalReference,
    payer: email ? { email } : undefined,
    back_urls: {
      success: `${baseUrl}/pagos/exito?ref=${encodeURIComponent(externalReference)}`,
      failure: `${baseUrl}/pagos/error?ref=${encodeURIComponent(externalReference)}`,
      pending: `${baseUrl}/pagos/pendiente?ref=${encodeURIComponent(externalReference)}`,
    },
    auto_return: 'approved',
    // notification_url DEBE ser público y alcanzable por MP. Si BASE_URL no está
    // seteado apunta a localhost (MP no puede llamarlo), así que caemos al dominio
    // de producción. Configurable con PUBLIC_URL.
    notification_url: `${notifBase}/api/pagos/webhook`,
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`MP error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return {
    stub: false,
    preference_id: data.id,
    init_point: data.init_point || data.sandbox_init_point,
  };
}

async function obtenerPago(paymentId) {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function obtenerPreapproval(preapprovalId) {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const res = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = {
  crearPreferencia, obtenerPago, obtenerPreapproval,
  linkInformeUnico, linkRegistroUnico, linkPackSuscripcion,
};
