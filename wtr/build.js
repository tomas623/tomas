// Generador del sitio estático de WTR | abogados.
// Uso: node wtr/build.js  →  arma wtr/dist/ (subible a cualquier hosting).
const fs = require('fs');
const path = require('path');
const { sitio, ejes, areas, pasos, socios, clientes } = require('./contenido');

// BASE: prefijo de rutas. Vacío para el sitio real; '/wtr' para la vista previa
// que sirve el servidor de Legal Pacer en marcas.legalpacers.com/wtr/.
const BASE = process.env.WTR_BASE || '';
const DIST = path.join(__dirname, BASE ? 'dist-preview' : 'dist');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICONOS = {
  flecha: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 5h18v14H3z M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5A2.5 2.5 0 1 1 5 8.5a2.5 2.5 0 0 1 0-5ZM3 9.75h4V21H3V9.75Zm6.5 0h3.8v1.6h.06c.53-1 1.84-2.06 3.79-2.06 4.05 0 4.8 2.67 4.8 6.13V21h-4v-4.9c0-1.17-.02-2.68-1.63-2.68-1.64 0-1.89 1.28-1.89 2.6V21h-4V9.75Z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const wordmark = 'WTR <span class="wm-barra">|</span> <small>abogados</small>';
const waLink = texto => `https://wa.me/${sitio.whatsapp}?text=${encodeURIComponent(texto)}`;

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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Spectral:ital,wght@0,300;0,400;0,500;1,300&display=swap">
<link rel="stylesheet" href="/estilos.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
<header class="cabecera">
  <div class="cabecera-in">
    <a href="/" class="wordmark" aria-label="WTR abogados, inicio">${wordmark}</a>
    <nav class="nav" id="nav" aria-label="Navegación principal">
      <a href="/#areas">Áreas de práctica</a>
      <a href="/#como-trabajamos">Cómo trabajamos</a>
      <a href="/#equipo">Equipo</a>
      <a href="/#contacto">Contacto</a>
      <a href="${sitio.legalPacer}" target="_blank" rel="noopener" class="nav-externo">Legal Pacer ${ICONOS.flecha}</a>
      <a href="/#contacto" class="btn btn-chico">Hablemos</a>
    </nav>
    <button class="menu-btn" id="menuBtn" aria-label="Abrir menú" aria-expanded="false">${ICONOS.menu}</button>
  </div>
</header>
<main>
${cuerpo}
</main>
<footer class="pie">
  <div class="pie-in">
    <div>
      <p class="pie-wordmark">${wordmark}</p>
      <p class="pie-claim">${esc(sitio.claim)}</p>
    </div>
    <div class="pie-datos">
      <p>${esc(sitio.direccion)}</p>
      <p><a href="mailto:${sitio.email}">${sitio.email}</a> · <a href="${waLink('Hola, quiero hacer una consulta.')}" target="_blank" rel="noopener">${sitio.whatsappVisible}</a></p>
      ${contactoIconos()}
    </div>
  </div>
  <div class="pie-legal">
    <div class="pie-legal-in">
      <span>© 2026 WTR | abogados. Todos los derechos reservados.</span>
      <a href="${sitio.legalPacer}" target="_blank" rel="noopener">Legal Pacer, nuestra legaltech ${ICONOS.flecha}</a>
    </div>
  </div>
</footer>
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
  return `<div class="eje revelar">
    <div class="eje-cabeza">
      <p class="volanta">${clave === 'negocios' ? '01' : '02'}</p>
      <h3>${esc(ejes[clave].titulo)}</h3>
      <p>${esc(ejes[clave].bajada)}</p>
    </div>
    ${lista.map(filaArea).join('\n')}
  </div>`;
}

function seccionContacto() {
  const mapa = 'https://maps.google.com/maps?q=' + encodeURIComponent(sitio.direccion) + '&output=embed';
  return `<section id="contacto" class="seccion">
  <div class="contacto-grid">
    <div class="revelar">
      <p class="volanta">Contacto</p>
      <h2 class="titulo-seccion">Hablemos.</h2>
      <p class="intro">Contanos en qué está tu proyecto y te respondemos para coordinar una primera conversación.</p>
      <div class="direccion">
        <p class="volanta">Dónde estamos</p>
        <p>${esc(sitio.direccion)}</p>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sitio.direccion)}" target="_blank" rel="noopener" class="link">Cómo llegar ${ICONOS.flecha}</a>
      </div>
      <iframe class="mapa" title="Mapa: ${esc(sitio.direccion)}" src="${mapa}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      ${contactoIconos()}
    </div>
    <form class="formulario revelar" id="formContacto" novalidate>
      <div class="campo-fila">
        <label class="campo">Nombre<input name="nombre" autocomplete="name" required></label>
        <label class="campo">Email<input name="email" type="email" autocomplete="email" required></label>
      </div>
      <label class="campo">Empresa o proyecto <span class="opcional">(opcional)</span><input name="empresa" autocomplete="organization"></label>
      <label class="campo">¿En qué te podemos ayudar?<textarea name="mensaje" rows="5" required></textarea></label>
      <p class="form-error" id="formError" hidden></p>
      <button class="btn" type="submit">Enviar consulta</button>
      <p class="form-ok" id="formOk" hidden>Recibimos tu consulta. Te respondemos a la brevedad.</p>
    </form>
  </div>
</section>`;
}

function home() {
  const cuerpo = `
<section class="hero">
  <div class="hero-in">
    <div class="hero-texto">
      <p class="volanta">Estudio jurídico · San Fernando, Buenos Aires</p>
      <h1>Trabajamos junto a <span class="subrayado">startups</span>.</h1>
      <p class="bajada">Acompañamos a founders en cada etapa del negocio, y en la vida que ese negocio construye: patrimonio, familia, sucesión.</p>
      <div class="acciones">
        <a class="btn" href="#contacto">Hablemos</a>
        <a class="link" href="#areas">Ver áreas de práctica ${ICONOS.flecha}</a>
      </div>
    </div>
    <nav class="hero-ejes" aria-label="Ejes de trabajo">
      <a href="#areas"><span class="volanta">01</span><strong>${esc(ejes.negocios.titulo)}</strong><span>${esc(ejes.negocios.bajada)}</span></a>
      <a href="#areas"><span class="volanta">02</span><strong>${esc(ejes.vida.titulo)}</strong><span>${esc(ejes.vida.bajada)}</span></a>
    </nav>
  </div>
</section>
${clientes.length ? `<section class="clientes"><p class="volanta">Con quién trabajamos</p><div class="carrusel"><div class="pista">${[...clientes, ...clientes].map(c => `<img src="${c.logo}" alt="${esc(c.nombre)}">`).join('')}</div></div></section>` : ''}
<section id="areas" class="seccion">
  <header class="cabeza-seccion revelar">
    <p class="volanta">Áreas de práctica</p>
    <h2 class="titulo-seccion">Las decisiones de tu empresa y las de tu vida.</h2>
  </header>
  <div class="ejes-grid">
    ${columnaEje('negocios')}
    ${columnaEje('vida')}
  </div>
</section>
<section class="banda-oscura">
  <div class="diferencial revelar">
    <p class="volanta">Nuestro diferencial</p>
    <p class="diferencial-texto">El mismo estudio que te arma la ronda te ordena el patrimonio que esa ronda genera. Y construyó su propia legaltech para resolver online lo que se puede resolver online.</p>
    <a class="link link-claro" href="${sitio.legalPacer}" target="_blank" rel="noopener">Conocé Legal Pacer ${ICONOS.flecha}</a>
  </div>
</section>
<section id="como-trabajamos" class="banda-hueso"><div class="seccion">
  <header class="cabeza-seccion revelar">
    <p class="volanta">Cómo trabajamos</p>
    <h2 class="titulo-seccion">Actuamos con criterio.</h2>
  </header>
  <ol class="pasos">
    ${pasos.map((p, i) => `<li class="revelar"><span class="paso-num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></li>`).join('\n')}
  </ol>
</div></section>
<section id="equipo" class="seccion">
  <header class="cabeza-seccion revelar">
    <p class="volanta">Equipo</p>
    <h2 class="titulo-seccion">Socios fundadores.</h2>
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
      <a class="btn" href="/#contacto">Hablemos</a>
      <a class="link" href="${waLink('Hola, quiero consultar sobre ' + a.titulo.toLowerCase() + '.')}" target="_blank" rel="noopener">Escribinos por WhatsApp ${ICONOS.flecha}</a>
    </aside>
  </div>
  ${otras.length ? `<div class="otras"><p class="volanta">Otras áreas de ${esc(ejes[a.eje].titulo)}</p>${otras.map((o, i) => filaArea(o, i)).join('')}</div>` : ''}
</section>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'Service', name: a.titulo, description: a.frase, provider: { '@type': 'LegalService', name: sitio.nombre, url: sitio.url } };
  return layout({ titulo: `${a.titulo} | WTR abogados`, descripcion: `${a.frase} ${a.decisiones.join(' ')}`.slice(0, 300), ruta: `/areas/${a.slug}/`, cuerpo, jsonld });
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
fs.copyFileSync(path.join(__dirname, 'estilos.css'), path.join(DIST, 'estilos.css'));
fs.copyFileSync(path.join(__dirname, 'sitio.js'), path.join(DIST, 'sitio.js'));
escribir('sitio-config.js', `window.WTR_API_CONTACTO = ${JSON.stringify(sitio.apiContacto)};`);
escribir('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${sitio.url}/sitemap.xml\n`);
escribir('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...areas.map(a => `/areas/${a.slug}/`)].map(r => `  <url><loc>${sitio.url}${r}</loc></url>`).join('\n')}\n</urlset>\n`);
escribir('llms.txt', `# WTR | abogados\n\n> ${sitio.claim} Estudio jurídico de San Fernando, Buenos Aires, que acompaña a founders en su empresa y en su vida (patrimonio, familia, sucesión). Creó Legal Pacer, su legaltech, para resolver online los temas estándar.\n\n## Áreas de práctica\n${areas.map(a => `- [${a.titulo}](${sitio.url}/areas/${a.slug}/): ${a.frase}`).join('\n')}\n\n## Contacto\n- ${sitio.direccion}\n- ${sitio.email}\n- WhatsApp ${sitio.whatsappVisible}\n- Legal Pacer: ${sitio.legalPacer}\n`);
// Para hostings con Apache (Hostinger): fuerza HTTPS, unifica www → sin www y
// manda las rutas viejas del sitio anterior a la home. El servidor de Legal
// Pacer lo ignora (express.static no sirve archivos ocultos).
if (!BASE) escribir('.htaccess', `RewriteEngine On
RewriteCond %{HTTPS} off [OR]
RewriteCond %{HTTP_HOST} ^www\\. [NC]
RewriteRule ^ https://wtrabogados.com.ar%{REQUEST_URI} [L,R=301]

ErrorDocument 404 /index.html

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
`);
console.log(`Sitio armado en ${DIST}: ${1 + areas.length} páginas.`);
