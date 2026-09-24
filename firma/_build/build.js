/* ============================================================
   WTR | abogados — static site generator
   Zero dependencies. Emits plain HTML into /firma.
   Run:  node firma/_build/build.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..");

/* ---- Firm data (edit these to update the whole site) ---- */
const FIRM = {
  name: "WTR",
  sub: "abogados",
  claim: "Derecho para decisiones que importan.",
  city: "Buenos Aires, Argentina",
  address: "Av. del Libertador 0000, Piso 00 — CABA", // placeholder
  email: "estudio@wtrabogados.com.ar",                 // placeholder — confirmar dominio
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
    title: "Negocios que nacen y se reinventan",
    intro: "Acompañamos a empresas y fundadores en toda la vida del negocio: cómo se arma, cómo contrata, cómo protege lo que crea y cómo resuelve lo que se complica. Derecho pensado desde el negocio.",
  },
  family: {
    eyebrow: "Eje 02",
    title: "Patrimonio, familia y sucesión",
    intro: "Detrás de cada negocio hay una persona y una familia. Ordenamos el patrimonio, la sucesión y las cuestiones de familia antes de que se vuelvan urgentes, con una mirada de largo plazo.",
  },
};

const PRACTICES = [
  {
    slug: "derecho-societario", no: "01", axis: "empresas", art: "arch",
    title: "Derecho societario",
    short: "Armar la sociedad, ordenar el gobierno de la empresa, acordar entre socios y reorganizar cuando hace falta. La estructura sobre la que se apoya todo lo demás.",
    intro: "La forma de tu sociedad no es un trámite: define quién decide, cómo se reparte lo que se genera y qué pasa cuando los socios dejan de estar de acuerdo. Diseñamos y ordenamos esa estructura para que acompañe el crecimiento y anticipe el conflicto.",
    body: [
      { h: "La estructura es una decisión, no un formulario", p: "Elegir el tipo de sociedad, repartir la participación y fijar las reglas de decisión condiciona a la empresa durante años. Trabajamos sobre el diseño para que la estructura te sirva, no que te limite." },
      { h: "Acordar entre socios, a tiempo", p: "La mayoría de los conflictos entre socios no nacen de la ley, sino de lo que nunca se puso por escrito. Definimos por adelantado cómo se toman las decisiones, cómo entra y sale un socio y cómo se valúa su parte." },
    ],
    checklist: [
      "Constitución de la sociedad y elección de estructura (SAS, SRL, SA)",
      "Acuerdo de socios y estatutos",
      "Gobierno de la empresa: directorio y toma de decisiones",
      "Aumentos de capital y aportes",
      "Fusiones, escisiones y reorganizaciones",
      "Revisión societaria y puesta en orden",
    ],
  },
  {
    slug: "contratos-comerciales", no: "02", axis: "empresas", art: "strata",
    title: "Contratos comerciales",
    short: "Los acuerdos que sostienen el día a día del negocio: clientes, proveedores, distribución, alianzas y financiamiento.",
    intro: "Un buen contrato reparte los riesgos con claridad y evita que cada relación dependa de la buena voluntad. Redactamos y negociamos los acuerdos que ordenan tus ingresos, tus obligaciones y tus responsabilidades.",
    body: [
      { h: "Contratos que piensan en el día que algo sale distinto", p: "Nos enfocamos en las cláusulas que importan cuando algo no sale como estaba previsto: precio, plazos, incumplimiento, límites de responsabilidad y salida. La idea es que el contrato juegue a favor del negocio, no en contra." },
      { h: "Negociar con criterio comercial", p: "Entendemos qué está realmente en juego en cada operación y dónde conviene ceder y dónde no. Traducimos tus objetivos a términos precisos, sin fricción de más." },
    ],
    checklist: [
      "Distribución, agencia, franquicia y representación",
      "Prestación de servicios y acuerdos con proveedores",
      "Contratos de software, licencias y términos de uso",
      "Alianzas y acuerdos de colaboración",
      "Confidencialidad y cartas de intención",
      "Financiamiento, préstamos y garantías",
    ],
  },
  {
    slug: "propiedad-intelectual", no: "03", axis: "empresas", art: "nodes",
    title: "Propiedad intelectual",
    short: "Marca, software, contenidos y todo el valor que no aparece en el balance: identificarlo, protegerlo y dejar en claro de quién es.",
    intro: "Hoy buena parte del valor de una empresa es intangible: la marca, el código, los datos, la reputación. Ayudamos a identificar esos activos, protegerlos donde corresponde y dejar en claro de quién son.",
    body: [
      { h: "Proteger antes de crecer", p: "Ordenar la marca o dejar en claro de quién es el software cuesta menos y es más simple antes de crecer que después de un conflicto. Definimos una estrategia de protección acorde al momento y al plan de la empresa." },
      { h: "De quién es lo que se crea", p: "Fundadores, empleados y proveedores generan valor intelectual todos los días. Ordenamos las cesiones y licencias para que la empresa sea, sin dudas, dueña de lo que produce." },
    ],
    checklist: [
      "Estrategia de protección de la marca",
      "Derechos sobre el software y los contenidos",
      "Titularidad: cesiones de empleados y proveedores",
      "Licencias y transferencia de tecnología",
      "Contratos de propiedad intelectual",
      "Conflictos de marca y uso indebido",
    ],
  },
  {
    slug: "startups", no: "04", axis: "empresas", art: "columns",
    title: "Startups",
    short: "Para el negocio que arranca: armar la sociedad, repartir la propiedad entre quienes fundan, sumar socios o empleados con parte de la empresa y estar listos cuando llega un inversor.",
    intro: "Acompañamos a quienes están creando un negocio en las decisiones que después son difíciles de revertir: cómo se reparte la propiedad de la empresa, cómo se suman los primeros socios y cómo se ordena todo para cuando entre un inversor.",
    body: [
      { h: "Repartir la propiedad, temprano y bien", p: "Cómo se divide la empresa entre quienes la fundan —y cuánto se reserva para futuros socios o empleados clave— es una de las decisiones más difíciles de deshacer. La ordenamos desde el principio, con reglas claras de permanencia y de salida." },
      { h: "Listos para cuando entre un inversor", p: "Cuando aparece un inversor, revisa la empresa entera. Dejamos en orden la sociedad, la propiedad intelectual y los contratos para que ese proceso confirme el valor del negocio, en lugar de complicarlo." },
    ],
    checklist: [
      "Armado de la sociedad y acuerdo entre fundadores",
      "Reparto de la propiedad y participación para socios o empleados clave",
      "Ingreso de inversores y acuerdos de inversión",
      "Lectura y negociación de las condiciones que propone el inversor",
      "Puesta en orden legal antes de buscar inversión",
      "Estructura para crecer en otros países",
    ],
  },
  {
    slug: "tecnologia-ia", no: "05", axis: "empresas", art: "grid",
    title: "Tecnología e inteligencia artificial",
    short: "Datos personales, uso responsable de inteligencia artificial, responsabilidad y contratos de tecnología, en un marco que todavía se está escribiendo.",
    intro: "La tecnología avanza más rápido que las reglas. Acompañamos a empresas que desarrollan o incorporan inteligencia artificial y productos digitales a moverse con criterio: cumpliendo lo que ya existe y anticipando lo que viene.",
    body: [
      { h: "Datos e inteligencia artificial con reglas claras", p: "Definimos cómo se juntan, se usan y se protegen los datos, y qué controles necesita un sistema de inteligencia artificial para funcionar con responsabilidad. Menos declaración de principios, más decisiones concretas." },
      { h: "¿Quién responde cuando algo falla?", p: "Cuando un sistema se equivoca, la pregunta es quién responde. Lo dejamos definido en los contratos de desarrollo, integración y uso de inteligencia artificial, y en las condiciones con tus usuarios y clientes." },
    ],
    checklist: [
      "Protección de datos personales y privacidad",
      "Uso responsable de inteligencia artificial y políticas internas",
      "Contratos de desarrollo e integración de software",
      "Términos de uso, licencias y responsabilidad",
      "Propiedad intelectual sobre modelos y datos",
      "Riesgo regulatorio y cumplimiento",
    ],
  },
  {
    slug: "resolucion-de-conflictos", no: "06", axis: "empresas", art: "contour",
    title: "Resolución de conflictos",
    short: "Negociación, mediación, arbitraje y, cuando hace falta, juicio. Resolver el conflicto cuidando el valor, el tiempo y las relaciones.",
    intro: "Cuando un conflicto es inevitable, la estrategia importa tanto como el derecho. Miramos con frialdad qué está en juego y elegimos el camino —acuerdo, arbitraje o juicio— que mejor protege tus intereses.",
    body: [
      { h: "Antes de litigar, buscamos la mejor salida", p: "No todo conflicto se resuelve en tribunales. Analizamos costos, plazos y probabilidades antes de recomendar un camino, y muchas veces la mejor salida es un buen acuerdo." },
      { h: "Cuando hay que litigar, con estrategia", p: "Si hay que ir a juicio, vamos preparados y con foco. Representamos a empresas y personas en conflictos societarios, comerciales, patrimoniales y de familia, con la mirada puesta en el resultado." },
    ],
    checklist: [
      "Negociación y mediación previa",
      "Conflictos entre socios",
      "Disputas comerciales y contractuales",
      "Arbitraje nacional e institucional",
      "Juicios civiles y comerciales",
      "Conflictos de sucesión y de familia",
    ],
  },
  {
    slug: "sucesiones-planificacion-patrimonial", no: "07", axis: "family", art: "strata",
    title: "Sucesiones y planificación patrimonial",
    short: "Ordenar el patrimonio, la sucesión y las cuestiones de familia con tiempo, para proteger lo construido y a los que vienen.",
    intro: "Detrás de cada negocio hay una persona y una familia. Ayudamos a ordenar hoy —con calma y reserva— lo que de otro modo se termina resolviendo en el peor momento: el patrimonio, la sucesión y la familia.",
    body: [
      { h: "Planificar con tiempo, no en la urgencia", p: "Planificar es la diferencia entre decidir con criterio y dejar que la ley y los tiempos judiciales decidan por tu familia. Ordenamos cómo se transmiten los bienes, la empresa y las participaciones, cuidando los impuestos y la continuidad." },
      { h: "La empresa de familia", p: "Cuando el patrimonio incluye una empresa, ordenar la relación entre familia, propiedad y gestión es clave para que llegue bien a la próxima generación. Armamos las reglas que separan lo familiar de lo societario." },
      { h: "Sucesión y familia", p: "Acompañamos sucesiones y cuestiones de familia —régimen patrimonial, acuerdos y conflictos— con discreción, cuidando tanto el patrimonio como los vínculos." },
    ],
    checklist: [
      "Planificación del patrimonio y la sucesión",
      "Testamentos y formas de transmisión",
      "Reglas para la empresa de familia",
      "Fideicomisos y vehículos patrimoniales",
      "Sucesiones",
      "Régimen patrimonial del matrimonio y acuerdos",
      "Conflictos de familia y de patrimonio",
    ],
  },
];

/* ---- Team (Walter y Tomás son reales; confirmar/ajustar bios y áreas) ---- */
const TEAM = [
  {
    name: "Walter Rodríguez", role: "Socio fundador",
    bio: "Acompaña a empresas y familias en las decisiones de fondo: la estructura de la sociedad, el patrimonio y la sucesión. Trabaja cerca del cliente, como un abogado propio, en relaciones que duran.",
    tags: ["Sociedades", "Patrimonio", "Sucesiones"], art: "arch",
  },
  {
    name: "Tomás Rodríguez", role: "Socio fundador",
    bio: "Trabaja con los negocios que nacen y se reinventan: sociedades, contratos, tecnología e inteligencia artificial. Traduce los objetivos del negocio en decisiones jurídicas concretas.",
    tags: ["Nuevos negocios", "Tecnología e IA", "Contratos"], art: "nodes",
  },
  {
    name: "Un lugar reservado", role: "Socio · por incorporar",
    bio: "Dejamos espacio para un tercer socio que sume una mirada complementaria, con el mismo criterio: rigor técnico y cercanía.",
    tags: ["Espacio reservado"], art: "contour",
  },
];

/* ---- Publications (placeholder editorial content) ---- */
const PUBS = [
  {
    kicker: "Nuevos negocios", date: "Julio 2026",
    title: "Repartir la propiedad de la empresa antes de sumar un socio o un inversor",
    excerpt: "Cómo dividir la empresa entre quienes la fundan, reservar una parte para el equipo y llegar sin sorpresas a la primera inversión.",
    art: "columns",
  },
  {
    kicker: "Tecnología", date: "Junio 2026",
    title: "Usar inteligencia artificial en la empresa: qué decidir antes de largarla",
    excerpt: "Datos, responsabilidad y controles concretos para incorporar inteligencia artificial sin quedar expuesto.",
    art: "grid",
  },
  {
    kicker: "Familia y patrimonio", date: "Mayo 2026",
    title: "Empresa de familia: ordenarla antes de que sea urgente",
    excerpt: "Separar familia, propiedad y gestión para que la empresa y el patrimonio lleguen bien a la próxima generación.",
    art: "strata",
  },
  {
    kicker: "Sociedades", date: "Abril 2026",
    title: "Acuerdo de socios: lo que conviene poner por escrito cuando todo va bien",
    excerpt: "Cómo se decide, cómo entra y sale un socio y cómo se valúa su parte. Las reglas que evitan el conflicto que todavía no existe.",
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
const WA_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15l-1.3 4.6 4.7-1.2A10 10 0 1012 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.5-1.2-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.6-.1 1.2z"/></svg>';

const FAVICON = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#14181e'/><text x='50' y='66' font-family='Georgia,serif' font-size='40' letter-spacing='1' fill='#fff' text-anchor='middle'>WTR</text><rect x='30' y='78' width='40' height='3' fill='#4e5836'/></svg>`
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
        <p>Derecho y pensamiento estratégico para los negocios que nacen y se reinventan, y las personas y familias que están detrás.</p>
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
      <p class="eyebrow reveal">Estudio jurídico · ${FIRM.city.split(",")[0]}</p>
      <h1 class="display hero__title reveal" data-d="1">Derecho para decisiones<br><span class="line2">que importan.</span></h1>
      <p class="lead hero__sub reveal" data-d="2">Acompañamos a los negocios que nacen y a los que se reinventan, y a las personas y familias que están detrás. Derecho y pensamiento estratégico, con la cercanía de un abogado propio.</p>
      <div class="hero__actions reveal" data-d="3">
        <a href="${b}areas/index.html" class="btn btn--solid">Áreas de práctica ${ARROW}</a>
        <a href="${b}quienes-somos.html" class="link-arrow">Cómo trabajamos ${ARROW}</a>
      </div>
      <div class="hero__meta reveal" data-d="4">
        <div><b>La empresa y la vida</b><span>Acompañamos las dos dimensiones</span></div>
        <div><b>Cerca</b><span>Como un abogado propio, en el largo plazo</span></div>
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
        <h3 class="card__title">La empresa y la vida, en un mismo plan</h3>
        <p class="card__desc">Quien construye un negocio también tiene patrimonio, familia y una sucesión que ordenar. Acompañamos las dos dimensiones, con la misma cabeza y a largo plazo.</p>
        <span class="card__foot"><a class="link-arrow" href="${b}areas/sucesiones-planificacion-patrimonial.html">Conocer el enfoque ${ARROW}</a></span>
      </div>
    </div>
  </div>
</section>

<section class="section section--dark">
  <div class="container split">
    <div class="statement reveal">
      <p class="eyebrow">El enfoque</p>
      <p class="pull">Unimos <em>rigor técnico</em> y cercanía: derecho para las decisiones del negocio y para las de tu vida.</p>
    </div>
    <div class="reveal" data-d="1">
      <div class="enfoque-list">
        <div class="enfoque-item"><span class="enfoque-item__n">01</span><div><h3>Entendemos el negocio, no solo el expediente</h3><p>Antes de redactar, preguntamos qué querés lograr y qué está en juego. Partimos de tus objetivos, no de un formulario.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">02</span><div><h3>Anticipamos en lugar de reaccionar</h3><p>Ordenamos hoy lo que evita el conflicto de mañana: acuerdos claros, decisiones documentadas y riesgos repartidos con criterio.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">03</span><div><h3>Hablamos claro</h3><p>Explicamos en términos de decisiones y consecuencias, sin latín ni tecnicismos. Si entendés tus opciones, decidís mejor.</p></div></div>
        <div class="enfoque-item"><span class="enfoque-item__n">04</span><div><h3>Cerca, como un abogado propio</h3><p>Trabajamos con pocos casos y nos metemos de lleno en cada uno. Quien piensa tu caso es quien lo lleva, en una relación de largo plazo.</p></div></div>
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
      ${list.length === 1 ? `<div class="card" style="background:var(--paper-2)"><span class="card__no">— / Alcance</span><h3 class="card__title">Patrimonio, sucesión y familia</h3><p class="card__desc">Ordenamos el patrimonio, la sucesión y las cuestiones de familia en una misma estrategia de largo plazo, cuidando lo construido y a los que vienen.</p></div>` : ""}
    </div>`;
  };

  return `
<section class="page-hero">
  <div class="container">
    <nav class="breadcrumb reveal"><a href="${b}index.html">Inicio</a><span>/</span><span>Áreas de práctica</span></nav>
    <h1 class="h-lg page-hero__title reveal">Áreas de práctica</h1>
    <p class="lead page-hero__intro reveal" data-d="1">Trabajamos sobre dos ejes que casi siempre van juntos: el negocio, y la persona y la familia que están detrás. Acompañamos las dos dimensiones con la misma cabeza.</p>
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
          <div style="margin-top:26px;display:flex;flex-direction:column;gap:16px;align-items:flex-start">
            <a href="${b}contacto.html" class="link-arrow">Consultar ${ARROW}</a>
            <a class="wa-share" data-wa-share data-wa-msg="Área de ${p.title} · ${FIRM.name} ${FIRM.sub}" href="https://wa.me/" target="_blank" rel="noopener">${WA_ICON} Compartir por WhatsApp</a>
          </div>
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
      <p class="pull">Entendemos el derecho como una <em>herramienta</em>: para construir empresas sólidas y para acompañar las decisiones de tu vida.</p>
    </div>
    <div class="reveal" data-d="1">
      <p class="lead">No arrancamos por el artículo del código. Arrancamos por la pregunta correcta: qué querés lograr con tu empresa, qué querés proteger de tu patrimonio, qué está realmente en juego.</p>
      <p style="margin-top:20px;color:var(--muted)">Desde ahí, el derecho aparece donde tiene que aparecer —para dar estructura, repartir riesgos y sostener lo que construís—, sin ruido ni tecnicismos. Trabajamos con pocos casos y nos metemos de lleno: quien piensa tu caso es quien lo lleva, en una relación de largo plazo.</p>
    </div>
  </div>
</section>

<section class="section section--tint">
  <div class="container">
    <p class="eyebrow reveal">Principios</p>
    <div class="enfoque-list reveal" data-d="1" style="margin-top:20px">
      <div class="enfoque-item"><span class="enfoque-item__n">01</span><div><h3>Criterio de negocio</h3><p>Unimos rigor técnico con una comprensión real de cómo funcionan las empresas y los patrimonios. El consejo se mide por la decisión que te permite tomar.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">02</span><div><h3>Anticipación</h3><p>Preferimos ordenar antes que reparar. La estructura correcta, el acuerdo bien redactado y la decisión documentada evitan la mayoría de los conflictos.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">03</span><div><h3>Claridad</h3><p>Explicamos en términos de opciones y consecuencias. Si entendés el terreno, decidís mejor y más rápido.</p></div></div>
      <div class="enfoque-item"><span class="enfoque-item__n">04</span><div><h3>Cercanía</h3><p>Como un abogado propio: cerca, disponible y con reserva. La confianza y la discreción son parte del trabajo, no un extra.</p></div></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="axis-head reveal">
      <div>
        <p class="eyebrow">Equipo</p>
        <h2 class="h-md">Quiénes piensan cada caso</h2>
        <p>Pocos socios, cada uno metido de lleno en los casos que lleva. Walter y Tomás Rodríguez, y espacio para un tercero.</p>
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
    <p class="lead page-hero__intro reveal" data-d="1">Un estudio es su gente. Somos pocos y nos metemos de lleno en cada caso: quien lo piensa es quien lo lleva. WTR son Walter y Tomás Rodríguez.</p>
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
    <p class="figure-caption reveal" style="margin-top:40px;max-width:60ch">Retratos en blanco y negro — espacio reservado para las fotos definitivas. Reemplazar las ilustraciones por retratos con un tratamiento sobrio y uniforme.</p>
  </div>
</section>

<section class="section section--dark">
  <div class="container cta-band reveal">
    <p class="eyebrow" style="justify-content:center">Sumate</p>
    <h2 class="h-lg">Hay lugar para un tercer socio.</h2>
    <p class="lead" style="margin:22px auto 0;max-width:52ch;color:#a7abb1">Buscamos a alguien que sume una mirada complementaria, con el mismo criterio: rigor técnico y cercanía.</p>
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
    <p class="lead page-hero__intro reveal" data-d="1">Contanos en dos líneas qué tenés entre manos. Te respondemos con una primera lectura y los próximos pasos.</p>
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
            <option>Patrimonio, familia y sucesión</option>
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
  { file: "index.html", base: "", key: "home", title: `${FIRM.name} ${FIRM.sub} — ${FIRM.claim}`, desc: "Estudio jurídico en Buenos Aires. Acompañamos los negocios que nacen y se reinventan —y las personas y familias que están detrás—: sociedades, contratos, tecnología, sucesión y patrimonio.", headerDark: false, body: homeBody() },
  { file: "areas/index.html", base: "../", key: "areas", title: `Áreas de práctica — ${FIRM.name} ${FIRM.sub}`, desc: "Áreas de práctica en dos ejes: los negocios que nacen y se reinventan; y el patrimonio, la sucesión y la familia detrás de ellos.", body: areasIndexBody() },
  { file: "quienes-somos.html", base: "", key: "nosotros", title: `Quiénes somos — ${FIRM.name} ${FIRM.sub}`, desc: "Cómo trabajamos: unimos rigor técnico y cercanía, con la dedicación de un abogado propio y una relación de largo plazo.", body: nosotrosBody() },
  { file: "equipo.html", base: "", key: "equipo", title: `Equipo — ${FIRM.name} ${FIRM.sub}`, desc: "WTR son Walter y Tomás Rodríguez, socios fundadores. Pocos casos, con quien lo piensa llevándolo.", body: equipoBody() },
  { file: "publicaciones.html", base: "", key: "pub", title: `Publicaciones — ${FIRM.name} ${FIRM.sub}`, desc: "Ideas sobre negocios, tecnología y patrimonio. Escritas para empresarios y familias, no para abogados.", body: publicacionesBody() },
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

/* ============================================================
   Single-file bundle (self-contained, hash-routed)
   For easy viewing / sharing: firma/preview.html
   ============================================================ */
function fileToRoute(file) {
  if (file === "index.html") return "/";
  if (file === "areas/index.html") return "/areas";
  const m = file.match(/^areas\/(.+)\.html$/);
  if (m) return "/areas/" + m[1];
  return "/" + file.replace(/\.html$/, "");
}
function rewriteLinks(html) {
  return html.replace(/href="([^"]+\.html)"/g, (m, h) => {
    const clean = h.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    return 'href="#' + fileToRoute(clean) + '"';
  });
}

const css = fs.readFileSync(path.join(OUT, "assets/css/style.css"), "utf8");
const navBundle = NAV.map(n => {
  const r = fileToRoute(n.href);
  return `<a href="#${r}" class="nav-link" data-route="${r}">${n.label}</a>`;
}).join("\n        ");

const routesHtml = pages.map(pg => {
  const route = fileToRoute(pg.file);
  return `<div class="route" data-route="${route}" data-title="${pg.title.replace(/"/g, "&quot;")}">\n<main>${pg.body}</main>\n</div>`;
}).join("\n");

const headerFinal = `
<header class="site-header">
  <div class="container site-header__inner">
    <a href="#/" class="brand" aria-label="${FIRM.name} ${FIRM.sub} — inicio">
      <span class="brand__name">${FIRM.name}</span>
      <span class="brand__bar">|</span>
      <span class="brand__sub">${FIRM.sub}</span>
    </a>
    <nav class="nav" aria-label="Principal">
        ${navBundle}
        <span class="nav__cta"><a href="#/contacto">Conversemos</a></span>
    </nav>
    <button class="nav-toggle" aria-label="Abrir menú" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
</header>`;
const footerBundle = rewriteLinks(footer({ base: "" })).replace(/<script[\s\S]*?<\/script>/g, "");

const bundle = `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${FIRM.name} ${FIRM.sub} — ${FIRM.claim}</title>
<meta name="description" content="Estudio jurídico en Buenos Aires. Negocios que nacen y se reinventan, y el patrimonio y la familia detrás.">
<meta name="theme-color" content="#14181e">
<link rel="icon" href="${FAVICON}">
<style>
/* System-font stack for offline/self-contained rendering (no webfont CDN). */
:root { --serif: "Spectral", Georgia, "Iowan Old Style", "Times New Roman", serif; --sans: "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
${css}
/* Bundle: content is shown per-route, no scroll-reveal dependency */
.reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
.route { display: none; }
.route.is-active { display: block; }
</style>
</head>
<body>
${headerFinal}
<div id="app">
${routesHtml}
</div>
${footerBundle}
<script>
(function () {
  "use strict";
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var body = document.body;

  function onScroll(){ if(!header) return; if(window.scrollY>24) header.classList.add("is-solid"); else header.classList.remove("is-solid"); }
  window.addEventListener("scroll", onScroll, { passive:true }); onScroll();

  if (toggle) toggle.addEventListener("click", function(){ body.classList.toggle("nav-open"); toggle.setAttribute("aria-expanded", body.classList.contains("nav-open")?"true":"false"); });

  var routes = Array.prototype.slice.call(document.querySelectorAll(".route"));
  function currentRoute(){ var h=location.hash.replace(/^#/,""); return h || "/"; }
  function show(route){
    var found=false;
    routes.forEach(function(el){
      var match = el.getAttribute("data-route")===route;
      el.classList.toggle("is-active", match);
      if(match){ found=true; document.title=el.getAttribute("data-title"); }
    });
    if(!found){ if(routes[0]) routes[0].classList.add("is-active"); route="/"; }
    document.querySelectorAll(".nav-link").forEach(function(a){
      a.classList.toggle("is-active", a.getAttribute("data-route")===route);
    });
    document.querySelectorAll("[data-wa-share]").forEach(function(a){
      var msg=a.getAttribute("data-wa-msg")||document.title;
      a.href="https://wa.me/?text="+encodeURIComponent(msg+"\\n"+location.href);
    });
    body.classList.remove("nav-open");
    window.scrollTo({ top:0, behavior:"auto" });
  }
  window.addEventListener("hashchange", function(){ show(currentRoute()); });
  show(currentRoute());

  var y=document.querySelector("[data-year]"); if(y) y.textContent=new Date().getFullYear();
})();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, "preview.html"), bundle);
console.log("  ✓ preview.html (single-file bundle)");
