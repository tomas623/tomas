# Datos personales del servicio de términos y condiciones y política de privacidad (Ley 25.326)

Qué guarda el sistema de Legal Pacer para este servicio, dónde y por cuánto tiempo. La fuente es la tabla "Datos personales" de `marcas/legal-pacer/servicio-tyc-pp/procedimiento.md` (HQ), aprobada por Tomás el 02/11/2026; los plazos marcados [VALIDA WTR] siguen pendientes de validación del estudio. Este archivo cubre solo lo que está en el código (Railway). Lo que vive en Drive (carpeta del caso, registro de pedidos, borradores y versión final) lo maneja `operaciones` según el procedimiento.

Responsable: WTR | abogados, representado por Tomás Rodríguez [COMPLETAR · Tomás: CUIT y domicilio]. Contacto de privacidad: privacidad@legalpacer.com.

## Qué guarda el sistema

| Qué | Dónde (en el sistema) | Cuánto tiempo | Cómo se borra |
| --- | --- | --- | --- |
| Nombre, mail, nombre del proyecto, servicio, monto, referencia del pago de Mercado Pago, UTM | Tabla `leads` (SQLite en el volumen de Railway) | 5 años desde la entrega [VALIDA WTR] | A mano por ahora [COMPLETAR · tarea programada a 5 años] |
| Número de pedido, estado, fechas de cada paso, estado de la reunión de diagnóstico | Tabla `pedidos_docs` | 5 años desde la entrega [VALIDA WTR] | A mano por ahora [COMPLETAR] |
| Fecha en que marcó las casillas (ley argentina y consentimiento antes de pagar; consentimiento en el formulario) | `pedidos_docs.ley_argentina_at`, `leads.consentimiento_at`, `pedidos_docs.consentimiento_ia_at` | Igual que el pedido (es la prueba del consentimiento) | Con el pedido |
| Respuestas del formulario (C1 a C7, F1 a F21, links de redes) | `pedidos_docs.respuestas` (JSON) | 5 años desde la entrega [VALIDA WTR] | A mano por ahora [COMPLETAR] |
| Archivos que subió el cliente (PDF, Word, imágenes; hasta 20 MB en total) | Volumen de Railway, carpeta `pedidos-docs/<id>/` junto a la base, fuera de cualquier carpeta pública. Nombre y tamaño en `pedidos_docs_archivos` | 90 días desde la versión final [VALIDA WTR] | Automático: tarea diaria `docs-borrar-archivos` (3:30, `DOCS_ARCHIVOS_DIAS`, por defecto 90). Queda la fecha en `pedidos_docs.archivos_borrados_at` y en la auditoría |
| Hash del link único al formulario | `pedidos_docs.token_hash` (sha256; el link en claro solo viaja en el mail) | Hasta que se manda la versión final: ahí se borra y el link deja de servir | Automático al enviar la versión final |
| Registro de mails del pedido (tipo, destinatario, asunto, si salió; sin el cuerpo) | Tabla `pedidos_docs_mails` | Igual que el pedido | Con el pedido |
| Versión final y guías que se adjuntan en el panel | No se guardan en el sistema: salen en el mail y la copia queda en la carpeta del caso en Drive. En la auditoría queda nombre, tamaño y sha256 de cada adjunto | — | — |
| Pedidos que se iniciaron y no se pagaron (nombre, mail, proyecto, fecha de las casillas) | `leads` y `pedidos_docs` con estado `pendiente_pago` | [COMPLETAR · Tomás: plazo; propuesta 6 meses] | A mano por ahora [COMPLETAR] |
| Auditoría (quién cambió qué estado y cuándo) | Tabla `audit_log` | Igual que el pedido | Con el pedido |

## Quién accede

- El cliente, solo a su pedido y solo con el link único del mail (256 bits al azar). Con ese link ve y edita sus respuestas, sube y quita sus archivos; no puede descargar archivos ni ver otro pedido.
- El panel admin (`/admin`, usuarios con rol admin u operador): lista de pedidos, respuestas, archivos y envío de los mails del borrador y de la versión final.

## Proveedores que reciben datos

| Proveedor | Qué recibe | País |
| --- | --- | --- |
| Railway (hosting y base) | Todo lo de la tabla de arriba | [VERIFICAR · `tecnico`: región del proyecto] |
| Mercado Pago | Mail del cliente, monto y referencia del pago | Argentina |
| Resend (envío de mails) | Mail del cliente, nombre y contenido de los mails, adjuntos de la versión final | EE. UU. [VERIFICAR] |
| Meta (WhatsApp Cloud API), solo si `WHATSAPP_NOTIFY` está activo | El aviso interno a Tomás, sin datos del cliente (número de pedido y servicio) | EE. UU. [VERIFICAR] |

La transferencia fuera de Argentina tiene que estar en la política de privacidad de Legal Pacer (Ley 25.326, art. 12) antes de activar el servicio: hoy `/privacidad` no cubre este servicio (`relanzamiento-plan.md` 2.8). **[REVISAR COLEGIO]**

## Derechos del titular

Pedidos de acceso, rectificación o supresión a privacidad@legalpacer.com. Acceso en 10 días corridos; rectificación o supresión en 5 días hábiles (procedimiento.md). Para suprimir antes de plazo: borrar la carpeta `pedidos-docs/<id>/`, las filas de `pedidos_docs_archivos`, `pedidos_docs_mails` y `pedidos_docs` del pedido y el lead, y anotarlo en el registro de pedidos.
