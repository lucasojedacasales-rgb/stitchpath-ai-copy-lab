# UNIVERSAL_EMBROIDERY_VALIDATION_ARCHITECTURE_REPORT_V1

Fecha: 2026-07-05
Fase: UNIVERSAL_EMBROIDERY_VALIDATION_ARCHITECTURE_V1

## Resumen

Se separó la validación principal en tres capas:

1. `UNIVERSAL_EMBROIDERY_VALIDATOR`
2. `FORMAT_VALIDATOR`
3. `MACHINE_PROFILE_VALIDATOR`

El modo por defecto pasa a ser `validationMode="universal"`.

La validación CE01 estricta queda disponible solo como modo explícito `ce01_strict`, no como autoridad principal por defecto.

## Regla de puntadas recalibrada

> El límite anterior de 12000 era demasiado conservador. Una muestra Wilcom aceptada por la máquina contiene aproximadamente 33845 puntadas, por lo que el conteo total de puntadas no debe bloquear automáticamente la exportación.

Nueva política:

- `totalStitches <= 35000`: OK / warning leve como máximo.
- `35000 < totalStitches <= 50000`: WARNING/RISKY según formato y máquina.
- `totalStitches > 50000`: RISKY alto, no INVALID automático sin corrupción, overflow, formato imposible o rechazo real confirmado.

## Campos obligatorios

```txt
oldCe01StitchLimitRemoved=true
universalValidatorCreated=true
formatValidatorCreated=true
machineProfileValidatorCreated=true
defaultValidationMode="universal"
ce01StrictModeDefault=false
stitchCountNoLongerBlocksAt12000=true
currentDesignTotalStitches=14203
currentDesignUniversalStatus=WARNING
currentDesignFormatStatus=VALID
currentDesignMachineProfileStatus=WARNING
exportAllowed=true
remainingInvalidReasons=[]
warnings=["END puede ser añadido por encoder antes de escribir archivo", "14203 puntadas no bloquea", "posibles trims/jumps/densidad solo como warnings si los detecta el runtime"]
motorFilesUnchanged=true
encodersUnchanged=true
exportLogicPreserved=true
mixedStitchBudgetReductionApplied=false
puntadasReducidas=0
```

## Validadores creados

### UNIVERSAL_EMBROIDERY_VALIDATOR

Bloquea solo por corrupción o imposibilidad estructural:

- commands vacío
- coordenadas NaN/undefined
- stitch/jump sin x/y
- secuencia inválida grave
- END duplicado
- comandos después de END
- distancias imposibles universales
- diseño fuera del área declarada

No bloquea por:

- más de 12000 puntadas
- stitched travel pequeño
- densidad alta
- saltos largos codificados correctamente como jump/trim
- conteo alto si el formato lo soporta

### FORMAT_VALIDATOR

Perfiles creados:

- DST_PROFILE
- DSB_PROFILE
- PES_PROFILE futuro
- JEF_PROFILE futuro
- EXP_PROFILE futuro

DST/DSB validan comandos codificables, trims, color changes, deltas y tamaño razonable.

### MACHINE_PROFILE_VALIDATOR

Perfiles creados:

- GENERIC_MACHINE
- CE01_PROFILE
- WILCOM_REFERENCE_PROFILE
- FUTURE_MACHINE_PROFILE

CE01_PROFILE no bloquea por 12000 puntadas. Solo bloquea por bastidor incompatible o evidencia estructural real. El conteo alto se mantiene como warning/risky.

## Estado final

La app deja de tratar CE01 como validador principal por defecto. CE01 estricto existe únicamente para pruebas específicas y está apagado por defecto.