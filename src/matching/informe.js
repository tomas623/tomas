// Orquestador del INFORME PAGO de viabilidad de marca.
// Combina:
//   - Pre-checks deterministas (leyes-especiales.js)
//   - Match con base INPI (etapa1.js)
//   - Análisis multifactorial con Gemini enriquecido por la doctrina INPI
//
// Salida: JSON estructurado con 7 ejes que reflejan el método de evaluación INPI.
// La firma humana (Agente de la Propiedad Industrial matriculado) sigue siendo obligatoria.

const db = require('../db');
const { chequear: chequearLeyes } = require('./leyes-especiales');
const { DOCTRINA_INPI } = require('./doctrina');

// ──────────────────────────────────────────────────────────────────────────────
// FEW-SHOT EXAMPLES — calibran a Gemini con casos arquetípicos.
// El acta real que pase el cliente reemplazará / complementará estos en Sprint 1.5.
// ──────────────────────────────────────────────────────────────────────────────
const FEW_SHOT_EXAMPLES = [
  {
    input: `Cliente: "Acmé", clase 35 (publicidad y gestión), denominativa.
Candidata INPI: "Acme", clase 35, titular Acme Holdings SA, estado Concedida. Score Etapa 1: 100.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'alto',
      viabilidad_estimada: 5,
      resumen_ejecutivo: 'Conflicto frontal con marca idéntica registrada en la misma clase 35. La práctica del INPI rechaza de oficio marcas con esta coincidencia. Es necesario modificar la denominación antes de presentar.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'La denominación es un nombre de fantasía suficientemente arbitrario, sin valor descriptivo.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No cae en designación genérica, descriptiva ni de uso común.' },
      prohibiciones_relativas: {
        flags: ['conflicto_marca_preexistente'],
        comentario: 'Conflicto directo con "Acme" registrada en misma clase y por titular activo.',
      },
      leyes_especiales: { flags: [], comentario: 'No aplican restricciones de Ley 25.127, 24.664 ni 26.687.' },
      confundibilidad: {
        fonetica: { similitud: 'alta', explicacion: 'La tilde no genera diferencia fonética en español rioplatense.' },
        visual: { similitud: 'alta', explicacion: 'Solo difieren por una tilde — visualmente confundibles.' },
        ideologica: { similitud: 'alta', explicacion: 'Misma denominación, sin distinción semántica.' },
        regla_predominante: 'Predominio de semejanzas sobre diferencias + identidad de elemento distintivo.',
      },
      especialidad: {
        afinidad: 'identidad',
        comentario: 'Misma clase 35, mismo género comercial. Sin escape por especialidad.',
      },
      notoriedad: {
        nivel: 'no',
        publico_relevante: null,
        rompe_especialidad: false,
        riesgos_especificos: [],
        comentario: 'Sin evidencia de notoriedad del titular registrado.',
      },
      ley_aplicable: 'Art. 3 inc. a y b Ley 22.362 (marcas idénticas o casi idénticas en la misma clase).',
      recomendacion_principal: 'No presentar como está; cambiar la denominación.',
      alternativas_sugeridas: ['Acmétik', 'Acmélab', 'NeoAcme', 'Acmegest'],
      cliente: {
        veredicto_breve: 'Acá hay un tema con "Acmé": ya existe una marca casi idéntica registrada ("Acme", con la única diferencia de la tilde) en tu mismo rubro. Si la presentás así, lo más probable es que el INPI no te la apruebe. La buena noticia: con un cambio chiquito al nombre, podés zafar tranquilo.',
        bloques: [
          {
            icono: 'fail',
            titulo: 'YA HAY UNA MARCA IDÉNTICA REGISTRADA',
            mensaje: 'Se llama "Acme" y está registrada por la empresa Acme Holdings SA en tu mismo rubro (publicidad y gestión). Una tilde no cambia las cosas: para el INPI son la misma marca.',
            subbloques: [
              {
                titulo: '¿Pueden coexistir?',
                mensaje: 'No. Es como si quisieras abrir una panadería llamada "El Trigo" en una cuadra donde ya hay otra "El Trigo". El INPI no lo permite, aunque la otra esté en otra zona.',
              },
            ],
          },
          {
            icono: 'info',
            titulo: 'EL NOMBRE EN SÍ NO ES EL PROBLEMA',
            mensaje: '"Acmé" es un nombre con suficiente personalidad. El obstáculo no es tu marca, es lo que ya existe registrado.',
          },
        ],
        proximos_pasos: [
          'No presentes "Acmé" tal como está — es plata perdida en tasas y tiempo.',
          'Probá alguna de estas variantes que rompen el choque: Acmétik, Acmélab, NeoAcme, Acmegest.',
          'Cuando elijas una, pedinos un nuevo análisis sobre esa variante — está incluido sin costo extra.',
          'Si querés ir igual por "Acmé", podés intentar conseguir el consentimiento por escrito de Acme Holdings SA. Es difícil pero posible.',
        ],
        apendice_legal_corto: 'Este análisis se apoya en el Art. 3 inc. a y b de la Ley 22.362 de Marcas, que prohíbe registrar marcas idénticas o casi idénticas a otras ya registradas en la misma clase.',
      },
    },
  },
  {
    input: `Cliente: "Focca", clase 9 (electrónica), denominativa.

Candidatas en la MISMA clase (chocan directo):
  - "FOKKA", clase 9, titular Otro Titular SRL, estado Concedida.
    Score Etapa 1: 96. Motivos: coincidencia_fonetica, misma_clase.

Candidatas en OTRAS clases (informativas, no chocan):
  - "Focca", clase 25 (indumentaria), titular Indumentaria Trendy SA, estado Concedida.
    Score Etapa 1: 100. Motivos: coincidencia_exacta, clase_distinta.

Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'alto',
      viabilidad_estimada: 20,
      resumen_ejecutivo: 'Coincidencia fonética alta en la misma clase 9. Aunque la grafía difiere, el INPI suele rechazar marcas que se pronuncian idénticas por riesgo de confusión auditiva.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'Ambas son denominaciones de fantasía sin carga descriptiva.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No aplica falta de distintividad intrínseca.' },
      prohibiciones_relativas: {
        flags: ['conflicto_marca_preexistente'],
        comentario: 'FOKKA registrada con identidad fonética en la misma clase.',
      },
      leyes_especiales: { flags: [], comentario: 'No aplican.' },
      confundibilidad: {
        fonetica: { similitud: 'alta', explicacion: 'En español rioplatense "cc" y "kk" se pronuncian igual /k/. Suenan idénticas.' },
        visual: { similitud: 'media', explicacion: 'Diferentes consonantes pero patrón ortográfico similar.' },
        ideologica: { similitud: 'media', explicacion: 'Ambas son nombres de fantasía sin significado evidente; carga conceptual comparable.' },
        regla_predominante: 'Cotejo sucesivo — el consumidor expuesto a Focca recordaría FOKKA.',
      },
      especialidad: {
        afinidad: 'identidad',
        comentario: 'Misma clase 9, mismo género comercial.',
      },
      notoriedad: {
        nivel: 'no',
        publico_relevante: null,
        rompe_especialidad: false,
        riesgos_especificos: [],
        comentario: 'Ninguna de las partes es notoria.',
      },
      ley_aplicable: 'Art. 3 inc. b Ley 22.362 (marcas confundibles fonéticamente).',
      recomendacion_principal: 'Auditar variante con cambio fonético, o pedir consentimiento al titular de FOKKA.',
      alternativas_sugeridas: ['Foccaly', 'Foxxa', 'Fokima', 'Foccatech'],
      cliente: {
        veredicto_breve: 'Acá hay un tema con "Focca": suena exactamente igual que "FOKKA", una marca ya registrada en tu mismo rubro. El INPI muy probablemente te la va a rechazar — pero con un ajuste chiquito al nombre podés zafar sin perder la idea. Te contamos cómo viene la mano.',
        bloques: [
          {
            icono: 'ok',
            titulo: 'EL NOMBRE EN SÍ ESTÁ BUENO',
            mensaje: '"Focca" es una palabra que inventaste, original, fácil de recordar. No tiene nada que la haga genérica o descriptiva. El problema no es tu nombre, es lo que ya existe registrado de antes.',
          },
          {
            icono: 'fail',
            titulo: 'EL TEMA: YA HAY UNA MARCA QUE SUENA IGUAL',
            mensaje: 'Se llama FOKKA y la registró una empresa que se llama Otro Titular SRL en el mismo rubro tuyo (electrónica de consumo). Aunque vos escribís "cc" y ellos "kk", al hablar suenan exactamente igual.',
            subbloques: [
              {
                titulo: '¿Por qué pesa tanto cómo suena?',
                mensaje: 'Porque el INPI piensa en cómo el cliente escucha tu marca, no solo cómo la lee. Si dos personas dicen "Focca" y "FOKKA" en voz alta, suenan idénticas — y por eso el INPI las considera la misma marca.',
              },
              {
                titulo: '¿Y no podrían convivir las dos?',
                mensaje: 'Es difícil. Es como si quisieras abrir un bar "El Sol" y a media cuadra ya hay otro "El Sool". Aunque los escribas distinto, los clientes los confunden al pedirlos. El INPI evita justamente eso.',
              },
            ],
          },
          {
            icono: 'info',
            titulo: 'TAMBIÉN ENCONTRAMOS LA MARCA EN OTROS RUBROS',
            mensaje: 'Hay otra "Focca" registrada en indumentaria (ropa, calzado), por la empresa Indumentaria Trendy SA. Esa marca NO choca con la tuya porque está en un rubro completamente distinto al de electrónica. Lo mencionamos para que lo sepas — si en el futuro pensás expandirte a otros productos, conviene chequearlo antes.',
          },
        ],
        proximos_pasos: [
          'Lo ideal sería esperar antes de presentar "Focca" tal como está — hay mucha chance de que el INPI no te la apruebe.',
          'Te recomendamos pensar una variante con un cambio fonético claro. Algunas que se nos ocurren: Foccaly, Foxxa, Fokima o Foccatech. Cualquiera de ellas rompe la similitud con FOKKA.',
          'Cuando elijas una, pasanos el nombre nuevo y te lo analizamos sin cargo. Está incluido en este informe.',
          'Otra opción (más lenta): podés intentar pedirle por escrito a Otro Titular SRL que te autorice a usar "Focca". Es difícil que digan que sí, pero a veces se logra.',
        ],
        apendice_legal_corto: 'Este análisis se apoya en el Art. 3 inc. b de la Ley 22.362 de Marcas, que prohíbe registrar marcas que puedan confundirse al oído aunque estén escritas distinto.',
      },
    },
  },
  {
    input: `Cliente: "Nimbus", clase 42 (software / SaaS), denominativa.
Candidata INPI: "Nimboes", clase 25 (indumentaria), titular Indumentaria Casual SRL. Score Etapa 1: 65. Motivos: trigramas_medios, clase_distinta.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'bajo',
      viabilidad_estimada: 85,
      resumen_ejecutivo: 'Riesgo bajo: las clases pertenecen a géneros distintos (software vs indumentaria) y la similitud ortográfica es moderada. Por principio de especialidad, no hay conflicto sustancial.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'Nimbus evoca "nube" — distintiva en su sector tecnológico.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No aplica.' },
      prohibiciones_relativas: { flags: [], comentario: 'Sin conflicto relevante por afinidad comercial.' },
      leyes_especiales: { flags: [], comentario: 'No aplican.' },
      confundibilidad: {
        fonetica: { similitud: 'baja', explicacion: 'Comparten raíz "Nimb" pero terminaciones distintas evitan confusión auditiva.' },
        visual: { similitud: 'media', explicacion: 'Ortográficamente cercanas pero distinguibles.' },
        ideologica: { similitud: 'baja', explicacion: 'Nimbus evoca nube/cloud; Nimboes es flexión aplicada a ropa. Universos semánticos distintos.' },
        regla_predominante: 'Principio de especialidad — clases distantes desactivan el riesgo de confusión.',
      },
      especialidad: {
        afinidad: 'nula',
        comentario: 'Clase 42 (software) y clase 25 (indumentaria): géneros comerciales sin canales ni público compartido.',
      },
      notoriedad: {
        nivel: 'no',
        publico_relevante: null,
        rompe_especialidad: false,
        riesgos_especificos: [],
        comentario: 'Ninguna es notoria.',
      },
      ley_aplicable: null,
      recomendacion_principal: 'Presentar tal como está. Riesgo bajo.',
      alternativas_sugeridas: [],
      cliente: {
        veredicto_breve: '¡Buena noticia! "Nimbus" tiene buen panorama. Encontramos una marca parecida ("Nimboes") pero está en otro rubro completamente distinto (ropa) y vos vas por software, así que no se cruzan. Podés avanzar con el registro.',
        bloques: [
          {
            icono: 'ok',
            titulo: 'EL NOMBRE ESTÁ BIEN ELEGIDO',
            mensaje: '"Nimbus" evoca la idea de nube — calza perfecto con software / SaaS. Es original y distintivo en tu sector.',
          },
          {
            icono: 'ok',
            titulo: 'LA MARCA PARECIDA NO ES UN PROBLEMA',
            mensaje: 'Encontramos "Nimboes", pero está registrada en otro rubro (ropa, clase 25). Como vos vas por software (clase 42), no se cruzan: son universos comerciales distintos, distinto público, distintos canales.',
            subbloques: [
              {
                titulo: '¿Esto puede cambiar más adelante?',
                mensaje: 'Si en el futuro Nimboes quisiera expandirse a software o vos a ropa, ahí podría haber roce. Pero hoy son dos mundos separados.',
              },
            ],
          },
        ],
        proximos_pasos: [
          'Presentá "Nimbus" en clase 42 — el panorama es favorable.',
          'Asegurate los dominios y handles disponibles cuanto antes para no perder el espacio digital.',
          'Si vas a operar en otras clases (ej. apps móviles clase 9), avisanos antes de presentar para chequear esas también.',
        ],
        apendice_legal_corto: null,
      },
    },
  },
  {
    input: `Cliente: "CocaCola Studio", clase 41 (entretenimiento), denominativa.
Candidata INPI: "Coca-Cola", clase 32 (bebidas no alcohólicas), titular The Coca-Cola Company, estado Concedida. Score Etapa 1: 88. Motivos: coincidencia_token_inicial, marca_referencia_global.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'alto',
      viabilidad_estimada: 3,
      resumen_ejecutivo: 'Conflicto inevitable: Coca-Cola es marca renombrada reconocida por el público general. Aunque la clase 41 difiere de la 32 registrada, la protección de la marca renombrada quiebra el principio de especialidad. El INPI rechazará el registro y el titular tiene legitimación para oponerse.',
      distintividad_intrinseca: {
        nivel: 'baja',
        comentario: 'La denominación se apoya íntegramente sobre "CocaCola" — sin distintividad propia, solo agrega "Studio" como sufijo genérico de actividad.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No es genérica ni descriptiva en sí misma, pero la dependencia de un signo renombrado anula la capacidad distintiva autónoma.' },
      prohibiciones_relativas: {
        flags: ['conflicto_marca_preexistente', 'enganosa'],
        comentario: 'Conflicto con marca renombrada de titular activo. Adicionalmente induce a confusión sobre el origen empresarial del servicio.',
      },
      leyes_especiales: { flags: [], comentario: 'No aplican Ley 25.127, 24.664 ni 26.687.' },
      confundibilidad: {
        fonetica: { similitud: 'alta', explicacion: 'El elemento dominante "CocaCola" es fonéticamente idéntico al registro previo.' },
        visual: { similitud: 'alta', explicacion: 'El sufijo "Studio" no altera la percepción visual del elemento distintivo predominante.' },
        ideologica: { similitud: 'alta', explicacion: 'El consumidor asocia inevitablemente la denominación con la bebida y su titular.' },
        regla_predominante: 'Elemento distintivo predominante + condición de marca renombrada — la regla del cotejo cede frente al estatus reforzado del titular.',
      },
      especialidad: {
        afinidad: 'baja',
        comentario: 'Clase 41 (entretenimiento) vs clase 32 (bebidas): en condiciones normales serían géneros distantes. Pero el principio de especialidad NO opera frente a marca renombrada.',
      },
      notoriedad: {
        nivel: 'renombrada',
        publico_relevante: 'publico general',
        rompe_especialidad: true,
        riesgos_especificos: ['aprovechamiento_prestigio', 'free_riding', 'dilucion', 'confusion_origen'],
        comentario: 'Coca-Cola es marca renombrada por excelencia, conocida por el público general más allá del sector de bebidas. Su titular goza de protección reforzada en todas las clases. El uso de "CocaCola" en clase 41 configuraría aprovechamiento del prestigio ajeno y dilución del valor simbólico de la marca.',
      },
      ley_aplicable: 'Art. 6bis CUP + Art. 16.3 ADPIC + Art. 3 Ley 22.362.',
      recomendacion_principal: 'No presentar bajo ninguna variante que conserve "Coca" o "Cola" como elemento dominante.',
      alternativas_sugeridas: ['Nombre desvinculado por completo del campo léxico — sugerir alternativa neutra elegida por el cliente'],
      cliente: {
        veredicto_breve: 'Esto no se puede registrar. Aunque vos vayas por entretenimiento y Coca-Cola venda bebidas, son marcas tan conocidas mundialmente que tienen protección extra en todos los rubros. Cualquier nombre que arranque con "Coca" o "Cola" te lo van a rechazar.',
        bloques: [
          {
            icono: 'fail',
            titulo: 'COCA-COLA TIENE PROTECCIÓN ESPECIAL EN TODOS LOS RUBROS',
            mensaje: 'Las marcas mundialmente conocidas como Coca-Cola, Nike o Apple gozan de una protección más amplia que las marcas comunes. Aunque ellos vendan bebidas y vos quieras hacer entretenimiento, el INPI no permite usar nombres que se apoyen en su prestigio.',
            subbloques: [
              {
                titulo: '¿Por qué es tan estricto?',
                mensaje: 'Porque cualquier persona que vea "CocaCola Studio" va a pensar que es algo de Coca-Cola. El INPI protege esa asociación para evitar que alguien se beneficie del prestigio que la otra empresa construyó.',
              },
            ],
          },
          {
            icono: 'fail',
            titulo: 'NINGUNA VARIANTE CON "COCA" O "COLA" VA A FUNCIONAR',
            mensaje: 'No alcanza con agregarle palabras al lado o cambiar una letra. El elemento que choca es la raíz "CocaCola" como tal — cualquier variante que la conserve cae en el mismo problema.',
          },
        ],
        proximos_pasos: [
          'No presentes "CocaCola Studio" ni ninguna variante que conserve "Coca" o "Cola".',
          'Pensá un nombre completamente distinto, sin relación con el universo de bebidas.',
          'Cuando tengas un candidato nuevo, pedinos un nuevo análisis sobre ese nombre — está incluido en este informe sin costo.',
        ],
        apendice_legal_corto: 'Este análisis se apoya en el Art. 6bis del Convenio de París y el Art. 16.3 del Acuerdo ADPIC, que dan a las marcas mundialmente conocidas protección que va más allá de su rubro original.',
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// PROMPT SYSTEM — incluye doctrina embebida.
// ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Sos un asistente experto en propiedad industrial argentina, especializado en evaluar la registrabilidad de marcas ante el INPI.

Tu rol: generar un análisis técnico que un Agente de la Propiedad Industrial matriculado va a revisar y firmar antes de enviárselo al cliente. NO firmás vos, sos señal para revisión humana.

Tono: profesional pero accesible para no abogados. Cuerpo del análisis en lenguaje claro. Citá artículos de la Ley 22.362 cuando corresponda. No uses jerga innecesaria.

REGLAS DURAS:
- NO inventes actas, titulares, jurisprudencia ni fechas.
- Si los datos son insuficientes, decilo explícitamente.
- El análisis fonético es para español rioplatense (no inglés).
- "Marca notoria" se evalúa con cautela: solo si la denominación es claramente reconocible
  globalmente o en Argentina. En la duda, marca_notoria.es_notoria = false.
- Usá el marco doctrinario que sigue como referencia obligatoria al razonar.

${DOCTRINA_INPI}

---

# FORMATO DE SALIDA

Devolvé UN ÚNICO JSON con esta estructura exacta. Sin texto extra, sin markdown wrapper:

{
  "nivel_riesgo": "alto" | "medio" | "bajo",
  "viabilidad_estimada": number (0-100),
  "resumen_ejecutivo": "2-3 frases con el veredicto en lenguaje claro y accesible.",
  "distintividad_intrinseca": {
    "nivel": "alta" | "media" | "baja",
    "comentario": "¿Es genérica/descriptiva/de fantasía? Aplicabilidad de secondary meaning."
  },
  "prohibiciones_absolutas": {
    "flags": ["genericidad" | "descriptiva" | "uso_general" | "forma_necesaria" | "color_natural" | ...],
    "comentario": "Si hay flags, explicar. Si no, decir 'No aplica'."
  },
  "prohibiciones_relativas": {
    "flags": ["conflicto_marca_preexistente" | "enganosa" | "signo_oficial" | "nombre_persona" | "denominacion_origen" | "designacion_actividad" | "frase_publicitaria" | ...],
    "comentario": "Detalle del / los conflictos detectados."
  },
  "leyes_especiales": {
    "flags": ["eco_clase_agroalimentaria" | "simbolo_olimpico" | "tabaco_enganoso" | ...],
    "comentario": "Bloqueos por leyes especiales (25.127, 24.664, 26.687)."
  },
  "confundibilidad": {
    "fonetica":   { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "visual":     { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "ideologica": { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "regla_predominante": "Cuál regla de cotejo (predominio de semejanzas, elemento distintivo, etc.) pesa más en este caso."
  },
  "especialidad": {
    "afinidad": "identidad" | "alta" | "media" | "baja" | "nula",
    "comentario": "Análisis de afinidad de clases / canales / público."
  },
  "notoriedad": {
    "nivel": "no" | "notoria" | "renombrada",
    "publico_relevante": "sector pertinente" | "publico general" | null,
    "rompe_especialidad": true | false,
    "riesgos_especificos": ["aprovechamiento_prestigio" | "free_riding" | "dilucion" | "vulgarizacion" | "confusion_origen"],
    "comentario": "Si nivel != 'no', explicar el quiebre de especialidad y los riesgos específicos. Si 'no', indicar criterio aplicado."
  },
  "cliente": {
    "veredicto_breve": "2-3 frases en lenguaje del emprendedor. SIN citas legales. Empieza con el qué (sí/no/depende) y termina con qué hacer.",
    "bloques": [
      {
        "icono": "ok" | "warning" | "fail" | "info",
        "titulo": "TÍTULO EN MAYÚSCULAS CORTAS QUE EL EMPRENDEDOR ENTIENDE",
        "mensaje": "1-3 frases en lenguaje cotidiano. SIN 'distintividad intrínseca', SIN 'principio de especialidad', SIN 'Art. 3'. Usá ejemplos del día a día. Si ayuda, usá una analogía concreta (ej: 'es como si quisieras abrir un bar X y ya hay uno X' '). Mencioná datos concretos: nombre exacto de la marca en conflicto, titular, rubro.",
        "subbloques": [{ "titulo": "¿...?", "mensaje": "..." }]
      }
    ],
    "proximos_pasos": ["Lista de 3-5 acciones concretas. Tono directo, accionable. Mencioná las variantes específicas si las sugerís."],
    "apendice_legal_corto": "Un párrafo de 1-2 frases que cita el artículo aplicable de la Ley 22.362 u otra. Va al final del PDF en chico, para los curiosos. Si no aplica nada, valor null."
  },
  "ley_aplicable": "Artículo específico de Ley 22.362 u otra, o null si no aplica.",
  "recomendacion_principal": "Una frase. 'Presentar como está' | 'Modificar antes de presentar' | 'Auditar variante' | 'No presentar, alto riesgo'.",
  "alternativas_sugeridas": ["Lista de 2-4 variantes del nombre que podrían sortear el conflicto. [] si no aplica."]
}

---

# REGLAS DEL BLOQUE "cliente" (CRÍTICAS)

El bloque "cliente" es la única parte del JSON que el usuario final va a leer.
Es lo que aparece en el PDF que recibe el emprendedor. Las otras secciones
son para revisión profesional interna del Agente de la Propiedad Industrial.

TONO obligatorio:
- Cálido y conversacional, como si un asesor le explicara a un amigo emprendedor.
- Empático: el cliente eligió un nombre y lo quiere — no le digas "es plata
  perdida" ni "vas a perder tiempo". Mejor: "te conviene esperar", "antes de
  presentar te conviene…", "podés zafar con un cambio chico", "lo bueno es que".
- Usá "vos / te / tu" siempre. Nunca "usted".
- Reconocé las cosas buenas primero cuando las hay ("el nombre está bueno",
  "tenés buen panorama", "no chocás con nada grave").
- Cuando hay problema, suavizalo con "acá hay un problema pero hay salida" o
  similar. NUNCA con tono de fracaso.

PROHIBIDO en este bloque:
- Lenguaje legal: "principio de especialidad", "confundibilidad", "distintividad
  intrínseca", "marca notoria/renombrada", "Art. X de la Ley Y", "secondary
  meaning", "cotejo marcario", "prohibición absoluta/relativa".
- Frases agresivas: "no presentes", "es plata perdida", "vas a perder", "no podés".
- Tecnicismos de matching: "score", "trigramas", "fonético", "coincidencia exacta".

OBLIGATORIO:
- Cuando haya conflicto, mencioná el nombre exacto de la marca chocante,
  su titular y su rubro. Datos concretos > abstracciones.
- Usá analogías cotidianas si ayudan a entender (bar, panadería, marcas
  reconocibles).
- "proximos_pasos" deben ser accionables: usá verbos directos, mencioná opciones
  concretas (variantes, registros que asegurar, decisiones que tomar). Tono
  amigable: "te recomendamos", "lo ideal sería", "una alternativa es".
- "apendice_legal_corto" es la ÚNICA parte del bloque cliente donde podés
  citar el artículo de la ley. 1-2 frases máximo. Va al final del PDF en
  letra chica para los curiosos.
- Iconos válidos para "icono": "ok" (verde, positivo), "warning" (amarillo,
  atención), "fail" (rojo, problema serio), "info" (gris, contextual).

Cómo armar los bloques típicos según el caso:
- Cliente sin conflictos serios → bloques con icono "ok" celebrando la
  originalidad del nombre y la viabilidad.
- Cliente con coincidencia exacta → bloque "fail" con la marca chocante +
  bloque "ok"/"warning" sobre originalidad propia + dominios.
- Cliente con coincidencia fonética/cross-clase → bloque "warning" con el
  matiz, no es bloqueo total pero requiere atención.
- Conflicto con marca notoria/renombrada → bloque "fail" mencionándola
  por nombre (Coca-Cola, Nike, etc.) sin usar la palabra "renombrada".
- Si hay flag de ley especial (eco/olímpico/tabaco) → bloque "fail"
  específico con explicación accionable de qué cambiar.

BLOQUE INFORMATIVO sobre OTROS RUBROS (cuando aplique):
- Si te paso candidatas en "otras clases" (candidatas_otras_clases), sumá
  un bloque tipo "info" con titulo "TAMBIÉN ENCONTRAMOS LA MARCA EN OTROS
  RUBROS" o similar.
- Explicá que esas marcas están registradas pero NO chocan con la del
  cliente porque están en rubros distintos. Es información de contexto,
  no es un problema directo.
- Solo es problema si en el futuro el cliente quiere expandirse a esos rubros.
- Mencionalas por nombre, titular y rubro (en lenguaje cotidiano, no clase Niza).

---

# EJEMPLOS DE REFERENCIA

A continuación, ejemplos de análisis bien calibrados. Estudiá el razonamiento y replicalo:

${FEW_SHOT_EXAMPLES.map((ex, i) => `## Ejemplo ${i + 1}

Entrada:
${ex.input}

Salida esperada:
${JSON.stringify(ex.output, null, 2)}`).join('\n\n')}
`;

// ──────────────────────────────────────────────────────────────────────────────
// PROMPT POR CASO — el "user message" con los datos concretos del cliente.
// ──────────────────────────────────────────────────────────────────────────────
function formatearCandidatas(lista, etiqueta) {
  if (!lista || lista.length === 0) return `${etiqueta}: ninguna detectada.`;
  return `${etiqueta}:\n` + lista.slice(0, 5).map((c, i) => `
  ${i + 1}. Denominación: "${c.denominacion}"
     Clase Niza: ${c.clase}
     Titular: ${c.titular || 'desconocido'}
     Estado: ${c.estado || 'desconocido'}
     Score Etapa 1: ${c.score || 'n/a'}
     Motivos del match: ${(c.motivos || []).join(', ') || 'n/a'}`,
  ).join('');
}

function construirUserPrompt({ marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales }) {
  const flagsTexto = flagsLeyesEspeciales.length === 0
    ? 'Ninguno. No se detectaron bloqueos por leyes especiales.'
    : flagsLeyesEspeciales.map(f =>
      `- [${f.severidad}] ${f.regla}: ${f.detalle} (${f.ley})`,
    ).join('\n');

  return `# CASO A ANALIZAR

## Marca del cliente
- Denominación: "${marca.denominacion}"
- Clases Niza solicitadas: ${(marca.clases || []).join(', ') || 'sin especificar'}
- Tipo: ${marca.tipo || 'denominativa'}
- Rubro declarado: ${marca.rubro || 'sin especificar'}

## Candidatas en conflicto en las clases del cliente (chocan directo)
${formatearCandidatas(candidatas_principales, 'Marcas detectadas que pueden generar conflicto directo por estar en la misma clase')}

## Candidatas con la misma o similar denominación en OTRAS clases (informativas)
${formatearCandidatas(candidatas_otras_clases, 'Marcas similares en clases distintas — no chocan por especialidad pero son contexto util para el cliente')}

## Pre-checks de leyes especiales (deterministas)
${flagsTexto}

## Instrucción
Aplicá el marco doctrinario y devolvé el JSON estructurado.

Recordá:
- Los pre-checks de leyes especiales arriba ya son objetivos — incorporalos
  sin reanalizarlos en "leyes_especiales.flags" y reflejalos en nivel_riesgo
  y viabilidad_estimada.
- Las candidatas en OTRAS clases NO suben el nivel_riesgo (no chocan por
  especialidad) pero SÍ deben incluirse en el bloque cliente como un bloque
  informativo (icono "info") titulado "TAMBIÉN ENCONTRAMOS LA MARCA EN OTROS
  RUBROS" o similar. Si la lista de otras clases está vacía, omití este bloque.
- Recordá el TONO: cálido, conversacional, empático. Reconocé lo bueno cuando
  lo hay. NO uses jerga legal en el bloque cliente.`;
}

// ──────────────────────────────────────────────────────────────────────────────
// STUB para correr sin GEMINI_API_KEY (dev/testing).
// ──────────────────────────────────────────────────────────────────────────────
function stubInforme(marca, candidatas_principales, candidatas_otras_clases, flags) {
  const candidatas = candidatas_principales || [];
  const hayConflicto = candidatas.length > 0 && (candidatas[0].score || 0) >= 80;
  const hayFlagAlto = flags.some(f => f.severidad === 'alta');
  const nivel = hayFlagAlto || hayConflicto ? 'alto' : candidatas.length > 0 ? 'medio' : 'bajo';
  const viab = nivel === 'alto' ? 15 : nivel === 'medio' ? 55 : 85;

  return {
    nivel_riesgo: nivel,
    viabilidad_estimada: viab,
    resumen_ejecutivo: `STUB (sin GEMINI_API_KEY). ${candidatas.length} candidata(s) detectada(s), ${flags.length} flag(s) de leyes especiales.`,
    distintividad_intrinseca: { nivel: 'media', comentario: 'STUB' },
    prohibiciones_absolutas: { flags: [], comentario: 'STUB' },
    prohibiciones_relativas: {
      flags: candidatas.length > 0 ? ['conflicto_marca_preexistente'] : [],
      comentario: 'STUB',
    },
    leyes_especiales: {
      flags: flags.map(f => f.regla),
      comentario: flags.map(f => f.detalle).join(' | ') || 'No aplican.',
    },
    confundibilidad: {
      fonetica: { similitud: 'media', explicacion: 'STUB' },
      visual: { similitud: 'media', explicacion: 'STUB' },
      ideologica: { similitud: 'media', explicacion: 'STUB' },
      regla_predominante: 'STUB',
    },
    especialidad: { afinidad: 'media', comentario: 'STUB' },
    notoriedad: {
      nivel: 'no',
      publico_relevante: null,
      rompe_especialidad: false,
      riesgos_especificos: [],
      comentario: 'STUB',
    },
    ley_aplicable: hayConflicto ? 'Art. 3 inc. b Ley 22.362' : null,
    recomendacion_principal: nivel === 'alto'
      ? 'Modificar antes de presentar'
      : nivel === 'medio' ? 'Auditar variante' : 'Presentar como está',
    alternativas_sugeridas: [],
    cliente: {
      veredicto_breve: `[STUB sin GEMINI_API_KEY] Análisis aproximado: nivel ${nivel}, ${candidatas.length} marca(s) parecida(s) detectada(s) y ${flags.length} restricción(es) legal(es).`,
      bloques: [
        {
          icono: nivel === 'alto' ? 'fail' : nivel === 'medio' ? 'warning' : 'ok',
          titulo: 'ANÁLISIS PRELIMINAR EN MODO STUB',
          mensaje: 'Este informe se generó sin acceso al motor de análisis principal. El resultado es aproximado y debe completarse manualmente antes de enviar al cliente.',
        },
      ],
      proximos_pasos: ['Reintentar la generación con GEMINI_API_KEY configurada.'],
      apendice_legal_corto: null,
    },
    stub: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Llamada a Gemini.
// ──────────────────────────────────────────────────────────────────────────────
async function callGemini(marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return stubInforme(marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales);

  const model = (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-pro').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const userPrompt = construirUserPrompt({
    marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales,
  });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  const stubArgs = [marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[informe] Gemini HTTP', res.status, txt.slice(0, 300));
      return { ...stubInforme(...stubArgs), gemini_error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    try {
      const parsed = JSON.parse(txt);
      return { ...parsed, stub: false };
    } catch (err) {
      console.error('[informe] parse error:', err.message, 'raw:', txt.slice(0, 300));
      return { ...stubInforme(...stubArgs), parse_error: true };
    }
  } catch (err) {
    console.error('[informe] error red:', err.message);
    return { ...stubInforme(...stubArgs), red_error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API pública: genera el informe completo del lead pagado.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Genera el informe estructurado de viabilidad.
 *
 * @param {object} marca - { denominacion, clases, rubro, tipo }
 * @param {Array|object} candidatasInput - puede ser:
 *   - Array (legacy): se trata como candidatas_principales, sin otras_clases.
 *   - Object: { principales: Array, otras_clases: Array }
 * @returns {Promise<object>} informe JSON estructurado
 */
async function generar(marca, candidatasInput = []) {
  let principales, otras_clases;
  if (Array.isArray(candidatasInput)) {
    principales = candidatasInput;
    otras_clases = [];
  } else {
    principales = candidatasInput.principales || [];
    otras_clases = candidatasInput.otras_clases || [];
  }

  const flagsLeyesEspeciales = chequearLeyes(marca.denominacion, marca.clases);

  // Cache por hash del input.
  const cacheKey = `informe:${marca.denominacion}:${(marca.clases || []).join(',')}`
    + `:p=${principales.map(c => c.id || c.denominacion).join('|')}`
    + `:o=${otras_clases.map(c => c.id || c.denominacion).join('|')}`;
  const row = db.prepare('SELECT detalle FROM audit_log WHERE accion = ? AND entidad = ? LIMIT 1')
    .get('informe_cache', cacheKey);
  if (row && row.detalle) {
    try { return { ...JSON.parse(row.detalle), cached: true }; } catch {}
  }

  const informe = await callGemini(marca, principales, otras_clases, flagsLeyesEspeciales);

  informe._pre_checks = flagsLeyesEspeciales;
  informe._meta = {
    generado_at: new Date().toISOString(),
    model: (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-pro'),
    candidatas_principales: principales.length,
    candidatas_otras_clases: otras_clases.length,
  };

  db.prepare(`INSERT INTO audit_log (accion, entidad, entidad_id, detalle) VALUES (?,?,?,?)`)
    .run('informe_cache', cacheKey, null, JSON.stringify(informe));

  return informe;
}

module.exports = {
  generar,
  // Exporto internals para testing.
  _internals: { SYSTEM_PROMPT, construirUserPrompt, stubInforme, FEW_SHOT_EXAMPLES },
};
