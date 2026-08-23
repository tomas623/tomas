// Fallback de clasificación rubro → clase Niza con IA (Gemini), para cuando la
// tabla de reglas (RUBRO_CLASES en server.js) no reconoce el rubro. Cachea el
// resultado en rubro_clase_cache para no repetir la llamada. Degradación elegante:
// si Gemini no responde a tiempo o falla, devuelve [] y el chequeo sigue como antes.

const db = require('../db');

// Resumen de las 45 clases Niza (una línea por clase) para el prompt.
const NIZA = `1 productos quimicos industria/ciencia/agricultura, fertilizantes, adhesivos industriales
2 pinturas, barnices, lacas, tintas, colorantes anticorrosivos
3 cosmetica, perfumes, cremas, maquillaje, jabones, productos de limpieza y tocador
4 aceites y grasas industriales, lubricantes, combustibles, velas
5 productos farmaceuticos, medicamentos, suplementos, higienicos medicos, desinfectantes, alimentos para bebes
6 metales comunes, ferreteria metalica, construcciones metalicas, cajas de caudales
7 maquinas y maquinas-herramienta, motores (no de vehiculos), distribuidores automaticos
8 herramientas manuales, cuchilleria, cubiertos, maquinillas de afeitar
9 aparatos cientificos/electronicos, software, computadoras, celulares, audio, opticos-instrumentos, extintores
10 aparatos medicos/quirurgicos, anteojos/gafas/lentes de sol/contacto, ortopedia, articulos sexuales
11 aparatos de alumbrado, calefaccion, cocina, refrigeracion, sanitarios
12 vehiculos, autos, motos, bicicletas, repuestos, locomocion
13 armas de fuego, municiones, explosivos, fuegos artificiales
14 joyeria, relojes, metales y piedras preciosas
15 instrumentos musicales
16 papel, carton, imprenta, papeleria, libros, fotografias, material didactico
17 caucho, plasticos semielaborados, aislantes, tuberias flexibles
18 cuero, marroquineria, carteras, bolsos, valijas, paraguas, articulos para animales
19 materiales de construccion no metalicos, asfalto, construcciones no metalicas
20 muebles, espejos, marcos, contenedores no metalicos
21 utensilios de cocina, vajilla, bazar, cepillos, cristaleria, articulos de limpieza (implementos)
22 cuerdas, redes, lonas, toldos, sacos, fibras textiles en bruto
23 hilos e hilados textiles
24 tejidos, telas, ropa de hogar, sabanas, toallas, cortinas, blanqueria
25 ropa, indumentaria, calzado, sombrereria
26 merceria, encajes, botones, flores artificiales, adornos para el cabello
27 alfombras, felpudos, revestimientos de suelos, tapices murales
28 juegos, juguetes, videojuegos, articulos de gimnasia y deporte
29 carne, pescado, fiambres, lacteos, quesos, huevos, frutas/verduras en conserva, aceites comestibles
30 cafe, te, yerba, cacao, arroz, pastas, pan, pasteleria, chocolate, helados, azucar, salsas, especias
31 productos agricolas en bruto, frutas/verduras frescas, plantas, flores, semillas, animales vivos, alimento para animales
32 cervezas, bebidas sin alcohol, aguas, jugos
33 bebidas alcoholicas (excepto cerveza), vinos, licores
34 tabaco, cigarrillos, vapers, articulos para fumadores
35 publicidad, marketing, gestion/administracion de negocios, comercio/venta minorista, ecommerce, oficina, importacion/exportacion
36 servicios financieros, bancarios, seguros, inmobiliarios
37 construccion, instalacion y reparacion, limpieza de edificios, mineria
38 telecomunicaciones
39 transporte, logistica, embalaje y almacenamiento, organizacion de viajes/turismo
40 tratamiento de materiales, reciclaje, impresion, purificacion de agua/aire
41 educacion, formacion, entretenimiento, eventos, deportes (actividad), cultura, fotografia
42 servicios cientificos y tecnologicos, diseno y desarrollo de software/hardware, investigacion, control de calidad
43 servicios de restauracion (comida), bares, catering, hospedaje temporal, hoteles
44 servicios medicos, veterinarios, belleza (peluqueria/estetica/spa), agricultura/jardineria/horticultura
45 servicios juridicos, seguridad, redes sociales, funerarios, cuidado de ninos`;

function normalizarRubro(rubro) {
  return String(rubro || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Devuelve un array de clases Niza (1-45) para el rubro. Usa caché; si no está,
 * consulta a Gemini. Nunca lanza: ante cualquier problema devuelve [].
 * @returns {Promise<number[]>}
 */
async function clasificarRubroIA(rubro) {
  const key = normalizarRubro(rubro);
  if (key.length < 2) return [];

  // 1) Caché
  try {
    const hit = db.prepare('SELECT clases FROM rubro_clase_cache WHERE rubro_norm = ?').get(key);
    if (hit) { try { return JSON.parse(hit.clases); } catch { return []; } }
  } catch { /* sigue a IA */ }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return [];
  const model = (process.env.GEMINI_MODEL_RUBRO || 'gemini-2.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const prompt = `Sos un clasificador de la Clasificación de Niza (marcas, Argentina/INPI). Dada la actividad/rubro de un negocio, devolvé la o las clases Niza (números 1 a 45) que mejor correspondan. Elegí 1 a 3 clases, las más específicas y relevantes; no inventes. Si es un producto, la clase del producto; si es un servicio, la clase del servicio.

Lista de clases:
${NIZA}

Rubro: "${String(rubro).slice(0, 200)}"

Respondé SOLO JSON: {"clases":[n,...]}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let clases = [];
    try { clases = (JSON.parse(txt).clases || []); } catch { return []; }
    clases = [...new Set(clases.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 45))].slice(0, 3);
    if (clases.length) {
      try {
        db.prepare('INSERT OR REPLACE INTO rubro_clase_cache (rubro_norm, clases, fuente) VALUES (?, ?, ?)')
          .run(key, JSON.stringify(clases), 'ia');
      } catch { /* no bloquea */ }
    }
    return clases;
  } catch {
    return []; // timeout / red / etc → degradación elegante
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { clasificarRubroIA, normalizarRubro };
