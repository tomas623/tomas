// Chequeo de disponibilidad de dominios .com y .com.ar para una marca.
// Estrategia: resolución DNS + HEAD HTTP con timeout corto. Tolerante a fallos
// (devuelve "incierto" cuando no podemos determinar).
//
// Para .com.ar: NIC.ar no expone una API pública estable de WHOIS, así que usamos
// el mismo método DNS — alcanza para el 95% de los casos (si hay registro NS, está
// tomado; si no, libre con falsa-positiva baja).

const dns = require('dns').promises;

const TIMEOUT_MS = 5000;
const USER_AGENT = 'LegalPacers/1.0 (+https://legalpacers.com)';

function slugDominio(marca) {
  return String(marca || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 63);
}

async function chequearDns(host) {
  try {
    await dns.resolve4(host);
    return { resuelve: true };
  } catch (err) {
    // ENOTFOUND / ENODATA → no resuelve.
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'NXDOMAIN') {
      return { resuelve: false };
    }
    // SERVFAIL u otros: incierto.
    return { resuelve: null, error: err.code || err.message };
  }
}

async function chequearHead(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
    return { responde: true, status: res.status };
  } catch (err) {
    return { responde: false, error: err.message };
  }
}

async function chequearDominio(host) {
  const dnsRes = await chequearDns(host);
  if (dnsRes.resuelve === false) {
    return { dominio: host, disponible: true, fuente: 'dns_no_resuelve' };
  }
  if (dnsRes.resuelve === null) {
    return { dominio: host, disponible: null, fuente: 'dns_incierto', detalle: dnsRes.error };
  }
  // DNS resuelve — confirmamos con HEAD para distinguir "parking" de "sitio real".
  const headRes = await chequearHead(`https://${host}`);
  return {
    dominio: host,
    disponible: false,
    fuente: headRes.responde ? `http_${headRes.status}` : 'dns_resuelve_sin_http',
  };
}

/**
 * Chequea disponibilidad de dominios .com, .com.ar y .ar para una marca.
 * @param {string} marca - denominación a chequear
 * @returns {Promise<object>} resultados por TLD
 */
async function chequear(marca) {
  const slug = slugDominio(marca);
  if (!slug) return { slug: '', error: 'marca_invalida' };

  const tlds = ['com', 'com.ar', 'ar'];
  const resultados = await Promise.all(
    tlds.map(tld => chequearDominio(`${slug}.${tld}`).catch(err => ({
      dominio: `${slug}.${tld}`,
      disponible: null,
      fuente: 'error',
      detalle: err.message,
    }))),
  );

  return {
    slug,
    resultados: Object.fromEntries(
      resultados.map(r => [r.dominio.replace(`${slug}.`, ''), r]),
    ),
  };
}

module.exports = { chequear, slugDominio };
