const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOGO, TIPOS_LEAD, obtenerServicio, leerPrecio, servicioPorTipo, tituloPago,
} = require('../src/servicios-docs');

const ENV_OK = {
  SERVICIOS_DOCS_ACTIVOS: 'true',
  PRECIO_TYC: '200000',
  PRECIO_PRIVACIDAD: '200000',
  PRECIO_TYC_PRIVACIDAD: '275000',
};

test('apagado por defecto: sin la variable de activación no hay servicio', () => {
  const { SERVICIOS_DOCS_ACTIVOS, ...sinFlag } = ENV_OK;
  for (const codigo of Object.keys(CATALOGO)) {
    assert.equal(obtenerServicio(codigo, sinFlag), null);
    assert.equal(obtenerServicio(codigo, { ...sinFlag, SERVICIOS_DOCS_ACTIVOS: 'false' }), null);
  }
});

test('sin precio cargado no se puede cobrar', () => {
  assert.equal(obtenerServicio('tyc', { SERVICIOS_DOCS_ACTIVOS: 'true' }), null);
  assert.equal(obtenerServicio('combo', { ...ENV_OK, PRECIO_TYC_PRIVACIDAD: '' }), null);
});

test('activo y con precio: devuelve el servicio con el precio de la variable', () => {
  assert.equal(obtenerServicio('tyc', ENV_OK).precio, 200000);
  assert.equal(obtenerServicio('privacidad', ENV_OK).precio, 200000);
  const combo = obtenerServicio('combo', ENV_OK);
  assert.equal(combo.precio, 275000);
  assert.deepEqual([...combo.documentos], ['terminos', 'privacidad']);
  assert.equal(combo.reunionesDiagnostico, 1);
});

test('códigos inválidos o heredados del prototipo no pasan', () => {
  for (const c of ['', 'TYC', 'informe', 'registro', '__proto__', 'constructor', 'toString', null, undefined, 1, {}]) {
    assert.equal(obtenerServicio(c, ENV_OK), null);
  }
});

test('leerPrecio solo acepta enteros positivos', () => {
  assert.equal(leerPrecio('275000'), 275000);
  assert.equal(leerPrecio(' 200000 '), 200000);
  for (const v of ['', '0', '-1', '200000.50', '2e5', 'abc', '99999999999999999999', undefined, null]) {
    assert.equal(leerPrecio(v), null, String(v));
  }
});

test('los tipos de lead no chocan con los existentes y se resuelven por tipo', () => {
  for (const t of TIPOS_LEAD) {
    assert.ok(!['informe', 'registro', 'suscripcion', 'free', 'interes', 'checklist'].includes(t));
    assert.equal(servicioPorTipo(t).tipo, t);
  }
  assert.equal(new Set(TIPOS_LEAD).size, TIPOS_LEAD.length);
  assert.equal(servicioPorTipo('registro'), null);
});

test('el título del pago lleva la marca y el nombre del servicio', () => {
  assert.equal(tituloPago(CATALOGO.tyc), 'Legal Pacer · Términos y condiciones');
});
