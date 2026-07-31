# Rodriguez | abogados — sitio web

Sitio estático (HTML/CSS/JS, sin dependencias) para un estudio jurídico boutique.
Estética editorial, minimalista y premium: serif para títulos, sans para texto,
predominio del blanco, azul casi negro y acento verde oliva.

## Estructura

```
firma/
├── index.html                     Home
├── areas/
│   ├── index.html                 Áreas de práctica (los dos ejes)
│   ├── derecho-societario.html
│   ├── contratos-comerciales.html
│   ├── propiedad-intelectual.html
│   ├── startups.html
│   ├── tecnologia-ia.html
│   ├── resolucion-de-conflictos.html
│   └── sucesiones-planificacion-patrimonial.html
├── quienes-somos.html
├── equipo.html                    3 socios (espacio reservado)
├── publicaciones.html             Sección editorial tipo revista
├── contacto.html                  WhatsApp, celular, email, form demo
├── assets/
│   ├── css/style.css              Sistema de diseño (editable a mano)
│   └── js/main.js                 Interacciones sutiles (header, menú, reveal)
└── _build/build.js                Generador de las páginas
```

## Cómo editar

Todo el contenido (nombre de la firma, prácticas, equipo, publicaciones,
datos de contacto) vive en **`_build/build.js`**, arriba del todo.
Después de cambiar algo, regenerá el sitio:

```bash
node firma/_build/build.js
```

Esto reescribe todos los `.html`. El header y el footer son compartidos, así que
un cambio se refleja en todas las páginas.

Los estilos se editan directamente en `assets/css/style.css` (no se generan).

## Placeholders a reemplazar antes de producción

En `_build/build.js`, objeto `FIRM`:

- `email`, `phone`, `waNumber` (número de WhatsApp para wa.me), `linkedin`, `address`.

Además:

- **Equipo** (`TEAM`): nombres, cargos y biografías reales de los 3 socios.
  Reemplazar las ilustraciones SVG por retratos en blanco y negro (o tratamiento
  sobrio) en `.member__photo`.
- **Publicaciones** (`PUBS`): artículos reales. Hoy enlazan a `#`.
- **Imágenes**: las ilustraciones son SVG editoriales generados (arquitectura,
  estratos, redes) pensados como marcadores sin clichés jurídicos. Pueden
  reemplazarse por fotografía documental real (reuniones, arquitectura, ciudad,
  tecnología) manteniendo un tratamiento sobrio/monocromo.
- **Formulario de contacto**: es de demostración. Conectar a un endpoint o email.

## Paleta y tipografía

- Tinta (azul casi negro): `#14181e` · Oscuro profundo: `#0e1218`
- Grises: `#737780`, líneas `#e4e2da`
- Acento (verde oliva): `#4e5836`
- Títulos: **Spectral** (serif) · Texto: **Inter** (sans) — vía Google Fonts.
