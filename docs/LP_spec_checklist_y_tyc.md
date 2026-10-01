# Legal Pacers — spec de módulos: Checklist legal y Términos y condiciones

Spec para implementar en la web de Legal Pacers. Leer junto con `CLAUDE.md` (en la raíz del repo) (contexto y voz). Español de Argentina, voseo. Mostrar, no declarar. Sin emojis ni signos de exclamación. No inventar precios ni funcionalidades.

> **Nota:** el contenido jurídico de fondo (qué ítems del checklist aplican, textos legales de los TyC) lo valida el estudio antes de publicar. Esta spec define producto, flujo, copy y derivación. Donde diga `[VALIDA WTR]`, es contenido legal a confirmar.

---

# MÓDULO 1 — Checklist legal para startups

## Qué es
Una herramienta gratuita (o de bajo costo) donde el founder responde unas preguntas y recibe un mapa de qué tiene en orden y qué le falta. **Ordena y prioriza; no resuelve.** Es la puerta de entrada: cada cosa que falta deriva a otro módulo de Legal Pacers o al estudio.

## Objetivo de negocio
Captar al emprendedor temprano, darle valor real sin costo, y abrir dos salidas: resolver con un módulo de LP (marca, TyC) o subir al estudio (lo que no es estándar).

## Flujo
1. **Intro** — una pantalla que explica qué va a obtener y cuánto tarda (2-3 minutos).
2. **Preguntas** — cortas, de a una o en bloques, con opciones claras (sí / no / no sé). Sin lenguaje técnico innecesario.
3. **Resultado** — un informe en pantalla (y opción de recibirlo por email) con tres estados por ítem: **en orden / te falta / revisar con un abogado.**
4. **Salidas** — cada ítem "te falta" linkea al módulo que lo resuelve; cada "revisar con un abogado" linkea a contacto con WTR.

## Bloques de preguntas y lógica (estructura propuesta — `[VALIDA WTR]`)
Agrupar en etapas que el founder reconozca:

**A. Tu empresa (estructura)**
- ¿Ya constituiste una sociedad o facturás como persona? → si no tiene sociedad y tiene socios o inversión a la vista: *te falta* → deriva a WTR (constituir no es autogestionable).
- ¿Tenés acuerdo de socios por escrito? → si hay más de un socio y no hay acuerdo: *te falta* → WTR (no es estándar, es a medida).

**B. Tu marca e identidad**
- ¿Registraste tu marca? → si no: *te falta* → **módulo de registro de marcas de LP.**
- ¿Sabés si alguien tiene una marca parecida? → *te falta* → vigilancia de marcas (suscripción LP).

**C. Tu web / app / producto digital**
- ¿Tu web o app tiene términos y condiciones y política de privacidad? → si no: *te falta* → **módulo de TyC de LP.**
- ¿Recolectás datos personales de usuarios? → si sí y no tiene política: *te falta* → módulo TyC / `[VALIDA WTR]` sobre registro de base de datos.

**D. Tus contratos y tu equipo**
- ¿Tenés por escrito los acuerdos con quienes trabajan con vos (empleados, freelancers, proveedores clave)? → si no: *revisar con un abogado* → WTR (contratos a medida, no estándar).
- ¿Cediste o recibiste propiedad intelectual (código, diseño, contenido) sin contrato? → *revisar con un abogado* → WTR.

> Regla de derivación: lo **estándar/repetible/autogestionable** va a un módulo de LP. Lo demás deriva al estudio. No construir el checklist como si resolviera todo.

## Copy (voz WTR)
- **Título:** Checklist legal para tu startup
- **Bajada:** En unos minutos sabés qué tenés en orden y qué te falta resolver. Sin vueltas.
- **CTA inicial:** Empezar el checklist
- **Encabezado del resultado:** Esto es lo que vimos de tu proyecto
- **Estado "en orden":** Lo tenés resuelto.
- **Estado "te falta":** Falta esto. Lo podés resolver acá. *(botón al módulo)*
- **Estado "revisar con un abogado":** Esto conviene verlo con alguien. Hablá con el estudio. *(botón a contacto WTR)*
- **Cierre del informe:** Este checklist te ordena las prioridades. No reemplaza el análisis de tu caso: cuando algo se vuelve específico, lo vemos en WTR.
- **Microcopy de derivación a WTR:** Legal Pacers es un producto de WTR | abogados. Lo que no se resuelve solo, lo resolvemos nosotros.

---

# MÓDULO 2 — Términos y condiciones

## Qué es
Un generador que arma los **términos y condiciones** y la **política de privacidad** de una web o app, a partir de lo que el emprendimiento realmente hace. Estándar, repetible, autogestionable: entra de lleno en Legal Pacers.

## Objetivo de negocio
Resolver una necesidad concreta y frecuente (toda web/app los precisa) de forma rápida y pagable, y dejar abierta la derivación al estudio cuando el caso excede lo estándar.

## Flujo
1. **Intro** — qué genera, para qué sirve, qué necesita saber de tu proyecto.
2. **Preguntas sobre el proyecto** — tipo de negocio, si vende online, si cobra, si recolecta datos, si usa cookies, si opera con menores, jurisdicción. `[VALIDA WTR]` el set exacto de preguntas.
3. **Generación** — arma el documento a partir de las respuestas.
4. **Entrega** — documento descargable (y/o por email). `[VALIDA WTR]` formato y si hay versión paga/gratis.
5. **Salida al estudio** — cuando el proyecto declara algo fuera de lo estándar (ej. maneja datos sensibles, opera en varios países, tiene un modelo atípico), el generador avisa que ese caso conviene revisarlo con WTR en vez de usar el documento estándar.

## Límite del módulo (importante)
El generador cubre **el caso estándar.** No promete cubrir todo. Cuando las respuestas salen de lo estándar, no fuerza un documento: deriva. Esto protege al usuario y al estudio.

## Copy (voz WTR)
- **Título:** Términos y condiciones para tu web o app
- **Bajada:** Respondé sobre tu proyecto y generá tus términos y condiciones y tu política de privacidad, listos para publicar.
- **CTA inicial:** Generar mis términos
- **Nota de alcance (antes de generar):** Esto cubre los casos más comunes. Si tu proyecto tiene algo particular, te lo vamos a marcar para verlo con el estudio.
- **Aviso de derivación (cuando sale de lo estándar):** Tu proyecto tiene una particularidad que conviene no resolver con un documento estándar. Hablá con WTR y lo vemos a medida. *(botón a contacto)*
- **Pie legal del documento generado:** `[VALIDA WTR]` — texto sobre alcance, responsabilidad y que no constituye asesoramiento específico.
- **Microcopy de marca:** Un producto de WTR | abogados.

---

## Para los dos módulos (consistencia)
- Toda salida "hablá con el estudio" va al mismo contacto de WTR (unificar destino).
- Mantener el patrón de estados y botones consistente entre módulos.
- Nunca afirmar que el documento o checklist "garantiza" cumplimiento legal: ordena y resuelve lo estándar, el resto se ve con el estudio.
- Pendiente de datos reales: contacto de WTR, precios de cada módulo (si los hay), textos legales `[VALIDA WTR]`.
