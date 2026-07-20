# MACHINE_PREVIEW_COMPARISON_AFTER_KNOCKOUT_V1

## Preview actual app

La vista Final/Simulación usa finalEmbroideryCommands, la misma fuente canónica que exporta DST. Tras esta fase, los rellenos inferiores reciben zonas de knockout antes de generar puntadas.

## Expected machine order

1. Underlay si está activo.
2. base_fill recortado.
3. foreground_fill recortado.
4. shadows_or_details.
5. black_outline al final.

## Thread stop count

Objetivo: 5-8 colores reales y colorChangeCommands ideal <= uniqueThreadColors + 2. La reducción se hace agrupando objetos por capa/color, sin tocar el encoder ni insertar cambios artificiales.

## Layer order

outlineAfterFill=true
blackOutlineFinalPass=true
foregroundOverBase=true

## Knockout success

eyeWhiteKnockoutExpected=true
bellyMouthWhiteKnockoutExpected=true
greenUnderWhiteReduced=true
blackBaseFillReduced=true

## Remaining visual defects

remainingVisualDefects=requiere_comparación_con_foto_real_de_máquina
recommendedAction=Probar DST reconocido por la máquina y comparar ojos, barriga/boca, pies naranjas y contorno negro final.