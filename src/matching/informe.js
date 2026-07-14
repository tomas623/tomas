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
        comparativas: [
          {
            marca: 'Acme', clase: 35, rubro: 'publicidad y gestión',
            titular: 'Acme Holdings SA', estado: 'Registrada', choca: true,
            como_suena: 'alta', como_se_escribe: 'alta', que_evoca: 'alta',
          },
        ],
        comparativas_resto: 0,
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
          'Conviene definir una variante que suene y se lea distinta a "Acme" — el cambio tiene que ir más allá de la tilde, que para el INPI no genera diferencia.',
          'Cuando tengas la variante definida, pasanos el nombre nuevo y la analizamos sin costo adicional. Está incluido en este informe.',
          'Una alternativa más lenta y compleja es solicitar a Acme Holdings SA una autorización escrita para coexistir. Antes de avanzar por esta vía, conviene consultarlo con un abogado especializado en propiedad industrial para evaluar viabilidad y términos del acuerdo.',
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
        comparativas: [
          {
            marca: 'FOKKA', clase: 9, rubro: 'electrónica de consumo',
            titular: 'Otro Titular SRL', estado: 'Registrada', choca: true,
            como_suena: 'alta', como_se_escribe: 'media', que_evoca: 'media',
          },
          {
            marca: 'Focca', clase: 25, rubro: 'indumentaria',
            titular: 'Indumentaria Trendy SA', estado: 'Registrada', choca: false,
            como_suena: null, como_se_escribe: null, que_evoca: null,
          },
        ],
        comparativas_resto: 0,
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
          'Conviene definir una variante que suene claramente distinta a FOKKA — la diferencia fonética es la que más pesa al cotejar marcas. No alcanza con cambiar una letra si al pronunciarla se sigue escuchando igual.',
          'Cuando tengas la variante definida, pasanos el nombre nuevo y la analizamos sin costo adicional. Está incluido en este informe.',
          'Una alternativa más lenta y compleja es solicitar a Otro Titular SRL una autorización escrita para coexistir. Antes de avanzar por esta vía, conviene consultarlo con un abogado especializado en propiedad industrial para evaluar viabilidad y términos del acuerdo.',
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
        comparativas: [
          {
            marca: 'Nimboes', clase: 25, rubro: 'indumentaria',
            titular: 'Indumentaria Casual SRL', estado: 'Registrada', choca: false,
            como_suena: null, como_se_escribe: null, que_evoca: null,
          },
        ],
        comparativas_resto: 0,
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
    input: `Cliente: "VB Logística Express", clases 39 (transporte y logística), denominativa. Rubro: servicios de logística y transporte de cargas.
Candidatas INPI: ninguna con similitud relevante en las clases del cliente.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'medio',
      viabilidad_estimada: 65,
      resumen_ejecutivo: 'No hay antecedentes que choquen, pero el conjunto es débil: "Logística" y "Express" son descriptivos del servicio y no monopolizables. La capacidad distintiva recae en la sigla "VB". Es registrable, pero con protección limitada y probable limitación de oficio del INPI.',
      distintividad_intrinseca: {
        nivel: 'baja',
        comentario: '"Logística" y "Express" describen la naturaleza y una característica del servicio (Art. 2 incs. a y b). El único elemento con aptitud distintiva es la sigla "VB". Marca débil.',
      },
      prohibiciones_absolutas: { flags: ['descriptiva', 'uso_general'], comentario: '"Logística" (naturaleza del servicio) y "Express" (uso general en transporte) no son apropiables en exclusiva.' },
      prohibiciones_relativas: { flags: [], comentario: 'Sin marcas preexistentes confundibles en las clases solicitadas.' },
      leyes_especiales: { flags: [], comentario: 'No aplican.' },
      confundibilidad: {
        fonetica: { similitud: 'nula', explicacion: 'Sin antecedentes con los que cotejar en las clases del cliente.' },
        visual: { similitud: 'nula', explicacion: 'Sin antecedentes relevantes.' },
        ideologica: { similitud: 'nula', explicacion: 'Sin antecedentes relevantes.' },
        regla_predominante: 'Elemento distintivo predominante: descartados los términos descriptivos, el cotejo con terceros recae exclusivamente sobre la sigla "VB". El riesgo real de oposición depende de otras "VB" en clases 39.',
      },
      especialidad: {
        afinidad: 'nula',
        comentario: 'No hay marcas preexistentes en el rubro con las que evaluar afinidad.',
      },
      notoriedad: {
        nivel: 'no', publico_relevante: null, rompe_especialidad: false, riesgos_especificos: [],
        comentario: 'Ninguna marca notoria involucrada.',
      },
      ley_aplicable: 'Art. 2 incs. a y b, Ley 22.362',
      recomendacion_principal: 'Auditar variante — conviene reforzar la distintividad antes de presentar.',
      alternativas_sugeridas: ['Presentar como marca mixta con logotipo original', 'Anteponer o reforzar el elemento "VB" como núcleo de la marca'],
      cliente: {
        veredicto_breve: 'El registro de "VB Logística Express" es posible, pero es una marca débil: las palabras "Logística" y "Express" no van a ser tuyas en exclusiva y la fuerza recae solo en "VB". Conviene presentarla con un logo propio para protegerla mejor.',
        comparativas: [],
        comparativas_resto: 0,
        bloques: [
          {
            icono: 'ok',
            titulo: 'NO ENCONTRAMOS MARCAS QUE TE BLOQUEEN',
            mensaje: 'Cruzamos tu marca contra la base del INPI en las clases 39 (transporte y logística) y no aparece ninguna marca registrada que represente un obstáculo directo para tu solicitud.',
          },
          {
            icono: 'warning',
            titulo: 'ES UNA MARCA DÉBIL: OJO CON ESTO',
            mensaje: 'Las palabras "Logística" y "Express" describen tu servicio, así que no vas a poder impedir que otras empresas del rubro las usen — sobre esas palabras nadie tiene exclusividad. Lo único realmente tuyo es la sigla "VB". Por eso se considera una marca débil: se registra, pero su protección es más limitada.',
            subbloques: [
              {
                titulo: '¿Qué puede pasar en el trámite?',
                mensaje: 'Es probable que el INPI te pida expresamente que no reclames uso exclusivo sobre "Logística" y "Express". Es normal en estos casos y conviene que lo sepas de antemano para que no te sorprenda.',
              },
            ],
          },
        ],
        proximos_pasos: [
          'Para fortalecer la marca, conviene presentarla como marca mixta: sumarle un logotipo, un diseño o una tipografía propia. Eso le da una identidad que sí es exclusivamente tuya, más allá de las palabras.',
          'Si preferís la versión solo de texto, tené presente que la protección se va a concentrar en la sigla "VB".',
          'Asegurá el dominio y los perfiles en redes cuanto antes.',
        ],
        apendice_legal_corto: 'El Art. 2 incs. a y b de la Ley 22.362 excluye del registro exclusivo a las designaciones descriptivas de la naturaleza o función del producto/servicio y a los signos de uso general.',
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
        comparativas: [
          {
            marca: 'Coca-Cola', clase: 32, rubro: 'bebidas',
            titular: 'The Coca-Cola Company', estado: 'Registrada', choca: true,
            como_suena: 'alta', como_se_escribe: 'alta', que_evoca: 'alta',
          },
        ],
        comparativas_resto: 0,
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

MARCAS EN TRÁMITE (PRIORIDAD / DERECHO DE PRELACIÓN):
- Cada candidata trae un "Estado". Puede ser "Registrada"/"Concedida"/"Renovada"
  (marca vigente) o "Solicitud publicada"/"Solicitada"/"En trámite" (todavía no
  concedida, pero EN PROCESO).
- Una solicitud anterior en trámite NO es un obstáculo menor: por el principio de
  prelación (quien solicita primero tiene mejor derecho, Art. 8 y conc. Ley 22.362),
  una solicitud previa de marca idéntica o confundible en la misma clase puede
  bloquear el registro del cliente tanto como una marca ya concedida — incluso
  habilita a ese solicitante anterior a oponerse cuando se publique la del cliente.
- Por lo tanto, una candidata "En trámite" con alta similitud en la misma clase
  debe tratarse como conflicto real (choca=true) y elevar el nivel_riesgo, igual
  que una registrada. La diferencia: en el comentario aclará que es una SOLICITUD
  EN TRÁMITE (todavía no resuelta), lo que abre dos caminos —esperar a ver si esa
  solicitud prospera o cae, o avanzar asumiendo el riesgo de oposición—. Esa
  incertidumbre es justamente información valiosa para el cliente.
- En el campo "estado" de cada comparativa, reflejá el estado real ("En trámite"
  cuando corresponda), no lo conviertas en "Registrada".

DISTINTIVIDAD INTRÍNSECA Y DESCRIPTIVIDAD (ANÁLISIS OBLIGATORIO — TAN IMPORTANTE COMO LA CONFUNDIBILIDAD):
El análisis NO se agota en buscar conflictos con terceros. ANTES de eso, evaluá si el
propio signo es registrable y qué tan fuerte es. Es un error grave dar viabilidad alta a
una marca descriptiva solo porque no aparecen antecedentes. En CADA informe:

1. DESCRIPTIVIDAD / USO GENERAL: identificá qué palabras del conjunto describen la
   naturaleza, función, calidad o características de los servicios/productos del rubro, o
   son de uso general en ese sector. Esas palabras NO son monopolizables (Art. 2 incs. a y
   b, Ley 22.362). Advertí EXPLÍCITAMENTE que el cliente NO obtendrá derechos exclusivos
   sobre esos términos, aunque el conjunto se registre.

2. ELEMENTO DISTINTIVO PREDOMINANTE: determiná cuál es el único (o principal) elemento con
   capacidad distintiva del conjunto (una sigla, un término de fantasía, una combinación
   original). Aclará que el análisis de antecedentes y el riesgo de oposición dependen CASI
   EXCLUSIVAMENTE de ese elemento, porque los términos descriptivos se descartan en el
   cotejo. Ej: en "RC Finanzas & COMEX" para consultoría financiera, el peso recae en "RC";
   el conflicto real sería con otras "RC" en esas clases, no con "Finanzas" ni "COMEX".

3. MARCA FUERTE vs. DÉBIL: clasificá el signo. Un conjunto de términos descriptivos + un
   elemento distintivo mínimo (pocas letras / una sigla) es una MARCA DÉBIL: se puede
   registrar, pero su protección es limitada y será difícil impedir que terceros usen
   conjuntos parecidos. Decíselo al cliente con claridad, sin tecnicismos.

4. LIMITACIÓN DE OFICIO PROBABLE DEL INPI: cuando el conjunto incluye términos que
   describen la naturaleza o función del servicio, el INPI suele exigir de oficio que el
   solicitante NO reclame derechos exclusivos sobre esos términos (disclaimer / limitación).
   Si es probable acá, advertilo y preparalo — que no lo sorprenda una vista después.

5. ESTRATEGIA PARA SUPERAR LA DEBILIDAD: si la denominación carece de fuerte distintividad
   por sí sola, recomendá NO presentarla como marca denominativa pura, sino incorporar un
   logotipo, diseño o tipografía original (marca MIXTA) para dotarla de distintividad
   extrínseca y un trámite más sólido. Esta recomendación va en "proximos_pasos" del
   cliente cuando aplique.

IMPACTO OBLIGATORIO EN VIABILIDAD Y RIESGO:
- Una marca descriptiva/débil NO puede llevar viabilidad 85-90 ni nivel_riesgo "bajo" por
  el solo hecho de no tener antecedentes: la debilidad intrínseca y la probable limitación
  de oficio son riesgos reales. Bajá la viabilidad (típicamente 55-75) y usá nivel_riesgo
  "medio" cuando el signo sea descriptivo/débil.
- Reflejalo en distintividad_intrinseca (nivel "baja"/"media"), en prohibiciones_absolutas
  (flags "descriptiva"/"uso_general") y en confundibilidad.regla_predominante (mención al
  elemento distintivo predominante), siempre con comentario concreto del caso.

${DOCTRINA_INPI}

---

# FORMATO DE SALIDA

Devolvé UN ÚNICO JSON con esta estructura exacta. Sin texto extra, sin markdown wrapper:

{
  "nivel_riesgo": "alto" | "medio" | "bajo",
  "viabilidad_estimada": number (0-90). NUNCA más de 90: ningún registro está
    garantizado (el INPI siempre puede observar), así que el caso más favorable
    llega hasta 90, no más. Reservá 85-90 para casos sin ningún conflicto.
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
    "comparativas": [
      {
        "marca": "Denominación EXACTA de la marca registrada (copiala del dato provisto, NO la inventes).",
        "clase": number (clase Niza de la marca registrada),
        "rubro": "Rubro en lenguaje cotidiano (ej: 'electrónica de consumo', 'indumentaria'). NO el número de clase.",
        "titular": "Titular EXACTO provisto. Si es desconocido, 'Titular no informado'.",
        "estado": "Registrada | Solicitada | En trámite (copialo del dato provisto).",
        "choca": true | false,
        "como_suena": "alta" | "media" | "baja" | "nula" | null,
        "como_se_escribe": "alta" | "media" | "baja" | "nula" | null,
        "que_evoca": "alta" | "media" | "baja" | "nula" | null
      }
    ],
    "comparativas_resto": number,
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
  "Una alternativa es". Mencioná decisiones a tomar y registros a asegurar.

REGLAS DUROS de "proximos_pasos" en bloque cliente:
- NO PROPONGAS NOMBRES CONCRETOS al cliente como alternativa de marca.
  En lugar de "podés probar con Foccaly, Foxxa, Fokima", decí
  "conviene definir una variante que SUENE distinta a [marca chocante]"
  o "que se LEA y se PRONUNCIE distinta". Los nombres concretos los pensará
  el cliente (es su marca, su decisión comercial). Los nombres concretos
  SÍ pueden ir en el campo técnico "alternativas_sugeridas" porque ese
  campo es para el Agente revisor, no para el cliente final.
- Si recomendás pedir consentimiento / autorización / carta de coexistencia
  al titular de la marca preexistente, SIEMPRE aclarar que conviene
  consultarlo PRIMERO con un abogado especializado en propiedad industrial
  antes de iniciar contacto. Es un trámite contractual con consecuencias
  legales y no debe encararse solo.
- "apendice_legal_corto" es la ÚNICA parte del bloque cliente donde podés
  citar el artículo de la ley. 1-2 frases máximo.
- Iconos válidos para "icono": "ok" (verde, positivo), "warning" (amarillo,
  atención), "fail" (rojo, problema serio), "info" (gris, contextual).

Cómo armar los bloques típicos según el caso:
- Cliente sin conflictos serios → NO repitas el titular ni el veredicto de la
  barra ("riesgo bajo" / "es viable") en el primer bloque. Ese mensaje ya lo dio
  la barra y el resumen. Los bloques tienen que APORTAR análisis distinto y hacer
  visible el trabajo hecho. Armá 2-3 bloques "ok", cada uno sobre una DIMENSIÓN
  diferente, por ejemplo:
    · Fonética/visual: qué tan parecida suena/se escribe respecto de lo que hay
      registrado, y por qué no genera confusión (mencioná que se cruzó contra la
      base). Ej: "CÓMO SUENA Y SE ESCRIBE FRENTE A LO REGISTRADO".
    · Distintividad: si el nombre tiene elementos descriptivos y qué parte le da
      fuerza distintiva (ej: un acrónimo, una combinación original). Ej:
      "LA DENOMINACIÓN ES SUFICIENTEMENTE DISTINTIVA".
    · Especialidad/clases: por qué las clases elegidas cubren el rubro y no chocan
      con registros de otras clases. Ej: "LAS CLASES CUBREN TU ACTIVIDAD".
  Cada bloque debe decir algo CONCRETO del caso, no una generalidad.
- MARCA DESCRIPTIVA / DÉBIL (obligatorio si el signo tiene términos que describen el
  rubro) → SIEMPRE incluí un bloque "warning", aunque no haya conflicto con terceros. En
  lenguaje llano tiene que decir: (a) que sobre las palabras descriptivas (nombralas: ej
  "Finanzas", "COMEX") no vas a tener uso exclusivo —cualquier competidor puede usarlas—;
  (b) que la fuerza de la marca recae en el elemento distintivo (nombralo: ej la sigla
  "RC"); (c) que por eso es una marca "débil" y su protección es más limitada; (d) que el
  INPI probablemente pida no reclamar exclusividad sobre esos términos. Y en
  "proximos_pasos" sumá la sugerencia de presentarla como marca MIXTA (con logo/diseño
  propio) para fortalecerla. NO uses las palabras "descriptividad", "distintividad
  intrínseca" ni "disclaimer" — explicalo con palabras del día a día.
- Cliente con coincidencia exacta → bloque "fail" con la marca chocante
  + datos del titular + analogía si ayuda.
- Cliente con coincidencia fonética/cross-clase → bloque "warning".
- Conflicto con marca notoria/renombrada → bloque "fail" mencionándola
  por nombre (Coca-Cola, Nike, etc.) sin usar la palabra "renombrada".
- Si hay flag de ley especial (eco/olímpico/tabaco) → bloque "fail"
  específico con explicación accionable de qué cambiar.
- NO crear bloques vacíos que solo elogien el nombre ("EL NOMBRE ESTÁ BUENO"
  NO va): cada bloque tiene que apoyarse en un hecho del análisis.

TABLA "comparativas" (CRÍTICA — es la prueba del trabajo):
- Incluí UNA entrada por cada marca registrada que te paso (principales Y
  otras_clases), hasta un máximo de 20, ordenadas de mayor a menor riesgo
  (primero las que chocan).
- Campos factuales (marca, clase, titular, estado): copialos EXACTOS del dato
  provisto. NUNCA los inventes ni los modifiques. "rubro" sí traducilo a
  lenguaje cotidiano (no número de clase Niza).
- "choca": true si la marca está en la misma clase del cliente o genera
  conflicto directo (riesgo real de rechazo/oposición). false si está en
  otro rubro y no choca por especialidad.
- Medidores "como_suena" / "como_se_escribe" / "que_evoca": son la similitud
  fonética / visual / ideológica respecto de la marca del cliente, traducidas.
  Usá "alta" | "media" | "baja" | "nula". Completalos SIEMPRE que choca=true.
  Para las que NO chocan (otro rubro), podés dejarlos en null: lo que importa
  ahí es el dato de que existe, no el detalle de similitud.
- "comparativas_resto": si la base detectó más marcas de las que listás
  (porque superan 20 o son coincidencias menores que omitís), poné acá la
  cantidad restante. Si listaste todas, poné 0.
- Si no hay ninguna marca detectada, "comparativas": [] y "comparativas_resto": 0.

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
  return `${etiqueta}:\n` + lista.slice(0, 20).map((c, i) => `
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
    resumen_ejecutivo: `[Borrador automático — pendiente de análisis del Agente] Se detectaron ${candidatas.length} candidata(s) en la base del INPI y ${flags.length} flag(s) de leyes especiales. El dictamen profesional completo se elabora en la revisión.`,
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
      veredicto_breve: `Análisis preliminar automático: nivel ${nivel}, ${candidatas.length} marca(s) parecida(s) detectada(s) y ${flags.length} restricción(es) legal(es). Pendiente del dictamen profesional del Agente.`,
      comparativas: [
        ...candidatas.slice(0, 20).map(c => ({
          marca: c.denominacion, clase: c.clase, rubro: c.rubro || '—',
          titular: c.titular || 'Titular no informado', estado: c.estado || 'Registrada',
          choca: (c.score || 0) >= 80,
          como_suena: (c.score || 0) >= 80 ? 'alta' : 'media',
          como_se_escribe: (c.score || 0) >= 80 ? 'media' : 'baja',
          que_evoca: 'media',
        })),
        ...(candidatas_otras_clases || []).slice(0, 20).map(c => ({
          marca: c.denominacion, clase: c.clase, rubro: c.rubro || '—',
          titular: c.titular || 'Titular no informado', estado: c.estado || 'Registrada',
          choca: false, como_suena: null, como_se_escribe: null, que_evoca: null,
        })),
      ],
      comparativas_resto: 0,
      bloques: [
        {
          icono: nivel === 'alto' ? 'fail' : nivel === 'medio' ? 'warning' : 'ok',
          titulo: 'ANÁLISIS PRELIMINAR',
          mensaje: 'Este es un pre-análisis automático de la marca. El dictamen profesional completo, con las recomendaciones del Agente de la Propiedad Industrial, se elabora en la revisión antes de enviártelo.',
        },
      ],
      proximos_pasos: ['El equipo revisa el análisis y te envía el dictamen final.'],
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

  // Default flash: disponible en el free tier (pro da 429 sin billing). Con
  // billing activo se puede subir a pro seteando GEMINI_MODEL_INFORME.
  const model = (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const userPrompt = construirUserPrompt({
    marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales,
  });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      // El informe es un JSON grande. Sin un tope alto, gemini-2.5-flash trunca
      // la respuesta (queda JSON inválido → parse_error → cae al borrador).
      maxOutputTokens: 32768,
      // gemini-2.5-flash trae "thinking" activo por defecto, que consume tokens
      // de salida y puede dejar el JSON incompleto. Lo desactivamos para el
      // informe estructurado (necesitamos JSON completo, no razonamiento).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const stubArgs = [marca, candidatas_principales, candidatas_otras_clases, flagsLeyesEspeciales];

  // El informe corre en background (el cliente espera 24 hs), así que ante un
  // 429 (rate limit por minuto del free tier) esperamos y reintentamos en vez
  // de caer al stub. Backoff: 20s, 45s, 90s. Configurable con GEMINI_REINTENTOS.
  const maxIntentos = 1 + parseInt(process.env.GEMINI_REINTENTOS || '3', 10);
  const esperas = [20000, 45000, 90000];
  let ultimoError = 'desconocido';

  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        // Leemos el cuerpo para saber QUÉ cuota se agotó. Google distingue
        // por-minuto (se despeja solo, conviene reintentar) de por-día
        // (no se despeja hoy — reintentar es inútil, hay que activar billing).
        const txt429 = await res.text().catch(() => '');
        const esPorDia = /PerDay|per day|daily/i.test(txt429);
        const cuota = esPorDia ? 'cuota DIARIA agotada (free tier). Requiere activar billing en Gemini o esperar al reset del día.'
          : 'límite por-minuto (free tier). Se despeja en ~1 min.';
        if (esPorDia) {
          // No tiene sentido reintentar por ~2 min si es la cuota diaria.
          console.error('[informe] Gemini 429 cuota diaria:', txt429.slice(0, 300));
          return { ...stubInforme(...stubArgs), gemini_error: `HTTP 429 — ${cuota}` };
        }
        if (intento < maxIntentos - 1) {
          const espera = esperas[Math.min(intento, esperas.length - 1)];
          console.warn(`[informe] Gemini 429 (${cuota}) — reintento ${intento + 1}/${maxIntentos - 1} en ${espera / 1000}s`);
          await new Promise(r => setTimeout(r, espera));
          continue;
        }
        console.error('[informe] Gemini 429 tras reintentos:', txt429.slice(0, 200));
        return { ...stubInforme(...stubArgs), gemini_error: `HTTP 429 — ${cuota} (reintentos agotados)` };
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error('[informe] Gemini HTTP', res.status, txt.slice(0, 300));
        ultimoError = `HTTP ${res.status}`;
        return { ...stubInforme(...stubArgs), gemini_error: ultimoError };
      }
      const json = await res.json();
      const finishReason = json?.candidates?.[0]?.finishReason || null;
      const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!txt) {
        // Respuesta vacía: típico de bloqueo por safety o de que "thinking" se
        // comió todo el presupuesto de salida. Guardamos el motivo.
        const motivo = finishReason || json?.promptFeedback?.blockReason || 'respuesta vacía';
        console.error('[informe] Gemini respuesta vacía. finishReason:', motivo, JSON.stringify(json).slice(0, 300));
        return { ...stubInforme(...stubArgs), gemini_error: `respuesta vacía (${motivo})` };
      }
      try {
        const parsed = JSON.parse(txt);
        return { ...parsed, stub: false };
      } catch (err) {
        console.error('[informe] parse error:', err.message, 'finishReason:', finishReason, 'raw:', txt.slice(0, 300));
        const detalle = finishReason === 'MAX_TOKENS'
          ? 'JSON truncado (MAX_TOKENS)'
          : `JSON inválido (${err.message})`;
        return { ...stubInforme(...stubArgs), parse_error: true, gemini_error: detalle };
      }
    } catch (err) {
      console.error('[informe] error red:', err.message);
      ultimoError = err.message;
      if (intento < maxIntentos - 1) { await new Promise(r => setTimeout(r, esperas[Math.min(intento, esperas.length - 1)])); continue; }
      return { ...stubInforme(...stubArgs), red_error: err.message };
    }
  }
  // Se agotaron los reintentos por 429 sostenido.
  console.error('[informe] Gemini 429 tras todos los reintentos');
  return { ...stubInforme(...stubArgs), gemini_error: 'HTTP 429 (reintentos agotados)' };
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
 * @param {object} [opts]
 * @param {boolean} [opts.forzar=false] - salta el caché y regenera.
 * @returns {Promise<object>} informe JSON estructurado
 */
async function generar(marca, candidatasInput = [], { forzar = false } = {}) {
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
  // `forzar` salta el caché (regeneración manual desde el panel: el agente
  // quiere una llamada fresca sí o sí).
  if (!forzar) {
    const row = db.prepare('SELECT detalle FROM audit_log WHERE accion = ? AND entidad = ? LIMIT 1')
      .get('informe_cache', cacheKey);
    if (row && row.detalle) {
      try {
        const cacheado = JSON.parse(row.detalle);
        // NO servir un fallo cacheado: si el resultado guardado es un stub
        // (Gemini falló cuando se generó), lo ignoramos y regeneramos. Antes,
        // un 429 transitorio quedaba pegado en el caché para siempre.
        if (cacheado && cacheado.stub !== true) {
          return { ...cacheado, cached: true };
        }
      } catch {}
    }
  }

  const informe = await callGemini(marca, principales, otras_clases, flagsLeyesEspeciales);

  // Tope duro de viabilidad: nunca prometemos más de 90% (ningún registro está
  // garantizado; el INPI siempre puede observar). Garantiza el límite aunque el
  // modelo se pase.
  if (typeof informe.viabilidad_estimada === 'number' && informe.viabilidad_estimada > 90) {
    informe.viabilidad_estimada = 90;
  }

  informe._pre_checks = flagsLeyesEspeciales;
  informe._meta = {
    generado_at: new Date().toISOString(),
    model: (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-flash'),
    candidatas_principales: principales.length,
    candidatas_otras_clases: otras_clases.length,
  };

  // Solo cacheamos resultados REALES (stub:false). Nunca guardamos un fallo,
  // para que un 429/parse_error transitorio no quede pegado y se pueda reintentar.
  if (informe.stub !== true) {
    db.prepare(`DELETE FROM audit_log WHERE accion = ? AND entidad = ?`).run('informe_cache', cacheKey);
    db.prepare(`INSERT INTO audit_log (accion, entidad, entidad_id, detalle) VALUES (?,?,?,?)`)
      .run('informe_cache', cacheKey, null, JSON.stringify(informe));
  }

  return informe;
}

// ──────────────────────────────────────────────────────────────────────────────
// Diagnóstico: reproduce EXACTAMENTE la llamada del informe (prompt grande,
// responseMimeType json, maxOutputTokens, thinkingConfig) y devuelve el status
// y el cuerpo crudo — sin fallback a stub. Sirve para ver el nombre exacto de
// la cuota cuando Gemini responde 429 al informe pero no al ping chico.
// ──────────────────────────────────────────────────────────────────────────────
async function diagnosticarGemini() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY no seteada' };
  const model = (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const marca = { denominacion: 'MARCA DE PRUEBA', clases: [35], rubro: 'diagnóstico', tipo: 'denominativa' };
  const userPrompt = construirUserPrompt({
    marca, candidatas_principales: [], candidatas_otras_clases: [], flagsLeyesEspeciales: [],
  });
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2, responseMimeType: 'application/json',
      maxOutputTokens: 32768, thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const txt = await res.text().catch(() => '');
    // Aproximación del tamaño del prompt en tokens (chars/4).
    const promptTokensAprox = Math.round((SYSTEM_PROMPT.length + userPrompt.length) / 4);
    return {
      ok: res.ok, http: res.status, ms, modelo: model,
      prompt_tokens_aprox: promptTokensAprox,
      body: txt.slice(0, 800),
    };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - t0 };
  }
}

module.exports = {
  generar,
  diagnosticarGemini,
  // Exporto internals para testing.
  _internals: { SYSTEM_PROMPT, construirUserPrompt, stubInforme, FEW_SHOT_EXAMPLES },
};
