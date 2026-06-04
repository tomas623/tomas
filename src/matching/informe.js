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
        veredicto_breve: 'Detectamos un obstáculo para registrar "Acmé": ya existe una marca casi idéntica registrada en tu mismo rubro ("Acme", con la única diferencia de la tilde). El INPI muy probablemente rechazaría la solicitud tal como está. Con un ajuste en la denominación, el registro pasa a ser viable.',
        bloques: [
          {
            icono: 'fail',
            titulo: 'YA HAY UNA MARCA IDÉNTICA REGISTRADA EN TU RUBRO',
            mensaje: 'Se llama "Acme" y está registrada por la empresa Acme Holdings SA en tu mismo rubro (publicidad y gestión). Para el INPI, la diferencia de una tilde no es suficiente para distinguirlas — las trata como la misma marca.',
            subbloques: [
              {
                titulo: '¿Pueden coexistir?',
                mensaje: 'No. Cuando dos marcas son prácticamente idénticas en la misma clase, el INPI no permite el registro de la segunda. Es como si quisieras abrir una panadería llamada "El Trigo" en una cuadra donde ya hay otra "El Trigo": el nombre ya está tomado.',
              },
            ],
          },
        ],
        proximos_pasos: [
          'Te recomendamos no presentar "Acmé" tal como está mientras "Acme" (Acme Holdings SA) esté vigente en clase 35.',
          'Conviene modificar la denominación con un cambio que vaya más allá de la tilde. Algunas opciones que rompen el conflicto: Acmétik, Acmélab, NeoAcme, Acmegest.',
          'Cuando definas la variante, pasanos el nombre nuevo y la analizamos sin costo adicional. Está incluido en este informe.',
          'Una alternativa más lenta es solicitar a Acme Holdings SA una autorización escrita para coexistir. No es lo habitual, pero existe la vía.',
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
        veredicto_breve: 'Detectamos un obstáculo importante para registrar "Focca": existe otra marca registrada en tu mismo rubro ("FOKKA") que se pronuncia idéntica. El INPI muy probablemente rechazaría la solicitud tal como está. Con un ajuste fonético al nombre, el registro pasa a ser viable.',
        bloques: [
          {
            icono: 'fail',
            titulo: 'YA EXISTE UNA MARCA REGISTRADA QUE SUENA IGUAL',
            mensaje: 'Se llama FOKKA. La registró la empresa Otro Titular SRL en tu mismo rubro (electrónica de consumo). Aunque vos escribís "cc" y ellos "kk", al pronunciarlas suenan exactamente igual.',
            subbloques: [
              {
                titulo: '¿Por qué pesa la pronunciación?',
                mensaje: 'El INPI evalúa cómo el consumidor escucha la marca, no solo cómo la lee. Si dos personas dicen "Focca" y "FOKKA" en voz alta, suenan idénticas — para el INPI son la misma marca a efectos de registro.',
              },
              {
                titulo: '¿Y no podrían coexistir las dos?',
                mensaje: 'Es difícil. Sería como abrir un bar llamado "El Sol" a media cuadra de otro "El Sool": aunque se escriban distinto, los clientes los confunden al pedirlos. El sistema de marcas existe justamente para evitar esa confusión.',
              },
            ],
          },
          {
            icono: 'info',
            titulo: 'TAMBIÉN ENCONTRAMOS LA MARCA EN OTROS RUBROS',
            mensaje: 'Existe otra "Focca" registrada en indumentaria (ropa, calzado), por la empresa Indumentaria Trendy SA. Esa marca NO entra en conflicto con la tuya porque está en un rubro distinto al de electrónica. Lo informamos como dato de contexto — si en el futuro pensás expandirte a otros productos, conviene revisarlo antes.',
          },
        ],
        proximos_pasos: [
          'Te recomendamos no presentar "Focca" tal cual está mientras FOKKA siga vigente como marca registrada en clase 9.',
          'Conviene definir una variante con un cambio fonético claro. Algunas opciones: Foccaly, Foxxa, Fokima o Foccatech. Cualquiera rompe la similitud con FOKKA.',
          'Cuando definas la variante, pasanos el nombre nuevo y la analizamos sin costo adicional. Está incluido en este informe.',
          'Una alternativa más lenta es solicitar a Otro Titular SRL una autorización escrita para coexistir. No es lo habitual, pero existe la vía.',
        ],
        apendice_legal_corto: 'Este análisis se apoya en el Art. 3 inc. b de la Ley 22.362 de Marcas, que prohíbe registrar marcas que puedan confundirse fonéticamente aunque estén escritas distinto.',
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
        veredicto_breve: 'El registro de "Nimbus" en clase 42 (software) es viable. Encontramos una marca parecida ("Nimboes") pero está en un rubro completamente distinto — ropa e indumentaria — por lo que no genera conflicto para tu solicitud.',
        bloques: [
          {
            icono: 'ok',
            titulo: 'EL REGISTRO EN TU RUBRO ES VIABLE',
            mensaje: 'No detectamos marcas registradas que representen un obstáculo en la clase 42 (software y servicios tecnológicos). La solicitud tiene panorama favorable.',
          },
          {
            icono: 'ok',
            titulo: 'LA MARCA PARECIDA NO GENERA CONFLICTO',
            mensaje: 'Encontramos "Nimboes", pero está registrada en otro rubro (ropa e indumentaria, clase 25). Como vos vas por software (clase 42), no se cruzan: son universos comerciales distintos, con distinto público y distintos canales de venta.',
            subbloques: [
              {
                titulo: '¿Esto puede cambiar más adelante?',
                mensaje: 'Si en el futuro quisieras expandirte a otras clases, conviene revisarlas antes de presentar. Pero para clase 42, hoy el panorama es libre.',
              },
            ],
          },
        ],
        proximos_pasos: [
          'Podés avanzar con la presentación de "Nimbus" en clase 42 — el panorama es favorable.',
          'Asegurá los dominios y los perfiles en redes cuanto antes para no perder el espacio digital.',
          'Si vas a operar en otras clases (por ejemplo, apps móviles en clase 9), consultanos antes de presentar para verificarlas también.',
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
        veredicto_breve: 'Detectamos un obstáculo sin salida para registrar "CocaCola Studio". Coca-Cola es una de las marcas más conocidas del mundo y tiene protección especial en todos los rubros, no solo en bebidas. Cualquier denominación que conserve "Coca" o "Cola" como elemento principal será rechazada, independientemente del rubro al que apunte.',
        bloques: [
          {
            icono: 'fail',
            titulo: 'COCA-COLA TIENE PROTECCIÓN ESPECIAL EN TODOS LOS RUBROS',
            mensaje: 'Marcas como Coca-Cola, Nike o Apple tienen una protección más amplia que la mayoría. Aunque vos vayas por entretenimiento y ellos vendan bebidas, el INPI no permite registrar una denominación que tome prestado su nombre — porque cualquier consumidor la va a asociar directamente con ellos.',
            subbloques: [
              {
                titulo: '¿Por qué alcanza a rubros distintos?',
                mensaje: 'Las marcas de ese nivel de reconocimiento tienen protección cruzada entre clases. Cualquier persona que vea "CocaCola Studio" va a pensar que es algo de Coca-Cola Company — eso es exactamente lo que el sistema de marcas busca evitar.',
              },
            ],
          },
          {
            icono: 'fail',
            titulo: 'NINGUNA VARIANTE CON "COCA" O "COLA" RESUELVE EL CONFLICTO',
            mensaje: 'Agregar palabras al lado o cambiar una letra no es suficiente. El elemento conflictivo es la raíz "CocaCola" en sí — cualquier variante que la conserve enfrenta el mismo obstáculo.',
          },
        ],
        proximos_pasos: [
          'Te recomendamos no presentar "CocaCola Studio" ni ninguna variante que conserve "Coca" o "Cola" como elemento dominante.',
          'Conviene definir una denominación completamente distinta, sin relación léxica con el universo de esa marca.',
          'Cuando tengas un candidato nuevo, pasanos el nombre y la analizamos sin costo adicional. Está incluido en este informe.',
        ],
        apendice_legal_corto: 'Este análisis se apoya en el Art. 6bis del Convenio de París y el Art. 16.3 del Acuerdo ADPIC, que otorgan a las marcas mundialmente conocidas protección más allá de su rubro original.',
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
- Profesional, claro y directo. Moderno pero NO familiar. Como un asesor
  técnico que explica sin tecnicismos, no como un amigo emprendedor.
- Empático en cómo encuadrás los problemas, sin paternalismo.
- Usá "vos / te / tu" siempre. Nunca "usted".
- Frases directas y cortas. SIN signos de admiración ("¡Buena noticia!").
- SIN expresiones argot ("zafar", "te contamos cómo viene la mano",
  "acá la cosa", "anda barbara", "viene piola").
- Cuando hay problema, encuadralo con "Detectamos un obstáculo / un conflicto
  / una restricción". NO con "acá hay un tema" ni "tenemos un tema".

NO HACER VALORACIÓN SUBJETIVA DEL NOMBRE:
- LegalPacers analiza VIABILIDAD DE REGISTRO, no la estética ni la calidad
  comercial del nombre.
- Prohibidas frases como "el nombre está bueno", "es un buen nombre",
  "el nombre es lindo", "tiene gancho", "buena elección".
- Si el nombre es suficientemente distintivo para registrarse, no lo digas
  como un cumplido. Mencionalo factualmente solo si suma claridad
  (ej: "Como signo, 'X' es suficientemente distintivo para registrarse").
- Si el nombre es genérico/descriptivo (problema real de registro), sí debe
  aparecer como una observación técnica, no como una valoración.

PROHIBIDO en el bloque cliente:
- Lenguaje legal: "principio de especialidad", "confundibilidad", "distintividad
  intrínseca", "marca notoria/renombrada", "Art. X de la Ley Y", "secondary
  meaning", "cotejo marcario", "prohibición absoluta/relativa".
- Tecnicismos de matching: "score", "trigramas", "fonético", "coincidencia exacta".
- Frases agresivas: "no presentes", "es plata perdida", "vas a perder", "no podés".
- Slang argentino exagerado y exclamaciones.

OBLIGATORIO:
- Cuando haya conflicto, mencioná el nombre exacto de la marca chocante,
  su titular y su rubro. Datos concretos > abstracciones.
- Usá analogías cotidianas si ayudan a entender (bar, panadería, marcas
  reconocibles).
- "proximos_pasos" deben ser accionables: usá "Te recomendamos", "Conviene",
  "Una alternativa es". Mencioná opciones concretas (variantes, registros que
  asegurar, decisiones que tomar).
- "apendice_legal_corto" es la ÚNICA parte del bloque cliente donde podés
  citar el artículo de la ley. 1-2 frases máximo.
- Iconos válidos para "icono": "ok" (verde, positivo), "warning" (amarillo,
  atención), "fail" (rojo, problema serio), "info" (gris, contextual).

Cómo armar los bloques típicos según el caso:
- Cliente sin conflictos serios → bloque(s) "ok" con la VIABILIDAD (no con
  la calidad del nombre). Ej: "EL REGISTRO ES VIABLE EN TU RUBRO".
- Cliente con coincidencia exacta → bloque "fail" con la marca chocante
  + datos del titular + analogía si ayuda.
- Cliente con coincidencia fonética/cross-clase → bloque "warning".
- Conflicto con marca notoria/renombrada → bloque "fail" mencionándola
  por nombre (Coca-Cola, Nike, etc.) sin usar la palabra "renombrada".
- Si hay flag de ley especial (eco/olímpico/tabaco) → bloque "fail"
  específico con explicación accionable de qué cambiar.
- NO crear bloques que solo valoren el nombre ("EL NOMBRE ESTÁ BUENO"
  NO va). Si la distintividad es relevante, integrala factualmente.

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
- Recordá el TONO: profesional y directo. SIN argot, SIN valoración del nombre,
  SIN signos de admiración. NO uses jerga legal en el bloque cliente.`;
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
