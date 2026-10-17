# Sitio de WTR | abogados

Sitio estático (HTML, CSS y JS, sin servidor) que reemplaza al export de Hostinger Horizons.

- `contenido.js`: todo el texto del sitio (áreas, socios, pasos, datos de contacto).
- `estilos.css`: el sistema de diseño (tinta, verde oliva, Spectral + DM Sans).
- `sitio.js`: menú móvil, aparición al scrollear y envío del formulario.
- `build.js`: arma las páginas.

## Cómo se arma
```
node wtr/build.js                  # sitio real → wtr/dist/
WTR_BASE=/wtr node wtr/build.js    # vista previa → wtr/dist-preview/ (se ve en marcas.legalpacers.com/wtr/)
```
Después de cambiar el contenido, correr los dos y commitear las carpetas generadas.

## Dónde se publica
- **Vista previa:** la sirve el servidor de Legal Pacer en `/wtr/`, sin indexar.
- **Sitio real:** la carpeta `wtr/dist/` se puede subir tal cual a cualquier hosting. En Hostinger (plan Business): sitio vacío para wtrabogados.com.ar, SSL activado y el contenido de `wtr/dist/` (incluido el `.htaccess` oculto) en `public_html`. Si en cambio `wtrabogados.com.ar` apunta a Railway, el servidor de Legal Pacer la sirve solo (ver `HOSTS_WTR` en `server.js`).

## Formulario de contacto
Envía a `POST /api/wtr/contacto` del servidor de Legal Pacer: guarda la consulta como lead tipo `wtr` (filtro "Consulta web WTR" en el panel) y la manda por mail a `MAIL_WTR` (por defecto contacto@wtrabogados.com) con reply-to al remitente. Los orígenes permitidos están en `WTR_ORIGENES`.

## Pendiente
- Fotos de los socios (`socios[].foto` en `contenido.js`).
- Logos de las startups (`clientes` en `contenido.js`).
- Revisión de Tomás de los textos de las áreas.
