// Mails del servicio de términos y condiciones / política de privacidad.
// Textos: HQ, marcas/legal-pacer/servicio-tyc-pp/textos-cliente.md (aprobado
// por Tomás el 05/11/2026). Se copian tal cual; lo que va entre corchetes en
// ese archivo lo completa cada función según el servicio del pedido.
//
// Funciones puras: devuelven { subject, html } y no mandan nada. El envío lo
// hace docs-pedidos.js (confirmación de pago, automática) o el panel (borrador
// y versión final, solo cuando Tomás aprieta el botón).

const WHATSAPP_URL = 'https://wa.me/5491128774200';
const CALENDLY_URL = 'https://calendly.com/tomas-wtrabogados/30min';
const FIRMA = 'Legal Pacer, un producto de WTR | abogados';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Variantes por servicio (orden de los corchetes en textos-cliente.md:
// términos / privacidad / los dos).
const V = {
  tyc: {
    tus: 'tus términos y condiciones',
    doc: 'términos y condiciones',
    guias: 'la guía de buenas prácticas',
    publicar: 'publicarlos',
    guiaDonde: 'La guía de buenas prácticas te dice dónde van',
  },
  privacidad: {
    tus: 'tu política de privacidad',
    doc: 'política de privacidad',
    guias: 'las guías de buenas prácticas y de GDPR',
    publicar: 'publicarla',
    guiaDonde: 'La guía de buenas prácticas te dice dónde va',
  },
  combo: {
    tus: 'tus términos y condiciones y tu política de privacidad',
    doc: 'términos y condiciones y política de privacidad',
    guias: 'las tres guías',
    publicar: 'publicarlos',
    guiaDonde: 'Las guías de buenas prácticas te dicen dónde va cada uno',
  },
};
function variante(codigo) { return V[codigo] || V.combo; }

const P = 'style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1E1E1E"';
const wa = `<a href="${WHATSAPP_URL}" style="color:#006FFB">WhatsApp</a>`;
function boton(href, texto) {
  return `<p style="margin:22px 0"><a href="${esc(href)}" style="background:#006FFB;color:#FFFFFF;padding:12px 22px;border-radius:999px;text-decoration:none;display:inline-block;font-weight:600;font-size:15px">${esc(texto)}</a></p>`;
}
function hola(nombre) {
  const n = String(nombre || '').trim();
  return `<p ${P}>Hola${n ? ' ' + esc(n) : ''},</p>`;
}
function cuerpo(partes) {
  return `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto">${partes.join('\n')}<p ${P}>${FIRMA}</p></div>`;
}

// c. Mail de confirmación de pago.
function mailConfirmacionPago({ codigo, nombre, numero, linkFormulario }) {
  const v = variante(codigo);
  return {
    subject: 'Recibimos tu pago. Completá el formulario',
    html: cuerpo([
      hola(nombre),
      `<p ${P}>Recibimos el pago de ${v.tus}. Tu número de pedido es ${esc(numero)}.</p>`,
      `<p ${P}>El próximo paso es completar el formulario sobre tu negocio y subir lo que tengas: tus términos y condiciones actuales, tu web, tus redes o un dossier. Si no tenés nada, completás solo el formulario. Lo podés dejar a medias y seguir desde el mismo link.</p>`,
      boton(linkFormulario, 'Completar el formulario'),
      `<p ${P}>El borrador te llega 7 días corridos después de que completes el formulario. Si tenés una duda, escribinos por ${wa}.</p>`,
    ]),
  };
}

// d. Mail del borrador. links: [{ documento: 'terminos'|'privacidad', url }].
// En el combo van los dos documentos en un solo mail; textos-cliente.md tiene
// un solo botón, así que con dos links cada botón dice de qué documento es
// [REVISAR · contenido: el texto aprobado no prevé dos botones].
function mailBorrador({ codigo, nombre, links, fechaLimite }) {
  const v = variante(codigo);
  const nombres = { terminos: 'Ver el borrador de los términos y condiciones', privacidad: 'Ver el borrador de la política de privacidad' };
  const botones = links.length === 1
    ? boton(links[0].url, 'Ver el borrador')
    : links.map(l => boton(l.url, nombres[l.documento] || 'Ver el borrador')).join('\n');
  return {
    subject: `Tu borrador de ${v.doc} está listo para revisar`,
    html: cuerpo([
      hola(nombre),
      `<p ${P}>El borrador de ${v.tus} está en Google Drive. Lo compartimos solo con este mail y podés dejar comentarios.</p>`,
      botones,
      `<p ${P}>Para comentar, seleccioná el texto que querés cambiar y agregá un comentario. Cuando termines, respondé este mail y contanos qué querés cambiar. Si no hay nada para cambiar, respondé que está bien. Si tenés dudas sobre cómo comentar, escribinos por ${wa}.</p>`,
      `<p ${P}>Tenés 10 días corridos, hasta el ${esc(fechaLimite)}. Es una sola ronda, así que conviene mandar todos los comentarios juntos.</p>`,
      `<p ${P}>El ajuste adapta el documento a lo que nos contaste en el formulario: corregimos un dato, cambiamos o sacamos una cláusula, aclaramos una redacción o sumamos algo que estaba en el formulario y no quedó. Si necesitás cubrir algo que el formulario no decía, como un producto nuevo u otra forma de cobrar, lo ve WTR | abogados con un presupuesto aparte.</p>`,
      `<p ${P}>Si comentás, ajustamos el documento y te mandamos la versión final 3 días hábiles después de tu respuesta. Si nos decís que está bien, o si no recibimos tu respuesta hasta el ${esc(fechaLimite)}, te mandamos la versión final así como está. En los dos casos va en Word y PDF, con ${v.guias}, y con eso cerramos el pedido.</p>`,
    ]),
  };
}

// e. Mail de la versión final (los adjuntos los agrega quien envía).
function mailVersionFinal({ codigo, nombre }) {
  const v = variante(codigo);
  return {
    subject: `Tu versión final de ${v.doc}`,
    html: cuerpo([
      hola(nombre),
      `<p ${P}>Te mandamos la versión final de ${v.tus}, en Word y PDF, con ${v.guias}.</p>`,
      `<p ${P}>Lo que sigue es ${v.publicar} en tu web o app. ${v.guiaDonde} y qué casillas activar.</p>`,
      `<p ${P}>Gracias por usar Legal Pacer. Si te surge una duda, escribinos por ${wa}.</p>`,
      `<p ${P}>¿Querés saber dónde está parado tu negocio? Agendá una reunión de diagnóstico gratuita con WTR | abogados, el estudio que creó Legal Pacer.</p>`,
      boton(CALENDLY_URL, 'Agendar la reunión de diagnóstico'),
    ]),
  };
}

// Avisos internos (a Tomás). Sin datos del formulario: solo número, servicio
// y que se mire el panel.
function avisoInterno({ evento, numero, servicio, proyecto, panelUrl }) {
  const titulos = {
    pago: `Pedido nuevo ${numero}: ${servicio}`,
    formulario: `Formulario completo ${numero}: ${servicio}`,
  };
  const textos = {
    pago: 'Se acreditó el pago y el cliente recibió el link al formulario. Anotalo en el registro de pedidos.',
    formulario: 'El cliente completó el formulario. Corre el plazo de 7 días corridos para el borrador.',
  };
  return {
    subject: titulos[evento],
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#0f1f3d">
      <h2 style="color:#1B6EF3">${esc(titulos[evento])}</h2>
      <p><strong>Proyecto:</strong> ${esc(proyecto || '—')}</p>
      <p>${textos[evento]}</p>
      <p><a href="${esc(panelUrl)}">Abrir el panel</a></p>
    </div>`,
    whatsapp: `Legal Pacer · ${titulos[evento]}. Mirá el panel.`,
  };
}

module.exports = {
  WHATSAPP_URL, CALENDLY_URL, FIRMA,
  mailConfirmacionPago, mailBorrador, mailVersionFinal, avisoInterno, esc,
};
