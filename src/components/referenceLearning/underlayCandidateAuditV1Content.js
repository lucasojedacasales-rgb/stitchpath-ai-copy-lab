export const UNDERLAY_CANDIDATE_AUDIT_V1_MD = `# UNDERLAY_CANDIDATE_AUDIT_V1 — StitchPath AI

> Fecha: 2026-07-05
> Punto de partida: CHECKPOINT_REFERENCE_LEARNING_TRIM_GUARD_SATIN_CONTOUR_STABLE
> Modo: auditoría únicamente
> No se modificó código. No se generaron comandos underlay.

---

## 0. Resumen ejecutivo

El preset aprendido activa learnedUnderlayEnabled=true, pero el pipeline profesional sigue midiendo underlayCount=0 porque actualmente esa clave queda escrita en el config, pero no existe una fase generadora de underlay real dentro de applyProfessionalPipeline.

La implementación más segura para CE01 sería un futuro UNDERLAY_GENERATOR_V1 transaccional, post-generador, dentro de applyProfessionalPipeline, sin tocar buildFinalCommands, flattenToCommands, contourExportBuilder, encoders ni V5.1.

Recomendación final: IMPLEMENT_SAFE_V1.

---

## 1. Dónde está el hueco

### 1.1 Dónde se guarda learnedUnderlayEnabled

learnedUnderlayEnabled forma parte del preset aprendido y llega al config como una key learned*.

La ruta funcional esperada es:

1. Reference Learning selecciona perfil aprendido.
2. El preset profesional incluye underlayEnabled=true.
3. El mapper de preset lo convierte en learnedUnderlayEnabled=true.
4. validateLearnedPresetEffectiveness lo conserva dentro del patch aplicado al proyecto/editor.
5. applyProfessionalPipeline recibe config.learnedUnderlayEnabled.

### 1.2 Si llega a applyProfessionalPipeline

Sí: el config puede contener learnedUnderlayEnabled=true durante la ejecución profesional.

Pero dentro de applyProfessionalPipeline, las keys aprendidas que se proyectan a professionalParams incluyen densidad, ángulo, compensación, color count, travel, trim, contour order y satin outer contours. No hay mapeo equivalente para learnedUnderlayEnabled.

Resultado: la señal llega, pero no se consume.

### 1.3 Si existe underlayMinAreaMm2

Sí. Existe un parámetro profesional:

| Parámetro | Valor |
|---|---:|
| underlayMinAreaMm2 | 80 |

Pero actualmente funciona solo como parámetro latente. No hay una fase activa que lo use para seleccionar regiones ni generar comandos.

### 1.4 Si hay alguna función que genere underlay real

No se encontró una fase real conectada al pipeline profesional que genere comandos con:

- layerType='underlay', o
- source='underlay', o
- metadatos equivalentes consumidos por professionalEmbroideryQualityGate.

Hay referencias UI/inteligencia a underlay, pero no una fase post-generador segura que inserte puntadas underlay reales en la secuencia final.

### 1.5 Por qué underlayCount sigue 0

professionalEmbroideryQualityGate calcula underlayCount contando comandos cuyo layerType o source contiene underlay.

En la validación runtime estable:

| Métrica | Antes SATIN | Después SATIN |
|---|---:|---:|
| underlayCount | 0 | 0 |

Causa directa:

- learnedUnderlayEnabled=true no genera comandos.
- underlayMinAreaMm2 no se consume.
- No existen comandos etiquetados como underlay.
- Los rellenos actuales vienen principalmente como source=ce01_safe_fill, stitchType=fill.

---

## 2. Candidatos reales para underlay

Proyecto medido: Nuevo diseño (6a48d4f03ec7e0d075352fc9)

Regiones: 16
Comandos base medidos: 6277
Puntadas base medidas: 5873

Criterio de lectura:

- fillSafe=true: región candidata potencial para underlay ligero.
- excludedAsDetailOrContour=true: excluir; normalmente contorno, detalle, boca, ojos, facial, satin o running.
- Área estimada en mm² desde geometría de región.
- Bounding box expresado como x1,y1-x2,y2 en escala 0–100.

| regionId | color | stitchCount | fillBlockCount | área estimada | bbox | tipo relleno | source | layerType | stitchType | fill seguro | excluir detalle/contorno |
|---|---|---:|---:|---:|---|---|---|---|---|---|---|
| r_ldurc35 | #ff9b9c | 2151 | 2151 | 4394.9 | 2.9,4.1-96.4,77.2 | fill | ce01_safe_fill | — | fill | true | false |
| r_5tstdpx | #ff3b9b | 308 | 308 | 537.1 | 3.3,41.5-95.9,83.5 | fill | ce01_safe_fill | — | fill | true | false |
| r_rpoa6l5 | #fc0030 | 293 | 293 | 577.2 | 7.8,68.2-44.2,96.3 | fill | ce01_safe_fill | — | fill | true | false |
| r_bnjo4ml | #fc0030 | 284 | 284 | 566.0 | 54.4,68.6-90.9,96.3 | fill | ce01_safe_fill | — | fill | true | false |
| safe_contour_r_ncgenm5 | #020101 | 119 | 0 | 6874.3 | 1.2,2.1-98.0,98.0 | running_stitch | standard | outer_outline | running_stitch | false | true |
| r_uyy080j | #020101 | 95 | 95 | 159.6 | 54.2,18.3-62.5,41.9 | fill | ce01_safe_fill | — | fill | true | false |
| r_nlsl5kg | #020101 | 92 | 92 | 158.8 | 36.9,18.3-45.2,41.8 | fill | ce01_safe_fill | — | fill | true | false |
| r_2fq07bv | #ff3b9b | 45 | 45 | 80.6 | 22.2,36.7-34.7,45.1 | fill | ce01_safe_fill | — | fill | true | false |
| r_3nk22uq | #ff3b9b | 44 | 44 | 80.3 | 64.7,36.7-77.0,45.1 | fill | ce01_safe_fill | — | fill | true | false |
| r_xht88oa | #ff9b9c | 20 | 20 | 34.9 | 56.0,19.5-60.7,28.7 | fill | ce01_safe_fill | — | fill | true | false |
| r_ob9r4gj | #ff9b9c | 19 | 19 | 34.7 | 38.6,19.5-43.3,28.7 | fill | ce01_safe_fill | — | fill | true | false |
| r_79trg5s | #1671e8 | 16 | 16 | 24.4 | 38.1,33.6-43.7,40.3 | fill | ce01_safe_fill | — | fill | true | false |
| r_ywytdfy | #1671e8 | 15 | 15 | 24.4 | 55.7,33.5-61.1,40.3 | fill | ce01_safe_fill | — | fill | true | false |
| r_1demmsx | #ff3b9b | 8 | 8 | 13.2 | 9.3,81.0-12.8,86.0 | fill | ce01_safe_fill | — | fill | true | false |
| r_6jx7mtc | #ff3b9b | 7 | 7 | 13.4 | 85.9,81.0-89.6,86.0 | fill | ce01_safe_fill | — | fill | true | false |
| r_7bzl7od | #020101 | 0 | 0 | 7.0 | 45.1,44.7-54.3,47.3 | fill | — | — | fill | true | false |

### 2.1 Candidatos iniciales recomendados

Para una primera implementación segura, solo conviene aceptar regiones con:

- fillSafe=true.
- excludedAsDetailOrContour=false.
- areaEstimatedMm2 >= 120.
- stitchCount >= 80.
- geometría de bbox no degenerada.

Candidatos fuertes:

| regionId | Motivo |
|---|---|
| r_ldurc35 | Región grande principal, fill CE01, área 4394.9mm². |
| r_5tstdpx | Fill grande, área 537.1mm². |
| r_rpoa6l5 | Fill grande, área 577.2mm². |
| r_bnjo4ml | Fill grande, área 566.0mm². |
| r_uyy080j | Fill mediano, área 159.6mm²; usar con cautela por color negro. |
| r_nlsl5kg | Fill mediano, área 158.8mm²; usar con cautela por color negro. |

Excluir de V1:

| regionId | Motivo |
|---|---|
| safe_contour_r_ncgenm5 | Contorno exterior running; no es fill seguro. |
| Regiones <80mm² | Demasiado pequeñas; riesgo de densidad, micro-puntadas y distorsión. |
| Regiones con 0 stitches | Sin bloque fill real medido. |

---

## 3. Estrategia recomendada para UNDERLAY_GENERATOR_V1

| Opción | Descripción | Riesgo CE01 | Recomendación |
|---|---|---|---|
| A | Centerline underlay dentro de regiones grandes | Bajo si se limita por bbox y longitud | Recomendado para V1 |
| B | Edge underlay muy ligero | Medio; puede acercarse a contornos y crear diagonales visibles | Posponer |
| C | Zigzag bajo relleno | Medio/alto; aumenta stitchCount y puede crear diagonales largas | No para V1 |
| D | No generar underlay si no hay geometría fiable | Bajo | Usar como fallback obligatorio |

UNDERLAY_GENERATOR_V1 debería implementar A + D:

- Generar centerline underlay solo en regiones grandes, fill-safe y con bbox fiable.
- Si la geometría no permite una línea interna corta y segura, no generar underlay.
- No generar underlay en contornos, detalles, boca, ojos, faciales, running stitch ni satin.
- No generar edge underlay ni zigzag en V1.

Para CE01, centerline es la opción más segura porque añade pocas puntadas, evita trims excesivos y puede mantenerse dentro del mismo bloque de relleno.

---

## 4. Ubicación recomendada en el pipeline

Orden estable actual resumido:

1. Color reducer.
2. reorderProfessionalLayers.
3. visible diagonal repair.
4. travel sanitize.
5. optional outer satin → running.
6. REFERENCE_TRIM_GUARD_V1.
7. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2.
8. SATIN_OUTER_CONTOUR_CONVERTER_V1.
9. quality gate final.

UNDERLAY_GENERATOR_V1 debería ejecutarse después de reorderProfessionalLayers, antes de visible diagonal repair/travel sanitize y antes de Trim Guard.

Motivo:

- Debe ocurrir después de ordenar capas para saber dónde insertar bajo rellenos.
- Debe insertar underlay antes de los rellenos principales dentro del bloque de región.
- Debe ocurrir antes de repairVisibleDiagonalStitches, para que cualquier diagonal accidental pueda ser detectada y reparada por el sistema existente.
- Debe ocurrir antes de Trim Guard, para que cualquier jump introducido por underlay quede cubierto por REFERENCE_TRIM_GUARD_V1.
- Debe ocurrir antes de SATIN, porque SATIN ya está validado como fase posterior a Splitter.

No se recomienda ejecutarlo después de Trim Guard, porque cualquier salto o trim nuevo quedaría fuera del guard estabilizado.

---

## 5. Límites de seguridad propuestos

| Límite | Valor recomendado | Motivo |
|---|---:|---|
| maxUnderlayRegions | 4 | Evita crecimiento excesivo y prioriza regiones grandes. |
| maxAddedUnderlayStitches | 160 | Presupuesto pequeño y auditable. |
| minAreaMm2 | 120 | Evita zonas pequeñas y detalles. |
| minRegionStitchCount | 80 | Asegura que ya existe relleno real suficiente. |
| distancia entre puntadas underlay | 3.0–4.0mm | Mantiene underlay ligero. |
| longitud máxima de segmento underlay | 4.0mm | Evita diagonales visibles. |
| pasadas por región | 1 | V1 simple; sin zigzag complejo. |
| máximo por región | 40 stitches | Evita que una región domine el presupuesto. |

Para evitar diagonales visibles:

- Solo crear segmentos internos con longitud <= 4.0mm.
- No conectar regiones entre sí con stitches.
- Rechazar candidatos cuya línea centerline salga del bbox interno seguro.
- Ejecutar el detector unificado de diagonales después de insertar underlay.
- Revertir si visibleDiagonalStitches sube.

Para evitar saltos/trims excesivos:

- Insertar underlay dentro del mismo bloque fill de la región.
- No crear cambios de color nuevos.
- No crear color blocks nuevos vacíos.
- No insertar underlay para regiones dispersas si exige jump largo.
- Presupuesto global para jumpCount y trimCount.

---

## 6. Guard transaccional recomendado

UNDERLAY_GENERATOR_V1 debe ser completamente reversible.

Medir antes y después:

- visibleDiagonalStitches.
- emptyBlocks.
- unsupportedLongStitches.
- CE01 status.
- finalLookExportMismatch.
- professionalScore.
- stitchCount.
- jumpCount.
- trimCount.
- underlayCount.

Criterios de revertido:

| Criterio | Revertir si |
|---|---|
| visibleDiagonalStitches | sube |
| emptyBlocks | sube |
| unsupportedLongStitches | sube |
| CE01 | pasa a INVALID |
| finalLookExportMismatch | pasa a true |
| professionalScore | baja más de 3 |
| stitchCount | sube más que maxAddedUnderlayStitches |
| jumpCount | sube más de 6 |
| trimCount | sube más de 6 |
| underlay geometry | coordenadas no numéricas o fuera de bbox seguro |
| color blocks | aparece bloque vacío nuevo |

Aceptar solo si:

- underlayCount aumenta.
- No hay regresión en métricas críticas.
- El crecimiento de stitchCount queda dentro del presupuesto.
- CE01 se mantiene SAFE o RISKY, nunca INVALID.
- finalLookExportMismatch=false.

---

## 7. Reporte esperado para futura implementación

La futura implementación debe generar UNDERLAY_GENERATOR_REPORT_V1.md.

Contenido mínimo esperado:

| Campo | Descripción |
|---|---|
| phaseAccepted | true/false según guard transaccional. |
| underlayCountBefore | Underlay medido antes. |
| underlayCountAfter | Underlay medido después o before si se revierte. |
| candidatesFound | Regiones candidatas detectadas. |
| candidatesAccepted | Regiones donde se insertó underlay. |
| candidatesSkippedTooSmall | Regiones descartadas por área/stitchCount. |
| candidatesSkippedDetail | Detalles, contornos, boca, ojos, facial, satin/running. |
| candidatesSkippedUnsafeGeometry | Bbox/centerline inválido o salida de región. |
| addedUnderlayStitches | Puntadas underlay retornadas. |
| stitchCount before/after | Conteo global. |
| jumpCount before/after | Conteo global. |
| trimCount before/after | Conteo global. |
| visibleDiagonalStitches before/after | Detector unificado. |
| CE01 status before/after | Estado CE01. |
| professionalScore before/after | Quality gate profesional. |
| finalLookExportMismatch before/after | Integridad visual/export. |
| revertReason | Motivo si se revierte. |
| commandsReturnedSource | underlayAccepted o beforeUnderlay. |

Ejemplo esperado:

- phaseAccepted: true
- underlayCount: 0 → 4
- candidatesFound: 6
- candidatesAccepted: 4
- candidatesSkippedTooSmall: 9
- candidatesSkippedDetail: 1
- candidatesSkippedUnsafeGeometry: 0
- addedUnderlayStitches: 128
- stitchCount: 5799 → 5927
- jumpCount: 375 → 377
- trimCount: 205 → 206
- visibleDiagonalStitches: 0 → 0
- CE01 status: RISKY → RISKY
- professionalScore: 90 → 90
- finalLookExportMismatch: false → false

---

## 8. Decisión final

UNDERLAY_IMPLEMENTATION_RECOMMENDATION: IMPLEMENT_SAFE_V1

Condiciones para implementarlo en una fase futura:

1. Implementar solo en applyProfessionalPipeline como fase post-generador transaccional.
2. No tocar motor base.
3. No tocar exportación.
4. No tocar V5.1.
5. No tocar SATIN, Trim Guard ni Splitter.
6. Empezar con centerline underlay solo para regiones grandes y fill-safe.
7. Usar fallback D: no generar underlay si la geometría no es fiable.
8. Generar siempre UNDERLAY_GENERATOR_REPORT_V1.md con métricas before/after reales.
9. Revertir automáticamente si cualquier métrica crítica empeora.

---

## 9. Estado final de esta auditoría

No se implementó underlay.
No se generaron comandos nuevos.
No se modificó código.
No se tocó exportación, V5.1, SATIN, Trim Guard, Splitter, encoders ni CE01 validator.

Este informe solo define una ruta segura para una futura implementación.
`;