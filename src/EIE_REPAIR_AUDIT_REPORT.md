# EIE_REPAIR_AUDIT_REPORT — StitchPath AI

> **Auditoría del Export Issue Engine (EIE).** Solo lectura. No se aplica ninguna mejora.
> Generado: 2026-07-04
> Estado estable de referencia: `CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING.md`

---

## Resumen ejecutivo

El EIE está dividido hoy en **dos responsabilidades mezcladas en un solo paso**:
`detectExportErrors()` detecta 15 tipos de errores, y el orquestador
`repairFinalLookCommandsForExport` aplica una secuencia fija de fases transaccionales.

El problema reportado —"detecta bien, pero al reparar a veces no lo hace del todo
bien o crea errores nuevos"— se descompone en 4 causas raíz:

1. **Errores detectados sin fixer real** (shortSt, longSt, tooDense, tooSmall,
   stitchCountOverLimit, excessiveJumps, excessiveTrims).
2. **Fixers peligrosos** (addTieInTieOff crea longSt/visibleDiag; splitUnsafeLongStitches
   puede crear diagonales si el soporte de máscara es dudoso).
3. **Fixers no conectados al pipeline V5.1** (splitUnsafeLongStitches,
   mergeShortStitches, optimizeTrimsAndJumps, simplifyTinyObjects existen pero no
   están en el array `phases` del orquestador).
4. **Fixers que no mejoran su target** porque el gate transaccional los revierte
   (addTieInTieOff se revierte sistemáticamente al crear longSt/visibleDiag).

---

## 1. Errores que detecta el sistema

`detectExportErrors()` (src/lib/exportRepair/exportErrorDetector.js) detecta
**15 tipos** de errores. Cada uno lleva `{ type, count, severity, reparable, proposedAction }`.

| # | error type | severity | reparable (flag) | cómo se cuenta |
|---|---|---|---|---|
| 1 | `invalidCommandSequence` | blocking | true | comandos nulos/sin `type` |
| 2 | `regionOutsideBounds` | blocking | true | `\|x\|>50` o `\|y\|>50` (hoop 100×100) |
| 3 | `emptyBlocks` | blocking | true | bloque entre colorChange/end/EOF con 0 stitches |
| 4 | `visibleDiagonalStitches` | blocking | true | detector único `detectVisibleDiagonalStitches` |
| 5 | `stitchCountOverLimit` | blocking | true | stitches > 12000 |
| 6 | `tooSmallObjects` | warning | true | regiones con 1-2 stitches |
| 7 | `tooDenseAreas` | warning | true | celda 10mm con >250 stitches |
| 8 | `shortStitches` | warning | true | d<0.6mm entre stitches consecutivos (no tie) |
| 9 | `duplicateStitches` | warning | true | d<0.1mm consecutivos (no tie) |
| 10 | `excessiveTrims` | warning | true | trims > 80 |
| 11 | `excessiveJumps` | warning | true | jumps > 250 |
| 12 | `missingTieIn` | warning | true | bloque ≥4 stitches sin `hasTieIn`/`isTie` en el primero |
| 13 | `missingTieOff` | warning | true | bloque ≥4 stitches sin `hasTieOff`/`isTie` en el último |
| 14 | `unsupportedLongStitches` | warning | true | d>8mm entre stitches consecutivos |
| 15 | `colorCountTooHigh` | warning | true | totalColors > 6 |

**Nota:** el flag `reparable` está puesto a `true` en los 15, pero eso **no implica
que exista un fixer conectado al pipeline** — solo declara intención. Es la causa #1
de "detecta pero no repara".

---

## 2. Función reparadora por error y conexión al pipeline V5.1

Pipeline V5.1 real (array `phases` en `repairFinalLookCommandsForExport.js`):
```
removeEmptyBlocks → repairVisibleDiagonalStitches → removeDuplicateStitches
  → reduceColorChangesIfSafe → removeEmptyBlocksFinal → addTieInTieOff
```

| error detectado | función reparadora | ¿existe? | ¿en pipeline V5.1? | funciona | riesgo | notas |
|---|---|---|---|---|---|---|
| `emptyBlocks` | `removeEmptyBlocks` | sí | sí (fase 1 + 5) | **funciona** | bajo | multi-pasada robusta, 8 casos cubiertos |
| `visibleDiagonalStitches` | `repairVisibleDiagonalStitches` | sí | sí (fase 2) | **funciona** | medio | usa el detector único compartido — no desincroniza |
| `invalidCommandSequence` | (sin fixer dedicado) | — | **no** | — | — | `removeEmptyBlocks` los dropea indirectamente al limpiar bloques vacíos, pero no hay fase explícita |
| `regionOutsideBounds` | (sin fixer dedicado) | — | **no** | — | — | el detector cuenta fuera-de-bastidor pero nadie proyecta al interior |
| `duplicateStitches` | `removeDuplicateStitches` | sí | sí (fase 3) | **funciona** | bajo | preserva double-run |
| `shortStitches` | `mergeShortStitches` | sí | **no** | no verificado | medio | existe en `preExportRepairer.js` pero NO está en el array `phases` V5.1 — solo lo usa `exportPolish` (post-V5) |
| `unsupportedLongStitches` | `splitUnsafeLongStitches` | sí | **no** | no verificado | **alto** | existe pero NO está en V5.1. Si se activa sin soporte de máscara puede crear diagonales visibles |
| `missingTieIn` / `missingTieOff` | `addTieInTieOff` | sí | sí (fase 6, final) | **falla/parcial** | **alto** | el gate transaccional lo revierte porque crea longSt (37→39) y visibleDiag (0→1). Ver §4 y §7 |
| `excessiveJumps` | `optimizeTrimsAndJumps` (preExportRepairer) + `collapseConsecutiveJumps` (travelPolish) | sí | **parcial** | parcial | medio | `optimizeTrimsAndJumps` NO está en V5.1; `collapseConsecutiveJumps` sí en travelPolish (post-V5) |
| `excessiveTrims` | `removeRedundantTrims` (travelPolish) + `optimizeTrimsAndJumps` | sí | **parcial** | parcial | medio | `removeRedundantTrims` en travelPolish (post-V5); `optimizeTrimsAndJumps` desconectado |
| `colorCountTooHigh` | `reduceColorChangesIfSafe` | sí | sí (fase 4) | **funciona** | bajo | fusiona por Lab Δ<12, preserva oscuras |
| `tooDenseAreas` | (sin fixer dedicado) | — | **no** | — | — | detecta celdas >250 pero nadie reduce densidad |
| `tooSmallObjects` | `simplifyTinyObjects` | sí | **no** | no verificado | medio | existe pero NO está en el array `phases`; es auxiliar sin conexión |
| `stitchCountOverLimit` | (sin fixer dedicado) | — | **no** | — | — | el `proposedAction` menciona merge+simplify pero ninguno de los dos está conectado a este objetivo |
| `longJumpNoTrim` (count interno) | `optimizeTrimsAndJumps` inserta trim | sí | **no** | — | — | métrica interna del detector, no se expone como error pero sí la usa `optimizeTrimsAndJumps` (desconectado) |

---

## 3. UNREPAIRED_DETECTED_ERRORS

Errores que el detector marca como `reparable: true` pero **no tienen un fixer
real conectado al pipeline V5.1**.

### 3.1 `invalidCommandSequence`
- **count actual en checkpoint:** 0 (no aparece porque removeEmptyBlocks lo limpia indirectamente).
- **por qué no se repara de forma dedicada:** no hay fase que filtre `{!c || !c.type}`.
- **función candidata:** `sanitizeInvalidCommands(commands)` — dropear nulos y cmd sin `type`.
- **riesgo de reparar automáticamente:** bajo (solo elimina basura estructural).

### 3.2 `regionOutsideBounds`
- **count actual:** 0 en checkpoint.
- **por qué no se repara:** nadie proyecta coordenadas al interior del bastidor.
- **función candidata:** `clampToHoop(commands, hoopW, hoopH)` — clamp x,y a ±hoop/2.
- **riesgo:** medio — el clamp puede deformar la forma si hay muchos puntos fuera. Mejor prevenir en el generador que reparar aquí.

### 3.3 `shortStitches`
- **count actual:** >0 (warning, no bloquea).
- **por qué no se repara:** `mergeShortStitches` existe pero NO está en el array `phases` V5.1. Solo lo ejecuta `exportPolish` (post-V5) sobre bloques no críticos.
- **función candidata:** ya existe — `mergeShortStitches`.
- **riesgo:** medio — fusionar colineales puede borrar esquinas si el ángulo >30° no se respeta; el código actual ya protege `isImportantDetail`.

### 3.4 `unsupportedLongStitches`
- **count actual:** 39 después de V5.1 (warning; subió 37→39 por addTieInTieOff antes de revertir).
- **por qué no se repara:** `splitUnsafeLongStitches` existe pero NO está en V5.1. Si se activa, debe ir **después** de `repairVisibleDiagonalStitches` y respetar el mismo soporte de máscara, si no, dividirá diagonales visibles en micro-diagonales.
- **función candidata:** ya existe — `splitUnsafeLongStitches`.
- **riesgo:** **alto** — dividir una diagonal visible sin soporte crea más diagonales visibles. Debe depender del detector único.

### 3.5 `tooDenseAreas`
- **count actual:** no reportado en checkpoint (probablemente 0).
- **por qué no se repara:** no existe fixer. El `proposedAction` dice "fusionar micro-puntadas" pero no hay fase.
- **función candidata:** `redistributeDensity(commands, regions)` — repuntada con spacing controlado por región.
- **riesgo:** alto — repuntadar cambia el Final Look visual; debe ser opt-in.

### 3.6 `tooSmallObjects`
- **count actual:** no reportado en checkpoint.
- **por qué no se repara:** `simplifyTinyObjects` existe pero NO está conectado al pipeline.
- **función candidata:** ya existe — `simplifyTinyObjects`.
- **riesgo:** medio — puede borrar detalles si `isImportantDetail` no cubre el caso.

### 3.7 `stitchCountOverLimit`
- **count actual:** 0 en checkpoint (stitches < 12000).
- **por qué no se repara:** no hay fixer. El `proposedAction` menciona merge+simplify pero ambos están desconectados.
- **función candidata:** combinación de `mergeShortStitches` + `simplifyTinyObjects` + reducción de densidad.
- **riesgo:** alto — reducir puntadas siempre cambia el Final Look.

### 3.8 `excessiveJumps` / `excessiveTrims` (parcial)
- **count actual:** jumps=46, trims=28 — por debajo de los umbrales (250/80), así que el detector reporta 0. Aun así, travelPolish los reduce.
- **por qué no se repara del todo:** `optimizeTrimsAndJumps` (preExportRepairer) está desconectado; travelPolish (post-V5) cubre el colapso de jumps consecutivos y trims redundantes, pero no inserta trim antes de saltos largos.
- **función candidata:** ya existe — `optimizeTrimsAndJumps`.
- **riesgo:** medio — insertar trim antes de saltos largos es seguro; colapsar jumps puede crear jumps >12.1mm si no se divide.

---

## 4. DANGEROUS_REPAIRERS

### 4.1 `addTieInTieOff` ⚠️ — el más peligroso
- **qué intenta arreglar:** `missingTieIn` + `missingTieOff` (warnings).
- **qué errores nuevos puede crear:**
  - `unsupportedLongStitches`: los tie stitches se interpolan desde `prevNon`
    (que puede ser un jump/trim/colorChange lejano), generando un stitch a >8mm
    del siguiente. **Regresión observada: longSt 37→39.**
  - `visibleDiagonalStitches`: el `originX/originY` se toma de `out[out.length-1]`
    que puede ser un `jump` cuyo destino está en otra región. El tie-in dibuja una
    diagonal corta pero visible cruzando vacío. **Regresión observada: visibleDiag 0→1.**
  - `duplicateStitches`: los tie stitches a 0.4mm del primer stitch pueden
    contar como dup — aunque `isTie:true` los excluye del contador, el siguiente
    stitch real ya no es tie y sí se cuenta.
- **ejemplo de regresión (checkpoint):** addTieInTieOff aceptado → longSt 37→39,
  visibleDiag 0→1 → gate transaccional lo **revierte** → ties no aplicados.
  Resultado: missingTieIn/Off siguen >0 (warning) pero el bloqueo no se crea.
- **estado actual:** **revertido por gate transaccional = efectivamente desactivado**.
  Es seguro pero inútil.
- **recomendación:** mover a **modo experimental** y reemplazar por `safeAddTieInTieOffV2` (§7).

### 4.2 `splitUnsafeLongStitches` ⚠️
- **qué intenta arreglar:** `unsupportedLongStitches`.
- **qué errores nuevos puede crear:**
  - `visibleDiagonalStitches`: si el soporte `segmentDarkSupport` es falso positivo
    (máscara ruidosa), divide una diagonal visible en N diagonales visibles más cortas.
  - `shortStitches`: si `SPLIT_SEG_MM=7.5` y la puntada mide 8.1mm, el split genera
    2 segmentos de ~4mm (ok), pero redondeos pueden dejar uno <0.6mm.
- **estado actual:** **desconectado del pipeline V5.1**. No activo.
- **recomendación:** **desactivado** hasta que se integre con el detector único de
  diagonales. Si se activa, debe ir inmediatamente después de
  `repairVisibleDiagonalStitches` y reusar `offenderByIdx` para no dividir lo que
  el detector ya marcó.

### 4.3 `optimizeTrimsAndJumps` ⚠️
- **qué intenta arreglar:** `excessiveJumps`, `excessiveTrims`, `longJumpNoTrim`.
- **qué errores nuevos puede crear:**
  - `unsupportedLongStitches`: al colapsar N jumps en uno, si `total > MAX_JUMP_MM`
    divide, pero si el cálculo de `total` se hace desde `prevX/prevY` (que no se
    actualiza tras trim) puede subestimar y crear un jump >12.1mm.
  - `emptyBlocks`: insertar trim antes de un jump largo puede dejar un bloque
    con 0 stitches si el bloque era pequeño.
- **estado actual:** **desconectado del pipeline V5.1**. travelPolish cubre parte.
- **recomendación:** **parcialmente activo vía travelPolish** (post-V5). No reconectar
  la versión de preExportRepairer sin auditar el cálculo de `prevX/prevY` tras trim.

### 4.4 `mergeShortStitches` ⚠️ (riesgo medio)
- **qué intenta arreglar:** `shortStitches`.
- **qué errores nuevos puede crear:**
  - `regionOutsideBounds`: no (no mueve puntos).
  - `visibleDiagonalStitches`: no (fusiona colineales, no crea diagonales).
  - Puede borrar esquinas si `ang > 30°` no se respeta — el código lo protege, pero
    `isImportantDetail` no cubre todos los contornos (solo mouth/eye/detail/outline).
- **estado actual:** **inactivo en V5.1**; activo en `exportPolish` (post-V5) solo en bloques no críticos.
- **recomendación:** **mantener fuera del pipeline principal**; usar solo en polish.

### 4.5 `simplifyTinyObjects` ⚠️
- **qué intenta arreglar:** `tooSmallObjects`.
- **qué errores nuevos puede crear:**
  - `emptyBlocks`: dropear una región tiny deja saltos que pueden convertirse en bloque vacío.
  - Borra detalles si `isImportantDetail` no los protege.
- **estado actual:** **desconectado**.
- **recomendación:** **desactivado** salvo modo explícito de reducción de puntadas.

---

## 5. Arquitectura propuesta: EIE en 4 capas

Hoy la responsabilidad está mezclada en `repairFinalLookCommandsForExport` que
ejecuta `detectExportErrors` antes de cada fase (dentro de `measureMetrics`),
aplica el fixer, y vuelve a medir. La auditoría propone separar en 4 capas
**sin romper el flujo V5.1**:

### Capa A — `detectExportIssues(commands)`
- **Entrada:** comandos.
- **Salida:** lista de issues `{ type, count, severity, offenderIndex[], proposedAction }`.
- **Regla:** pura lectura. No modifica comandos. Reutiliza `detectExportErrors`.
- **Estado:** ya existe como `detectExportErrors`. No cambia.

### Capa B — `planRepairs(issues, commands)`
- **Entrada:** issues de la capa A + comandos.
- **Salida:** plan `{ phases: [{ name, target, safe: boolean, experimental: boolean }] }`.
- **Regla:** decide qué errores son seguros de reparar según el estado actual.
  No toca comandos. Filtra fixers peligrosos (addTieInTieOff → experimental).
  Decide el orden respetando dependencias (diagonales antes que longSt).
- **Estado:** hoy esta lógica está hardcodeada en el array `phases` del orquestador.
  Moverla a un planificador permite activar/desactivar fases sin tocar el orquestador.

### Capa C — `applyRepairPlan(commands, plan)`
- **Entrada:** comandos + plan.
- **Salida:** comandos reparados + log por fase.
- **Regla:** aplica las fases del plan una a una. Cada fase recibe los comandos
  de la anterior. No decide orden ni seguridad — solo ejecuta.
- **Estado:** ya existe como el bucle `for (const p of phases)` del orquestador.

### Capa D — `verifyRepair(before, after)`
- **Entrada:** métricas antes/después de cada fase.
- **Salida:** `{ accept: boolean, reasons: [] }`.
- **Regla:** aplica los invariantes duros (§6). Si una fase rompe un invariante,
  se revierte. Esta capa ya existe como `phaseGateAccepts` + `v5InvariantsHold`.
- **Estado:** ya existe. No cambia.

**Beneficio de la separación:** hoy, añadir un fixer requiere editar el array
`phases` y el gate. Con la capa B, el plan se construye desde los issues
detectados, y los fixers peligrosos se marcan `experimental: true` y solo se
aplican si el plan lo permite (ej. `safeAddTieInTieOffV2` cuando el bloque es
intrarregión y <0.4mm).

---

## 6. Reglas obligatorias (invariantes duros)

Ningún fixer puede aceptarse si el resultado viola **cualquiera** de:

| invariante | valor obligatorio |
|---|---|
| `visibleDiagonalStitches` | === 0 |
| `emptyBlocks` | === 0 |
| `invalidCommandSequence` | === 0 |
| `regionOutsideBounds` | === 0 |
| `ce01Status` | !== 'INVALID' |
| `exportAllowed` | === true |

Estos ya están implementados en `phaseGateAccepts` (fails duros) y
`v5InvariantsHold` (travelPolish). La auditoría confirma que **están vigentes**
y son la razón por la que addTieInTieOff se revierte.

**Recomendación:** extraerlos a un helper único `assertInvariantHardGates(before, after)`
usado por las 4 capas (hoy están duplicados en `phaseGateAccepts` y `v5InvariantsHold`).

---

## 7. Caso especial: `addTieInTieOff`

### 7.1 Diagnóstico actual

El fixer se revierte sistemáticamente porque:

1. **Origen del tie-in inseguro:** toma `prevNon = out[out.length-1]`, que puede
   ser un `jump` cuyo destino está en otra región. El tie-in interpola desde ahí
   hasta `first.x/first.y` → crea un stitch a >8mm (longSt) y/o una diagonal
   visible cruzando vacío (visibleDiag).
2. **No respeta región:** no comprueba que `prevNon` y `first` estén en la misma
   región (`regionId`).
3. **No respeta distancia:** no limita la longitud del tie a 0.4mm; interpola
   `t*0.3` que puede ser cualquier distancia si el origen es lejano.
4. **Tie-off extrapolado:** `last.x + (last - prevLast)*t*0.3` puede salir del
   bloque y cruzar vacío.

### 7.2 Propuesta: `safeAddTieInTieOffV2`

Reglas estrictas (no aplica si cualquiera falla → `blockSkipped` con reason):

| regla | check |
|---|---|
| no añadir tie-in si el origen viene de otro bloque lejano | `\|origin - first\| > 0.4mm` → no tie-in, solo `hasTieIn=false` |
| no usar previous non-stitch como origen si genera diagonal | si `prevNon.type !== 'stitch'` → usar `first` como origen (tie-in原地) |
| ties solo dentro del mismo bloque y muy cerca del primer/último stitch | `\|tie - first\| <= 0.4mm` |
| máximo distancia tie ≤ 0.4mm | `TIE_LEN_MM = 0.4` hardcodeado |
| no cruzar regiones | `tie.regionId === first.regionId === last.regionId` |
| no cruzar vacío | `segmentDarkSupport(tie, first) >= 0` o `regionAt(tie) === regionAt(first)` |
| no crear visibleDiag | tras insertar, re-ejecutar `detectVisibleDiagonalStitches` localmente |
| no crear unsupportedLongStitches | `|tie - nextStitch| <= MAX_STITCH_MM` |
| si no es seguro | `blockSkipped: true, reason: 'originTooFar' \| 'crossesRegion' \| 'crossesEmpty'` |

**Implementación segura (borrador, NO aplicar):**
```js
// tie-in原地: 2 stitches a 0.3mm y 0.4mm de first, dirección hacia el interior del bloque
const dir = unit(block[1] - first); // hacia el segundo stitch del bloque
tieIn1 = first + dir * 0.3;  // 0.3mm
tieIn2 = first + dir * 0.4;  // 0.4mm
// tie-off原地: 2 stitches a 0.3mm y 0.4mm de last, dirección hacia atrás
const dirBack = unit(block[n-2] - last);
tieOff1 = last + dirBack * 0.3;
tieOff2 = last + dirBack * 0.4;
```

Esto **nunca** crea longSt (todos los ties están a <0.4mm de un stitch real del
mismo bloque) ni visibleDiag (no cruzan vacío ni región).

**Estado:**提案 — no implementar hasta que el usuario lo pida explícitamente.

---

## 8. EIE_ROOT_PROBLEMS

### 8.1 Errores detectados sin fixer real
- `invalidCommandSequence` — sin fixer dedicado (removeEmptyBlocks lo limpia indirectamente).
- `regionOutsideBounds` — sin fixer.
- `shortStitches` — fixer existe (`mergeShortStitches`) pero no conectado a V5.1.
- `unsupportedLongStitches` — fixer existe (`splitUnsafeLongStitches`) pero no conectado; peligroso.
- `tooDenseAreas` — sin fixer.
- `tooSmallObjects` — fixer existe (`simplifyTinyObjects`) pero no conectado.
- `stitchCountOverLimit` — sin fixer (depende de merge+simplify, ambos desconectados).
- `excessiveJumps` / `excessiveTrims` — cubrimiento parcial vía travelPolish (post-V5).

### 8.2 Fixers peligrosos
- `addTieInTieOff` — **revertido por gate** = efectivamente desactivado. Reemplazar por V2.
- `splitUnsafeLongStitches` — desconectado; crearía diagonales si se activa sin reusar el detector.
- `optimizeTrimsAndJumps` — desconectado; riesgo de jumps >12.1mm si prevX/prevY no se actualiza tras trim.

### 8.3 Fixers no conectados al pipeline V5.1
- `splitUnsafeLongStitches` (existe, no invocado).
- `mergeShortStitches` (existe, solo en exportPolish post-V5).
- `optimizeTrimsAndJumps` (existe, no invocado en V5.1).
- `simplifyTinyObjects` (existe, no invocado).
- `sanitizeInvalidCommands` (no existe — candidato nuevo).
- `clampToHoop` (no existe — candidato nuevo).

### 8.4 Fixers que no mejoran su target
- `addTieInTieOff` — target `missingTie` no mejora porque el gate lo revierte.
  El fixer es correcto en intención pero defectuoso en implementación (origen lejano).

### 8.5 Recomendaciones de orden de trabajo

1. **No tocar el flujo V5.1 estable.** Cualquier cambio se hace en rama/feature flag.
2. **Primero: `safeAddTieInTieOffV2`** (§7) — el fixer más útil y el que más daña
   hoy. Reemplazar el actual cuando V2 pase el gate sin crear longSt/visibleDiag.
3. **Segundo: conectar `mergeShortStitches`** como fase opcional (post-diagonales,
   pre-dups) con `experimental: true` y medir si reduce shortSt sin romper invariantes.
4. **Tercero: `sanitizeInvalidCommands`** — fixer trivial y seguro para
   `invalidCommandSequence`.
5. **Cuarto: revisar `splitUnsafeLongStitches`** — solo si reusa `offenderByIdx`
   del detector de diagonales para no dividir lo ya marcado.
6. **Quinto: separar el EIE en 4 capas** (§5) — refactor arquitectónico que
   permite activar/desactivar fixers sin tocar el orquestador.
7. **No abordar todavía:** `tooDenseAreas`, `stitchCountOverLimit`,
   `regionOutsideBounds` — requieren cambios en el generador, no en el EIE.

---

## 9. Estado del flujo V5.1 (no romper)

Confirmado en `CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING.md`:

| Métrica | Valor |
|---|---|
| repairAccepted | SÍ |
| exportAllowed | SÍ |
| commandSourceUsedForExport | repaired |
| visibleDiagonalStitches | 0 |
| emptyBlocks | 0 |
| invalidCommandSequence | 0 |
| regionOutsideBounds | 0 |
| CE01 status | RISKY (no INVALID) |
| CE01 score | 56 |
| jumpCount | 46 |
| trimCount | 28 |
| colorCount | 3 |

Esta auditoría **no aplica ningún cambio**. El flujo V5.1 queda intacto.

---

_EIE_REPAIR_AUDIT_REPORT — solo lectura. Próximo paso: decidir cuál de las
recomendaciones de §8.5 se aborda primero._