# WTR | abogados — sitio web

Sitio estático (HTML/CSS/JS, sin dependencias). Estética editorial, minimalista y
contemporánea: serif para títulos, sans para texto, predominio del blanco, azul
casi negro y acento verde oliva.

**Marca y voz:** WTR | abogados (Walter y Tomás Rodríguez, socios fundadores).
Claim: *"Derecho para decisiones que importan."* La redacción sigue la skill de
voz de marca del estudio (afirmar sin compararse, mostrar sin declarar, voseo,
jerga en criollo, sin la palabra "boutique").

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
├── equipo.html                    Walter, Tomás y un lugar reservado
├── publicaciones.html
├── contacto.html                  WhatsApp, celular, email, form demo
├── preview.html                   Versión de un solo archivo (hash routing)
├── assets/
│   ├── css/style.css
│   └── js/main.js
└── _build/build.js                Generador de las páginas
```

## Cómo editar

Todo el contenido (datos de la firma, áreas, equipo, publicaciones) vive en
**`_build/build.js`**, arriba del todo. Después de cambiar algo, regenerá:

```bash
node firma/_build/build.js
```

Reescribe todos los `.html` y el `preview.html`. Header y footer son compartidos.
Los estilos se editan directo en `assets/css/style.css`.

## Deep links y compartir por WhatsApp

- Cada área tiene su propia URL (multipágina) y su ruta hash en `preview.html`
  (ej. `preview.html#/areas/propiedad-intelectual`).
- Cada página de práctica tiene un botón "Compartir por WhatsApp" que arma el
  link con el título y la URL de esa página.

## Placeholders a reemplazar antes de producción

En `_build/build.js`, objeto `FIRM`: `email` (confirmar dominio), `phone`,
`waNumber` (para wa.me), `linkedin`, `address`.

Además:
- **Equipo** (`TEAM`): confirmar/ajustar las bios y áreas de Walter y Tomás, y
  definir el tercer socio. Reemplazar las ilustraciones por retratos en blanco y
  negro con tratamiento sobrio.
- **Publicaciones** (`PUBS`): reemplazar por los artículos reales.
- **Imágenes**: las ilustraciones son SVG editoriales (arquitectura, estratos,
  red) sin clichés jurídicos; pueden reemplazarse por fotografía documental.
- **Formulario de contacto**: es de demostración; conectar a un endpoint o email.

## Paleta y tipografía

- Tinta (azul casi negro): `#14181e` · Oscuro profundo: `#0e1218`
- Grises: `#737780`, líneas `#e4e2da`
- Acento (verde oliva): `#4e5836`
- Títulos: **Spectral** (serif) · Texto: **Inter** (sans) — vía Google Fonts.
