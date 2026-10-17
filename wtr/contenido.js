// Contenido del sitio de WTR | abogados. Todo el texto vive acá: el generador
// (build.js) arma las páginas a partir de estos datos.
// Voz: la de WTR (ver skill wtr-brand-voice). Textos de áreas: BORRADOR para que
// Tomás los revise; no pueden describir nada que el estudio no haga.

const sitio = {
  nombre: 'WTR | abogados',
  claim: 'Derecho para decisiones que importan.',
  url: 'https://wtrabogados.com.ar',
  email: 'contacto@wtrabogados.com',
  whatsapp: '5491134489128',
  whatsappVisible: '+54 11 3448 9128',
  linkedin: 'https://www.linkedin.com/company/wtr-abogados',
  direccion: 'Gral. Pinto 1228, San Fernando, Buenos Aires',
  legalPacer: 'https://marcas.legalpacers.com',
  calendly: 'https://calendly.com/tomas-wtrabogados/30min',
  // Formulario de contacto: lo recibe el servidor de Legal Pacer y lo manda por mail.
  apiContacto: 'https://marcas.legalpacers.com/api/wtr/contacto',
};

const ejes = {
  negocios: {
    titulo: 'Empresas y startups',
    bajada: 'Estructura para crecer, sumar socios, recibir inversión y resolver conflictos.',
  },
  vida: {
    titulo: 'Family office',
    bajada: 'Cuidar y ordenar el patrimonio, la familia y la sucesión que el negocio construye.',
  },
};

const areas = [
  {
    slug: 'derecho-societario', eje: 'negocios', titulo: 'Derecho societario',
    frase: 'El acuerdo de socios y la estructura que un inversor mira antes de invertir.',
    decisiones: [
      'Elegir el tipo de sociedad y constituirla.',
      'Armar el acuerdo de socios: aportes, vesting, salida de un socio y toma de decisiones.',
      'Ordenar el cap table antes de una ronda.',
      'Sumar socios o inversores, y armar la estructura en el exterior cuando un inversor la pide.',
    ],
    como: 'Arrancamos con una reunión para entender el proyecto y a los socios. Proponemos la estructura y los documentos, los revisamos con ustedes y los dejamos firmados e inscriptos. Cada ronda o cambio de socios lo sigue el mismo equipo.',
  },
  {
    slug: 'contratos', eje: 'negocios', titulo: 'Contratos',
    frase: 'Los acuerdos que sostienen tu operación cuando el negocio escala.',
    decisiones: [
      'Contratos con clientes y proveedores.',
      'Acuerdos con el equipo y con freelancers, con cesión de propiedad intelectual y confidencialidad.',
      'Contratos de software, licencias y servicios digitales.',
    ],
    como: 'Partimos de cómo funciona tu negocio. Redactamos, negociamos con la otra parte cuando hace falta y te dejamos modelos que tu equipo puede volver a usar.',
  },
  {
    slug: 'propiedad-intelectual', eje: 'negocios', titulo: 'Propiedad intelectual',
    frase: 'Tu marca, tu código y tus datos: que sean de la empresa, y no de quien los hizo.',
    decisiones: [
      'Registro de marcas en Argentina y en otros países.',
      'Oposiciones y defensa de la marca.',
      'Cesión a la sociedad del código y el diseño que crearon fundadores y freelancers.',
      'Protección de la información confidencial.',
    ],
    como: 'El registro estándar de una marca lo resolvés online en Legal Pacer, nuestra legaltech. Las oposiciones, los conflictos y las estrategias en varios países los toma el estudio. Los trámites ante el INPI los firma Tomás Rodríguez, Agente de la Propiedad Industrial.',
    legalPacer: { texto: 'Registrá tu marca online en Legal Pacer', url: 'https://marcas.legalpacers.com' },
  },
  {
    slug: 'tecnologia-e-inteligencia-artificial', eje: 'negocios', titulo: 'Tecnología e inteligencia artificial',
    frase: 'Términos, datos e IA: lanzar rápido sin dejar riesgos abiertos.',
    decisiones: [
      'Términos y condiciones de productos digitales.',
      'Uso de IA en el producto: decisiones automatizadas y responsabilidad.',
      'Contratos con proveedores de tecnología y servicios en la nube.',
      'Actividades reguladas, como pagos o salud.',
    ],
    como: 'Revisamos el producto con el equipo que lo construye, para que lo legal acompañe el roadmap. Te dejamos documentos que se actualizan cuando el producto cambia.',
  },
  {
    slug: 'datos-y-privacidad', eje: 'negocios', titulo: 'Datos y privacidad',
    frase: 'Cómo se recolectan, se usan y se protegen los datos personales de usuarios y clientes.',
    decisiones: [
      'Política de privacidad y consentimientos.',
      'Inscripción de las bases de datos ante la autoridad de control.',
      'Datos alojados fuera de Argentina y proveedores en la nube.',
      'GDPR, si tenés usuarios en Europa.',
      'Qué hacer ante un incidente de seguridad.',
    ],
    como: 'Revisamos qué datos recolecta tu producto y para qué, y dejamos documentados los permisos y las políticas. Los términos y la política de privacidad estándar los resolvés online en Legal Pacer.',
  },
  {
    slug: 'derecho-laboral', eje: 'negocios', titulo: 'Derecho laboral',
    frase: 'Las relaciones con el equipo: desde la contratación hasta la salida, con reglas claras.',
    decisiones: [
      'Cómo contratar a cada persona: relación de dependencia o servicios.',
      'Contratos de trabajo y políticas internas.',
      'Planes de incentivos para el equipo.',
      'Desvinculaciones y reclamos.',
    ],
    como: 'Ordenamos cómo se contrata desde la primera persona, para que el equipo crezca sin contingencias. Cuando hay un conflicto, buscamos cerrarlo antes de que llegue a juicio.',
  },
  {
    slug: 'resolucion-de-conflictos', eje: 'negocios', titulo: 'Resolución de conflictos',
    frase: 'Cuando algo se rompe —un socio, un cliente, un inversor— estrategia antes que ruido.',
    decisiones: [
      'Diferencias entre socios.',
      'Incumplimientos de clientes, proveedores o inversores.',
      'Disputas por marcas y propiedad intelectual.',
    ],
    como: 'Antes de litigar buscamos la mejor salida: negociación, mediación o un acuerdo. Cuando hay que litigar, lo hacemos con estrategia.',
  },
  {
    slug: 'patrimonio-y-planificacion', eje: 'vida', titulo: 'Patrimonio y planificación',
    frase: 'Ordenar lo que tenés para decidir con tranquilidad lo que viene.',
    decisiones: [
      'Ordenar el patrimonio personal y separarlo del de la empresa.',
      'Estructuras para inversiones e inmuebles.',
      'Planificación ante la venta de la empresa o la llegada de una ronda.',
    ],
    como: 'Partimos de una foto completa de lo que tenés y de lo que querés para tu familia. Proponemos la estructura y la revisamos cuando tu situación cambia.',
  },
  {
    slug: 'familia', eje: 'vida', titulo: 'Familia',
    frase: 'Acuerdos y decisiones que ocurren entre personas que se importan.',
    decisiones: [
      'Convenciones matrimoniales y pactos de convivencia.',
      'Divorcio y división de bienes.',
      'Cuidado de los hijos y alimentos.',
    ],
    como: 'Trabajamos con un abordaje interdisciplinario y priorizamos los acuerdos que cuidan a las personas. Cuando no hay acuerdo posible, llevamos el caso con estrategia.',
  },
  {
    slug: 'sucesion', eje: 'vida', titulo: 'Sucesión',
    frase: 'Anticipar la transmisión de lo construido y acompañar cuando llega el momento.',
    decisiones: [
      'Testamentos y planificación sucesoria.',
      'Continuidad de la empresa familiar.',
      'Trámite sucesorio.',
    ],
    como: 'Anticipamos la transmisión para que cada decisión quede tomada a tiempo. Cuando llega el momento, llevamos la sucesión con cuidado y con plazos claros.',
  },
];

const pasos = [
  { titulo: 'Entender el contexto', texto: 'Escuchamos el negocio y lo que está en juego antes de hablar de los pasos a seguir.' },
  { titulo: 'Ordenar la decisión', texto: 'Traducimos riesgos y alternativas a un camino claro, con sus costos y consecuencias a la vista.' },
  { titulo: 'Acompañar el largo plazo', texto: 'Seguimos cuando la decisión se ejecuta y cuando el escenario cambia.' },
];

const socios = [
  {
    nombre: 'Tomás Rodríguez', rol: 'Socio fundador', iniciales: 'TR',
    foto: null, // Tomás sube la foto el lunes.
    bio: 'Abogado y Mg. en Propiedad Intelectual y Nuevas Tecnologías. Trabajó en el ámbito público y privado. Miembro de la Cámara Argentina de Comercio Electrónico y de la Cámara Argentina de Startups. Speaker habitual en eventos del ecosistema emprendedor.',
    links: [{ texto: 'LinkedIn', url: 'https://ar.linkedin.com/in/trodriguezsi' }],
  },
  {
    nombre: 'Walter Rodríguez', rol: 'Socio fundador', iniciales: 'WR',
    foto: null,
    bio: 'Abogado (UBA), con posgrado en derecho ambiental. Fue funcionario judicial y fundó y dirigió el primer equipo interdisciplinario del Departamento Judicial de San Isidro, en la Provincia de Buenos Aires. Dicta conferencias y cursos sobre crisis familiares y su abordaje estratégico e interdisciplinario.',
    links: [{ texto: 'Su libro en Amazon', url: 'https://www.amazon.com/-/es/Walter-Alcides-Alberto-Rodriguez-ebook/dp/B08ZR6ZCM6/' }],
  },
];

// Logos de las startups con las que trabaja el estudio (los pasa Tomás).
const clientes = [];

// Textos de Tomás: se respetan tal cual (solo se corrige gramática).
const diferencial = 'Somos especialistas en startups, nuevos modelos de negocios y resolución de conflictos. Entendemos cómo nacen esos negocios, se financian y crecen. Por eso acompañamos a sus fundadores en cada decisión que define su futuro: desde la creación hasta el salto a nuevos mercados.';

const quienesSomos = 'Somos el estudio de los founders. Acompañamos a startups y nuevos modelos de negocio en las decisiones que definen su futuro y, cuando el negocio se vuelve patrimonio, también a las personas y la familia que están detrás. Trabajamos con cercanía, como un abogado in-house: entendemos cómo nace, se financia y crece una empresa, y estamos cuando hay que decidir, no solo cuando aparece un problema.';

// Política de privacidad (texto de Tomás). Cada párrafo: título en negrita + texto.
const privacidad = {
  actualizada: '17/10/2026',
  parrafos: [
    { texto: 'Esta política describe cómo WTR | abogados (“WTR”, “nosotros”) trata los datos personales que nos facilitás a través de este sitio (wtrabogados.com.ar). Responsable del tratamiento: WTR | abogados, Gral. Pinto 1228, San Fernando, Buenos Aires, Argentina. Contacto: contacto@wtrabogados.com.' },
    { titulo: 'Qué datos recolectamos.', texto: 'Los que nos dejás voluntariamente en el formulario de contacto: nombre, correo electrónico y el contenido de tu consulta. Esos datos se guardan en nuestro sistema y se nos envían por correo, únicamente para responder tu consulta. No recolectamos datos sensibles.' },
    { titulo: 'Con qué finalidad.', texto: 'Solo para responder tu consulta y, si lo pedís, avanzar con una primera conversación. No los usamos para otros fines ni te enviamos comunicaciones no solicitadas.' },
    { titulo: 'Base del tratamiento.', texto: 'Tu consentimiento, que prestás al enviarnos el formulario, conforme a la Ley de Protección de Datos Personales N.º 25.326.' },
    { titulo: 'Con quién los compartimos.', texto: 'No compartimos tus datos con terceros, salvo que una obligación legal o una orden judicial lo requiera.' },
    { titulo: 'Cuánto los conservamos.', texto: 'El tiempo necesario para responder tu consulta y gestionar una eventual relación profesional; luego los eliminamos o anonimizamos, salvo obligación legal de conservarlos.' },
    { titulo: 'Tus derechos.', texto: 'Podés acceder, rectificar, actualizar y solicitar la supresión de tus datos escribiéndonos a contacto@wtrabogados.com. La Agencia de Acceso a la Información Pública, órgano de control de la Ley N.º 25.326, atiende las denuncias y reclamos vinculados al incumplimiento de las normas sobre protección de datos personales.' },
    { titulo: 'Aviso.', texto: 'El envío del formulario no inicia una relación profesional ni implica asesoramiento legal; esa relación se formaliza solo por acuerdo expreso entre las partes.' },
    { titulo: 'Cambios.', texto: 'Podemos actualizar esta política; la versión vigente es la publicada en esta página, con su fecha de última actualización.' },
  ],
};

module.exports = { sitio, ejes, areas, pasos, socios, clientes, diferencial, quienesSomos, privacidad };
