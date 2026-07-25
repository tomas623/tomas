// Arma un "prompt" en texto plano con todos los datos del registro, listo para
// pegar en la extensión de Claude para Chrome y que complete el formulario del
// INPI. No lleva formato HTML: es texto para copiar y pegar.

function domTxt(d) {
  if (!d) return '-';
  return [d.calle, d.ciudad, d.provincia ? `Provincia de ${d.provincia}` : null, d.cp ? `CP ${d.cp}` : null]
    .filter(Boolean).join(', ') || '-';
}

function titularTxt(t, i) {
  const pct = t.porcentaje != null ? `\n  Porcentaje de titularidad: ${t.porcentaje}%` : '';
  const contacto = `\n  Email: ${t.email || '-'} · Teléfono: ${t.telefono || '-'}`;
  if (t.tipo === 'juridica') {
    return `Titular ${i + 1} — PERSONA JURÍDICA (empresa)\n`
      + `  Razón social: ${t.razon_social || '-'}\n`
      + `  CUIT: ${t.cuit || '-'}\n`
      + `  Firma en representación: ${t.representante || '-'}`
      + `${t.representante_dni ? `, DNI ${t.representante_dni}` : ''}`
      + `${t.representante_cuit ? `, CUIT ${t.representante_cuit}` : ''}`
      + `${t.cargo ? `, en carácter de ${t.cargo}` : ''}\n`
      + `  Domicilio: ${domTxt(t.domicilio)}`
      + contacto + pct;
  }
  return `Titular ${i + 1} — PERSONA FÍSICA\n`
    + `  Nombre y apellido: ${t.nombre || '-'}\n`
    + `  DNI: ${t.dni || '-'} · CUIT/CUIL: ${t.cuit || '-'}\n`
    + `  Estado civil: ${t.estado_civil || '-'}${t.conyuge ? ` (cónyuge: ${t.conyuge})` : ''}\n`
    + `  Domicilio: ${domTxt(t.domicilio)}`
    + contacto + pct;
}

function construirPromptINPI(datos, marca, clasesTxt) {
  const d = datos || {};
  const tits = (d.titulares || []).map((t, i) => titularTxt(t, i)).join('\n\n');
  const tipoMarca = (d.marca && d.marca.tipo) || 'denominativa';
  const denom = (d.marca && d.marca.denominacion) || marca || '-';
  const clases = d.clases || clasesTxt || '-';
  const notaLogo = tipoMarca !== 'denominativa' ? '\n  (Marca con logo — el archivo del logo está adjunto/en el panel.)' : '';

  return `Necesito cargar una solicitud de registro de marca en el sitio del INPI (Argentina, https://portaltramites.inpi.gob.ar). Completá el formulario paso a paso con estos datos. Si algún campo del formulario no tiene un dato acá, dejalo vacío y avisame cuál falta.

MARCA
  Denominación exacta: ${denom}
  Tipo: ${tipoMarca}${notaLogo}
  Clase(s) Niza / productos y servicios a proteger: ${clases}

TITULARIDAD: ${d.cantidad_titulares === 'varios' ? 'COTITULARIDAD (varios titulares, respetar los porcentajes)' : 'ÚNICO TITULAR'}

${tits}

Antes de confirmar, mostrame un resumen de lo que cargaste para que lo revise.`;
}

module.exports = { construirPromptINPI };
