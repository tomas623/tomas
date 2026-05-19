# Perfil de práctica — Laboral (Argentina)

## Idioma y estilo

- Responder en **español rioplatense**.
- Terminología argentina: "trabajador / trabajadora" (no "empleado" en escritos formales); "empleador" (no "patrón"); "despido" (no "termination"); "indemnización por antigüedad" (no "severance"); "preaviso"; "rubros no remunerativos"; "registración"; "telegrama laboral" (no "letter").

## Marco normativo

### Fondo
- **Ley 20.744 — Ley de Contrato de Trabajo (LCT)**. Régimen general.
- **Ley 24.013 — Empleo** (multas por mala registración, arts. 8-15).
- **Ley 25.323** (duplicación indemnizatoria, intimación previa).
- **Ley 25.345** (art. 80 LCT — certificados, multa por no entrega).
- **Ley 24.557 — Riesgos del Trabajo (LRT)** y modificatorias (Ley 26.773, Ley 27.348).
- **Ley 14.250 — Convenios Colectivos de Trabajo (CCT)** y Ley 23.546 (negociación).
- **Ley 23.551 — Asociaciones Sindicales**.
- **Ley 11.544 — Jornada de Trabajo** y Decreto 16.115/33.
- **Ley 26.844 — Régimen Especial para Personal de Casas Particulares**.
- **Ley 22.250 — Régimen de la Construcción**.
- **Ley 26.727 — Trabajo Agrario**.
- **Estatutos profesionales** específicos (viajantes, periodistas, encargados de edificios, etc.).
- **Reforma laboral Ley 27.742 (Ley Bases)** — verificar estado vigente.

### Procedimiento
- **Ley 18.345** — Procedimiento ante la Justicia Nacional del Trabajo (CABA).
- **SECLO** — Servicio de Conciliación Laboral Obligatoria (CABA, previo a juicio).
- Códigos procesales laborales provinciales (ej. Ley 11.653 PBA).

## Cálculos típicos

### Indemnización por despido sin causa (art. 245 LCT)
- **Base**: mejor remuneración mensual, normal y habitual devengada durante el último año o el tiempo de prestación, si fuere menor.
- **Tope**: 3 veces el promedio de remuneraciones del CCT aplicable (Vizzoti: si la base supera el tope en más del 33%, se aplica el 67% de la base real).
- **Fórmula**: base x años de antigüedad. Fracción mayor a 3 meses = 1 año.
- **Mínimo**: 1 mes de sueldo.

### Preaviso (art. 231 LCT)
- Trabajador: 15 días.
- Empleador:
  - 15 días durante el período de prueba.
  - 1 mes si antigüedad ≤ 5 años.
  - 2 meses si antigüedad > 5 años.
- Integración mes de despido (art. 233 LCT) si la fecha de despido no coincide con fin de mes.

### SAC proporcional, vacaciones no gozadas
- SAC sobre indemnizaciones (jurisprudencia plenario "Tulosai" — **revisar estado actual** post Ley 27.742).
- Vacaciones no gozadas: art. 156 LCT — proporcional.

### Multas (revisar vigencia post Ley 27.742)
- Art. 8, 9, 10 Ley 24.013: trabajo no registrado o deficientemente registrado.
- Art. 15 Ley 24.013: despido dentro de los 2 años de la intimación.
- Art. 2 Ley 25.323: duplicación por falta de pago oportuno (50%).
- Art. 80 LCT (Ley 25.345): falta de entrega de certificados.

> **IMPORTANTE**: la Ley 27.742 (Bases) modificó/derogó varias multas. Marcar `[verificar vigencia]` y confirmar antes de incluir en cálculo final.

## Procedimiento de intercambio telegráfico (CCT)

1. **Trabajador intima** (telegrama Ley 23.789 / carta documento) por causa concreta (registración deficiente, falta de pago, malos tratos, etc.) bajo apercibimiento de considerarse despedido.
2. Empleador tiene plazo razonable (48 hs / 2 días hábiles según jurisprudencia).
3. **Respuesta del empleador**: rechazar o reconocer.
4. **Trabajador se da por despedido** (despido indirecto) o continúa.

Modelo de telegrama en `references/telegrama-modelo.md`.

## Banderas rojas / cuestiones críticas

- **Trabajo no registrado o mal registrado**: fecha de ingreso real, categoría real, salario real (sumas "en negro"). Multas Ley 24.013.
- **Fraude laboral**: locación de servicios / monotributo / facturación encubriendo relación dependiente. Test de subordinación (jurídica, técnica, económica).
- **Tercerización (art. 30 LCT)**: solidaridad del contratista principal por cesión de establecimiento o contratación de servicios correspondientes a la actividad normal y específica.
- **Grupo económico (art. 31 LCT)**: solidaridad entre sociedades del mismo grupo cuando hayan mediado maniobras fraudulentas o conducción temeraria.
- **Discriminación (Ley 23.592)**: nulidad del acto, reinstalación o agravamiento indemnizatorio. Cuidado especial con embarazo (arts. 177-178 LCT), matrimonio (arts. 180-182), enfermedad, sindical.
- **Mobbing / acoso**: aplicar Convenio 190 OIT (ratificado por Argentina) y Ley 26.485.
- **Período de prueba (art. 92 bis LCT)**: 3 meses (extensible por Ley 27.742 a 6/8 meses — verificar texto vigente).
- **Trabajo a distancia (Ley 27.555)**: derecho a la desconexión, reversibilidad, compensación de gastos.
- **Licencias especiales**: maternidad (90 días), paternidad (2 días — proyecto de ampliación), excedencia, lactancia.

## Output esperado

- **Liquidación final**: detalle rubro por rubro (sueldo proporcional, SAC prop., vacaciones no gozadas, preaviso, integración, indemnización art. 245, multas si corresponden), con base de cálculo, antigüedad y cálculo paso a paso.
- **Memo de riesgo de despido**: análisis de causa, riesgo de despido indirecto, multas eventuales, recomendación (acuerdo en SECLO vs. despido directo).
- **Carta documento / telegrama**: redacción precisa, con causal concreta, intimación, plazo, apercibimiento.

## Por defecto

- **Convenio colectivo aplicable**: identificarlo siempre antes de calcular. Confirmar en BORA o página del Ministerio de Trabajo.
- **Conciliación previa**: en CABA, SECLO obligatorio antes de demanda. En provincias, revisar régimen local.
- **Prescripción**: 2 años (art. 256 LCT) desde la exigibilidad. Para créditos previsionales: 10 años (Ley 14.236).
- **Intereses**: las tasas judiciales varían por fuero. CNAT aplica tasa activa BNA / Acta 2658 / 2764 según fecha. Marcar `[verificar tasa aplicable]`.
- **Solidaridad de directores y socios** (art. 54 LGS, art. 274 LGS, doctrina "Palomeque"): analizar caso por caso, no es automática.
