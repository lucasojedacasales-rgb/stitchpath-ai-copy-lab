# CE01_INVALID_FORENSICS_REPORT.md — StitchPath AI

> Diagnóstico forense (solo lectura). No se modifica código, no se relaja el
> validador, no se permite exportar si CE01=INVALID, no se toca encoder,
> detector universal, aprendizaje del corpus ni Final Look.
>
> Pregunta: ¿por qué CE01 sigue INVALID después de EXPORT_REPAIR_REPORT_V5?

---

## 1. Estado general

Datos tomados del EXPORT_REPAIR_REPORT_V5 facilitado:

| Campo | Valor |
|---|---|
| source CE01 status | **INVALID** |
| repaired CE01 status | **INVALID** |
| source score | 21 |
| repaired score | 26 |
| exportAllowed (source) | false |
| exportAllowed (repaired) | false |
| commandSourceUsedForExport | repaired (repairAccepted=true) |

Métricas reparadas (devueltas):

| Métrica | source | repaired |
|---|---|---|
| visibleDiagonalStitches | 70 | **0** |
| emptyBlocks | 1 | **0** |
| duplicateStitches | 125 | 38 |
| missingTieIn | 55 | 5 |
| missingTieOff | 55 | 5 |
| unsupportedLongStitches | — | **0** |
| invalidCommandSequence | — | **0** |
| regionOutsideBounds | — | **0** |
| ce01Score | 21 | 26 |

> Todas las métricas que el V5 reporta como "bloqueos" están a 0, pero CE01
> sigue INVALID. **El bloqueo restante NO está entre las métricas que vigila el
> reporte V5.**

---

## 2. Blocking issues reales del `validateCE01`

### 2.1 Reglas del validador que producen INVALID (análisis de `ce01Validator.js`)

`validateCE01` solo devuelve `INVALID` si `blockingIssues.length > 0`. Las
únicas reglas que emiten `blockingIssues` son:

| check | regla | condition | score penalty | categoría |
|---|---|---|---|---|
| 1 | stitchCountOverLimit | `stitches > 12000` | -30 | stitchCountOverLimit |
| 7 | outOfHoop | `\|x\|>50 o \|y\|>50` | -25 | boundsError |
| 8 | bboxOverHoop | `designW>100 o designH>100` | -20 | collapsedGeometry / boundsError |
| 13 | contourAsFill | región contour con `stitch_type='fill'` | -15 | malformedColorBlocks (región) |
| 15 | invalidCommand | comando nulo/sin type o secuencia vacía | (retorna INVALID inmediato) | invalidCommandSequence |

> **Crítico:** el `exportRepairReport.js` solo imprime en su tabla "Bloqueos
> antes/después" **4** categorías: `visibleDiagonalStitches`, `emptyBlocks`,
> `invalidCommandSequence`, `regionOutsideBounds`. 
> **NO imprime** `stitchCountOverLimit` (check 1) ni `contourAsFill` (check 13).
> Por eso el reporte V5 muestra "todo 0" pero CE01 sigue INVALID.

### 2.2 Mapping métrica V5 → check CE01

| Métrica V5 (reporte) | check CE01 | ¿reparable por V5? | estado repaired |
|---|---|---|---|
| visibleDiagonalStitches | (no es check CE01; es detector propio) | sí | 0 ✅ |
| emptyBlocks | (no es check CE01 directo) | sí | 0 ✅ |
| invalidCommandSequence | 15 | sí | 0 ✅ |
| regionOutsideBounds | 7 | sí | 0 ✅ |
| **stitchCountOverLimit** | **1** | parcial (merge/simplify) | **NO reportado** ⚠ |
| **contourAsFill** | **13** | **NO** (es a nivel región, no comando) | **NO reportado** ⚠ |
| bboxOverHoop | 8 | implícito por 7 | 0 (si 7=0) |

### 2.3 Blocking issues para sourceCommands

El validador devuelve `blockingIssues: [{ check, message }]` — **solo** `check`
(número) y `message`. **No expone** `ruleId`, `commandIndexes`, `regionIds` ni
`affectedColors` en su esquema actual.

| Campo | sourceCommands |
|---|---|
| blockingIssues | presentes (INVALID) |
| ruleId (check) | ver §4 — candidatos: 1, 13 (7 y 15 descartados) |
| severity | blocking |
| message | formato `${n} ...` (count incluido en el texto) |
| count | embebido en message (no campo separado) |
| commandIndexes | **N/A — el validador no los registra** |
| regionIds | **N/A — el validador no los registra** (check 13 es aggregate por regions) |
| affectedColors | **N/A — el validador no los registra** |

### 2.4 Blocking issues para repairedCommands

| Campo | repairedCommands |
|---|---|
| blockingIssues | presentes (INVALID) — al menos 1 |
| ruleId (check) | **1 (stitchCountOverLimit)** o **13 (contourAsFill)** — ver §4 |
| severity | blocking |
| count | embebido en message |
| commandIndexes | N/A (esquema validador) |
| regionIds | N/A (esquema validador) |
| affectedColors | N/A (esquema validador) |

> **Para confirmar el `check` exacto:** en la app, `CE01ReportPanel` ya renderiza
> `blockingIssues` (con `check` y `message`). Abrir ese panel sobre los
> `repairedCommands` (modo exportable) revela el número de check. Alternativa:
> `console.log(validateCE01(repairedCommands, objects, regions, config, ms).blockingIssues)`.

---

## 3. Diferencia source vs repaired

| issue (check CE01) | source count | repaired count | mejora | sigue bloqueando |
|---|---|---|---|---|
| visibleDiagonalStitches (detector) | 70 | 0 | ✅ 70 | no (no es check CE01) |
| emptyBlocks (detector) | 1 | 0 | ✅ 1 | no (no es check CE01 directo) |
| invalidCommandSequence (check 15) | 0 | 0 | — | **no** ✅ |
| regionOutsideBounds (check 7) | 0 | 0 | — | **no** ✅ |
| unsupportedLongStitches (check 5, warning) | 0 | 0 | — | no (warning) |
| **stitchCountOverLimit (check 1)** | **¿?** | **¿?** | desconocido | **posible SÍ** ⚠ |
| **contourAsFill (check 13)** | **¿?** | **¿?** | **0 (V5 no toca regions)** | **posible SÍ** ⚠ |
| bboxOverHoop (check 8) | 0 (implícito por 7=0) | 0 | — | no ✅ |
| duplicateStitches (check 6, warning) | 125 | 38 | ✅ 87 | no (warning) |
| missingTieIn (check 9, warning) | 55 | 5 | ✅ 50 | no (warning) |
| missingTieOff (check 10, warning) | 55 | 5 | ✅ 50 | no (warning) |
| ce01Score | 21 | 26 | +5 | — |

> Las dos filas marcadas ⚠ son las únicas blocking checks de CE01 que el V5
> **no vigila ni reporta**. Una de ellas (o ambas) es la causa del INVALID.

---

## 4. Clasificar causa del INVALID

Categorías candidatas (de la lista solicitada) que pueden quedar activas tras
V5 con las métricas reparadas a 0:

| Categoría | check | ¿puede quedar tras V5? | motivo |
|---|---|---|---|
| stitchCountOverLimit | 1 | **SÍ** | V5 elimina dups/diagonales pero puede no bajar de 12000; además el reporte V5 NO la imprime |
| malformedColorBlocks (contourAsFill) | 13 | **SÍ** | regla a nivel **región**; V5 solo repara comandos → 0 mejora posible |
| tooManyTrims | (2b) | no → warning, no INVALID | solo warning (-15 score) |
| tooManyJumps | (2) | no → warning | solo warning |
| shortStitchesCritical | 4 | no → warning | solo warning |
| tieInTieOffMissing | 9/10 | no → warning | solo warning |
| colorCountTooHigh | 11 | no → warning | solo warning |
| invalidCommandSequence | 15 | no | repaired=0 |
| boundsError | 7 | no | repaired=0 |
| unsafeDensity | 12 | no → warning | solo warning |
| unsupportedCommandType | — | no | no existe check dedicado |
| missingEndCommand | — | no | no existe check dedicado |
| collapsedGeometry | 8 | no | implícito por 7=0 |

### Veredicto de clasificación

**Root cause primario (más probable): `contourAsFill` (check 13)**
- Es una regla **a nivel región**, no comando. El pipeline V5 opera
  exclusivamente sobre `finalLookCommands`; **nunca toca `regions`**.
- Por diseño, V5 **no puede** reducir `contourAsFill` (siempre source = repaired).
- En diseños tipo Kirby (personaje con outline/contour), es habitual que una
  región clasificada como `outer_outline`/`inner_outline`/`detail_run` (o con
  nombre que contiene "outline"/"contour") tenga `stitch_type='fill'`, lo que
  dispara el check 13 como blocking.
- Esto explica perfectamente: todas las métricas de comando reparadas a 0,
  pero CE01 sigue INVALID por una regla que **no depende de los comandos**.

**Root cause secundario: `stitchCountOverLimit` (check 1)**
- V5 sí la tiene en cuenta (`stitchCountOverLimit` es blocking en
  `exportErrorDetector`), pero el `exportRepairReport.js` **la omite** de la
  tabla "Bloqueos antes/después". Si el diseño tiene >12000 puntadas y V5 no
  consigue bajar del límite, CE01 queda INVALID sin que el reporte lo muestre.

> Ambas son **consistentes** con el síntoma "métricas V5 a 0 pero CE01 INVALID".

---

## 5. Top 30 comandos problemáticos

> ⚠ **Limitación del esquema actual del validador.** `validateCE01` emite
> `blockingIssues` como `{ check, message }` — **sin `commandIndex`, sin
> regionId, sin affectedColors**. Las reglas blocking reales son además
> **aggregate** (check 1 = total de puntadas; check 13 = total de regiones
> contour-as-fill), por lo que **no tienen un commandIndex individual**.

Por tanto, la tabla "top 30 comandos problemáticos" **no puede poblarse** con el
validador actual sin modificar código. Lo que sí puede determinarse:

| check | naturaleza | commandIndex aplicable? | cómo localizar |
|---|---|---|---|
| 13 (contourAsFill) | aggregate por región | N/A (no es un comando) | iterar `regions`: donde `(region_class ∈ {outer_outline,inner_outline,detail_run} \|\| nombre incluye outline/contour) && stitch_type==='fill'` |
| 1 (stitchCountOverLimit) | aggregate global | N/A (es un total) | `commands.filter(c=>c.type==='stitch').length > 12000` |

### Plantilla (a rellenar tras confirmar el check con CE01ReportPanel)

| # | commandIndex | type | x | y | color | stitchType | regionId | prev cmd | next cmd | whyInvalid | proposedFix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | — | — | fill | <regionId con contourAsFill> | — | — | check 13: región contour marcada como fill | reclasificar `stitch_type` a `running_stitch` (region-level) |
| … | … | … | … | … | … | … | … | … | … | … | … |

> Para checks warning con commandIndex (4, 5, 6), el validador tampoco indexa:
> solo cuenta. Localizar commands requiere recorrer la secuencia aplicando la
> misma condición que el validador (ej. `dist < 0.8mm` para check 4).

---

## 6. ¿El INVALID viene de una regla demasiado agresiva?

| check | validatorRuleSeemsCorrect | possibleFalsePositive | reason |
|---|---|---|---|
| 13 (contourAsFill) | **true** | **false** | Un contorno cosido como fill es un error real de digitalización: produce relleno donde debería haber running stitch. La regla es correcta; el problema está **aguas arriba** (clasificación de región), no en el validador. |
| 1 (stitchCountOverLimit) | **true** | **false** | 12000 es el límite físico de la CE01. La regla es correcta; el problema es de **reducción de puntadas**, no de validación. |

> No se detecta regla agresiva ni falso positivo. El validador está actuando
> correctamente: detecta un problema **real** que el pipeline V5 no está
> diseñado para resolver (región mal clasificada / exceso de puntadas).

---

## 7. Verificar inconsistencia de reporte

**Sí, hay una inconsistencia de reporte.**

El EXPORT_REPAIR_REPORT_V5 dice (sobre `returnedMetrics`):
- repaired visibleDiagonalStitches = 0 ✅
- repaired emptyBlocks = 0 ✅
- repaired invalidCommandSequence = 0 ✅
- repaired regionOutsideBounds = 0 ✅
- repaired unsupportedLongStitches = 0 ✅

Y, sin embargo, CE01 = INVALID.

**Causa de la inconsistencia:** `exportRepairReport.js` (sección "2. Bloqueos
antes/después" y "6. Criterios de éxito") solo considera **4** categorías de
bloqueo:
`visibleDiagonalStitches`, `emptyBlocks`, `invalidCommandSequence`,
`regionOutsideBounds`.

**Omite dos blocking checks reales de `validateCE01`:**
1. **check 1 — `stitchCountOverLimit`** (presente en `exportErrorDetector` como
   blocking, pero **no volcado** en la tabla del reporte).
2. **check 13 — `contourAsFill`** (región-level; **no existe** en
   `exportErrorDetector` ni en el reporte).

Por eso el reporte muestra "todos los bloqueos a 0" mientras CE01 sigue INVALID:
**el bloqueo real pertenece a una categoría que el reporte no imprime.**

Además, `validateCE01` ya calcula `ce01.blockingIssues` (con `check` + `message`)
dentro de `detectExportErrors`, pero `exportRepairReport.js` **no vuelca**
`ce01.blockingIssues` en el informe. La información existe en runtime; no se
imprime.

---

## 8. Resultado esperado

```
CE01_INVALID_ROOT_CAUSE:

- regla principal:        check 13 (contourAsFill) — región contour con stitch_type='fill'
                          [secundaria posible: check 1 stitchCountOverLimit]
- cantidad:               contourAsFill: ≥1 región (a confirmar via CE01ReportPanel)
                          stitchCount: >12000 puntadas (a confirmar)
- severidad:              blocking (INVALID)
- reparable automáticamente: NO por el pipeline V5 actual
    · check 13 → requiere corrección a nivel REGIÓN (reclasificar stitch_type),
      no a nivel comando. V5 no toca regions.
    · check 1  → requiere reducción de puntadas (simplificación/merge agresivo)
      que V5 no implementa (su merge es solo warnings).
- siguiente función que debe corregirse:
    1) Volcar ce01.blockingIssues (check + message) en exportRepairReport.js
       para que el reporte V5 muestre la regla exacta. (solo reporte, no lógica)
    2) Para check 13: añadir una fase de reparación a nivel región que
       reclasifique `stitch_type` de regiones contour (outer_outline/
       inner_outline/detail_run o nombre outline/contour) a 'running_stitch'.
    3) Para check 1: añadir una fase de reducción de puntadas (simplificación
       de objetos diminutos / merge de micro-stitches) con gate transaccional.
- si debe bloquear exportación: SÍ (mientras contourAsFill>0 o stitches>12000).
  No relajar el validador. La exportación debe seguir bloqueada hasta que la
  causa real se repare.
```

---

## Resumen ejecutivo

- El V5 funciona: visibleDiag 70→0, emptyBlocks 1→0, dups 125→38, tieIn/Off 55→5.
- CE01 sigue INVALID porque **el bloqueo restante no es de las 4 categorías que
  vigila el reporte V5**, sino de **check 13 (contourAsFill)** — una regla a
  nivel **región** que el pipeline de comandos V5 no puede tocar — o de
  **check 1 (stitchCountOverLimit)**, que el detector trackea pero el reporte
  no imprime.
- No hay falso positivo ni regla agresiva: el validador detecta un problema real.
- **No se relaja el validador.** La exportación debe seguir bloqueada.
- Próximo paso (cuando se autorice modificar): volcar `ce01.blockingIssues` en el
  reporte V5 y, por separado, corregir la clasificación de región (check 13) /
  reducir puntadas (check 1).

_Forense de solo lectura. Sin cambios de código. Sin relajar CE01._