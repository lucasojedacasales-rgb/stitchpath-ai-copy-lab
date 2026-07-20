# CE01_VALIDATOR_STITCH_LIMIT_RECALIBRATION_REPORT_V1

Fecha: 2026-07-05
Fase aplicada: CE01_VALIDATOR_STITCH_LIMIT_RECALIBRATION_V1

Restricciones respetadas:

- No se redujeron puntadas.
- No se aplicó MIXED_STITCH_BUDGET_REDUCTION_V1.
- No se tocó el motor de generación de puntadas.
- No se tocaron encoders DST/DSB.
- No se cambió ExportModal.
- No se modificó SATIN / Trim Guard / Splitter / Underlay.
- No se modificó Simular ni Final Look.

---

## 1. Motivo de la recalibración

La hipótesis anterior `CE01_MAX_STITCHES=12000` era demasiado conservadora y no estaba demostrada como límite real de máquina.

Evidencia real aportada por usuario:

- Archivo funcional creado con Wilcom.
- La máquina CE01 lo acepta.
- La pantalla de la máquina muestra aproximadamente 33845 puntadas.
- Por tanto, un diseño con más de 30000 puntadas puede ser válido en esta máquina.
- El diseño actual de la app tiene 14203 puntadas, por lo que no debe ser `INVALID` solo por superar 12000.

Comentario añadido en código:

> El límite anterior de 12000 era demasiado conservador. Se recalibra porque una muestra Wilcom funcional aceptada por CE01 contiene ~33845 puntadas.

---

## 2. Cambios aplicados

### CE01 validator principal

Antes:

```txt
CE01_MAX_STITCHES=12000
stitches > 12000 => blockingIssue CHECK_1 => CE01 INVALID
```

Después:

```txt
totalStitches <= 35000 => OK / no bloqueo por conteo
totalStitches > 35000 => warning/risky, no INVALID automático
totalStitches > 50000 => high risk, no INVALID automático sin evidencia real de rechazo/memoria
```

### Detector de errores pre-export

Antes:

```txt
stitchCountOverLimit > 12000 => blocking
```

Después:

```txt
stitchCountWarning > 35000 => warning
stitchCountHighRisk > 50000 => warning
no blocking por stitch count
```

### Validador de máquina

Antes:

```txt
maxStitches=12000
```

Después:

```txt
maxStitches=35000
highRiskStitches=50000
```

### Métricas internas V5/reportes

Se recalibraron las métricas internas que calculaban `stitchCountOverLimit` contra 12000 para que usen 35000. No se cambió la lógica de reparación V5.1 ni se aplicaron nuevas reparaciones.

### Auto-cleanup antiguo

El antiguo cap automático de 12000 se recalibró a 35000 para evitar reducción de densidad causada por una hipótesis falsa. Para el diseño actual de 14203 puntadas, no debe activar reducción.

---

## 3. Validación del diseño actual

Datos del diseño actual según auditoría previa:

```txt
totalStitches=14203
oldMaxStitches=12000
oldOverBy=2203
severeVisibleLongStitchCount=0
maxVisibleStitchMm≈7.469
stitchedTravel remanente no explica INVALID
```

Resultado esperado tras la recalibración:

```txt
14203 <= 35000
stitchCountNoLongerBlocks=true
CHECK_1_STITCH_COUNT_LIMIT eliminado como causa INVALID
```

Estado CE01 esperado:

```txt
ce01StatusBefore=INVALID
ce01StatusAfter=RISKY
```

Motivo: el conteo de puntadas deja de ser bloqueo. El diseño puede seguir mostrando warnings por trims, jumps, densidad o eficiencia, pero no debe quedar `INVALID` solo por 14203 puntadas.

---

## 4. Causas que sí siguen siendo INVALID

El validador CE01 puede seguir bloqueando como `INVALID` por causas reales:

- comandos vacíos
- comandos inválidos o sin `type`
- coordenadas NaN / undefined
- coordenadas fuera del bastidor real
- diseño fuera de área de bordado
- secuencia de comandos inválida
- bloques vacíos graves
- colorChange inválido
- formatos DST/DSB corruptos
- saltos/puntadas imposibles para el formato

No se añadió ninguna reparación para estas causas en esta fase.

---

## 5. Estado de MIXED_STITCH_BUDGET_REDUCTION_V1

La implementación de reducción fue detenida:

```txt
mixedStitchBudgetReductionConnected=false
stitchBudgetReducerFileRemoved=true
finalEmbroideryCommandsUsesBudgetReduction=false
simulatorUsesReducedCommands=false
finalLookUsesReducedCommands=false
exportUsesReducedCommands=false
```

No se convierte 14203 en 11800. No se empobrece el bordado.

---

## 6. Resultado de búsqueda de reglas activas

Reglas activas de bloqueo por `CE01_MAX_STITCHES` o `stitchCountOverLimit`:

```txt
blockingStitchCountRules=[]
```

Archivos históricos pueden seguir mencionando 12000 en informes antiguos, pero ya no gobiernan la validación activa.

---

## 7. Campos finales obligatorios

```txt
oldMaxStitches=12000
oldRuleWasBlocking=true
referenceAcceptedWilcomStitches≈33845
newSafeNonBlockingThreshold=35000
newRiskThreshold=50000
totalStitchesCurrentDesign=14203
stitchCountNoLongerBlocks=true
ce01StatusBefore=INVALID
ce01StatusAfter=RISKY
remainingInvalidReasons=[]
remainingWarnings=["possible high jumps/trims/density warnings only if detected by runtime validator"]
exportLogicUnchanged=true
encodersUnchanged=true
motorFilesUnchanged=true
mixedStitchBudgetReductionStopped=true
puntadasReducidas=0
``