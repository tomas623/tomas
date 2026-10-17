// Generador del sitio estático de WTR | abogados.
// Uso: node wtr/build.js  →  arma wtr/dist/ (subible a cualquier hosting).
// Con WTR_V2=1 arma la versión 2 (misma estructura y contenido, otra hoja de
// estilos: estilos-v2.css) en wtr/dist-v2/ o, con WTR_BASE, en wtr/dist-v2-preview/.
const fs = require('fs');
const path = require('path');
const { sitio, ejes, areas, etapas, etapasNota, socios, clientes, diferencial, privacidad } = require('./contenido');

// BASE: prefijo de rutas. Vacío para el sitio real; '/wtr' para la vista previa
// que sirve el servidor de Legal Pacer en marcas.legalpacers.com/wtr/.
const BASE = process.env.WTR_BASE || '';
const V2 = process.env.WTR_V2 === '1';
const DIST = path.join(__dirname, (V2 ? 'dist-v2' : 'dist') + (BASE ? '-preview' : ''));
const FUENTES = V2
  ? 'family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Inter+Tight:wght@500;600&family=Spectral:ital,wght@1,400'
  : 'family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Spectral:ital,wght@0,300;0,400;0,500;1,300';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICONOS = {
  flecha: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  // Íconos de contacto: de línea, del set Tabler Icons (licencia MIT).
  whatsapp: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7l9 6 9-6"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11v5M8 8v.01M12 16v-5M16 16v-3a2 2 0 1 0-4 0"/><path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const wordmark = 'WTR <span class="wm-barra">|</span> <small>abogados</small>';
const waLink = texto => `https://wa.me/${sitio.whatsapp}?text=${encodeURIComponent(texto)}`;
// Botón de agenda: abre Calendly en pestaña nueva (funciona aunque el embebido no cargue).
const btnAgenda = (clase = 'btn', texto = 'Agendá una charla') => `<a class="${clase}" href="${sitio.calendly}" target="_blank" rel="noopener">${texto}</a>`;
const pad = n => String(n).padStart(2, '0');
const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sitio.direccion)}`;

function area(slug) {
  const a = areas.find(x => x.slug === slug);
  if (!a) throw new Error(`No existe el área "${slug}" (revisá contenido.js).`);
  return a;
}
// Convierte {texto|slug} en un link al área ({texto|#ancla}: a esa sección de la home).
const linkear = t => esc(t).replace(/\{([^|}]+)\|([^}]+)\}/g, (_, texto, slug) => `<a href="${slug.startsWith('#') ? '/' + slug : `/areas/${area(slug).slug}/`}">${texto}</a>`);

function contactoIconos() {
  return `<div class="iconos">
    <a href="${waLink('Hola, quiero hacer una consulta.')}" target="_blank" rel="noopener" aria-label="WhatsApp">${ICONOS.whatsapp}</a>
    <a href="mailto:${sitio.email}" aria-label="Mail">${ICONOS.mail}</a>
    <a href="${sitio.linkedin}" target="_blank" rel="noopener" aria-label="LinkedIn">${ICONOS.linkedin}</a>
  </div>`;
}

function layout({ titulo, descripcion, ruta, cuerpo, jsonld }) {
  const url = sitio.url + ruta;
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="WTR | abogados">
<meta property="og:locale" content="es_AR">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FUENTES}&display=swap">
<link rel="stylesheet" href="/estilos.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
<header class="cabecera">
  <div class="cabecera-in">
    <a href="/" class="wordmark" aria-label="WTR abogados, inicio">${wordmark}</a>
    <nav class="nav" id="nav" aria-label="Navegación principal">
      <a href="/#areas">Áreas de práctica</a>
      <a href="/#quienes-somos">Quiénes somos</a>
      <a href="/#contacto">Contacto</a>
      ${btnAgenda('btn btn-chico')}
    </nav>
    <button class="menu-btn" id="menuBtn" aria-label="Abrir menú" aria-expanded="false">${ICONOS.menu}</button>
  </div>
</header>
<main>
${cuerpo}
</main>
<footer class="pie">
  <div class="pie-in">
    <p class="pie-wordmark">${wordmark}</p>
    <div class="pie-datos">
      <a class="pie-direccion" href="${mapsLink}" target="_blank" rel="noopener">${esc(sitio.direccion)} ${ICONOS.flecha}</a>
      ${contactoIconos()}
    </div>
  </div>
  <div class="pie-legal">
    <div class="pie-legal-in">
      <span>© 2026 WTR | abogados. Todos los derechos reservados. · <a href="/privacidad/">Política de privacidad</a></span>
      <a href="${sitio.legalPacer}" target="_blank" rel="noopener">LegalPacer ${ICONOS.flecha}</a>
    </div>
  </div>
</footer>
<div class="barra-agenda" id="barraAgenda">${btnAgenda()}</div>
<script src="/sitio-config.js"></script>
<script src="/sitio.js" defer></script>
</body>
</html>`;
}

function filaArea(a, i) {
  return `<a class="area-fila" href="/areas/${a.slug}/">
    <span class="area-num">${String(i + 1).padStart(2, '0')}</span>
    <span><span class="area-titulo">${esc(a.titulo)}</span><span class="area-frase">${esc(a.frase)}</span></span>
    ${ICONOS.flecha}
  </a>`;
}

function columnaEje(clave) {
  const lista = areas.filter(a => a.eje === clave);
  // Desplegable nativo: el contenido queda en el HTML (lo lee Google) y en celular ordena.
  return `<details class="eje revelar">
    <summary class="eje-cabeza">
      <h3>${esc(ejes[clave].titulo)}</h3>
      <p>${esc(ejes[clave].bajada)}</p>
      <span class="eje-mas" aria-hidden="true"></span>
    </summary>
    ${lista.map(filaArea).join('\n')}
  </details>`;
}

function seccionContacto() {
  // Calendly embebido como iframe simple (sin su script). Los colores toman la marca si el plan de Calendly lo permite.
  const calendlyEmbed = `${sitio.calendly}?embed_type=Inline&embed_domain=${new URL(sitio.url).hostname}&primary_color=4e5836&text_color=0e1420`;
  // En la vista previa el CSP del servidor de Legal Pacer bloquea el iframe: va un recuadro con el botón.
  const agenda = BASE
    ? `<div class="calendly calendly-recuadro">${btnAgenda('btn', 'Abrir el calendario')}</div>`
    : `<iframe class="calendly" title="Agendá una reunión con WTR | abogados" src="${calendlyEmbed}" loading="lazy"></iframe>
      <a class="link" href="${sitio.calendly}" target="_blank" rel="noopener">Abrir el calendario en otra pestaña ${ICONOS.flecha}</a>`;
  return `<section id="contacto" class="seccion">
  <header class="cabeza-seccion revelar">
    <p class="volanta">Contacto</p>
    <h2 class="titulo-seccion">Hablemos.</h2>
    <p class="intro">Agendá directamente o dejanos tu consulta y te escribimos.</p>
  </header>
  <div class="contacto-grid">
    <div class="agenda revelar">
      <h3 class="contacto-titulo">Agendá una reunión</h3>
      ${agenda}
    </div>
    <div class="revelar">
    <h3 class="contacto-titulo">Escribinos</h3>
    <form class="formulario" id="formContacto" novalidate>
      <div class="campo-fila">
        <label class="campo">Nombre<input name="nombre" autocomplete="name" required></label>
        <label class="campo">Email<input name="email" type="email" autocomplete="email" required></label>
      </div>
      <label class="campo">Empresa o proyecto <span class="opcional">(opcional)</span><input name="empresa" autocomplete="organization"></label>
      <label class="campo">¿En qué te podemos ayudar?<textarea name="mensaje" rows="5" required></textarea></label>
      <p class="form-error" id="formError" hidden></p>
      <button class="btn" type="submit">Enviar consulta</button>
      <p class="form-legal">Al enviar la consulta aceptás nuestra <a href="/privacidad/">política de privacidad</a>.</p>
      <p class="form-ok" id="formOk" hidden>Recibimos tu consulta. Te respondemos a la brevedad.</p>
    </form>
    </div>
  </div>
</section>`;
}

function home() {
  const cuerpo = `
<section class="hero">
  <div class="hero-in">
    <div class="hero-texto">
      <h1>Trabajamos junto a <span class="subrayado">startups</span>.</h1>
      <p class="bajada">Acompañamos a founders en cada etapa del negocio, y en la vida que ese negocio construye: patrimonio, familia, sucesión.</p>
      <div class="acciones">
        ${btnAgenda()}
        <a class="link" href="#areas">Ver áreas de práctica ${ICONOS.flecha}</a>
      </div>
    </div>
  </div>
</section>
${clientes.length ? `<section class="clientes"><p class="volanta">Con quién trabajamos</p><div class="carrusel"><div class="pista">${[...clientes, ...clientes].map((c, i) => i < clientes.length ? `<img src="${c.logo}" alt="${esc(c.nombre)}">` : `<img src="${c.logo}" alt="" aria-hidden="true">`).join('')}</div></div></section>`
  // Sin logos todavía: el lugar se ve solo en la vista previa, no en el sitio real.
  : BASE ? `<section class="clientes"><p class="volanta">Con quién trabajamos</p><div class="logos-pendientes">${'<span>Logo</span>'.repeat(5)}</div></section>` : ''}
<section id="areas" class="seccion">
  <header class="cabeza-seccion revelar">
    <p class="volanta">Áreas de práctica</p>
    <h2 class="titulo-seccion">Acompañamos a tu startup <span class="acento">y a vos</span> en cada etapa.</h2>
  </header>
  <ol class="roadmap revelar">
    ${etapas.map((e, i) => `<li class="etapa"><span class="etapa-num">${pad(i + 1)}</span><h3 class="etapa-titulo">${esc(e.titulo)}</h3><p class="etapa-areas">${linkear(e.texto)}</p></li>`).join('\n    ')}
  </ol>
  <p class="roadmap-nota revelar">${esc(etapasNota)}</p>
  <div class="ejes-grid">
    ${columnaEje('negocios')}
    ${columnaEje('vida')}
  </div>
</section>
<section id="quienes-somos">
  <div class="seccion">
  <header class="cabeza-seccion revelar">
    <h2 class="titulo-seccion">Quiénes somos</h2>
  </header>
  <div class="equipo-grid">
    ${socios.map(s => `<article class="socio revelar">
      ${s.foto ? `<img class="socio-foto" src="${s.foto}" alt="Retrato de ${esc(s.nombre)}" loading="lazy">` : `<div class="socio-foto socio-sin-foto" aria-hidden="true">${s.iniciales}</div>`}
      <p class="volanta">${esc(s.rol)}</p>
      <h3>${esc(s.nombre)}</h3>
      <p class="socio-bio">${esc(s.bio)}</p>
      <p class="socio-links">${s.links.map(l => `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.texto)} ${ICONOS.flecha}</a>`).join('')}</p>
    </article>`).join('\n')}
  </div>
  </div>
  <div class="banda-oscura">
    <div class="diferencial revelar">
      <p class="volanta">Nuestro diferencial</p>
      <p class="diferencial-texto">${esc(diferencial)}</p>
    </div>
  </div>
</section>
${seccionContacto()}`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'LegalService', name: sitio.nombre, url: sitio.url,
    email: sitio.email, telephone: '+' + sitio.whatsapp, slogan: sitio.claim,
    address: { '@type': 'PostalAddress', streetAddress: 'Gral. Pinto 1228', addressLocality: 'San Fernando', addressRegion: 'Buenos Aires', addressCountry: 'AR' },
    sameAs: [sitio.linkedin],
    founder: socios.map(s => ({ '@type': 'Person', name: s.nombre, jobTitle: s.rol, sameAs: s.links.map(l => l.url) })),
    knowsAbout: areas.map(a => a.titulo),
  };
  return layout({
    titulo: 'WTR | abogados — Estudio jurídico para startups y family office',
    descripcion: 'Estudio jurídico de San Fernando, Buenos Aires. Acompañamos a founders en su empresa (sociedades, contratos, inversión, propiedad intelectual) y en su vida (patrimonio, familia, sucesión).',
    ruta: '/', cuerpo, jsonld,
  });
}

function paginaArea(a) {
  const otras = areas.filter(x => x.slug !== a.slug && x.eje === a.eje);
  const cuerpo = `
<section class="area-hero">
  <div class="area-hero-in">
    <a class="link volver" href="/#areas">← Áreas de práctica</a>
    <p class="volanta">${esc(ejes[a.eje].titulo)}</p>
    <h1>${esc(a.titulo)}</h1>
    <p class="area-frase-grande">${esc(a.frase)}</p>
  </div>
</section>
<section class="seccion area-cuerpo">
  <div class="area-grid">
    <div>
      <div class="bloque">
        <p class="volanta">Qué decisiones acompañamos</p>
        <ul class="lista">${a.decisiones.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>
      <div class="bloque">
        <p class="volanta">Cómo trabajamos</p>
        <p class="texto">${esc(a.como)}</p>
        ${a.legalPacer ? `<a class="link" href="${a.legalPacer.url}" target="_blank" rel="noopener">${esc(a.legalPacer.texto)} ${ICONOS.flecha}</a>` : ''}
      </div>
    </div>
    <aside class="area-cta">
      <p class="volanta">Primera conversación</p>
      <p class="area-cta-texto">Contanos tu caso y vemos juntos por dónde empezar.</p>
      ${btnAgenda()}
      <a class="link" href="${waLink('Hola, quiero consultar sobre ' + a.titulo.toLowerCase() + '.')}" target="_blank" rel="noopener">Escribinos por WhatsApp ${ICONOS.flecha}</a>
    </aside>
  </div>
  ${otras.length ? `<div class="otras"><p class="volanta">Otras áreas de ${esc(ejes[a.eje].titulo)}</p>${otras.map((o, i) => filaArea(o, i)).join('')}</div>` : ''}
</section>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'Service', name: a.titulo, description: a.frase, provider: { '@type': 'LegalService', name: sitio.nombre, url: sitio.url } };
  return layout({ titulo: `${a.titulo} | WTR abogados`, descripcion: `${a.frase} ${a.decisiones.join(' ')}`.slice(0, 300), ruta: `/areas/${a.slug}/`, cuerpo, jsonld });
}

function paginaPrivacidad() {
  const cuerpo = `
<section class="area-hero">
  <div class="area-hero-in">
    <a class="link volver" href="/">← Inicio</a>
    <h1>Política de privacidad</h1>
    <p class="volanta">Última actualización: ${esc(privacidad.actualizada)}</p>
  </div>
</section>
<section class="seccion">
  <div class="legal-texto">
    ${privacidad.parrafos.map(p => `<p>${p.titulo ? `<strong>${esc(p.titulo)}</strong> ` : ''}${esc(p.texto).split(sitio.email).join(`<a href="mailto:${sitio.email}">${sitio.email}</a>`)}</p>`).join('\n    ')}
  </div>
</section>`;
  return layout({ titulo: 'Política de privacidad | WTR abogados', descripcion: 'Cómo WTR | abogados trata los datos personales que nos dejás en el formulario de contacto del sitio.', ruta: '/privacidad/', cuerpo });
}

function escribir(ruta, contenido) {
  if (BASE && ruta.endsWith('.html')) {
    contenido = contenido.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`)
      .replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"');
  }
  const destino = path.join(DIST, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

fs.rmSync(DIST, { recursive: true, force: true });
escribir('index.html', home());
for (const a of areas) escribir(`areas/${a.slug}/index.html`, paginaArea(a));
escribir('privacidad/index.html', paginaPrivacidad());
fs.copyFileSync(path.join(__dirname, V2 ? 'estilos-v2.css' : 'estilos.css'), path.join(DIST, 'estilos.css'));
fs.cpSync(path.join(__dirname, 'img'), path.join(DIST, 'img'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'sitio.js'), path.join(DIST, 'sitio.js'));
escribir('sitio-config.js', `window.WTR_API_CONTACTO = ${JSON.stringify(sitio.apiContacto)};`);
escribir('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${sitio.url}/sitemap.xml\n`);
escribir('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...areas.map(a => `/areas/${a.slug}/`), '/privacidad/'].map(r => `  <url><loc>${sitio.url}${r}</loc></url>`).join('\n')}\n</urlset>\n`);
escribir('llms.txt', `# WTR | abogados\n\n> ${sitio.claim} Estudio jurídico de San Fernando, Buenos Aires, que acompaña a founders en su empresa y en su vida (patrimonio, familia, sucesión). Creó LegalPacer, un espacio online para emprendedores.\n\n## Áreas de práctica\n${areas.map(a => `- [${a.titulo}](${sitio.url}/areas/${a.slug}/): ${a.frase}`).join('\n')}\n\n## Contacto\n- ${sitio.direccion}\n- ${sitio.email}\n- WhatsApp ${sitio.whatsappVisible}\n- LegalPacer: ${sitio.legalPacer}\n`);
// Para hostings con Apache (Hostinger): fuerza HTTPS, unifica www → sin www y
// manda las rutas viejas del sitio anterior a la home. El servidor de Legal
// Pacer lo ignora (express.static no sirve archivos ocultos).
if (!BASE) escribir('.htaccess', `RewriteEngine On
RewriteCond %{HTTPS} off [OR]
RewriteCond %{HTTP_HOST} ^www\\. [NC]
RewriteRule ^ ${sitio.url}%{REQUEST_URI} [L,R=301]

ErrorDocument 404 /index.html

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
`);
console.log(`Sitio armado en ${DIST}: ${2 + areas.length} páginas.`);
