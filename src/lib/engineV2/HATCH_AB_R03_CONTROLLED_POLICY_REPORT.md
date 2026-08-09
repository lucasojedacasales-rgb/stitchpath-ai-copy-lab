# R03 — Política controlada Hatch A/B

## Objetivo y alcance

R03 añade una política interna, explícita, reversible y fail-closed para las
cuatro reglas Hatch A/B ya integradas experimentalmente en Engine V2. No activa
ninguna regla por defecto, no convierte la evidencia experimental en integración
productiva y no modifica evaluadores geométricos, físicos o de huecos.

Estado inicial acreditado:

- rama inicial: `main`;
- HEAD inicial: `f87fdc3c2d044b3fb6afcb795d2c195547005f72`;
- `origin/main`: `f87fdc3c2d044b3fb6afcb795d2c195547005f72`;
- divergencia inicial: `0/0`;
- árbol, staging y untracked iniciales: vacíos;
- rama de implementación: `engine-v2-ab-consolidation`.

## Contrato `controlled-opt-in`

El único valor explícito válido es:

```js
hatchEvidenceActivationMode: 'controlled-opt-in'
```

Cuando el campo está ausente o vale `undefined`, la capa R03 no interviene. El
perfil `legacy`, el perfil `hatch-a-f-experimental`, sus 16 combinaciones, sus
trazas y los hashes R02 conservan el comportamiento anterior.

La resolución controlada devuelve un objeto inmutable con esta forma lógica:

```js
Object.freeze({
  operationalRuleIds: Object.freeze([]),
  diagnosticRuleIds: Object.freeze([]),
  effectiveRuleIds: Object.freeze([]),
  fallbackToLegacy: false,
  fallbackReasonCodes: Object.freeze([]),
})
```

Las listas siguen siempre el orden de `HATCH_EVIDENCE_RULE_IDS`. Ante cualquier
error quedan vacías y el planificador ejecuta directamente el fallback legacy.

## Clasificación canónica

Reglas operacionales, siempre OFF por defecto:

- `SATIN-RANGE-OBSERVED-001`;
- `HOLE-MIN-SIZE-001`.

Reglas exclusivamente diagnósticas:

- `LOCAL-WIDTH-PROFILE-001`;
- `HOLE-PRESERVE-001`.

LOCAL-WIDTH no cambia técnica. HOLE-PRESERVE no muta geometría, no habilita
HOLE-MIN-SIZE y no permite materialización adicional. Su presencia en una traza
controlada no las convierte en reglas operacionales.

## Combinaciones rechazadas

- SATIN-RANGE junto con HOLE-MIN-SIZE produce
  `HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT`.
- Las cuatro reglas activas producen
  `HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN`.
- `ALL-ON` sin `hatchEvidenceActivationMode` se conserva únicamente como
  interacción experimental de laboratorio y regresión R02.

El modo controlado exige el perfil `hatch-a-f-experimental`. Usarlo con legacy
produce `HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE`. Todos los flags
OFF constituyen una configuración válida que deriva a legacy con
`HATCH_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES`.

## Precedencia de errores

1. `INVALID_HATCH_EVIDENCE_ACTIVATION_MODE`.
2. `HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE`.
3. `HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN`.
4. `HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT`.
5. Errores existentes de perfil, flags, contexto o configuración técnica.
6. `HATCH_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES`.

R1 canonicaliza todos los `fallbackReasonCodes` antes de congelar el resultado.
Elimina duplicados y aplica este orden literal dentro del nivel 5:

1. `INVALID_HATCH_EVIDENCE_PROFILE`;
2. `INVALID_HATCH_EVIDENCE_RULE_FLAGS`;
3. `UNKNOWN_HATCH_EVIDENCE_RULE_FLAG`;
4. `INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE`;
5. `HATCH_EVIDENCE_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE`;
6. `INVALID_HATCH_EVIDENCE_CONTEXT`;
7. `UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD`;
8. `MISSING_HATCH_EVIDENCE_FABRIC`;
9. `MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY`;
10. `INVALID_HATCH_EVIDENCE_FABRIC`;
11. `INVALID_HATCH_EVIDENCE_SCALE_COMPATIBILITY`;
12. `MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG`;
13. `INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG`;
14. `INVALID_HATCH_EFFECTIVE_SATIN_MAXIMUM`.

Los códigos futuros no incluidos en la precedencia se conservan después de los
códigos conocidos en orden ordinal por unidades de código. R2 sustituye
`localeCompare` por comparaciones `<` y `>`, por lo que el resultado no depende
del locale ni del orden de inserción de `hatchEvidenceRuleFlags`. Los códigos
existentes se reutilizan literalmente y no se mantiene una segunda validación
paralela.

## Fallback y trazabilidad

`resolveHatchEvidenceControlledOptInPolicy` compone el validador existente y la
configuración técnica efectiva. El planificador usa exclusivamente
`effectiveRuleIds` cuando el modo controlado es válido. Si la política exige
fallback, no ejecuta evaluadores Hatch.

Las trazas controladas registran `activationMode`, `operationalRuleIds`,
`diagnosticRuleIds` y `effectiveRuleIds`. Esos campos nunca se añaden cuando el
modo está ausente, por lo que la salida experimental R02 permanece normalizada
como antes de R03.

El registro oficial conserva identidad referencial con la política canónica.
R2 mantiene separada esa identidad del contrato del validador exportado: una
copia externa solo es válida si su prototipo es `Object.prototype`, está
profundamente congelada y presenta exactamente las claves, descriptores de datos,
valores y orden canónicos. Los arrays exigen `Array.prototype`, índices y
`length` exactos, descriptores de datos congelados, valores ordenados y únicos y
ausencia de propiedades adicionales.

La introspección usa `Reflect.ownKeys` y `Object.getOwnPropertyDescriptors` antes
de obtener valores desde `descriptor.value`. Rechaza getters, setters, símbolos,
propiedades enumerables o no enumerables adicionales, prototipos anómalos, IDs
desconocidos o duplicados y valores divergentes. Toda la inspección está
protegida por `try/catch`: un Proxy hostil se rechaza con
`HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY_INVALID` sin ejecutar getters ni
propagar excepciones.

## Correcciones y cobertura R1/R2

- canonicalización estable de errores conocidos y futuros;
- igualdad completa ante distinto orden de inserción de flags;
- fallback exacto para flags canónicos no booleanos;
- validación estructural de copias profundamente congeladas del registro;
- rechazo de copias mutables o estructuralmente divergentes;
- HOLE-MIN combinado con HOLE-PRESERVE sin requisito técnico de SATIN y sin
  ampliar el efecto operacional acreditado;
- máximo SATIN inválido anclado a sus dos códigos y orden exactos;
- proyección intrínseca de supervivientes ampliada con objeto, técnica final,
  puntadas físicas, underlay, top stitches y comandos físicos locales;
- resecuenciación, conectores, jumps y trims conservados como consecuencias
  globales, no como evidencia de mejora física.
- forma exterior exacta mediante prototipo, claves propias y descriptores;
- forma exacta separada para cada array de la política;
- rechazo aislado de mutabilidad exterior y de cada array interno;
- rechazo aislado de propiedades ocultas, símbolos, accessors y prototipos
  anómalos en objetos y arrays;
- rechazo sin excepción de proxies hostiles en `getPrototypeOf`, `ownKeys` y
  `getOwnPropertyDescriptor`;
- comparador ordinal de códigos futuros independiente del locale;
- prueba positiva con copia y arrays independientes profundamente congelados.

## Protección de R02

R03 no modifica la prueba ni el informe R02. Sus identificadores canónicos son:

- prueba R02:
  - blob Git: `b9f7a48a21fa28b5f66c716b1da3827150829f23`;
  - SHA-256 LF: `DF3E7EB56E5046D59490BE994EACCDFF659EF4C1B83B47FC0CEB1092C3CBD294`;
- informe R02:
  - blob Git: `4d47267f045c6199ba0bac8cc4f9cefeec1a12d9`;
  - SHA-256 LF: `5D01DDC274026D587B1EE2D9E8B638F391FFE220214DE59A57126F0192799F3B`.

Los SHA-256 del working tree con CRLF dependen del checkout y no son
identificadores portátiles.

## Archivos de implementación

Modificados:

- `src/lib/engineV2/rules/hatchEvidence/profiles.js`;
- `src/lib/engineV2/rules/hatchEvidence/registry.js`;
- `src/lib/engineV2/planning/embroideryRolePlanner.js`;
- `src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js`;
- `src/lib/engineV2/__tests__/hatchABExperimentalIntegration.test.js`;
- `src/lib/engineV2/__tests__/hatchABPlanningCorpus.test.js`.

Nuevo:

- `src/lib/engineV2/HATCH_AB_R03_CONTROLLED_POLICY_REPORT.md`.

`src/lib/engineV2/rules/hatchEvidence/index.js` no se modifica ni se amplía como
API pública.

## Verificación R2

### Antecedentes de infraestructura

El intento focalizado inicial de R03 dentro del sandbox, iniciado el
`2026-08-09 16:35:04.078 +02:00`, terminó a las `16:35:09.010 +02:00` tras
`4.931 s` con salida `1` y `spawn EPERM` antes de cargar Vitest: `0` suites,
`0` pruebas y `0` fallos de aserción. Se conserva como antecedente y no se
contabiliza como ejecución de pruebas.

El intento sandbox R1 del `2026-08-09 20:12:02.322 +02:00` también terminó en
`spawn EPERM` antes de cargar Vitest: `0` suites y `0` pruebas. Permanece como
segundo antecedente de infraestructura y no se mezcla con los resultados R2.

El primer intento R2 de la prueba directamente afectada usó el comando:

```text
npm run test:engine-v2 -- src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js
```

Resultado dentro del sandbox:

- inicio del proceso: `2026-08-09 20:42:27.805 +02:00`;
- fin del proceso: `2026-08-09 20:42:28.949 +02:00`;
- duración de pared: `1.144 s`;
- código de salida: `1`;
- `spawn EPERM` antes de cargar `vitest.engine-v2.config.js`;
- versión de Vitest no informada;
- suites cargadas: `0`;
- pruebas ejecutadas: `0`;
- fallos de prueba: `0`.

Fue un incidente de infraestructura, no un fallo de código. Las ejecuciones
siguientes utilizaron el mecanismo efectivo ya acreditado.

### Prueba directamente afectada

Comando: el mismo del intento R2 anterior.

Resultado efectivo:

- Vitest: `v4.1.10`;
- inicio del proceso: `2026-08-09 20:42:39.889 +02:00`;
- inicio informado por Vitest: `20:42:41`;
- fin del proceso: `2026-08-09 20:42:42.490 +02:00`;
- duración Vitest: `1.37 s`;
- duración de pared: `2.601 s`;
- código de salida: `0`;
- suites: `1/1` aprobadas;
- pruebas: `109/109` aprobadas;
- fallos: `0`.

### Puerta focalizada completa

Comando:

```text
npm run test:engine-v2 -- src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js src/lib/engineV2/__tests__/hatchABExperimentalIntegration.test.js src/lib/engineV2/__tests__/hatchABPlanningCorpus.test.js src/lib/engineV2/__tests__/hatchABReferenceFidelity.test.js src/lib/engineV2/__tests__/hatchABR02Metrics.test.js src/lib/engineV2/__tests__/internalPipeline.test.js
```

Resultado efectivo:

- Vitest: `v4.1.10`;
- inicio del proceso: `2026-08-09 20:43:00.412 +02:00`;
- inicio informado por Vitest: `20:43:01`;
- fin del proceso: `2026-08-09 20:43:12.220 +02:00`;
- duración Vitest: `10.76 s`;
- duración de pared: `11.808 s`;
- código de salida: `0`;
- suites: `6/6` aprobadas;
- pruebas: `210/210` aprobadas;
- fallos: `0`.

### Suite completa Engine V2

Comando:

```text
npm run test:engine-v2
```

Resultado efectivo:

- Vitest: `v4.1.10`;
- inicio del proceso: `2026-08-09 20:43:26.530 +02:00`;
- inicio informado por Vitest: `20:43:27`;
- fin del proceso: `2026-08-09 20:43:47.096 +02:00`;
- duración Vitest: `19.50 s`;
- duración de pared: `20.566 s`;
- código de salida: `0`;
- suites: `19/19` aprobadas;
- pruebas: `713/713` aprobadas;
- fallos: `0`.

La puerta focalizada incluye la regresión R02 exacta, el corpus A/B, la
fidelidad de referencia, la conservación de las 16 combinaciones experimentales
y la integración del pipeline interno. La suite completa no detectó regresiones
en Engine V2.

## Límites

- `productionIntegration` permanece `false`.
- Base44 no expone ni transmite `hatchEvidenceActivationMode`.
- No se modifican `engineV2Bridge`, CE01, C_Solapes, exportadores, adaptadores,
  encoders, superficies binarias, generación física, planificación técnica o
  secuenciación global.
- `ALL-ON` no es una configuración controlada o productiva.
- No se realizó sew-out ni se controlaron aguja, hilo, estabilizador, tensión,
  velocidad, bastidor o condiciones reales de tela.
- Los cambios de métricas, comandos o puntadas no acreditan por sí solos una
  mejora física del bordado.
