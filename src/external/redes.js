// Chequeo de disponibilidad de handles en redes sociales para una marca.
//
// Estrategia: HEAD/GET HTTP a la URL pública del perfil con User-Agent realista.
//   - 200 → handle TOMADO
//   - 404 → handle LIBRE
//   - otros (rate limit, bloqueo) → INCIERTO
//
// Caveat: las plataformas bloquean ocasionalmente requests automatizados (esp. IG y
// TikTok). Cuando esto pasa, devolvemos "incierto" y el informe lo aclara — preferible
// ser honesto antes que tirar un falso positivo.

const TIMEOUT_MS = 7000;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';

function slugHandle(marca) {
  return String(marca || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 30);
}

async function chequearUrl(url, { method = 'HEAD' } = {}) {
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    });
    return { status: res.status, ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function interpretarStatus(status) {
  if (status === 200 || (status >= 300 && status < 400)) return { disponible: false };
  if (status === 404) return { disponible: true };
  if (status === 429 || status === 403 || status === 401) return { disponible: null, detalle: 'bloqueado_o_rate_limited' };
  return { disponible: null, detalle: `status_inusual_${status}` };
}

async function chequearInstagram(handle) {
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const r = await chequearUrl(url);
  if (!r.ok) return { red: 'instagram', handle, url, disponible: null, detalle: r.error };
  return { red: 'instagram', handle, url, ...interpretarStatus(r.status) };
}

async function chequearTwitter(handle) {
  // x.com es el dominio actual; mantenemos twitter.com como fallback.
  const url = `https://x.com/${encodeURIComponent(handle)}`;
  const r = await chequearUrl(url, { method: 'GET' });
  if (!r.ok) return { red: 'twitter', handle, url, disponible: null, detalle: r.error };
  return { red: 'twitter', handle, url, ...interpretarStatus(r.status) };
}

async function chequearTiktok(handle) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  const r = await chequearUrl(url, { method: 'GET' });
  if (!r.ok) return { red: 'tiktok', handle, url, disponible: null, detalle: r.error };
  return { red: 'tiktok', handle, url, ...interpretarStatus(r.status) };
}

/**
 * Chequea disponibilidad del handle @marca en IG, X y TikTok.
 * @param {string} marca - denominación a chequear
 * @returns {Promise<object>} resultados por red
 */
async function chequear(marca) {
  const handle = slugHandle(marca);
  if (!handle) return { handle: '', error: 'marca_invalida' };

  const [instagram, twitter, tiktok] = await Promise.all([
    chequearInstagram(handle).catch(err => ({ red: 'instagram', disponible: null, detalle: err.message })),
    chequearTwitter(handle).catch(err => ({ red: 'twitter', disponible: null, detalle: err.message })),
    chequearTiktok(handle).catch(err => ({ red: 'tiktok', disponible: null, detalle: err.message })),
  ]);

  return { handle, resultados: { instagram, twitter, tiktok } };
}

module.exports = { chequear, slugHandle };
