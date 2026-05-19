# Claude for Legal — Adaptación Argentina

Esta carpeta contiene archivos de configuración (`CLAUDE.md`) y plantillas de referencia para adaptar los plugins de [anthropics/claude-for-legal](https://github.com/anthropics/claude-for-legal) al ejercicio profesional de la abogacía en la **República Argentina**.

El repositorio original está diseñado para la práctica jurídica en EE.UU. (common law, cortes federales, Westlaw/CourtListener). Estos archivos sobrescriben los defaults para trabajar bajo:

- **Sistema jurídico**: derecho continental / civil law
- **Idioma**: español rioplatense
- **Normativa de fondo**: Código Civil y Comercial de la Nación (CCyCN, Ley 26.994), Ley de Contrato de Trabajo (LCT, Ley 20.744), Ley General de Sociedades (LGS, Ley 19.550), Ley de Protección de Datos Personales (Ley 25.326), Ley de Defensa del Consumidor (Ley 24.240), entre otras.
- **Jurisdicción tipo**: CABA y Justicia Nacional/Federal; adaptable a provincias.

---

## Instalación

### 1. Instalar Claude Code y el marketplace de claude-for-legal

```bash
# En tu máquina, cloná el repo original
git clone https://github.com/anthropics/claude-for-legal.git ~/claude-for-legal

# Dentro de Claude Code
/plugin marketplace add ~/claude-for-legal
```

### 2. Instalar los plugins relevantes

```bash
/plugin install commercial-legal@claude-for-legal
/plugin install corporate-legal@claude-for-legal
/plugin install employment-legal@claude-for-legal
/plugin install litigation-legal@claude-for-legal
/plugin install privacy-legal@claude-for-legal
```

### 3. Copiar las adaptaciones argentinas

Por cada plugin instalado, copiá el `CLAUDE.md` y la carpeta `references/` correspondientes:

```bash
# Ejemplo para commercial-legal
mkdir -p ~/.claude/plugins/config/claude-for-legal/commercial-legal
cp claude-for-legal-argentina/commercial-legal/CLAUDE.md \
   ~/.claude/plugins/config/claude-for-legal/commercial-legal/CLAUDE.md
cp -r claude-for-legal-argentina/commercial-legal/references \
   ~/.claude/plugins/config/claude-for-legal/commercial-legal/

# Repetí para corporate-legal, employment-legal, litigation-legal, privacy-legal
```

### 4. (Opcional) Correr cold-start-interview con `--skip` o personalizar

Si querés afinar más (estudios chicos vs. medianos, materia específica, foro habitual), corré:

```
/commercial-legal:cold-start-interview
```

y completá tus datos. El `CLAUDE.md` ya cargado se va a respetar como base.

---

## Advertencias importantes

1. **No es asesoramiento legal**: estas adaptaciones son herramientas de trabajo para un abogado matriculado. Todo borrador requiere revisión y firma profesional.
2. **Verificá citas**: los conectores de investigación (CourtListener, Westlaw) son de EE.UU. Para citas a SAIJ, InfoLeg, jurisprudencia de la CSJN o de cámaras, Claude marcará `[verificar]` — usalo siempre.
3. **Datos personales**: si vas a procesar información de clientes, asegurate de cumplir con la Ley 25.326 y, cuando entre en vigencia, su sucesora.
4. **Secreto profesional**: configurá los conectores de almacenamiento (Drive, Box) con cuidado. El art. 7º inc. c) de la Ley 23.187 (Ejercicio de la Abogacía en CABA) y normas equivalentes provinciales imponen el deber de secreto.

---

## Estructura

```
claude-for-legal-argentina/
├── README.md
├── commercial-legal/          # Contratos comerciales, NDAs, locación de servicios
│   ├── CLAUDE.md
│   └── references/
├── corporate-legal/           # Societario, M&A, due diligence
│   ├── CLAUDE.md
│   └── references/
├── employment-legal/          # Laboral individual y colectivo
│   ├── CLAUDE.md
│   └── references/
├── litigation-legal/          # Litigios civiles, comerciales, laborales
│   ├── CLAUDE.md
│   └── references/
└── privacy-legal/             # Protección de datos personales
    ├── CLAUDE.md
    └── references/
```
