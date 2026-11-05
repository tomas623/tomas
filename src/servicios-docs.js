// Servicios de documentos de Legal Pacer: términos y condiciones, política de
// privacidad y el combo de los dos (decisiones de Tomás, 02/11/2026).
//
// Hasta enero de 2027 el servicio funciona "a mano" por detrás: el sistema
// solo cobra, recibe el formulario y los archivos, avisa y entrega. Este
// módulo define el catálogo para cobrar con Mercado Pago (crearPreferencia).
//
// Nada se activa por defecto. Un servicio está disponible solo si:
//   1. SERVICIOS_DOCS_ACTIVOS=true (o 1), y
//   2. su precio está cargado en la variable de entorno que le corresponde.
// Así el código puede llegar a producción sin que nadie pueda comprar antes
// del relanzamiento, y los precios no quedan escritos en el código.

const CATALOGO = Object.freeze({
  tyc: Object.freeze({
    codigo: 'tyc',
    tipo: 'tyc',
    nombre: 'Términos y condiciones',
    envPrecio: 'PRECIO_TYC',
    documentos: Object.freeze(['terminos']),
    reunionesDiagnostico: 1,
  }),
  privacidad: Object.freeze({
    codigo: 'privacidad',
    tipo: 'privacidad',
    nombre: 'Política de privacidad',
    envPrecio: 'PRECIO_PRIVACIDAD',
    documentos: Object.freeze(['privacidad']),
    reunionesDiagnostico: 1,
  }),
  combo: Object.freeze({
    codigo: 'combo',
    tipo: 'tyc_privacidad',
    nombre: 'Términos y condiciones y política de privacidad',
    envPrecio: 'PRECIO_TYC_PRIVACIDAD',
    documentos: Object.freeze(['terminos', 'privacidad']),
    reunionesDiagnostico: 1,
  }),
});

// Tipos de lead que usan estos servicios (columna leads.tipo).
const TIPOS_LEAD = Object.freeze(Object.values(CATALOGO).map(s => s.tipo));

function serviciosActivos(env = process.env) {
  return ['true', '1'].includes(String(env.SERVICIOS_DOCS_ACTIVOS || '').trim().toLowerCase());
}

// Precio en pesos, entero y positivo; null si falta o es inválido.
function leerPrecio(valor) {
  const txt = String(valor ?? '').trim();
  if (!/^\d+$/.test(txt)) return null;
  const n = Number(txt);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Devuelve el servicio listo para cobrar ({ ...servicio, precio }) o null si
// no existe, no está activo o no tiene precio cargado.
function obtenerServicio(codigo, env = process.env) {
  if (!serviciosActivos(env)) return null;
  if (typeof codigo !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOGO, codigo)) return null;
  const servicio = CATALOGO[codigo];
  const precio = leerPrecio(env[servicio.envPrecio]);
  if (precio === null) return null;
  return { ...servicio, precio };
}

function servicioPorTipo(tipo) {
  return Object.values(CATALOGO).find(s => s.tipo === tipo) || null;
}

// Título del ítem en Mercado Pago (lo ve el cliente en el checkout).
function tituloPago(servicio) {
  return `Legal Pacer · ${servicio.nombre}`;
}

module.exports = {
  CATALOGO, TIPOS_LEAD,
  serviciosActivos, leerPrecio, obtenerServicio, servicioPorTipo, tituloPago,
};
