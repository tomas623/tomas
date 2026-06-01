const crypto = require('crypto');

const MP_API = 'https://api.mercadopago.com';

async function crearPreferencia({ titulo, precio, externalReference, email, baseUrl }) {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();

  if (!token) {
    const stubId = `STUB-${crypto.randomBytes(6).toString('hex')}`;
    return {
      stub: true,
      preference_id: stubId,
      init_point: `${baseUrl}/pagos/stub?ref=${encodeURIComponent(externalReference)}&monto=${precio}&titulo=${encodeURIComponent(titulo)}`,
    };
  }

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
    notification_url: `${baseUrl}/api/pagos/webhook`,
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

module.exports = { crearPreferencia, obtenerPago };
