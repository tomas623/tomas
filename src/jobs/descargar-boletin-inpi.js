// Descargador de boletines del INPI. Baja UN solo boletín a la vez. Sabe
// probar el formato correcto según la serie: la serie "registros" empezó como
// PDF y ahora viene como XLS; la serie "marcas nuevas" es PDF.
//
// URL base confirmada en bulk_importer.py del scraper Python anterior:
//   https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.{ext}
//
// Devuelve { ok, formato, buffer, bytes } o { ok: false, motivo, status }.
// No escribe nada en la DB: el caller (catch-up) decide qué hacer.

const BASE = 'https://portaltramites.inpi.gob.ar/Uploads/Boletines';

function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (compatible; LegalPacersBot/1.0)',
    'Referer': 'https://portaltramites.inpi.gob.ar/Boletines?Tipo_Item=3',
    'Accept': '*/*',
  };
}

// Configuración por serie: en qué orden probamos extensiones.
// Para "registros" el XLS es lo nuevo (2025+) y el PDF lo viejo; probamos XLS
// primero. Para "nuevas" es siempre PDF.
const SERIES = {
  registros: {
    label: 'Concedidas / Oposiciones / Limitaciones (XLS)',
    extensiones: ['xls', 'pdf'],
  },
  nuevas: {
    label: 'Marcas nuevas en trámite (PDF INID)',
    extensiones: ['pdf'],
  },
};

async function descargar({ serie, numero, timeoutMs = 30000 }) {
  const cfg = SERIES[serie];
  if (!cfg) throw new Error(`Serie inválida: ${serie}`);
  const inicio = Date.now();

  for (const ext of cfg.extensiones) {
    const url = `${BASE}/${numero}_3_.${ext}`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: getHeaders(), signal: ctrl.signal });
      clearTimeout(t);

      if (res.status === 404) continue; // Probar siguiente extensión.
      if (!res.ok) {
        return { ok: false, motivo: 'http_error', status: res.status, formato: ext, duracion_ms: Date.now() - inicio };
      }

      // Validamos magic bytes para confirmar el formato — el INPI a veces
      // devuelve HTML de error con 200 en blanco.
      const arrBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      if (buf.length < 1024) {
        // Demasiado chico para ser un boletín real.
        continue;
      }
      const inicio4 = buf.slice(0, 4).toString();
      const inicio2hex = buf.slice(0, 2).toString('hex').toLowerCase();
      const esPDF = inicio4 === '%PDF';
      const esXLS = inicio2hex === 'd0cf' || inicio2hex === '504b'; // OLE2 o ZIP

      const okSegunExt = (ext === 'pdf' && esPDF) || (ext === 'xls' && esXLS) || (ext === 'xlsx' && esXLS);
      if (!okSegunExt) continue; // Bytes no coinciden con la extensión esperada.

      return {
        ok: true,
        formato: ext,
        buffer: buf,
        bytes: buf.length,
        url,
        duracion_ms: Date.now() - inicio,
      };
    } catch (err) {
      // Timeout o error de red: probamos siguiente extensión.
      if (err.name === 'AbortError') {
        return { ok: false, motivo: 'timeout', formato: ext, duracion_ms: Date.now() - inicio };
      }
      // Si la última extensión también falla, devolvemos error de red.
      if (ext === cfg.extensiones[cfg.extensiones.length - 1]) {
        return { ok: false, motivo: 'red_error', error: err.message, duracion_ms: Date.now() - inicio };
      }
    }
  }

  return { ok: false, motivo: 'no_existe', duracion_ms: Date.now() - inicio };
}

module.exports = { descargar, SERIES };
