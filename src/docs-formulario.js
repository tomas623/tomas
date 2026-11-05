// Formulario post-pago de términos y condiciones / política de privacidad.
// Fuente: HQ, marcas/legal-pacer/servicio-tyc-pp/formulario.md (aprobado por
// Tomás el 04/11/2026). Los textos de las preguntas se copian tal cual: si el
// archivo cambia, se cambia acá y en ningún otro lado (la página, la validación
// y el panel leen esta definición).
//
// `para`: 'ambas' (se muestra siempre), 'tyc' (solo si el pedido incluye
// términos y condiciones) o 'pp' (solo si incluye política de privacidad).
// `textoSoloTyc` / `textoSoloPp`: versión de la pregunta cuando el pedido es
// de un solo documento y la columna "Para" del formulario lo indica.

const INTRO = {
  tyc: 'tus términos y condiciones',
  privacidad: 'tu política de privacidad',
  combo: 'tus términos y condiciones y tu política de privacidad',
};

function introFormulario(codigoServicio) {
  const que = INTRO[codigoServicio] || INTRO.combo;
  return `Con estas respuestas armamos ${que} a la medida de cómo funciona tu negocio. Te lleva unos minutos. Si una pregunta no aplica, dejala en blanco; si dudás, contanos cómo funciona hoy. Hacelo tranquilo: estas respuestas son la base de la relación con tus usuarios.`;
}

const CIERRE = 'Con esto armamos tu borrador. Te llega por mail en 7 días corridos, en un documento de Google Drive donde vas a poder dejar tus comentarios.';

// Preguntas de alcance: sí o no y, si es "sí", "Contanos cómo" (o la pregunta
// de seguimiento, que es el cómo).
const ALCANCE = [
  { id: 'C1', texto: '¿Los usuarios publican contenido que otros ven (perfiles, reseñas, posteos, mensajes)?',
    como: '¿Revisás lo que publican antes de que se vea, o después? ¿Cómo te avisa alguien que un contenido está mal?' },
  { id: 'C2', texto: '¿Conectás vendedores o prestadores con compradores, o cobrás comisión por operación entre terceros?',
    como: '¿A quién le cobrás la comisión (vendedor, comprador o los dos) y cuánto? ¿Quién le factura al comprador? ¿Quién atiende los reclamos por el producto o el servicio?' },
  { id: 'C3', texto: '¿Recibís dinero de compradores para pagarle después a vendedores?', como: 'Contanos cómo' },
  { id: 'C4', texto: '¿Tu actividad toca pagos, salud, seguros, educación, cripto o apuestas? ¿Cuál?', como: 'Contanos cómo' },
  { id: 'C5', texto: '¿Puede haber usuarios menores de 18?',
    como: '¿Desde qué edad? ¿La cuenta o el pago los hace un adulto?' },
  { id: 'C6', texto: '¿Pedís datos de salud, biometría (huella, cara), origen, religión, opiniones políticas, vida sexual o antecedentes? ¿Cuáles?', como: 'Contanos cómo' },
  { id: 'C7', texto: '¿Usás datos de usuarios para entrenar modelos de inteligencia artificial?',
    como: '¿Qué datos usás? ¿Les sacás nombre, mail y lo que identifica a la persona antes de entrenar? ¿El modelo es tuyo o de un proveedor (cuál)? ¿El usuario puede pedir que no se usen sus datos?' },
];

const SECCIONES = [
  { titulo: 'Tu empresa', preguntas: [
    { id: 'F1', para: 'ambas', texto: 'Razón social y CUIT de la sociedad o persona que opera la plataforma.' },
    { id: 'F2', para: 'ambas', texto: 'Domicilio legal.' },
    { id: 'F3', para: 'ambas', texto: 'Marca, sitio web y nombre de la app, si la tenés. Si tenés app, ¿está en App Store o Google Play?' },
    { id: 'F4', para: 'ambas', texto: 'Email de atención a usuarios y horario en que responden. Si usan WhatsApp, el número. ¿Tenés un mail para temas de privacidad?' },
  ] },
  { titulo: 'Tu negocio', preguntas: [
    { id: 'F5', para: 'ambas', texto: '¿Qué vendés u ofrecés? Una o dos frases. Si para cumplir dependés de otros (proveedores, plataformas, organismos), contanos de quiénes y qué no podés garantizar.' },
    { id: 'F6', para: 'ambas', texto: '¿A quién le vendés: a personas, a empresas o a ambos?' },
    { id: 'F7', para: 'tyc', texto: '¿Cómo cobrás: suscripción, pago único u otro?' },
  ] },
  { titulo: 'Cobros', preguntas: [
    { id: 'F8', para: 'ambas', texto: '¿En qué moneda cobrás? ¿Prestás servicios desde o hacia el exterior? ¿Desde qué países te usan?' },
    { id: 'F9', para: 'ambas', texto: '¿Con qué pasarela de pago cobrás (Mercado Pago, Stripe u otro)? Pasanos el enlace a tus planes y precios.' },
    { id: 'F10', para: 'tyc', texto: 'Si cobrás suscripción: ¿es mensual o anual? ¿Ofrecés un período de prueba y se cobra solo al terminar? ¿Se renueva sola? ¿Cómo se da de baja hoy un usuario?' },
    { id: 'F11', para: 'tyc', texto: 'Si alguien se arrepiente, ¿en cuántos días podés devolverle el dinero? ¿Hay algo que, una vez empezado, ya no se puede deshacer?' },
  ] },
  { titulo: 'Usuarios', preguntas: [
    { id: 'F12', para: 'ambas', texto: '¿Hace falta crear una cuenta para usar el servicio?' },
    { id: 'F13', para: 'tyc', texto: '¿Pensás cambiar o quitar funciones en los próximos meses?' },
  ] },
  { titulo: 'Datos y tecnología', preguntas: [
    { id: 'F14', para: 'ambas', texto: '¿Qué datos pedís a los usuarios y para qué los usás?' },
    { id: 'F15', para: 'ambas', texto: '¿Qué proveedores usan esos datos (hosting, email, analítica, CRM, píxeles de publicidad) y en qué países están? ¿Le pasás datos a alguien más?' },
    { id: 'F16', para: 'ambas', texto: '¿Enviás newsletters o comunicaciones comerciales? ¿Por mail, WhatsApp u otro canal?' },
    { id: 'F17', para: 'pp', texto: '¿Usás inteligencia artificial con datos de usuarios? ¿Para qué?' },
    // "PP (si el pedido es solo TyC, se muestra la primera parte)".
    { id: 'F18', para: 'ambas', texto: '¿Ya tenés política de privacidad? Pasanos el enlace. ¿Tu base de datos está inscripta ante la Agencia de Acceso a la Información Pública?',
      textoSoloTyc: '¿Ya tenés política de privacidad? Pasanos el enlace.' },
  ] },
  { titulo: 'Operación, conflictos y contexto', preguntas: [
    // F19 lleva la casilla "Vendo productos", que es la que abre F21.
    { id: 'F19', para: 'tyc', vendeProductos: true, texto: 'Si es software: ¿qué disponibilidad y soporte ofrecés (canal, horario, tiempo de respuesta)? ¿Avisás el mantenimiento? Si vendés productos: ¿a qué zonas enviás, con qué logística y en qué plazos? ¿Aceptás cambios por gusto, en qué plazo y quién paga el envío?' },
    // "TyC (la ronda, también PP)".
    { id: 'F20', para: 'ambas', texto: 'Con clientes empresa, ¿preferís tribunales o arbitraje? ¿En qué ciudad? ¿Tenés inversores o pensás levantar una ronda en los próximos 12 meses?',
      textoSoloPp: '¿Tenés inversores o pensás levantar una ronda en los próximos 12 meses?' },
    { id: 'F21', para: 'tyc', soloSiVendeProductos: true, texto: 'Solo si vendés productos: ¿son nuevos, usados o hechos a medida? ¿Das una garantía además de la legal? Si un producto llega dañado o falla, ¿cómo lo resolvés hoy y en cuántos días devolvés el dinero?' },
  ] },
];

const TEXTO_VENDE_PRODUCTOS = 'Vendo productos';

const ARCHIVOS = {
  titulo: 'Subí lo que tengas',
  ayuda: 'Lo usamos para conocer tu negocio y armar tus documentos nuevos.',
  detalle: 'Opcional: tus términos y condiciones, tu política de privacidad, un dossier o presentación, capturas. PDF, Word o imágenes, hasta 20 MB en total.',
};
const REDES = { titulo: 'Links de redes', detalle: 'Opcional: Instagram, LinkedIn, TikTok u otras.' };

// Casilla de consentimiento (texto de Tomás, 02/11/2026, procedimiento.md).
// La última frase se publica solo cuando `tecnico` confirme en las condiciones
// del proveedor de IA que no entrena con los datos: hasta entonces queda
// apagada (DOCS_CONSENTIMIENTO_SIN_ENTRENAMIENTO=true la muestra).
// [COMPLETAR · tecnico: plan contratado y condiciones de retención]
function textoConsentimiento(env = process.env) {
  const base = 'Acepto que, para preparar mi documento, Legal Pacer use herramientas de procesamiento de información y que un abogado de WTR | abogados revise el documento antes de entregármelo.';
  const sinEntrenamiento = String(env.DOCS_CONSENTIMIENTO_SIN_ENTRENAMIENTO || '').trim().toLowerCase() === 'true';
  return sinEntrenamiento ? `${base} Esa información no se usará para entrenar modelos de inteligencia artificial.` : base;
}

const LIMITES = { como: 2000, respuesta: 4000, redes: 1000 };

// documentos: ['terminos'] | ['privacidad'] | ['terminos','privacidad']
function preguntasPara(documentos) {
  const tyc = documentos.includes('terminos');
  const pp = documentos.includes('privacidad');
  const soloTyc = tyc && !pp;
  const soloPp = pp && !tyc;
  return SECCIONES.map(s => ({
    titulo: s.titulo,
    preguntas: s.preguntas
      .filter(p => p.para === 'ambas' || (p.para === 'tyc' && tyc) || (p.para === 'pp' && pp))
      .map(p => ({
        id: p.id,
        texto: (soloTyc && p.textoSoloTyc) || (soloPp && p.textoSoloPp) || p.texto,
        vendeProductos: !!p.vendeProductos,
        soloSiVendeProductos: !!p.soloSiVendeProductos,
      })),
  })).filter(s => s.preguntas.length);
}

function idsVisibles(documentos) {
  return new Set(preguntasPara(documentos).flatMap(s => s.preguntas.map(p => p.id)));
}

const limpiar = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

// Normaliza lo que manda el navegador: solo las claves conocidas y visibles
// para este pedido, con tope de largo. Todo lo demás se descarta.
// Devuelve { alcance: {C1: {valor:'si'|'no'|'', como}}, respuestas: {F1: '...'},
//            vende_productos: bool, redes: '...' }.
function normalizarRespuestas(body, documentos) {
  const entrada = body && typeof body === 'object' ? body : {};
  const alcIn = entrada.alcance && typeof entrada.alcance === 'object' ? entrada.alcance : {};
  const resIn = entrada.respuestas && typeof entrada.respuestas === 'object' ? entrada.respuestas : {};
  const alcance = {};
  for (const c of ALCANCE) {
    const r = Object.prototype.hasOwnProperty.call(alcIn, c.id) && alcIn[c.id] && typeof alcIn[c.id] === 'object' ? alcIn[c.id] : {};
    const valor = r.valor === 'si' || r.valor === 'no' ? r.valor : '';
    alcance[c.id] = { valor, como: valor === 'si' ? limpiar(r.como, LIMITES.como) : '' };
  }
  const visibles = idsVisibles(documentos);
  const vende = visibles.has('F19') && entrada.vende_productos === true;
  const respuestas = {};
  for (const id of visibles) {
    if (id === 'F21' && !vende) continue;
    if (!Object.prototype.hasOwnProperty.call(resIn, id)) continue;
    const v = limpiar(resIn[id], LIMITES.respuesta);
    if (v) respuestas[id] = v;
  }
  return { alcance, respuestas, vende_productos: vende, redes: limpiar(entrada.redes, LIMITES.redes) };
}

// Lo que falta para poder enviar el formulario (vacío = se puede enviar).
// C1 a C7 son sí o no: se piden todas. Las F se pueden dejar en blanco
// ("Si una pregunta no aplica, dejala en blanco").
function faltantesParaEnviar(datos, consentimientoIa) {
  const faltan = ALCANCE.filter(c => !datos.alcance[c.id] || !datos.alcance[c.id].valor).map(c => c.id);
  if (!consentimientoIa) faltan.push('consentimiento');
  return faltan;
}

// Para el panel: cada pregunta visible con su respuesta, en orden.
function respuestasLegibles(datos, documentos) {
  const out = [];
  for (const c of ALCANCE) {
    const r = (datos && datos.alcance && datos.alcance[c.id]) || {};
    out.push({ id: c.id, pregunta: c.texto, respuesta: r.valor === 'si' ? 'Sí' : r.valor === 'no' ? 'No' : '',
      como_pregunta: c.como, como: r.como || '' });
  }
  for (const s of preguntasPara(documentos)) {
    for (const p of s.preguntas) {
      if (p.soloSiVendeProductos && !(datos && datos.vende_productos)) continue;
      out.push({ id: p.id, seccion: s.titulo, pregunta: p.texto, respuesta: (datos && datos.respuestas && datos.respuestas[p.id]) || '' });
    }
  }
  out.push({ id: 'vende_productos', pregunta: TEXTO_VENDE_PRODUCTOS, respuesta: datos && datos.vende_productos ? 'Sí' : 'No' });
  out.push({ id: 'redes', pregunta: REDES.titulo, respuesta: (datos && datos.redes) || '' });
  return out;
}

module.exports = {
  ALCANCE, SECCIONES, ARCHIVOS, REDES, CIERRE, LIMITES, TEXTO_VENDE_PRODUCTOS,
  introFormulario, textoConsentimiento, preguntasPara, normalizarRespuestas, faltantesParaEnviar, respuestasLegibles,
};
