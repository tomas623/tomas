# Legal Pacer — spec de módulos: Checklist legal, Términos y condiciones y Política de privacidad

Spec para implementar en la web de Legal Pacer. Leer junto con `CLAUDE.md` (en la raíz del repo) (contexto y voz). Español de Argentina, voseo. Mostrar, no declarar. Sin emojis ni signos de exclamación. No inventar precios ni funcionalidades.

> **Relanzamiento (decisiones de Tomás, 02/11/2026):** Legal Pacer relanza el martes 1/12/2026 en legalpacer.com con todo activo: marca y vigilancia, checklist gratis con captura de mail, términos y condiciones ($200.000), política de privacidad ($200.000) y combo de los dos ($275.000), cada uno con una reunión de diagnóstico gratuita con WTR (una sola en el combo). Hasta enero de 2027 los términos y la política se arman "a mano" por detrás; el sistema solo cobra, recibe el formulario y los archivos, avisa y entrega. El procedimiento interno está en el repo de la oficina (`marcas/legal-pacer/servicio-tyc-pp/procedimiento.md`).

> **Nota:** el contenido jurídico de fondo (qué ítems del checklist aplican, textos legales de los TyC) lo valida el estudio antes de publicar. Esta spec define producto, flujo, copy y derivación. Donde diga `[VALIDA WTR]`, es contenido legal a confirmar.

---

# MÓDULO 1 — Checklist legal para startups

## Qué es
Una herramienta **gratis** donde el founder responde unas preguntas y recibe un mapa de qué tiene en orden y qué le falta. **Ordena y prioriza; no resuelve.** Es la puerta de entrada: cada cosa que falta deriva a otro módulo de Legal Pacer o al estudio. Se busca que deje el mail (decisión de Tomás, 02/11/2026).

## Objetivo de negocio
Captar al emprendedor temprano, darle valor real sin costo, y abrir dos salidas: resolver con un módulo de LP (marca, TyC) o subir al estudio (lo que no es estándar).

## Flujo
1. **Intro** — una pantalla que explica qué va a obtener y cuánto tarda (2-3 minutos).
2. **Preguntas** — cortas, de a una o en bloques, con opciones claras (sí / no / no sé). Sin lenguaje técnico innecesario.
3. **Resultado** — el resumen por etapa se ve en pantalla sin pedir nada. El detalle ítem por ítem, con sus tres estados (**en orden / te falta / revisar con un abogado**), se muestra y se manda por mail a cambio del mail. El mail no se pide antes de empezar.
4. **Captura del mail (Ley 25.326)** — junto al campo: para qué se usa (mandar el resultado), quién es el responsable (WTR | abogados), cuánto tiempo se guarda, y cómo pedir la baja o el acceso (privacidad@legalpacer.com), con link a la política de privacidad. Casilla aparte, **sin marcar**, para recibir novedades: sin ella el mail solo se usa para mandar el resultado. Se guarda como lead de tipo `checklist`, con las respuestas. `[VALIDA WTR]` el plazo de conservación.
5. **Salidas** — cada ítem "te falta" linkea al módulo que lo resuelve; cada "revisar con un abogado" linkea a contacto con WTR.

## Bloques de preguntas y lógica (estructura propuesta — `[VALIDA WTR]`)
Agrupar en etapas que el founder reconozca:

**A. Tu empresa (estructura)**
- ¿Ya constituiste una sociedad o facturás como persona? → si no tiene sociedad y tiene socios o inversión a la vista: *te falta* → deriva a WTR (constituir no es autogestionable).
- ¿Tenés acuerdo de socios por escrito? → si hay más de un socio y no hay acuerdo: *te falta* → WTR (no es estándar: depende de cada sociedad).

**B. Tu marca e identidad**
- ¿Registraste tu marca? → si no: *te falta* → **registro de marcas de LP.**
- ¿Sabés si alguien tiene una marca parecida? → *te falta* → vigilancia de marcas (suscripción LP).

**C. Tu web / app / producto digital**
- ¿Tu web o app tiene términos y condiciones y política de privacidad? → si no: *te falta* → **términos y condiciones / política de privacidad de LP (legalpacer.com/tyc-startups).**
- ¿Recolectás datos personales de usuarios? → si sí y no tiene política: *te falta* → política de privacidad de LP / `[VALIDA WTR]` sobre registro de base de datos.

**D. Tus contratos y tu equipo**
- ¿Tenés por escrito los acuerdos con quienes trabajan con vos (empleados, freelancers, proveedores clave)? → si no: *revisar con un abogado* → WTR (cada contrato depende del caso, no es estándar).
- ¿Cediste o recibiste propiedad intelectual (código, diseño, contenido) sin contrato? → *revisar con un abogado* → WTR.

> Regla de derivación: lo **estándar/repetible/autogestionable** va a un módulo de LP. Lo demás deriva al estudio. No construir el checklist como si resolviera todo.

## Copy (voz WTR)
- **Título:** Checklist legal para tu startup
- **Bajada:** En unos minutos sabés qué tenés en orden y qué te falta resolver. Sin vueltas.
- **CTA inicial:** Empezar el checklist
- **Encabezado del resultado:** Esto es lo que vimos de tu proyecto
- **Estado "en orden":** Lo tenés resuelto.
- **Estado "te falta":** Falta esto. Lo podés resolver acá. *(botón al módulo)*
- **Estado "revisar con un abogado":** Esto conviene verlo con alguien. Hablá con el estudio. *(botón a la reunión de diagnóstico de WTR)*
- **Cierre del informe:** Este checklist te ordena las prioridades. No reemplaza el análisis de tu caso: cuando algo se vuelve específico, lo vemos en WTR.
- **Microcopy de derivación a WTR:** Legal Pacer es un producto de WTR | abogados. Lo que no se resuelve solo, lo resolvemos nosotros.

---

# MÓDULO 2 — Términos y condiciones y política de privacidad

> Reemplaza las versiones anteriores de este módulo (el generador automático y la revisión de los documentos del usuario). Decisiones de Tomás del 02/11/2026.

## Qué es
Un servicio online con tres opciones de compra, en una página propia (legalpacer.com/tyc-startups), fuera del checklist:

| Servicio | Precio | Incluye |
|---|---|---|
| Términos y condiciones | $200.000 | Documento en Word y PDF, guía de buenas prácticas, reunión de diagnóstico gratuita con WTR |
| Política de privacidad | $200.000 | Documento en Word y PDF, guía de buenas prácticas y guía de GDPR, reunión de diagnóstico gratuita con WTR |
| Las dos (combo) | $275.000 | Los dos documentos, las tres guías, una sola reunión de diagnóstico |

El usuario completa un formulario sobre su proyecto y sube lo que tenga (sus términos actuales, su web, redes, un dossier) como base de conocimiento, no para que se lo corrijan. Si no tiene nada, solo completa el formulario. El documento se arma sobre los modelos de WTR, con **ley argentina**, y un abogado del estudio lo revisa antes de entregarlo.

## Cómo funciona por detrás (hasta enero de 2027)
"A mano": el borrador lo arma el equipo sobre los modelos de WTR y lo revisa Tomás. **El sistema no redacta nada.** Lo que hace el sistema:

1. **Cobra** — preferencia de Mercado Pago por servicio (reusa `crearPreferencia` y el webhook de pagos). Precios por variable de entorno.
2. **Recibe** — formulario por pasos después del pago, con link por mail que se puede retomar, y subida de archivos.
3. **Avisa** — mail al admin al pagar y al completar el formulario.
4. **Entrega** — mail al cliente con el documento, las guías y el link a la reunión de diagnóstico (Calendly de WTR). Se envía solo con el OK de Tomás para ese pedido.

La herramienta automática de redacción queda para enero de 2027; no se construye antes sin consultar.

## Flujo del usuario
1. **Página /tyc-startups** — qué recibe, cuánto sale, en cuánto tiempo, y que trabaja con ley argentina (si necesita otra ley, se deriva a la reunión de diagnóstico con WTR).
2. **Elección** — términos, política o las dos.
3. **Antes de pagar** — casilla de consentimiento (ver abajo) y link a la política de privacidad de Legal Pacer.
4. **Pago** — Mercado Pago. Al acreditarse, mail con el link al formulario.
5. **Formulario** — por pasos; se puede dejar a medias. Las preguntas C1 a C7 (datos sensibles, actividad regulada, dinero de terceros, contenido de usuarios, marketplace, menores, IA) **no cortan el pedido**: sirven para el alcance. Si al cruzarlas algo no es estándar, lo decide Tomás en la revisión. `[VALIDA WTR]` el set final de preguntas (borrador en la oficina, `servicio-tyc-pp/formulario.md`).
6. **Archivos** — opcionales. PDF, Word e imágenes, hasta 20 MB en total `[CONFIRMAR]`. No quedan accesibles desde afuera.
7. **Confirmación** — pantalla y mail con el plazo de entrega: 5 días hábiles desde que el formulario está completo `[VALIDA WTR]`.
8. **Entrega** — por mail, con los adjuntos y un solo llamado a la acción: agendar la reunión de diagnóstico.

## Consentimiento (texto de Tomás, 02/11/2026)
Casilla separada, sin marcar, antes de pagar y otra vez en el formulario (antes de subir archivos). Sin ella no se puede seguir. Con link a la política de privacidad de Legal Pacer, que informa la transferencia internacional. **[REVISAR COLEGIO]**

> Acepto que, para preparar mi documento, Legal Pacer use herramientas de procesamiento de información y que un abogado de WTR | abogados revise el documento antes de entregármelo. Esa información no se usará para entrenar modelos de inteligencia artificial.

## Estados del pedido
pagado · formulario completo · borrador listo · en revisión · enviado · reunión agendada. Los dos primeros los marca el sistema; los demás, el panel o la operación.

## Datos personales (Ley 25.326)
Responsable: WTR | abogados, representado por Tomás Rodríguez. Contacto: privacidad@legalpacer.com. Conservación (Tomás, 02/11/2026): respuestas, documento y contacto, 5 años; archivos subidos y borradores, 90 días desde la entrega (borrado automático); documentación de pago, 10 años `[VERIFICAR art.]`.

## Límite del módulo
Cubre el caso estándar con ley argentina. Lo que excede (otra ley, sociedad del exterior, un modelo atípico) va a la reunión de diagnóstico con WTR. Los cambios posteriores a la entrega no están incluidos: se ofrecen desde WTR.

## Copy
Lo escribe `contenido` en la oficina y lo aprueba Tomás. Reglas: sin promesas de resultado, sin "garantiza", un solo llamado a la acción por pantalla. **Microcopy de marca:** Un producto de WTR | abogados.

---

## Para los dos módulos (consistencia)
- Toda salida "hablá con el estudio" va a la reunión de diagnóstico de WTR (mismo Calendly, también desde Legal Pacer).
- Mantener el patrón de estados y botones consistente entre módulos.
- Nunca afirmar que el documento o checklist "garantiza" cumplimiento legal: ordena y resuelve lo estándar, el resto se ve con el estudio.
- Pendiente de datos reales: textos legales `[VALIDA WTR]`, plazo de entrega, límite de archivos y plazo de conservación de los mails del checklist.
