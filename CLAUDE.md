# Legal Pacer — contexto del proyecto (para Claude Code)

Este archivo fija el contexto de Legal Pacer. Leelo antes de proponer o escribir cambios en la web. Si una decisión de producto o copy no encaja con esto, avisá antes de aplicarla.

## Qué es Legal Pacer
La **legaltech de WTR | abogados**. Resuelve online, simple y a bajo costo, las necesidades legales **tempranas y repetidas** de un emprendimiento. Es un **producto**, no un estudio online: resuelve casos que ya están pensados, no asesora caso por caso.

- Dueño de marca: **WTR | abogados** (estudio jurídico, San Fernando, Buenos Aires).
- **El nombre es Legal Pacer, en singular** (decisión de Tomás, octubre 2026).
- **Relanzamiento: martes 1/12/2026, directamente en legalpacer.com** (decisión de Tomás, 02/11/2026). legalpacers.com y marcas.legalpacers.com pasan a redirigir con 301 al singular. Hasta el día de la migración, producción sigue en el plural: la migración se prepara en la rama, detrás de variables de entorno, y no se cambian URLs, mails ni rutas en producción sin el OK de Tomás. Los webhooks de Mercado Pago y de Meta se cambian a mano (un 301 no sirve para un POST).
- La web vieja puede decir "Rodríguez y Asociados": eso es legacy. **Unificar a WTR | abogados** donde aparezca.
- URL del módulo de marcas: marcas.legalpacers.com (pasa a marcas.legalpacer.com con la migración).

## El filtro (la regla que ordena TODO)
Una funcionalidad va en Legal Pacer **solo si cumple las tres**:
1. **Estándar** — la respuesta es parecida para casi todos.
2. **Repetible** — pasa seguido, no es un caso único.
3. **Autogestionable** — el usuario lo resuelve solo con una buena guía, sin un abogado al lado.

Si falla en una, **no es Legal Pacer: es WTR** (el estudio). No lo construyas como feature; derivá al estudio.

## Los productos (el alcance real)
1. **Registro de marcas** *(existe)* — registro online + **vigilancia de marcas por suscripción** (ingreso recurrente, es el ancla del negocio).
2. **Checklist legal para startups** *(sale el 1/12, gratis)* — el usuario responde preguntas y recibe un mapa de qué tiene en orden y qué le falta. **Ordena y prioriza; no resuelve todo.** Cada ítem faltante deriva a otro módulo de LP o al estudio. Es gratis y se busca que deje el mail, con lo que pide la Ley 25.326 (finalidad, responsable, plazo y baja; casilla aparte y sin marcar para novedades).
3. **Términos y condiciones** *(sale el 1/12)* — el usuario completa un formulario y sube lo que tenga (sus términos actuales, web, redes, dossier) como base de conocimiento; si no tiene nada, solo completa el formulario. El estudio arma el documento sobre los modelos de WTR, con ley argentina, y un abogado lo revisa antes de entregarlo en Word y PDF, con una guía de buenas prácticas. Precio: **$200.000**, con una reunión de diagnóstico gratuita con WTR.
4. **Política de privacidad** *(sale el 1/12)* — mismo circuito, aparte de los términos. Precio: **$200.000**, con una reunión de diagnóstico gratuita con WTR. Lleva guía de buenas prácticas y guía de GDPR.
5. **Combo términos y condiciones + política de privacidad** *(sale el 1/12)* — **$275.000**, con una sola reunión de diagnóstico.
6. **Club Pacers** *(después del MVP, decisión de Tomás)* — un lugar donde conviven proveedores de servicios **no legales** para startups (contadores, diseño, desarrollo, marketing) y las startups que los necesitan. No es un producto legal, así que no pasa por el filtro de abajo: es tráfico y comunidad para el ecosistema. Los servicios legales quedan en WTR.

Los tres (3, 4 y 5) van en página propia (legalpacer.com/tyc-startups), fuera del checklist; el checklist solo deriva ahí. **Hasta enero de 2027 el servicio funciona "a mano" por detrás**: el borrador lo arma el equipo sobre los modelos de WTR y lo revisa Tomás. El sistema solo cobra, recibe el formulario y los archivos, avisa y entrega. No construir una herramienta automática de redacción sin consultar. Precios configurables por variable de entorno, nunca escritos sueltos en el código. Agendar la reunión de diagnóstico es siempre con el estudio (mismo Calendly de WTR).

## Fuera de alcance (no construir sin consultar)
- E-commerce como vertical propio, "cualquier trámite legal", asesoramiento caso por caso, módulos genéricos que no pasen el filtro. Si surge algo bueno pero no pasa el filtro, se ofrece **desde el estudio**, no como feature de LP.

## El funnel (siempre presente en el diseño)
El usuario **entra por Legal Pacer** (barato, self-service, necesidad puntual) y **sube a WTR** cuando el caso deja de ser estándar (socio nuevo, inversión, conflicto, un contrato propio del caso). Por eso:
- Cada módulo debe tener una **salida natural al estudio** cuando el caso se complejiza ("esto ya necesita un abogado → contactanos").
- El checklist es la puerta de entrada: su resultado empuja a resolver (otro módulo) o a hablar con WTR.

## Voz y tono
- Español de Argentina, **voseo**. Claro, sobrio, cercano, para emprendedores.
- **Mostrar, no declarar.** Prohibido: "boutique", "excelencia jurídica", "soluciones integrales", "amplia trayectoria", latinismos, jerga vacía de marketing ("disrupción", "revolucionamos"), emojis, signos de exclamación.
- El lenguaje real del ecosistema (marca, TyC, socios, ronda) sí va; la jerga vacía no.
- **Afirmar, no compararse.** No compararse con estudios grandes ni "firmas serias".
- No inventar datos, precios ni funcionalidades que no existan: si falta info real, dejar el dato pendiente visible, no inventarlo.
- **Sin tono "de IA".** Legal Pacer habla simple, como un producto: qué hacés, qué recibís, cuánto sale. Evitar frases en espejo o simétricas ("Lo simple, online. Lo complejo, con el estudio"), aforismos, enumeraciones de a tres por reflejo y abuso de dos puntos. Explicar en positivo lo que hace cada uno (Legal Pacer y WTR), nunca "esto no lo hacemos".
- Si Tomás escribe un texto, se respeta su redacción: se corrige gramática, no se reescribe.

## Marca e identidad visual
- Resumen del brandbook en `docs/brand.md`: concepto del pacer, paleta (#001540, #006FFB, #E2E1DE, #1E1E1E, fondo crema), tipografía Mundial y uso del logo. Todo diseño nuevo lo sigue.
- El brandbook dice "consultora legal": eso quedó viejo. Hoy Legal Pacer es un producto de WTR | abogados.

## Relación con WTR (cómo nombrarlo)
- En Legal Pacer: mostrar que es **"un producto de WTR | abogados"**.
- Legal Pacer no compite con el estudio: lo alimenta. El tono es el de una herramienta que te resuelve lo simple y te conecta con el estudio para lo complejo.

## Regla de bolsillo ante cualquier duda de alcance
*¿Esto lo puede hacer solo, con una guía, y le pasa a casi todos? Sí → Legal Pacer. No → WTR.*
