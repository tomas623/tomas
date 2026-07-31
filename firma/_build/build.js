/* ============================================================
   Rodriguez | abogados — static site generator
   Zero dependencies. Emits plain HTML into /firma.
   Run:  node firma/_build/build.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..");

/* ---- Firm data (edit these to update the whole site) ---- */
const FIRM = {
  name: "Rodriguez",
  sub: "abogados",
  city: "Buenos Aires, Argentina",
  address: "Av. del Libertador 0000, Piso 00 — CABA", // placeholder
  email: "estudio@rodriguezabogados.com.ar",           // placeholder
  phone: "+54 9 11 0000 0000",                          // placeholder
  waNumber: "5491100000000",                            // placeholder (wa.me)
  linkedin: "https://www.linkedin.com/",                // placeholder
};

/* ---- Navigation ---- */
const NAV = [
  { label: "Inicio", href: "index.html", key: "home" },
  { label: "Áreas de práctica", href: "areas/index.html", key: "areas" },
  { label: "Quiénes somos", href: "quienes-somos.html", key: "nosotros" },
  { label: "Equipo", href: "equipo.html", key: "equipo" },
  { label: "Contacto", href: "contacto.html", key: "contacto" },
];

/* ---- Practice areas ---- */
const AXES = {
  empresas: {
    eyebrow: "Eje 01",
    title: "Empresas, startups y pymes",
    intro: "Acompañamos la vida de una organización: cómo se constituye, cómo contrata, cómo protege lo que crea y cómo resuelve lo que se rompe. Derecho pensado desde la lógica del negocio.",
  },
  family: {
    eyebrow: "Eje 02",
    title: "Family office",
    intro: "Ordenamos el patrimonio de familias y personas antes de que las decisiones se vuelvan urgentes. Planificación, sucesiones y familia con una mirada de largo plazo.",
  },
};

const PRACTICES = [
  {
    slug: "derecho-societario", no: "01", axis: "empresas", art: "arch",
    title: "Derecho societario",
    short: "Constitución, gobierno corporativo, acuerdos de socios y reorganizaciones. La estructura sobre la que se apoya el resto.",
    intro: "La forma societaria no es un trámite: define quién decide, cómo se reparte el valor y qué pasa cuando los intereses dejan de estar alineados. Diseñamos y ordenamos estructuras que sostienen el crecimiento y anticipan el conflicto.",
    body: [
      { h: "Estructura como decisión estratégica", p: "Elegir el tipo societario, distribuir el capital y definir las reglas de gobierno son decisiones que condicionan una empresa durante años. Trabajamos sobre el diseño —no sobre el formulario— para que la estructura acompañe el plan de negocio y no lo limite." },
      { h: "Acuerdos entre socios", p: "La mayoría de los conflictos societarios no nacen de la ley, sino de lo que nunca se puso por escrito. Redactamos acuerdos de accionistas, pactos de socios y estatutos que definen mayorías, salidas, valuación y resolución de bloqueos antes de que hagan falta." },
    ],
    checklist: [
      "Constitución de SAS, SRL y SA y elección de estructura",
      "Acuerdos de accionistas y pactos de socios",
      "Gobierno corporativo, directorios y órganos de decisión",
      "Aumentos de capital, aportes y reorganizaciones",
      "Fusiones, escisiones y transformaciones",
      "Due diligence societario y saneamiento",
    ],
  },
  {
    slug: "contratos-comerciales", no: "02", axis: "empresas", art: "strata",
    title: "Contratos comerciales",
    short: "Los acuerdos que sostienen la operación diaria: distribución, servicios, proveedores, alianzas y financiamiento.",
    intro: "Un contrato bien hecho reparte riesgos con claridad y evita que cada relación comercial dependa de la buena voluntad. Redactamos y negociamos los acuerdos que estructuran ingresos, obligaciones y responsabilidades.",
    body: [
      { h: "Contratos que anticipan, no que reaccionan", p: "Nos concentramos en las cláusulas que importan cuando algo sale distinto de lo previsto: precio, plazos, incumplimiento, límites de responsabilidad y salida. El objetivo es que el contrato trabaje a favor del negocio, no que lo trabe." },
      { h: "Negociación con criterio comercial", p: "Entendemos qué está realmente en juego en cada operación y dónde conviene ceder y dónde no. Traducimos objetivos de negocio en términos jurídicos precisos, sin fricción innecesaria." },
    ],
    checklist: [
      "Distribución, agencia, franquicia y representación",
      "Prestación de servicios y acuerdos con proveedores",
      "Contratos SaaS, licencias y términos y condiciones",
      "Joint ventures y acuerdos de colaboración",
      "Confidencialidad (NDA) y cartas de intención",
      "Financiamiento, mutuos y garantías",
    ],
  },
  {
    slug: "propiedad-intelectual", no: "03", axis: "empresas", art: "nodes",
    title: "Propiedad intelectual",
    short: "Marcas, software, contenidos y activos intangibles: identificar el valor que no está en el balance y protegerlo.",
    intro: "En buena parte de las empresas actuales, el valor está en lo intangible: la marca, el código, los datos, la reputación. Ayudamos a identificar esos activos, registrarlos donde corresponde y ordenar su titularidad.",
    body: [
      { h: "Proteger antes de escalar", p: "Registrar una marca o clarificar la titularidad del software es más barato y más simple antes de crecer que después de un conflicto. Definimos una estrategia de protección proporcional a la etapa y al plan de la empresa." },
      { h: "Titularidad y cesión de derechos", p: "Fundadores, empleados y proveedores generan activos intelectuales todos los días. Estructuramos las cesiones y licencias para que la empresa sea, sin ambigüedad, dueña de lo que produce." },
    ],
    checklist: [
      "Registro y defensa de marcas en el INPI",
      "Estrategia de portafolio de marcas",
      "Derechos de autor sobre software y contenidos",
      "Cesión de derechos de empleados y proveedores",
      "Acuerdos de licencia y transferencia de tecnología",
      "Oposiciones, cese de uso y conflictos de marca",
    ],
  },
  {
    slug: "startups", no: "04", axis: "empresas", art: "columns",
    title: "Startups",
    short: "Desde la constitución hasta la ronda: cap table, vesting, acuerdos de inversión y todo lo que revisa un inversor.",
    intro: "Acompañamos a fundadores en las decisiones jurídicas que definen una startup: cómo se reparte el equity, cómo entran los inversores y cómo se prepara la empresa para una due diligence sin sorpresas.",
    body: [
      { h: "El cap table como decisión temprana", p: "La forma en que se reparte el capital entre fundadores, empleados y primeros inversores es una de las decisiones más difíciles de revertir. La estructuramos desde el inicio, con vesting, pool de opciones y reglas claras de salida." },
      { h: "Preparados para la ronda", p: "Cuando llega el inversor, la empresa se revisa entera. Ordenamos la documentación societaria, la propiedad intelectual y los contratos laborales para que el proceso confirme el valor de la compañía en lugar de erosionarlo en la negociación." },
    ],
    checklist: [
      "Constitución y acuerdo de fundadores",
      "Cap table, vesting y planes de opciones (ESOP)",
      "SAFE, convertibles y acuerdos de inversión",
      "Term sheets: lectura y negociación",
      "Due diligence legal previa a la ronda",
      "Estructuras para expansión regional",
    ],
  },
  {
    slug: "tecnologia-ia", no: "05", axis: "empresas", art: "grid",
    title: "Tecnología e inteligencia artificial",
    short: "Datos personales, gobernanza de IA, responsabilidad y contratos de tecnología en un marco todavía en construcción.",
    intro: "La tecnología avanza más rápido que la regulación. Ayudamos a empresas que desarrollan o incorporan inteligencia artificial y productos digitales a moverse con criterio: cumpliendo lo que existe y anticipando lo que viene.",
    body: [
      { h: "Gobernanza de datos y de IA", p: "Definimos cómo se recolectan, tratan y protegen los datos, y qué controles necesita un sistema de IA para operar con responsabilidad. Menos declaraciones de principios y más decisiones concretas de diseño y contrato." },
      { h: "Responsabilidad y contratos tecnológicos", p: "¿Quién responde cuando un modelo se equivoca? Estructuramos la responsabilidad en contratos de desarrollo, integración y uso de IA, y en los términos con usuarios y clientes." },
    ],
    checklist: [
      "Protección de datos personales y privacidad",
      "Gobernanza y políticas de uso de IA",
      "Contratos de desarrollo e integración de software",
      "Términos de uso, licencias y responsabilidad",
      "Propiedad intelectual sobre modelos y datasets",
      "Análisis de riesgo regulatorio y cumplimiento",
    ],
  },
  {
    slug: "resolucion-de-conflictos", no: "06", axis: "empresas", art: "contour",
    title: "Resolución de conflictos",
    short: "Negociación, mediación, arbitraje y litigio. Resolver disputas cuidando el valor, el tiempo y las relaciones.",
    intro: "Cuando un conflicto es inevitable, la estrategia importa tanto como el derecho. Evaluamos con frialdad qué está en juego y elegimos el camino —acuerdo, arbitraje o juicio— que mejor protege los intereses del cliente.",
    body: [
      { h: "Decidir antes de litigar", p: "No todo conflicto se gana en tribunales. Analizamos costos, plazos, exposición y probabilidad antes de recomendar un curso de acción, y muchas veces el mejor resultado es un acuerdo bien negociado." },
      { h: "Litigio y arbitraje con estrategia", p: "Cuando hay que litigar, lo hacemos con preparación y foco. Representamos a empresas y personas en disputas societarias, comerciales, patrimoniales y familiares, con una mirada puesta en el resultado, no en el trámite." },
    ],
    checklist: [
      "Negociación y mediación previa",
      "Conflictos societarios y entre socios",
      "Disputas comerciales y contractuales",
      "Arbitraje nacional e institucional",
      "Litigio civil y comercial",
      "Conflictos sucesorios y patrimoniales",
    ],
  },
  {
    slug: "sucesiones-planificacion-patrimonial", no: "07", axis: "family", art: "strata",
    title: "Sucesiones y planificación patrimonial",
    short: "Planificación patrimonial, sucesiones y derecho de familia para ordenar el patrimonio y proteger a las próximas generaciones.",
    intro: "Ayudamos a familias y personas con patrimonios relevantes a ordenar hoy lo que de otro modo se resuelve en el peor momento. Planificación, sucesión y familia con confidencialidad y una mirada de décadas, no de trámites.",
    body: [
      { h: "Planificar en calma, no en crisis", p: "La planificación patrimonial es la diferencia entre decidir con tiempo y criterio, o dejar que la ley y los tiempos judiciales decidan por la familia. Estructuramos la transmisión de bienes, empresas y participaciones cuidando la carga fiscal y la continuidad." },
      { h: "Empresa familiar y protocolo", p: "Cuando el patrimonio incluye una empresa, ordenar la relación entre familia, propiedad y gestión es clave para que sobreviva a la siguiente generación. Redactamos protocolos familiares y estructuras de gobierno que separan lo afectivo de lo societario." },
      { h: "Sucesiones y familia", p: "Acompañamos procesos sucesorios y cuestiones de derecho de familia —régimen patrimonial, acuerdos y conflictos— con discreción y con foco en preservar tanto el patrimonio como los vínculos." },
    ],
    checklist: [
      "Planificación patrimonial y sucesoria",
      "Testamentos y estructuras de transmisión",
      "Protocolo de empresa familiar",
      "Fideicomisos y vehículos patrimoniales",
      "Procesos sucesorios",
      "Régimen patrimonial del matrimonio y acuerdos",
      "Conflictos de familia y patrimoniales",
    ],
  },
];

/* ---- Team (placeholder partners — replace names, bios and photos) ---- */
const TEAM = [
  {
    name: "Martín Rodríguez", role: "Socio · Empresas y M&A",
    bio: "Estructura operaciones societarias, rondas de inversión y transacciones. Trabaja con fundadores e inversores traduciendo objetivos de negocio en estructuras jurídicas.",
    tags: ["Societario", "M&A", "Startups"], art: "arch",
  },
  {
    name: "Socia — nombre", role: "Socia · Tecnología y PI",
    bio: "Lidera la práctica de tecnología, datos e inteligencia artificial y propiedad intelectual. Asesora a empresas de base tecnológica en producto, contratos y cumplimiento.",
    tags: ["Tecnología e IA", "Datos", "Propiedad intelectual"], art: "nodes",
  },
  {
    name: "Socio — nombre", role: "Socio · Family office",
    bio: "Conduce la práctica de planificación patrimonial, sucesiones y empresa familiar. Acompaña a familias y personas en decisiones patrimoniales de largo plazo.",
    tags: ["Patrimonial", "Sucesiones", "Familia"], art: "contour",
  },
];

/* ---- Publications (placeholder editorial content) ---- */
const PUBS = [
  {
    kicker: "Startups", date: "Julio 2026",
    title: "Cap table antes de la primera ronda: los errores que después no se deshacen",
    excerpt: "Cómo repartir equity entre fundadores, prever un pool de opciones y llegar a la negociación con inversores sin sorpresas.",
    art: "columns",
  },
  {
    kicker: "Tecnología e IA", date: "Junio 2026",
    title: "Gobernanza de IA en la empresa: qué decidir antes de poner un modelo en producción",
    excerpt: "Datos, responsabilidad y controles concretos para incorporar inteligencia artificial con criterio jurídico.",
    art: "grid",
  },
  {
    kicker: "Family office", date: "Mayo 2026",
    title: "Protocolo familiar: ordenar el patrimonio antes de que sea urgente",
    excerpt: "Separar familia, propiedad y gestión para que la empresa y el patrimonio lleguen bien a la próxima generación.",
    art: "strata",
  },
  {
    kicker: "Societario", date: "Abril 2026",
    title: "Acuerdo de socios: las cláusulas que evitan el conflicto que todavía no existe",
    excerpt: "Mayorías, salidas, valuación y bloqueos. Lo que conviene escribir cuando todo va bien.",
    art: "arch",
  },
];

/* ============================================================
   SVG art — bespoke editorial placeholders (no legal clichés)
   Architecture · strata · technology · strategic structure
   ============================================================ */
function art(kind, opts) {
  opts = opts || {};
  const w = 800, h = opts.tall ? 1000 : (opts.wide ? 534 : 600);
  // Hardcoded hex — var() is not resolved inside SVG presentation attributes.
  const L = "#d7d4ca", A = "#4e5836", I = "#14181e";
  let inner = "";

  if (kind === "arch") {
    // Converging architectural perspective
    let lines = "";
    for (let i = 0; i <= 10; i++) {
      const x = (w / 10) * i;
      lines += `<line x1="${x}" y1="0" x2="${w * .5}" y2="${h}" stroke="${L}" stroke-width="1"/>`;
    }
    for (let i = 1; i <= 7; i++) {
      const y = h - (h / 8) * i, s = i / 8;
      lines += `<line x1="${w * .5 - (w * .5) * (1 - s)}" y1="${y}" x2="${w * .5 + (w * .5) * (1 - s)}" y2="${y}" stroke="${L}" stroke-width="1"/>`;
    }
    inner = lines + `<rect x="${w * .28}" y="${h * .18}" width="${w * .16}" height="${h * .5}" fill="none" stroke="${A}" stroke-width="1.5"/>`;
  } else if (kind === "strata") {
    let s = "";
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      const y = (h / bands) * i;
      const accent = i === 3;
      s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${accent ? A : L}" stroke-width="${accent ? 1.5 : 1}"/>`;
    }
    for (let i = 1; i < 24; i++) {
      const x = (w / 24) * i;
      s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${L}" stroke-width=".5" opacity=".5"/>`;
    }
    inner = s;
  } else if (kind === "nodes") {
    const pts = [[.2,.25],[.5,.18],[.78,.3],[.35,.55],[.68,.62],[.5,.82],[.15,.75],[.85,.7]];
    let e = "", n = "";
    const link = [[0,1],[1,2],[0,3],[1,4],[3,4],[3,6],[4,5],[5,6],[2,7],[4,7]];
    link.forEach(([a,b]) => {
      e += `<line x1="${pts[a][0]*w}" y1="${pts[a][1]*h}" x2="${pts[b][0]*w}" y2="${pts[b][1]*h}" stroke="${L}" stroke-width="1"/>`;
    });
    pts.forEach((p, i) => {
      const r = i % 3 === 0 ? 7 : 4;
      n += `<circle cx="${p[0]*w}" cy="${p[1]*h}" r="${r}" fill="${i === 1 ? A : I}"/>`;
    });
    inner = e + n;
  } else if (kind === "columns") {
    let s = "";
    const cols = 6;
    for (let i = 0; i < cols; i++) {
      const x = (w / (cols + 1)) * (i + 1);
      const hh = h * (0.35 + (i % 3) * 0.2);
      s += `<line x1="${x}" y1="${h}" x2="${x}" y2="${h - hh}" stroke="${i === 2 ? A : L}" stroke-width="${i === 2 ? 2 : 1}"/>`;
      s += `<circle cx="${x}" cy="${h - hh}" r="3.5" fill="${i === 2 ? A : I}"/>`;
    }
    s += `<line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="${L}" stroke-width="1"/>`;
    inner = s;
  } else if (kind === "grid") {
    let s = "";
    for (let i = 0; i <= 12; i++) s += `<line x1="${(w/12)*i}" y1="0" x2="${(w/12)*i}" y2="${h}" stroke="${L}" stroke-width=".8"/>`;
    for (let i = 0; i <= 9; i++) s += `<line x1="0" y1="${(h/9)*i}" x2="${w}" y2="${(h/9)*i}" stroke="${L}" stroke-width=".8"/>`;
    s += `<rect x="${(w/12)*4}" y="${(h/9)*3}" width="${(w/12)*3}" height="${(h/9)*2}" fill="none" stroke="${A}" stroke-width="1.5"/>`;
    s += `<circle cx="${(w/12)*4}" cy="${(h/9)*3}" r="4" fill="${A}"/>`;
    inner = s;
  } else if (kind === "contour") {
    let s = "";
    for (let k = 0; k < 8; k++) {
      let d = `M 0 ${h*0.2 + k*30}`;
      for (let x = 0; x <= w; x += 40) {
        const y = h * 0.2 + k * 30 + Math.sin((x / w) * Math.PI * 2 + k * 0.5) * (30 + k * 6);
        d += ` L ${x} ${y.toFixed(1)}`;
      }
      s += `<path d="${d}" fill="none" stroke="${k === 3 ? A : L}" stroke-width="${k === 3 ? 1.5 : 1}"/>`;
    }
    inner = s;
  }

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Ilustración editorial" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

/* ============================================================
   Shared partials
   ============================================================ */
const ARROW = '<svg class="arw" width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true"><path d="M12 1l5 5-5 5M17 6H0" stroke="currentColor" stroke-width="1.3"/></svg>';

const FAVICON = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#14181e'/><text x='50' y='72' font-family='Georgia,serif' font-size='64' fill='#fff' text-anchor='middle'>R</text><rect x='30' y='82' width='40' height='3' fill='#4e5836'/></svg>`
);

function head(page) {
  const b = page.base;
  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.desc}">
<meta name="theme-color" content="#14181e">
<meta property="og:type" content="website">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.desc}">
<meta property="og:locale" content="es_AR">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Inter:wght@400;450;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${b}assets/css/style.css">
</head>`;
}

function header(page) {
  const b = page.base;
  const onDark = page.headerDark ? " on-dark" : "";
  const links = NAV.map(n => {
    const active = n.key === page.key ? " is-active" : "";
    return `<a href="${b}${n.href}" class="nav-link${active}">${n.label}</a>`;
  }).join("\n        ");
  return `
<header class="site-header${onDark}">
  <div class="container site-header__inner">
    <a href="${b}index.html" class="brand" aria-label="${FIRM.name} ${FIRM.sub} — inicio">
      <span class="brand__name">${FIRM.name}</span>
      <span class="brand__bar">|</span>
      <span class="brand__sub">${FIRM.sub}</span>
    </a>
    <nav class="nav" aria-label="Principal">
        ${links}
        <span class="nav__cta"><a href="${b}contacto.html">Conversemos</a></span>
    </nav>
    <button class="nav-toggle" aria-label="Abrir menú" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
</header>`;
}

function footer(page) {
  const b = page.base;
  const areaLinks = PRACTICES.slice(0, 5).map(p =>
    `<li><a href="${b}areas/${p.slug}.html">${p.title}</a></li>`).join("\n          ");
  return `
<footer class="site-footer">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <span class="brand"><span class="brand__name">${FIRM.name}</span><span class="brand__bar">|</span><span class="brand__sub" style="color:#8d9196">${FIRM.sub}</span></span>
        <p>Estudio jurídico boutique. Derecho empresarial, tecnología y planificación patrimonial, con criterio de negocio.</p>
      </div>
      <div class="footer-col">
        <h5>Áreas</h5>
        <ul>
          ${areaLinks}
          <li><a href="${b}areas/index.html">Ver todas</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h5>Contacto</h5>
        <ul>
          <li><a href="https://wa.me/${FIRM.waNumber}" target="_blank" rel="noopener">WhatsApp</a></li>
          <li><a href="tel:${FIRM.phone.replace(/\s/g,"")}">${FIRM.phone}</a></li>
          <li><a href="mailto:${FIRM.email}">${FIRM.email}</a></li>
          <li><a href="${FIRM.linkedin}" target="_blank" rel="noopener">LinkedIn</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <small>© <span data-year>2026</span> ${FIRM.name} ${FIRM.sub}. ${FIRM.city}.</small>
      <div class="footer-social">
        <a href="${FIRM.linkedin}" target="_blank" rel="noopener">LinkedIn ↗</a>
      </div>
    </div>
  </div>
</footer>
<script src="${b}assets/js/main.js" defer></script>
</body>
</html>`;
}

function page(opts) {
  return head(opts) + "\n<body>\n" + header(opts) + "\n<main id=\"main\">\n" + opts.body + "\n</main>\n" + footer(opts);
}

/* ---- Reusable content blocks ---- */
function ctaBand(base, tint) {
  return `
<section class="section ${tint ? "section--tint" : ""}">
  <div class="container cta-band reveal">
    <p class="eyebrow" style="justify-content:center">Conversemos</p>
    <h2 class="h-lg">¿Tenés una decisión por delante? Empecemos por entenderla.</h2>
    <a href="${base}contacto.html" class="btn btn--solid">Agendar una conversación ${ARROW}</a>
  </div>
</section>`;
}

/* ============================================================
   HOME
   ============================================================ */
function homeBody() {
  const b = "";
  const empresas = PRACTICES.filter(p => p.axis === "empresas");
  const family = PRACTICES.filter(p => p.axis === "family");

  const card = (p, i) => `
      <a class="card reveal" data-d="${(i % 3) + 1}" href="${b}areas/${p.slug}.html">
        <span class="card__no">${p.no} / Práctica</span>
        <h3 class="card__title">${p.title}</h3>
        <p class="card__desc">${p.short}</p>
        <span class="card__foot"><span class="link-arrow" style="pointer-events:none">Ver práctica ${ARROW}</span></span>
      </a>`;

  const feature = PUBS[0];
  const rest = PUBS.slice(1, 4);

  return `
<section class="hero" >
  <div class="container hero__inner">
    <div>
      <p class="eyebrow reveal">Estudio jurídico boutique · ${FIRM.city.split(",")[0]}</p>
      <h1 class="display hero__title reveal" data-d="1">Decisiones complejas.<br><span class="line2">Criterio claro.</span></h1>
      <p class="lead hero__sub reveal" data-d="2">Acompañamos a empresas, fundadores e inversores —y a las familias que construyen patrimonio— en las decisiones jurídicas que definen su crecimiento y protegen su valor.</p>
      <div class="hero__actions reveal" data-d="3">
        <a href="${b}areas/index.html" class="btn btn--solid">Áreas de práctica ${ARROW}</a>
        <a href="${b}quienes-somos.html" class="link-arrow">Cómo trabajamos ${ARROW}</a>
      </div>
      <div class="hero__meta reveal" data-d="4">
        <div><b>Dos ejes</b><span>Empresas &amp; tecnología · Family office</span></div>
        <div><b>Criterio</b><span>Profundidad jurídica con lógica de negocio</span></div>
      </div>
    </div>
    <div class="hero__figure reveal" data-d="2">
      <div class="figure-art">${art("arch", { tall: true })}</div>
    </div>
  </div>
</section>

<section class="section" id="areas">
  <div class="container">
    <div class="axis-head reveal">
      <div>
        <p class="eyebrow">${AXES.empresas.eyebrow}</p>
        <h2 class="h-md">${AXES.empresas.title}</h2>
        <p>${AXES.empresas.intro}</p>
      </div>
      <a href="${b}areas/index.html" class="link-arrow">Todas las áreas ${ARROW}</a>
    </div>
    <div class="cards">
      ${empresas.map(card).join("")}
    </div>

    <div class="axis-head reveal" style="margin-top:var(--section-y)">
      <div>
        <p class="eyebrow">${AXES.family.eyebrow}</p>
        <h2 class="h-md">${AXES.family.title}</h2>
        <p>${AXES.family.intro}</p>
      </div>
    </div>
    <div class="cards cards--2">
      ${family.map(card).join("")}
      <div class="card" style="background:var(--paper-2)">
        <span class="card__no">— / Enfoque</span>
        <h3 class="card__title">Patrimonio, familia y empresa, en un mismo plan</h3>
        <p class="card__desc">La planificación patrimonial, las sucesiones y el derecho de familia se trabajan juntos: decisiones de largo plazo que se piensan en calma, no en el conflicto.</p>
        <span class="card__foot"><a class="link-arrow" href="${b}areas/sucesiones-planificacion-patrimonial.html">Conocer el enfoque ${ARROW}</a></span>
      </div>
    </div>
  </div>
</section>

<section class="section section--dark">
  <div class="container split">
    <div class="statement reveal">
      <p class="eyebrow">El enfoque</p>
      <p class="pull">El derecho como <em>herramienta</em> para construir organizaciones sólidas y acompañar decisiones complejas.</p>
    </div>
    <div class="reveal" data-d="1">
      <div class="enfoque-list">
        <div class="enfoque-item"><span class="enfoque-item__n">01</span><div><h3>Entendemos el negocio, no solo el expediente</h3><p>Antes de redactar, preguntamos qué está en juego. El asesoramiento parte de los objetivos comerciales y patrimoniales, no de un formulario.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">02</span><div><h3>Anticipamos en lugar de reaccionar</h3><p>Estructuramos hoy lo que evita el conflicto de mañana: acuerdos claros, decisiones documentadas y riesgos repartidos con criterio.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">03</span><div><h3>Claridad por sobre la formalidad</h3><p>Explicamos en términos de decisiones, no de tecnicismos. Un cliente que entiende sus opciones decide mejor.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">04</span><div><h3>Cerca, con dedicación de socio</h3><p>Al ser un estudio boutique, quien piensa el caso es quien lo lleva. Trato directo, tiempos reales y foco en el resultado.</p></div></div>
      </div>
      <div style="margin-top:38px"><a href="${b}quienes-somos.html" class="btn btn--light">Quiénes somos ${ARROW}</a></div>
    </div>
  </div>
</section>

<section class="section section--tint">
  <div class="container">
    <div class="axis-head reveal">
      <div>
        <p class="eyebrow">Publicaciones</p>
        <h2 class="h-md">Ideas sobre derecho, negocios y patrimonio</h2>
      </div>
      <a href="${b}publicaciones.html" class="link-arrow">Todas las publicaciones ${ARROW}</a>
    </div>
    <div class="pub-grid">
      <a class="pub-feature reveal" href="${b}publicaciones.html">
        <div class="figure-frame ratio-3x2">${art(feature.art, { wide: true })}</div>
        <p class="pub__meta">${feature.kicker} · ${feature.date}</p>
        <h3 class="pub__title">${feature.title}</h3>
        <p class="pub__excerpt">${feature.excerpt}</p>
        <span class="pub__read"><span class="link-arrow" style="pointer-events:none">Leer ${ARROW}</span></span>
      </a>
      <div class="pub-list reveal" data-d="1">
        ${rest.map(p => `
        <a class="pub-item" href="${b}publicaciones.html">
          <span class="pub__meta">${p.kicker} · ${p.date}</span>
          <h3 class="pub__title">${p.title}</h3>
          <p class="pub__excerpt">${p.excerpt}</p>
        </a>`).join("")}
      </div>
    </div>
  </div>
</section>

${ctaBand(b, false)}`;
}

/* ============================================================
   ÁREAS — index
   ============================================================ */
function areasIndexBody() {
  const b = "../";
  const block = (axisKey) => {
    const ax = AXES[axisKey];
    const list = PRACTICES.filter(p => p.axis === axisKey);
    return `
    <div class="axis-head reveal" ${axisKey === "family" ? 'style="margin-top:var(--section-y)"' : ""}>
      <div>
        <p class="eyebrow">${ax.eyebrow}</p>
        <h2 class="h-md">${ax.title}</h2>
        <p>${ax.intro}</p>
      </div>
    </div>
    <div class="cards ${list.length === 1 ? "cards--2" : ""}">
      ${list.map((p, i) => `
      <a class="card reveal" data-d="${(i % 3) + 1}" href="${b}areas/${p.slug}.html">
        <span class="card__no">${p.no} / Práctica</span>
        <h3 class="card__title">${p.title}</h3>
        <p class="card__desc">${p.short}</p>
        <span class="card__foot"><span class="link-arrow" style="pointer-events:none">Ver práctica ${ARROW}</span></span>
      </a>`).join("")}
      ${list.length === 1 ? `<div class="card" style="background:var(--paper-2)"><span class="card__no">— / Alcance</span><h3 class="card__title">Planificación, sucesiones y familia</h3><p class="card__desc">La práctica de family office integra la planificación patrimonial, los procesos sucesorios y el derecho de familia en una misma estrategia de largo plazo.</p></div>` : ""}
    </div>`;
  };

  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Áreas de práctica</span></nav>
    <h1 class="h-lg page-hero__title reveal">Áreas de práctica</h1>
    <p class="lead page-hero__intro reveal" data-d="1">Trabajamos sobre dos ejes. En cada uno, el derecho es un medio: construir y proteger organizaciones, y ordenar y preservar patrimonios.</p>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="container">
    ${block("empresas")}
    ${block("family")}
  </div>
</section>
${ctaBand(b, true)}`;
}

/* ============================================================
   ÁREAS — detail
   ============================================================ */
function practiceBody(p) {
  const b = "../";
  const ax = AXES[p.axis];
  const others = PRACTICES.filter(x => x.axis === p.axis);
  const bodyHtml = p.body.map(s => `<h3>${s.h}</h3><p>${s.p}</p>`).join("\n        ");
  const checks = p.checklist.map(c => `<li>${c}</li>`).join("\n          ");
  const aside = others.map(o =>
    `<li><a href="${b}areas/${o.slug}.html" class="${o.slug === p.slug ? "is-current" : ""}">${o.title} <span aria-hidden="true">↗</span></a></li>`
  ).join("\n        ");

  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><a href="${b}areas/index.html">Áreas</a><span>/</span><span>${p.title}</span></nav>
    <p class="eyebrow reveal">${ax.title}</p>
    <h1 class="h-lg page-hero__title reveal" data-d="1">${p.title}</h1>
    <p class="lead page-hero__intro reveal" data-d="2">${p.intro}</p>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container">
    <div class="figure-frame ratio-3x2 reveal" style="margin-bottom:var(--section-y)">${art(p.art, { wide: true })}</div>
    <div class="detail-layout">
      <div class="prose reveal">
        ${bodyHtml}
        <h3>Cómo podemos ayudar</h3>
        <ul class="checklist">
          ${checks}
        </ul>
      </div>
      <aside class="reveal" data-d="1">
        <div class="aside-card">
          <h4>Más en ${ax.title}</h4>
          <ul>
        ${aside}
          </ul>
          <div style="margin-top:26px"><a href="${b}contacto.html" class="link-arrow">Consultar ${ARROW}</a></div>
        </div>
      </aside>
    </div>
  </div>
</section>
${ctaBand(b, true)}`;
}

/* ============================================================
   QUIÉNES SOMOS
   ============================================================ */
function nosotrosBody() {
  const b = "";
  return `
<section class="page-hero">
  <div class="container container--narrow" style="margin-inline:0;max-width:none">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Quiénes somos</span></nav>
    <p class="eyebrow reveal">Cómo trabajamos</p>
    <h1 class="display reveal" data-d="1" style="max-width:16ch;font-size:clamp(2.2rem,5vw,3.8rem)">Primero la manera de trabajar. Después, el estudio.</h1>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container split">
    <div class="reveal">
      <p class="pull">Entendemos el derecho como una <em>herramienta</em>: sirve para construir organizaciones sólidas y para acompañar decisiones complejas.</p>
    </div>
    <div class="reveal" data-d="1">
      <p class="lead">No creemos en el asesoramiento que empieza por el artículo del código. Empieza por la pregunta correcta: qué quiere lograr una empresa, qué quiere proteger una familia, qué está realmente en juego en una decisión.</p>
      <p style="margin-top:20px;color:var(--muted)">Desde ahí, el derecho aparece donde tiene que aparecer —para dar estructura, repartir riesgos y sostener lo que se construye—, sin ruido ni tecnicismos innecesarios. Somos un estudio boutique por decisión: pocos asuntos, atención de socio y foco en el resultado.</p>
    </div>
  </div>
</section>

<section class="section section--tint">
  <div class="container">
    <p class="eyebrow reveal">Principios</p>
    <div class="enfoque-list reveal" data-d="1" style="margin-top:20px">
      <div class="enfoque-item"><span class="enfoque-item__n">01</span><div><h3>Criterio de negocio</h3><p>Combinamos profundidad jurídica con comprensión real de cómo funcionan las empresas y los patrimonios. El consejo legal se mide por la decisión que habilita.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">02</span><div><h3>Anticipación</h3><p>Preferimos ordenar antes que reparar. La estructura correcta, el acuerdo bien redactado y la decisión documentada evitan la mayoría de los conflictos.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">03</span><div><h3>Claridad</h3><p>Explicamos en términos de opciones y consecuencias. Un cliente que entiende el terreno decide mejor y más rápido.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">04</span><div><h3>Discreción</h3><p>Trabajamos con información sensible de empresas y familias. La confidencialidad y el trato reservado son parte del servicio, no un agregado.</p></div></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="axis-head reveal">
      <div>
        <p class="eyebrow">Equipo</p>
        <h2 class="h-md">Quienes piensan cada caso</h2>
        <p>Un equipo reducido de socios con experiencia en empresas, tecnología y patrimonio.</p>
      </div>
      <a href="${b}equipo.html" class="link-arrow">Conocer al equipo ${ARROW}</a>
    </div>
    <div class="team-grid">
      ${TEAM.map((m, i) => `
      <div class="member reveal" data-d="${i + 1}">
        <div class="member__photo">${art(m.art, { tall: true })}</div>
        <h3 class="member__name">${m.name}</h3>
        <p class="member__role">${m.role}</p>
      </div>`).join("")}
    </div>
  </div>
</section>
${ctaBand(b, true)}`;
}

/* ============================================================
   EQUIPO
   ============================================================ */
function equipoBody() {
  const b = "";
  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Equipo</span></nav>
    <h1 class="h-lg page-hero__title reveal">Equipo</h1>
    <p class="lead page-hero__intro reveal" data-d="1">Un estudio boutique es su gente. Estos son los socios que piensan y llevan cada asunto, con experiencia, formación y foco en su área de especialización.</p>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container">
    <div class="team-grid">
      ${TEAM.map((m, i) => `
      <article class="member reveal" data-d="${i + 1}">
        <div class="member__photo">${art(m.art, { tall: true })}</div>
        <h2 class="member__name">${m.name}</h2>
        <p class="member__role">${m.role}</p>
        <p class="member__bio">${m.bio}</p>
        <div class="member__tags">${m.tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>
      </article>`).join("")}
    </div>
    <p class="figure-caption reveal" style="margin-top:40px;max-width:60ch">Retratos en blanco y negro — espacio reservado para las fotografías definitivas del equipo. Reemplazar las ilustraciones por retratos con tratamiento sobrio y uniforme.</p>
  </div>
</section>

<section class="section section--dark">
  <div class="container cta-band reveal">
    <p class="eyebrow" style="justify-content:center">Sumate</p>
    <h2 class="h-lg">Espacio para tres socios. Uno todavía por presentarse.</h2>
    <p class="lead" style="margin:22px auto 0;max-width:52ch;color:#a7abb1">El equipo está pensado para crecer con perfiles que combinen rigor jurídico y comprensión de los negocios.</p>
    <a href="${b}contacto.html" class="btn btn--light" style="margin-top:36px">Escribinos ${ARROW}</a>
  </div>
</section>`;
}

/* ============================================================
   PUBLICACIONES
   ============================================================ */
function publicacionesBody() {
  const b = "";
  const feature = PUBS[0];
  const rest = PUBS.slice(1);
  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Publicaciones</span></nav>
    <h1 class="h-lg page-hero__title reveal">Publicaciones</h1>
    <p class="lead page-hero__intro reveal" data-d="1">Notas sobre derecho, negocios y patrimonio. Ideas para decidir mejor —escritas para founders, directores, inversores y familias, no para abogados.</p>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container">
    <a class="pub-feature pub-hero reveal" href="#">
      <div class="figure-frame ratio-3x2">${art(feature.art, { wide: true })}</div>
      <div>
        <p class="pub__meta">${feature.kicker} · ${feature.date} · Destacado</p>
        <h2 class="pub__title" style="font-size:clamp(1.8rem,3vw,2.6rem)">${feature.title}</h2>
        <p class="pub__excerpt" style="font-size:16px">${feature.excerpt}</p>
        <span class="pub__read"><span class="link-arrow" style="pointer-events:none">Leer ${ARROW}</span></span>
      </div>
    </a>

    <div class="cards">
      ${rest.map((p, i) => `
      <a class="card reveal" data-d="${(i % 3) + 1}" href="#">
        <span class="card__no">${p.kicker} · ${p.date}</span>
        <h3 class="card__title" style="font-size:1.4rem">${p.title}</h3>
        <p class="card__desc">${p.excerpt}</p>
        <span class="card__foot"><span class="link-arrow" style="pointer-events:none">Leer ${ARROW}</span></span>
      </a>`).join("")}
    </div>
    <p class="figure-caption reveal" style="margin-top:40px">Contenido editorial de muestra — reemplazar por los artículos definitivos del estudio.</p>
  </div>
</section>
${ctaBand(b, true)}`;
}

/* ============================================================
   CONTACTO
   ============================================================ */
function contactoBody() {
  const b = "";
  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Contacto</span></nav>
    <h1 class="h-lg page-hero__title reveal">Conversemos sobre tu decisión</h1>
    <p class="lead page-hero__intro reveal" data-d="1">Contanos brevemente qué tenés por delante. Respondemos con una primera lectura y los próximos pasos.</p>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container contact-grid">
    <div class="reveal">
      <div class="contact-block">
        <h4>WhatsApp</h4>
        <a class="wa-btn" href="https://wa.me/${FIRM.waNumber}" target="_blank" rel="noopener">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15l-1.3 4.6 4.7-1.2A10 10 0 1012 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.5-1.2-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.6-.1 1.2z"/></svg>
          Escribir por WhatsApp
        </a>
        <p class="muted" style="margin-top:14px;font-size:14px">La vía más rápida para una primera consulta.</p>
      </div>
      <div class="contact-block">
        <h4>Celular</h4>
        <a class="big" href="tel:${FIRM.phone.replace(/\s/g,"")}">${FIRM.phone}</a>
      </div>
      <div class="contact-block">
        <h4>Email</h4>
        <a class="big" href="mailto:${FIRM.email}">${FIRM.email}</a>
      </div>
      <div class="contact-block">
        <h4>Estudio</h4>
        <p class="big">${FIRM.address}</p>
        <p class="muted" style="margin-top:6px">${FIRM.city} · <a href="${FIRM.linkedin}" target="_blank" rel="noopener" style="color:var(--accent)">LinkedIn ↗</a></p>
      </div>
    </div>

    <div class="reveal" data-d="1">
      <form class="form-row" onsubmit="event.preventDefault(); this.querySelector('.form-status').hidden=false;">
        <div class="field">
          <label for="nombre">Nombre</label>
          <input id="nombre" name="nombre" type="text" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="tema">Tema</label>
          <select id="tema" name="tema">
            <option>Empresas · societario / contratos</option>
            <option>Startups / inversión</option>
            <option>Tecnología e inteligencia artificial</option>
            <option>Propiedad intelectual</option>
            <option>Resolución de conflictos</option>
            <option>Family office · patrimonio / sucesiones / familia</option>
          </select>
        </div>
        <div class="field">
          <label for="mensaje">Contanos brevemente</label>
          <textarea id="mensaje" name="mensaje" rows="4"></textarea>
        </div>
        <div>
          <button type="submit" class="btn btn--solid">Enviar consulta ${ARROW}</button>
          <p class="form-status muted" hidden style="margin-top:16px;color:var(--accent)">Gracias. Este formulario es de demostración — conectar a un endpoint o email para producción.</p>
        </div>
      </form>
    </div>
  </div>
</section>`;
}

/* ============================================================
   Build
   ============================================================ */
const pages = [
  { file: "index.html", base: "", key: "home", title: `${FIRM.name} ${FIRM.sub} — Estudio jurídico boutique`, desc: "Estudio jurídico boutique en Buenos Aires. Derecho empresarial, startups, tecnología e inteligencia artificial, y family office: patrimonio, sucesiones y familia.", headerDark: false, body: homeBody() },
  { file: "areas/index.html", base: "../", key: "areas", title: `Áreas de práctica — ${FIRM.name} ${FIRM.sub}`, desc: "Áreas de práctica en dos ejes: empresas, startups y tecnología; y family office. Societario, contratos, propiedad intelectual, IA, conflictos y planificación patrimonial.", body: areasIndexBody() },
  { file: "quienes-somos.html", base: "", key: "nosotros", title: `Quiénes somos — ${FIRM.name} ${FIRM.sub}`, desc: "Nuestra manera de trabajar: el derecho como herramienta para construir organizaciones sólidas y acompañar decisiones complejas.", body: nosotrosBody() },
  { file: "equipo.html", base: "", key: "equipo", title: `Equipo — ${FIRM.name} ${FIRM.sub}`, desc: "Los socios del estudio: experiencia en empresas, tecnología y planificación patrimonial.", body: equipoBody() },
  { file: "publicaciones.html", base: "", key: "pub", title: `Publicaciones — ${FIRM.name} ${FIRM.sub}`, desc: "Ideas sobre derecho, negocios y patrimonio. Escritas para founders, directores, inversores y familias.", body: publicacionesBody() },
  { file: "contacto.html", base: "", key: "contacto", title: `Contacto — ${FIRM.name} ${FIRM.sub}`, desc: "Conversemos sobre tu decisión. WhatsApp, celular y email.", body: contactoBody() },
];

PRACTICES.forEach(p => {
  pages.push({
    file: `areas/${p.slug}.html`, base: "../", key: "areas",
    title: `${p.title} — ${FIRM.name} ${FIRM.sub}`,
    desc: p.short,
    body: practiceBody(p),
  });
});

let count = 0;
pages.forEach(pg => {
  const outPath = path.join(OUT, pg.file);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, page(pg));
  count++;
  console.log("  ✓", pg.file);
});
console.log(`\nBuilt ${count} pages into ${OUT}`);
