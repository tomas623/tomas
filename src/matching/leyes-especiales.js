// Pre-checks deterministas según legislación argentina especial + práctica INPI.
// Se ejecutan ANTES de Gemini para detectar bloqueos objetivos que no requieren IA.
// Cada flag detectado se le pasa a Gemini como contexto duro y se refleja en el informe.
//
// Fuentes verificadas (junio 2026):
//   - Ley 22.362 — Marcas y Designaciones
//   - Ley 25.127 — Producción ecológica, biológica u orgánica
//   - Ley 24.664 — Titularidad del Símbolo Olímpico (COI / COA)
//   - Ley 26.687 — Control de tabaco

// Clases Niza con restricción agroalimentaria (práctica INPI + L. 25.127 + SENASA).
// El texto de la ley no fija clases; es la práctica administrativa la que las acota.
const CLASES_AGROALIMENTARIAS = new Set([16, 20, 24, 29, 30, 31, 32]);
const PALABRAS_ECO = [
  'bio', 'eco', 'organico', 'orgánico',
  'ecologico', 'ecológico', 'biologico', 'biológico',
];

// L. 24.664 — términos protegidos en TODAS las clases.
// El normalizador saca acentos antes de comparar, así que solo listo formas sin acento.
const TERMINOS_OLIMPICOS = [
  'juegos olimpicos',
  'olimpiada', 'olimpiadas',
  'olimpico', 'olimpica', 'olimpicos', 'olimpicas',
  'citius altius fortius',
  'mas rapido mas alto mas fuerte',
  'movimiento olimpico', 'movimiento olimpicos',
];

// L. 26.687 — términos engañosos prohibidos en tabaco.
const CLASE_TABACO = 34;
const TERMINOS_TABACO_ENGANOSOS = [
  'light', 'suave', 'milds',
  'bajo en nicotina', 'bajo en alquitran', 'bajo en alquitrán',
];

// Art. 3 Ley 22.362 — designaciones de actividad no son registrables como denominación única.
const DESIGNACIONES_ACTIVIDAD = [
  'zapateria', 'zapatería', 'taller', 'estudio', 'consultora',
  'consultoria', 'consultoría', 'panaderia', 'panadería',
  'libreria', 'librería', 'farmacia', 'kiosco', 'almacen', 'almacén',
];

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // saca acentos
    .replace(/[^a-z0-9ñü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contieneTermino(textoNorm, listaTerminos) {
  return listaTerminos.find(t => {
    const tNorm = normalizar(t);
    const re = new RegExp(`(^|\\s)${tNorm}(\\s|$)`, 'i');
    return re.test(textoNorm);
  });
}

function contienePrefijoOSubstring(textoNorm, listaTerminos) {
  return listaTerminos.find(t => textoNorm.includes(normalizar(t)));
}

/**
 * Evalúa una marca contra todas las restricciones especiales.
 * @param {string} marca - denominación a evaluar
 * @param {number[]} clases - clases Niza solicitadas
 * @returns {Array<{regla, ley, severidad, detalle}>} flags detectados
 */
function chequear(marca, clases) {
  const flags = [];
  const denomNorm = normalizar(marca);
  const clasesArr = Array.isArray(clases) ? clases.map(Number).filter(Number.isFinite) : [];

  // 1. Eco/Bio/Orgánico en clases agroalimentarias.
  const palabraEco = contienePrefijoOSubstring(denomNorm, PALABRAS_ECO);
  if (palabraEco) {
    const claseRestricta = clasesArr.find(c => CLASES_AGROALIMENTARIAS.has(c));
    if (claseRestricta) {
      flags.push({
        regla: 'eco_clase_agroalimentaria',
        ley: 'Ley 25.127 (Producción ecológica) + práctica INPI/SENASA',
        severidad: 'alta',
        detalle: `Contiene "${palabraEco}" y se solicita en clase ${claseRestricta} (agroalimentaria). El INPI rechaza estos términos en marcas de clases 16/20/24/29/30/31/32 salvo certificación SENASA del producto.`,
      });
    } else if (clasesArr.length === 0) {
      // No sabemos la clase; aviso suave para que Gemini lo evalúe.
      flags.push({
        regla: 'eco_sin_clase',
        ley: 'Ley 25.127',
        severidad: 'baja',
        detalle: `Contiene "${palabraEco}". Si la marca se aplicará en clases agroalimentarias (16/20/24/29-32), revisar certificación SENASA antes de presentar.`,
      });
    }
  }

  // 2. Símbolos olímpicos — bloqueo en cualquier clase.
  const palabraOlimpica = contieneTermino(denomNorm, TERMINOS_OLIMPICOS);
  if (palabraOlimpica) {
    flags.push({
      regla: 'simbolo_olimpico',
      ley: 'Ley 24.664 (Titularidad del Símbolo Olímpico)',
      severidad: 'alta',
      detalle: `Contiene "${palabraOlimpica}". El COI y el COA tienen titularidad exclusiva sobre estos términos en todas las clases Niza. Registro improbable sin licencia previa.`,
    });
  }

  // 3. Términos engañosos en tabaco.
  if (clasesArr.includes(CLASE_TABACO)) {
    const palabraTab = contienePrefijoOSubstring(denomNorm, TERMINOS_TABACO_ENGANOSOS);
    if (palabraTab) {
      flags.push({
        regla: 'tabaco_enganoso',
        ley: 'Ley 26.687 (Control de Tabaco)',
        severidad: 'alta',
        detalle: `Contiene "${palabraTab}" en marca clase 34. La ley prohíbe expresiones que sugieran menor daño en productos de tabaco.`,
      });
    }
  }

  // 4. Designaciones de actividad sin acompañamiento distintivo.
  const designacion = contieneTermino(denomNorm, DESIGNACIONES_ACTIVIDAD);
  if (designacion) {
    const esUnicaPalabra = denomNorm.split(/\s+/).length <= 2;
    if (esUnicaPalabra) {
      flags.push({
        regla: 'designacion_actividad',
        ley: 'Art. 3 inc. d Ley 22.362',
        severidad: 'media',
        detalle: `"${designacion}" es una designación de actividad. No registrable como denominación única; requiere un elemento distintivo adicional para superar la observación del INPI.`,
      });
    }
  }

  return flags;
}

module.exports = {
  chequear,
  normalizar,
  CLASES_AGROALIMENTARIAS,
};
