# Integración controlada de evidencia Hatch A–F

## Baseline

- Repositorio: `C:\Users\lucas\Documents\Codex\stitchpath-engine-v2-clean`
- Rama y HEAD de partida: `engine-v2` / `37ec300cd95f9def83ceef3c64a30bb172d6410f`
- Estado inicial: limpio, sin cambios locales que preservar.
- Baseline focalizado: 26 suites, 187/187 pruebas superadas.
- Paridad representativa del plan no marcado: SHA-256
  `b076b8e44015b2c8d8b5152bd14c6fe8ac526d02cc7f8170dd9d0a11b3e010a7`.

No se modificó comportamiento antes de capturar el baseline.

## Evidencia registrada

Fuente maestra inmutable:

- Paquete: `PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip`
- SHA-256:
  `d2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3`
- Tamaño: 320891578 bytes.

Los hashes de los artefactos de reglas se verificaron contra el manifiesto del
paquete:

| Fase | Reglas | SHA-256 |
| --- | ---: | --- |
| A_Anchuras | 5 | `af0f84318ed59b5979827ca0ed8f188472b511c1408fc25f1a8c7d6d5833d698` |
| B_Huecos | 6 | `a0fa1078e833852e6a7a5f6a67114f40da3ac4c9c7bc35491deceb6a3d2fc669` |
| C_Solapes | 8 | `38255ab102e38cb66612d745da8e8a8073187466abbbf887cf313e5333d6e377` |
| D_Técnicas | 6 | `a33c4b46d35250b2bae1d4b501abe40b631fd1cd5b89c8926a794df7e4664aef` |
| E_Telas | 6 | `f9784669e394a8767974c5c2e50a97a04a5f49fb9641a1582efb62b254f159cc` |
| F_Escalado | 6 | `3d5c6cc7fd3f8f3aeb251736fe0c0e6cf86b25ca3d17a65637ccc6a6c6194e0f` |

Para la fidelidad A8/C6/D6/H9 se verificaron además los bytes de los seis
artefactos usados para derivar fixtures:

| Artefacto | Ruta dentro del paquete | SHA-256 |
| --- | --- | --- |
| SVG anchuras | `01_ANCHURAS/00_Fuentes/Vectores/HATCH-A-WIDTHS-EXACT-100x80mm.svg` | `548cbe7ab351dfdc481f31643f5482a8391918a54ad842ef68d77447facadcbe` |
| CSV anchuras | `01_ANCHURAS/05_Datos_Objetos/HATCH-A-WIDTHS-EXACT-map.csv` | `08d833e7b63327bee8d7c9422833d31808834a72bec8e36a34b34cc640ce9a08` |
| XLSX anchuras | `01_ANCHURAS/05_Datos_Objetos/HATCH-A-WIDTHS-R01-analisis-ABCD.xlsx` | `4064bdc426072cb31e43fa0b26e231aae2423eacc6708620630f9bae784e0986` |
| SVG huecos | `02_HUECOS/00_Fuentes/Vectores/HATCH-B-HOLES-EXACT-100x80mm.svg` | `f9c9df2d6bcea3f61f119fabfff676684d126c9220b6ad464765565a9c7a6d83` |
| CSV huecos | `02_HUECOS/05_Datos_Objetos/HATCH-B-HOLES-map.csv` | `834e518ac4bf4830141cd4e150a43e0fa86c04532ba329b8ecaac834ddfb7d57` |
| XLSX huecos | `02_HUECOS/05_Datos_Objetos/HATCH-B-HOLES-R01-analisis.xlsx` | `7388d8d3cf036e0f6027031cf9f8ea118c876a2f2dae2925fcd20eac61f964f0` |

Los fixtures de prueba conservan las primitivas SVG y las filas CSV/XLSX
relevantes. A8 procede del `<rect>` exacto; C6 conserva los cuatro segmentos
cuadráticos `Q` y los muestrea de forma determinista en ocho intervalos por
segmento para la frontera poligonal de Engine V2; D6 conserva el `<rect>` con
`rx=ry=4,5` y muestrea sus semicircunferencias; H9 conserva el rectángulo y los
cuatro círculos definidos mediante arcos SVG, muestreados en 32 ángulos. El ZIP
de 320 MB no es dependencia de ejecución: las pruebas consumen solo constantes
autocontenidas con trazabilidad.

El registro contiene las 37 reglas A–F, sin duplicados, y conserva para cada
una `id`, fase, fuente, condición, acción candidata, confianza, límites,
estado y notas. Todas mantienen el estado integrador `candidate`; el estado
original del paquete se conserva como `sourceRuleStatus`.

C_Solapes permanece cerrada e inactiva. Su auditoría revisada también queda
vinculada por SHA-256
`a652d1d32a325fd70880b891263f5b7ae73508d42fffa54f18a2443e9c4a9d8b`.
G_Lettering no forma parte del registro.

## Arquitectura y puntos de integración

- Clasificación geométrica:
  `semantics/geometryFeatureAnalysis.js` y
  `technical/objectGeometryMetrics.js`.
- Selección de técnica:
  `planning/embroideryRolePlanner.js`, con parametrización posterior en
  `technical/stitchParameterPlanner.js`.
- Generación de satín:
  `stitchGeneration/satinStitchGenerator.js`.
- Generación de tatami:
  `stitchGeneration/tatamiStitchGenerator.js` y
  `stitchGeneration/polygonScanlineClipper.js`.
- Huecos:
  ingestión y canonicalización, topología de regiones, conversión a milímetros,
  métricas técnicas y recorte físico mediante `polygonScanlineClipper.js`.
- Solapes:
  relaciones topológicas y `planning/dependencyPlanner.js`.
- Perfiles de tejido:
  `technical/materialProfileModel.js` y la configuración/pipeline de
  planificación técnica.
- Escalado:
  `planning/normalizedToMillimeterGeometry.js`; el generador físico de tatami
  conserva además su invariante experimental de escalado de dirección.

La decisión experimental permanece en `planning/embroideryRolePlanner.js`,
antes de materializar la propuesta de objeto. `planning/objectPlanningPipeline.js`
transporta la misma `technicalConfig` que consumirá después el pipeline
técnico, y la validación del perfil comprueba ese contrato.
`orchestration/regionToBinaryOrchestrator.js` comparte una única instancia de
la configuración efectiva entre ambos pasos. El registro no altera por sí
mismo generadores físicos.

## Perfil reversible

Perfiles admitidos:

- `legacy` — predeterminado; no añade campos a la configuración por defecto ni
  modifica la salida. El planificador corta antes de resolver o ejecutar
  evaluadores Hatch.
- `hatch-a-f-experimental` — habilita el contrato de flags, pero ninguna regla
  se activa si su flag individual no vale `true`.

Los únicos flags admitidos son:

- `SATIN-RANGE-OBSERVED-001`
- `LOCAL-WIDTH-PROFILE-001`
- `HOLE-PRESERVE-001`
- `HOLE-MIN-SIZE-001`

El opt-in de una regla usa una allowlist de contexto limitada a
`fabricProfile` y `referenceScaleCompatible`. SATIN-RANGE recibe además la
configuración técnica efectiva por un canal separado:

```js
const hatchConfig = {
  hatchEvidenceProfile: 'hatch-a-f-experimental',
  hatchEvidenceRuleFlags: {
    'SATIN-RANGE-OBSERVED-001': true,
  },
  hatchEvidenceContext: {
    fabricProfile: 'Pure Cotton',
    referenceScaleCompatible: true,
  },
};

const technicalConfig = {
  satin: { maximumWidthMm: 9.18 },
};

buildEmbroideryObjectProposalPlan({
  regions,
  graph,
  semanticResult,
  config: hatchConfig,
  technicalConfig,
});

buildTechnicalEmbroideryPlan({
  regions,
  threadedObjectMaterialization,
  config: technicalConfig,
});
```

Un perfil, flag, valor o campo de contexto desconocido/inválido falla la
validación. Con algún flag activo se exigen solo los campos que consume esa
regla: tejido para las cuatro; escala para SATIN-RANGE, LOCAL-WIDTH y
HOLE-MIN-SIZE; y configuración técnica efectiva para SATIN-RANGE. Un flag
`true` bajo `legacy` también falla la validación y se resuelve desactivado.
Legacy y el perfil experimental con todos los flags OFF no añaden requisitos.

## Integración activa A/B

Estas cuatro reglas son elegibles y activables de manera independiente:

- `SATIN-RANGE-OBSERVED-001`
- `LOCAL-WIDTH-PROFILE-001`
- `HOLE-PRESERVE-001`
- `HOLE-MIN-SIZE-001`

`SATIN-RANGE-OBSERVED-001` solo cambia tatami a satín cuando se cumplen a la vez:

- Pure Cotton y escala de referencia compatible;
- geometría válida, sin huecos y alineada con la orientación de referencia;
- altura entre 13 y 16 mm, inclusivas con tolerancia numérica de 0,000001 mm;
- anchura máxima local de entrada no superior a los 9,0 mm de la familia fuente
  acreditada por D6;
- mínimo configurado y relación de aspecto legacy;
- anchura máxima local no superior al máximo de satín de la `technicalConfig`
  efectiva y válida que recibirá el pipeline técnico.

`maximumSourceSatinWidthMm = 9,0` representa la geometría SVG de D6.
`maximumObservedSatinWidthMm = 9,18` representa la medición de salida de Hatch,
no una dimensión admisible de entrada. La capacidad técnica experimental puede
ser 9,18 mm cuando se proporciona explícitamente, pero no amplía la familia
fuente por encima de 9,0 mm.

Si falta una condición conserva la decisión legacy. En particular, nunca
promueve un objeto cuya sección local máxima supera el máximo técnico efectivo.
La mediana local no sustituye esta comprobación. Los antiguos campos
declarativos `technicalSatinMaximumWidthMm` y
`technicalSatinValidationPassed` no pertenecen a la allowlist y se rechazan.

`LOCAL-WIDTH-PROFILE-001` queda separada y es diagnóstica. Registra únicamente
los campos que Engine V2 calcula: mínimo, mediana, máximo, variación, relación
de aspecto y eje principal. No afirma calcular media, porcentaje sostenido
cerca del máximo, curvatura ni forma de extremos, y todavía no cambia técnica.

`HOLE-PRESERVE-001` conserva de forma independiente huecos geométricamente
válidos y nunca habilita el umbral mínimo.

`HOLE-MIN-SIZE-001`, con Pure Cotton, escala compatible y medición compatible
con la evidencia:

- hasta 0,8 mm rechaza generación automática y deriva a revisión manual;
- entre 0,8 y 1,2 mm protege el hueco y exige revisión;
- desde 1,2 mm conserva el hueco y permite continuar el tatami existente.

La medición acepta polígonos ortogonales convexos y, de forma separada,
geometría aproximadamente circular con al menos 16 puntos. La circularidad se
comprueba mediante centro medio, radios, desviación radial máxima del 2 % y una
separación angular máxima de dos veces la uniforme. El diámetro es dos veces el
radio medio y no depende de la orientación. `null`, valores no finitos,
geometría insuficiente, degenerada, irregular, cóncava o no acreditada producen
fallback sin clasificar pérdida observada. Las trazas contienen únicamente
reglas cuyo flag estaba activo y que fueron realmente evaluadas.

## Reglas registradas pero no activadas

- Las otras tres reglas de A_Anchuras.
- Las otras cuatro reglas de B_Huecos.
- Todas las reglas de C_Solapes, D_Técnicas, E_Telas y F_Escalado.
- Todo G_Lettering.

## Verificación

- Baseline focalizado previo a esta revisión externa: 3 suites, 64/64.
- Suites A/B focalizadas, incluida fidelidad: 4 suites, 107/107.
- Suite de fidelidad A8/C6/D6/H9: 16/16.
- Corpus A/B pre-exportación: 1 suite, 7/7.
- Suite Engine V2: 141 archivos de prueba, 3383/3383, con timeout de prueba de
  30 s.
- La suite global no se repitió en esta revisión; la comprobación solicitada fue
  la suite Engine V2.
- ESLint focalizado: 20 archivos JavaScript, cero errores.
- ESLint global: falla por 25 imports no usados preexistentes en UI, fuera del
  alcance de esta integración.
- Whitespace: 21 archivos revisados, cero coincidencias.
- `git diff --check`: correcto; solo avisos de normalización LF/CRLF de Git.

La paridad legacy queda confirmada por el hash preintegración
`b076b8e44015b2c8d8b5152bd14c6fe8ac526d02cc7f8170dd9d0a11b3e010a7`,
igualdad entre perfil explícito y configuración no marcada, igualdad de todos
los flags OFF y ruta de código que no invoca evaluadores Hatch.

### Cierre de la auditoría independiente A/B

La auditoría técnica A/B queda cerrada. Sus tres bloqueos independientes están
cerrados. El cierre se sustenta en los resultados finales 107/107 de las suites
A/B focalizadas, 16/16 de fidelidad A8/C6/D6/H9, 7/7 del corpus y 3383/3383 de
Engine V2. Se corrigieron exclusivamente los tres hallazgos reproducidos:

1. **Configuración resuelta idempotente.** Antes, reutilizar `firstPlan.config`
   anidaba `extras.extras`: en la sonda B el primer plan rechazaba el hueco de
   0,8 mm como manual y el segundo plan válido lo convertía silenciosamente en
   tatami sin traza; en A el candidato A8 pasaba de satín a tatami. Después,
   la primera, segunda y tercera resolución son semánticamente iguales, nunca
   aparece `extras.extras` y los campos desconocidos explícitos del nivel
   superior prevalecen de forma determinista sobre `source.extras`. Un valor
   Hatch explícito e inválido continúa produciendo error de validación. Las dos
   planificaciones B conservan revisión, rechazo automático y la misma traza;
   las dos planificaciones A8 conservan el mismo candidato a satín y la misma
   traza.
2. **Puntos de hueco inválidos.** Antes, una mezcla de puntos válidos y `NaN`
   podía reconstruirse como un rectángulo de 0,8 mm válido y bloqueante.
   Después, `null`, coordenadas ausentes, `NaN`, `Infinity`, `-Infinity` y
   mezclas válidas/inválidas producen `minimumSpanMm: null`,
   `evidenceCompatible: false`, `disposition: fallback` y
   `fallbackReason: invalid_or_non_finite_hole_point`. Un duplicado finito
   válido continúa limpiándose y midiéndose como 0,8 mm.
3. **Frontera única de la familia fuente.** Antes, 9,0000005 mm podía aplicar
   satín y registrar simultáneamente `width_above_source_family`. Después, una
   única condición gobierna aplicabilidad y fallback: 9 mm, `9 + 0,5e-6` y
   `9 + 1e-6` pueden aplicar con fallback nulo; `9 + 2e-6` no aplica y devuelve
   `width_above_source_family`. Altura/orientación reutiliza igualmente su
   predicado calculado; la frontera técnica ya reutilizaba
   `technicalLimitCompatible`. No se amplió ninguna regla.

La integración A/B queda técnicamente aprobada como experimental, con flags
individuales OFF por defecto. No se consolidó ninguna regla, no se realizó
sew-out físico y no se demostró mejora física ni de calidad. Esta corrección no
tocó C_Solapes, D_Técnicas, E_Telas, F_Escalado, G_Lettering, Base44, CE01,
exportadores, encoders ni fixtures DST/DSB.

### Fidelidad de referencias A8/C6/D6/H9

| Referencia | Geometría fuente | Medición Hatch observada | Resultado demostrado |
| --- | --- | --- | --- |
| A8 | Rectángulo 8,0 × 16,0 mm | 8,04 mm | Tatami con máximo técnico 7; satín candidato con 9,18 explícito |
| C6 | Forma afilada 8,0 × 14,0 mm, cuatro curvas `Q` | 8,04 mm | Tatami con máximo técnico 7; satín candidato con 9,18 explícito |
| D6 | Cápsula 9,0 × 14,0 mm, radio 4,5 mm | 9,18 mm | Tatami con máximo técnico 7; satín candidato con 9,18 explícito |
| H9 | Rectángulo 20 × 14 mm; huecos Ø0,8/1,2/1,8/2,5 | Ø0,8 colapsa; Ø1,2+ se conservan | Los cuatro se miden juntos; Ø0,8 bloquea automático y los otros tres quedan protegidos |

Una sonda sintética de 9,01 × 14 mm confirma que superar los 9,0 mm de entrada
queda fuera de la familia fuente, aunque el máximo técnico efectivo sea
9,18 mm. Esa sonda está etiquetada como sintética y no se presenta como
referencia del paquete. Un hueco cóncavo irregular también permanece en
fallback sin inferir pérdida.

### Corpus A/B pre-exportación

El corpus termina en comandos canónicos. No ejecuta adaptación de máquina,
encoder ni exportador.

| Variante | Objetos | Puntadas físicas | Comandos stitch | Jumps | Trims |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy / todos OFF; máximo efectivo 7 mm | 4 | 1337 | 1516 | 25 | 24 |
| SATIN-RANGE; máximo efectivo 7 mm | 4 | 1337 | 1516 | 25 | 24 |
| SATIN-RANGE; máximo efectivo 9,18 mm | 4 | 1310 | 1450 | 24 | 23 |
| LOCAL-WIDTH; máximo efectivo 7 mm | 4 | 1337 | 1516 | 25 | 24 |
| HOLE-PRESERVE; máximo efectivo 7 mm | 4 | 1337 | 1516 | 25 | 24 |
| HOLE-MIN-SIZE; máximo efectivo 7 mm | 3 | 765 | 876 | 17 | 16 |
| Las cuatro ON; máximo efectivo 9,18 mm | 3 | 738 | 810 | 16 | 15 |

SATIN-RANGE con el máximo técnico predeterminado de 7 mm no cambia la técnica:
el objeto de 8 × 16 mm conserva tatami. Con el máximo explícito de 9,18 mm
entregado tanto al planificador de objetos como al pipeline técnico, cambia
solo ese objeto a satín y el recorrido conserva validez técnica. LOCAL-WIDTH y
HOLE-PRESERVE no cambian métricas operativas.
HOLE-MIN-SIZE deriva exclusivamente el hueco sintético ortogonal compatible de
0,8 mm a revisión, sin eliminar ni mutar geometría. La suite de fidelidad
separada cubre los cuatro círculos reales de H9 en un único objeto. Todas las
variantes son deterministas.

Estos resultados no prueban una mejora física de bordado; solo demuestran
comportamiento digital, aislamiento, seguridad de fallback y diferencias
medibles antes de exportación. No se realizó sew-out físico.

## Siguiente paso

Revisar el corpus y decidir si alguna regla merece una fase posterior de
consolidación. No consolidar reglas ni activar C_Solapes sin aprobación
explícita.
