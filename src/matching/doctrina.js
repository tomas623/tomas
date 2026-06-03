// Marco doctrinario y normativo que se inyecta al system prompt de Gemini.
// Fuente: síntesis a partir de Ley 22.362, doctrina de marcas argentina y práctica INPI.
// Última verificación: junio 2026.
//
// El texto está organizado por bloques para que Gemini pueda razonar cada eje del análisis.
// NO modificar sin validar con un Agente de la Propiedad Industrial matriculado.

const DOCTRINA_INPI = `
# MARCO PARA EVALUAR LA REGISTRABILIDAD DE UNA MARCA EN ARGENTINA

La evaluación se rige por la **Ley 22.362 de Marcas y Designaciones** y aplica cuatro principios rectores:
**capacidad distintiva, novedad, especialidad y licitud**.

El INPI estructura su análisis en cuatro grupos de variables. Tu análisis debe cubrir las cuatro.

---

## 1. PROHIBICIONES ABSOLUTAS — falta de capacidad distintiva (Art. 2 Ley 22.362)

No es registrable un signo que carezca de aptitud intrínseca para distinguir productos/servicios:

- **Designaciones genéricas, necesarias o habituales** del producto o servicio (ej: "Pan" para panaderías).
- **Signos descriptivos** que indiquen naturaleza, función, cualidades, cantidad, destino, valor,
  lugar de origen o época de producción (ej: "Rápido" para mensajería).
- Nombres, signos o frases publicitarias que ya **pasaron al uso general** antes de la solicitud.
- La **forma necesaria o habitual** del producto.
- El **color natural** del producto, o un solo color aplicado sobre el mismo.

**Excepción — Secondary Meaning (capacidad distintiva sobreviniente):** un signo originalmente
descriptivo puede registrarse si el solicitante prueba que adquirió distintividad por uso intensivo
y reconocimiento de mercado.

---

## 2. PROHIBICIONES RELATIVAS — conflicto con terceros o con el orden público (Art. 3)

- **Marcas idénticas o similares** ya registradas o solicitadas para los mismos productos/servicios
  o productos/servicios afines (eje central del análisis de confundibilidad — ver §5).
- **Marcas engañosas** que induzcan a error sobre naturaleza, propiedades, función, calidad,
  origen, técnica de elaboración o precio.
- Signos **contrarios a la moral y a las buenas costumbres**.
- **Signos oficiales e institucionales**: escudos, banderas, emblemas de Nación, provincias,
  municipios, países extranjeros, organizaciones religiosas, sanitarias (Cruz Roja) e internacionales
  (ONU, Interpol).
- **Nombre, seudónimo o retrato** de una persona sin su consentimiento (o de herederos hasta el 4º grado).
- **Denominaciones de origen e indicaciones geográficas**, nacionales o extranjeras.
- **Designaciones de actividades** (ej: "Zapatería", "Taller", "Estudio") solas, sin elemento distintivo.
- **Frases publicitarias sin originalidad**.

---

## 3. RESTRICCIONES POR LEYES ESPECIALES

- **Ley 25.127** (producción ecológica): los términos "Bio", "Eco", "Orgánico", "Ecológico", "Biológico"
  están restringidos en marcas de clases **agroalimentarias (16, 20, 24, 29, 30, 31, 32)** salvo
  certificación SENASA del producto.
- **Ley 24.664** (símbolos olímpicos): los aros, JUEGOS OLIMPICOS, OLIMPIADAS, OLIMPICO,
  CITIUS ALTIUS FORTIUS, MOVIMIENTO OLIMPICO, COI y similares están reservados al COI/COA
  en **todas las clases**.
- **Ley 26.687** (tabaco): "Light", "Suave", "Milds", "Bajo en nicotina/alquitrán" y similares
  están prohibidos en marcas de clase 34.

---

## 4. ANÁLISIS DE CONFUNDIBILIDAD (método multifactorial)

El INPI **no aplica una fórmula matemática**: estima la reacción del público consumidor.
El cotejo marcario se hace en tres ámbitos:

- **Visual / gráfico-ortográfico**: cómo se ven escritas, errores de lectura previsibles.
- **Auditivo / fonético**: cómo suenan al pronunciarse en español rioplatense.
- **Ideológico / conceptual**: significado o idea evocada por el signo.

### Reglas de cotejo

1. **Cotejo sucesivo, no simultáneo**: las marcas NO se comparan una al lado de la otra.
   Se evalúa si el consumidor expuesto a la nueva marca puede recordar y confundirla con la anterior.
2. **Cotejo espontáneo**: simulando la reacción del consumidor común, sin análisis técnico.
3. **Impresión de conjunto**: comparar las marcas como totalidades, sin desintegrar elementos.
4. **Predominio de las semejanzas sobre las diferencias**: el evaluador debe enfatizar lo que
   acerca, no lo que aleja. Una diferencia notable puede no bastar si predominan similitudes.
5. **Elemento distintivo predominante**: identificar el componente más fuerte del conjunto
   marcario y ponderar la similitud sobre ese eje.
6. **Circunstancias adjetivas**:
   - **Partes iniciales idénticas** elevan el riesgo de confusión.
   - **Prefijos comunes** o sufijos compartidos refuerzan la familiaridad.
   - **Familias de marcas** del mismo titular extienden la protección a variantes.
   - **Marcas notorias** (Art. 6bis CUP) gozan de **protección reforzada cross-clase**: su
     reconocimiento generalizado las protege incluso fuera del nicho registrado.

---

## 5. PRINCIPIO DE ESPECIALIDAD

El riesgo de confusión se evalúa **respecto de los productos o servicios** que la marca protege.
Se considera afín cuando:

- Las clases pertenecen al **mismo género** comercial (ej: clase 25 ropa vs 18 marroquinería).
- **Finalidad complementaria** (ej: cosméticos clase 3 y servicios de peluquería clase 44).
- **Mismas materias primas** o procesos de elaboración.
- **Canales de comercialización compartidos** (mismo tipo de comercio o público).

Cuando las clases son notoriamente distintas y no hay afinidad comercial, la confusión decae
salvo que se trate de marca notoria.

---

## 6. MARCA NOTORIA (Art. 6bis Convenio de París)

Una marca es notoria cuando es **ampliamente reconocida** por el público consumidor del sector
relevante o el público general en Argentina. Su protección **trasciende el principio de
especialidad**: puede oponerse en clases donde su titular no registró.

Criterio cauteloso: solo afirmar notoriedad si la marca es claramente reconocible
(ej: Coca-Cola, Nike, Mercado Libre, YPF). Ante la duda, declarar **no notoria**.
`;

module.exports = { DOCTRINA_INPI };
