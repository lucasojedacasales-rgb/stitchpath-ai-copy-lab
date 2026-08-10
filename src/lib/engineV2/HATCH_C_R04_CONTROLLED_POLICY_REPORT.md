# R04 — política controlada interna de C_Solapes C1

## Estado

R04 consolida de forma controlada el guard existente `CONTOUR-LAST-001`.
Las puertas finales de R04-R0, R04-R1, R04-R2 y R04-R3 terminaron aprobadas,
con cero fallos en sus verificaciones acreditadas.

R04 no crea dependencias, no introduce una nueva resecuenciación y no implementa
geometría de solapes. `productionIntegration` permanece en `false`.

## Base y rama

- Rama inicial: `main`.
- HEAD inicial: `47d135d96161a2d3303ff5a5024f94e8775ddf8b`.
- `origin/main` local inicial: `47d135d96161a2d3303ff5a5024f94e8775ddf8b`.
- Divergencia inicial: `0/0`.
- Árbol, staging y untracked iniciales: vacíos.
- Rama creada: `engine-v2-c-overlap-consolidation`.
- La rama se creó sin cambiar el HEAD.

No se ejecutaron `fetch` ni `pull`.

## Alcance

La implementación modifica exclusivamente:

- `src/lib/engineV2/rules/hatchEvidence/overlapProfiles.js`;
- `src/lib/engineV2/rules/hatchEvidence/registry.js`;
- `src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js`.

Añade exclusivamente:

- `src/lib/engineV2/__tests__/hatchCControlledPolicy.test.js`;
- `src/lib/engineV2/HATCH_C_R04_CONTROLLED_POLICY_REPORT.md`.

Las correcciones R04-R1, R04-R2 y R04-R3 modifican exclusivamente
`overlapProfiles.js`, la prueba controlada C y este informe. Conservan sin
cambios `registry.js` y `hatchEvidenceRegistry.test.js`.

No se modifican consumidores downstream. La activación efectiva permanece
centralizada en `resolveHatchOverlapIntegrationConfig`.

## Historial formal R04-R0 a R04-R3

- R04-R0: implementación inicial de la política controlada interna C1, su
  registro, prueba focalizada e informe.
- R04-R1: clasificación A/B fail-closed e inspección segura inicial, sin
  convertir excepciones en todos-OFF.
- R04-R2: clasificación trivalente, captura de proxies revocados, rechazo de
  símbolos y prototipos anómalos, y precedencia C antes del cruce A/B.
- R04-R3: estado de inspección por campo, precedencia simultánea completa y
  cierre documental.

## Contrato `controlled-opt-in`

El modo explícito es:

```js
hatchOverlapActivationMode: 'controlled-opt-in'
```

La única regla autorizada es:

```text
CONTOUR-LAST-001
```

El resultado lógico de la política contiene exactamente:

```js
{
  operationalRuleIds,
  diagnosticRuleIds,
  effectiveRuleIds,
  fallbackToLegacy,
  fallbackReasonCodes,
}
```

El objeto exterior y todos sus arrays se congelan. C1 es la única regla
operacional; no existen reglas diagnósticas R04. C2 y C3 no están autorizadas en
este modo.

## Compatibilidad histórica

Cuando `hatchOverlapActivationMode` está ausente o vale `undefined`, R04 no
interviene:

- `legacy` conserva su resolución anterior;
- `hatch-c-experimental` conserva las combinaciones históricas C1/C2/C3;
- no se añaden campos R04 a la integración resuelta;
- no se modifican consumidores, contratos ni trazas anteriores.

## Fallback y fallo cerrado

Un modo inválido, el perfil legacy con modo controlado, una regla no autorizada,
varias reglas, `ALL-ON`, una estructura C inválida, una petición A/B ON o un
origen A/B inválido u hostil vacían las listas controladas y fuerzan fallback
legacy.

Todos-OFF es un fallback válido y explícito con:

```text
HATCH_OVERLAP_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES
```

Los errores reales no se mezclan con `NO_EFFECTIVE_RULES`. El validador existente
recibe los errores R04, invalida el plan y los consumidores posteriores bloquean
la salida física y canónica.

## Precedencia determinista

Los códigos conocidos siguen esta precedencia:

1. `INVALID_HATCH_OVERLAP_ACTIVATION_MODE`;
2. `HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE`;
3. `HATCH_OVERLAP_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN`;
4. `HATCH_OVERLAP_CONTROLLED_OPT_IN_MULTIPLE_RULES_FORBIDDEN`;
5. `HATCH_OVERLAP_CONTROLLED_OPT_IN_RULE_NOT_AUTHORIZED`;
6. códigos estructurales existentes;
7. `HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID`;
8. `HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_COMBINATION_FORBIDDEN`;
9. `HATCH_OVERLAP_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES`.

Los códigos se deduplican. Los códigos futuros se sitúan después de los conocidos
y se ordenan mediante comparación ordinal `<` y `>`, sin `localeCompare`.

## Cruce A/B+C

La dependencia es unidireccional:

```text
overlapProfiles.js → profiles.js
```

R04-R1 inspecciona configuración, `extras`, contexto y flags externos mediante
una clasificación trivalente: registro, valor ordinario no-registro o entrada
hostil. Obtiene una sola lista de claves y cada descriptor dentro de `try/catch`,
sin ejecutar accessors. Construye una copia interna y reutiliza el validador
canónico A/B únicamente sobre esa copia. No usa `Object.entries` sobre entradas
externas y captura traps y proxies revocados.

Bajo modo C controlado, raíz, `extras`, contexto y flags deben usar prototipo
plano, claves string, propiedades enumerables y descriptores de datos. Símbolos,
propiedades ocultas, prototipos personalizados y snapshots incoherentes fallan
cerrado. Sin modo C explícito se conserva la ruta histórica ordinaria.

Si cualquier regla A/B válida está solicitada ON, tanto por el perfil histórico
como por R03, C controlada falla con:

```text
HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_COMBINATION_FORBIDDEN
```

Si el origen A/B es inválido, contiene accessors o no puede inspeccionarse de
forma segura, falla con:

```text
HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID
```

A/B ausente, legacy todos-OFF, experimental todos-OFF y R03 controlada
todos-OFF permiten C1. Ninguna excepción se interpreta como una lista A/B vacía
válida.

Sin modo C explícito no se añade esta prohibición.

## Registro

El registro publica una única referencia al singleton canónico de la política
R04. La política declara:

- alcance interno;
- estado experimental;
- una regla operacional;
- cero reglas diagnósticas;
- C2 y C3 no autorizadas;
- `defaultEnabled: false`;
- `allOnAllowed: false`;
- cruces de fase no permitidos;
- `productionIntegration: false`.

El validador acepta copias estructurales independientes profundamente congeladas
y rechaza objetos o arrays mutables, propiedades ausentes o adicionales,
propiedades ocultas, símbolos, accessors, prototipos anómalos y proxies hostiles
sin ejecutar getters.

## C1 como guard

El planificador heredado ya deriva la dependencia nominal contorno-relleno con C
OFF. C1 controlada reutiliza el mismo recorrido histórico y acredita que la
dependencia, las capas y el contrato actual siguen siendo coherentes.

C1 no modifica:

- roles;
- técnicas;
- geometría o huecos;
- `layer`;
- dependencias nominales;
- orden nominal;
- puntadas;
- comandos.

Ante una contradicción, C1 no repara ni inventa dependencias: bloquea el plan y
conserva la causa.

## Verificación

Todas las ejecuciones efectivas utilizaron Vitest `v4.1.10`:

| Puerta | Inicio | Duración | Suites | Pruebas | Fallos | Código |
| --- | --- | --- | --- | --- | --- | --- |
| R04 directa final | `00:29:03` | `2.95 s` | `2/2` | `178/178` | `0` | `0` |
| C completa | `00:29:21` | `17.33 s` | `9/9` | `612/612` | `0` | `0` |
| Regresión R02/R03 | `00:29:50` | `9.97 s` | `4/4` | `95/95` | `0` | `0` |
| Engine V2 completa | `00:30:08` | `20.70 s` | `20/20` | `782/782` | `0` | `0` |

Antes de las puertas acreditadas hubo dos antecedentes separados:

1. La primera invocación directa terminó con `spawn EPERM` antes de cargar
   Vitest: código `1`, `0` suites y `0` pruebas. Fue un incidente de
   infraestructura y no un fallo de código.
2. La primera invocación que sí cargó Vitest comenzó a las `00:27:34` y duró
   `15.30 s`: ejecutó `2` archivos y `178` pruebas, con `176` aprobadas y `2`
   fallidas, código `1`. Ambas discrepancias estaban en la prueba R04 nueva: un
   hash C11 esperado mal transcrito y una sonda regional aplicada a una
   coordenada que no forma parte de la firma C1. Se corrigieron dentro del
   inventario autorizado usando el hash C11 históricamente acreditado y un
   campo regional firmado. La repetición directa final y las tres regresiones
   posteriores aprobaron íntegramente.

La matriz verificada cubre el contrato de activación y fallback, la precedencia
de errores, el cruce A/B+C, la inmutabilidad, el registro hostil, el recorrido
C1 real, la propagación fail-closed y la paridad nominal y física exigida. La
puerta R02/R03 y la suite completa acreditan que los checkpoints anteriores
permanecen intactos.

## Corrección R04-R1

R04-R1 sustituye el detector basado únicamente en `enabledRuleIds` por una
clasificación fail-closed del origen A/B. El delta funcional es:

- petición A/B válida ON: cruce prohibido;
- A/B válida ausente o todos-OFF: C1 permitida;
- A/B inválida, accessor o proxy hostil: origen inválido;
- excepción de inspección: origen inválido, nunca todos-OFF;
- ruta C histórica sin modo: misma resolución y misma forma;
- consumidor directo C1: legacy/OFF ante origen A/B inválido;
- pipeline: causa conservada y cero salida física o canónica.

Las cinco puertas finales R04-R1 utilizaron Vitest `v4.1.10`:

| Puerta R1 | Inicio | Duración | Suites | Pruebas | Fallos | Código |
| --- | --- | --- | --- | --- | --- | --- |
| R1 focalizada | `01:10:23` | `2.60 s` | `1/1` | `68/68` | `0` | `0` |
| R1 política + registro | `01:10:36` | `2.92 s` | `2/2` | `207/207` | `0` | `0` |
| C completa | `01:10:48` | `17.63 s` | `9/9` | `641/641` | `0` | `0` |
| Regresión R02/R03 | `01:11:15` | `10.23 s` | `4/4` | `95/95` | `0` | `0` |
| Engine V2 completa | `01:11:39` | `23.29 s` | `20/20` | `811/811` | `0` | `0` |

El primer intento focalizado R1 cargó Vitest a las `01:09:57`, duró `3.30 s`
y terminó con código `1`: `1` archivo, `68` pruebas, `66` aprobadas y `2`
fallidas. Los dos targets Proxy de prueba estaban vacíos y por ello el trap
`getOwnPropertyDescriptor` no podía ejecutarse. Se añadieron propiedades a los
targets para atravesar realmente los traps; no se cambió código productivo por
ese resultado. La repetición focalizada y las cuatro puertas posteriores
aprobaron íntegramente. R04-R1 no registró ningún incidente `spawn EPERM`.

## Corrección R04-R2 — cierre de bloqueantes pre-commit

La auditoría estática posterior identificó cuatro bloqueantes y este cierre los
resuelve dentro del mismo inventario R1:

1. una excepción de clasificación ya no puede convertirse en configuración
   ausente ni todos-OFF;
2. los errores estructurales C preceden al cruce A/B;
3. raíz y `extras` controlados rechazan prototipos, símbolos, propiedades
   ocultas y descriptores incoherentes igual que los registros anidados;
4. la matriz cubre accessors C/A/B, proxies revocados, consumidor directo,
   review y pipeline completo.

La prueba controlada añade `21` casos sobre el cierre anterior: pasa de `68` a
`89` pruebas. La matriz nueva incluye:

- getters en `hatchOverlapActivationMode`, `hatchOverlapRuleFlags`,
  `hatchEvidenceProfile`, `hatchEvidenceRuleFlags` y flags A/B;
- setter A/B, con contadores que permanecen en cero;
- proxies revocados en raíz, `extras` y flags A/B;
- símbolos y propiedades ocultas en raíz, `extras` y flags;
- prototipos personalizados en raíz, `extras`, flags y contexto;
- contradicción determinista entre `ownKeys` y descriptor;
- `legacy + controlled-opt-in` A/B;
- precedencia estructural C sobre fuente A/B inválida;
- ausencia de evaluación C1 en el consumidor directo y cero decisiones en el
  pipeline fail-closed.

Las cinco puertas efectivas del cierre utilizaron Vitest `v4.1.10`:

| Puerta de cierre | Inicio | Duración | Suites | Pruebas | Fallos | Código |
| --- | --- | --- | --- | --- | --- | --- |
| Focalizada | `01:33:27` | `3.34 s` | `1/1` | `89/89` | `0` | `0` |
| Política + registro | `01:34:00` | `3.04 s` | `2/2` | `228/228` | `0` | `0` |
| C completa | `01:34:17` | `16.51 s` | `9/9` | `662/662` | `0` | `0` |
| Regresión R02/R03 | `01:34:43` | `10.06 s` | `4/4` | `95/95` | `0` | `0` |
| Engine V2 completa | `01:35:08` | `23.72 s` | `20/20` | `832/832` | `0` | `0` |

La primera invocación focalizada del cierre no cargó Vitest: terminó con
`spawn EPERM`, código `1`, `0` suites y `0` pruebas. La misma puerta se ejecutó
fuera del sandbox, cargó Vitest y aprobó `89/89`; el incidente fue de
infraestructura y no un fallo de código.

## Corrección R04-R3 — precedencia simultánea por campo

La revisión R3 detectó que un indicador global de fallo de inspección podía
ocultar un error de activación o perfil ya acreditado por un descriptor de datos
seguro. El resolver y el validador conservan ahora por separado el estado de:

- `hatchOverlapActivationMode`;
- `hatchOverlapProfile`;
- `hatchOverlapRuleFlags` y su clasificación hostil;
- estructura raíz C y `extras`;
- fuente A/B clasificada de forma independiente.

La fuente A/B se inspecciona de forma fail-closed, pero su resultado solo
gobierna después de terminar las comprobaciones C de mayor precedencia. Una
activación legible pero inválida conserva
`INVALID_HATCH_OVERLAP_ACTIVATION_MODE`; un perfil legible pero incompatible
con modo controlado conserva
`HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE`. Si activación
o perfil no pueden inspeccionarse no se inventa ninguno de esos errores: un
error estructural C detectable gobierna primero y, si no existe, gobierna
`HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID`.

La matriz R3 añade `12` casos y eleva la prueba focalizada de `89` a `101`
pruebas. Combina:

1. activación inválida con flags C, `extras` y flags A/B revocados;
2. perfil legacy con flags C y flags A/B revocados;
3. C `ALL-ON`, múltiples reglas C y C2 individual con A/B hostil;
4. flag C desconocido con A/B hostil;
5. accessors hostiles de activación o perfil, con y sin error estructural C.

Cada caso fija el único error gobernante, listas controladas vacías, fallback
legacy, ausencia de C1, ausencia de excepciones, traps alcanzados cuando son
aplicables y descriptores de entrada sin mutación. La precedencia final queda
anclada en el orden literal documentado en «Precedencia determinista».

Una primera pasada R04-R3 aprobó las cinco puertas con `101/101`, `240/240`,
`674/674`, `95/95` y `844/844` pruebas. A continuación se reforzó la acreditación
de los proxies revocables para demostrar que el trap se alcanza durante la
inspección y que el proxy queda revocado. Las cinco puertas definitivas R04-R3
utilizaron Vitest `v4.1.10`:

| Puerta R3 | Inicio | Duración | Suites | Pruebas | Fallos | Código |
| --- | --- | --- | --- | --- | --- | --- |
| R3 focalizada | `02:01:38` | `3.36 s` | `1/1` | `101/101` | `0` | `0` |
| R3 política + registro | `02:01:55` | `2.90 s` | `2/2` | `240/240` | `0` | `0` |
| C completa | `02:02:10` | `16.77 s` | `9/9` | `674/674` | `0` | `0` |
| Regresión R02/R03 | `02:02:37` | `9.76 s` | `4/4` | `95/95` | `0` | `0` |
| Engine V2 completa | `02:03:00` | `20.07 s` | `20/20` | `844/844` | `0` | `0` |

R04-R3 no registró ningún incidente `spawn EPERM`. Permanecen documentados los
incidentes anteriores: el antecedente R04-R0 con `0` suites y `0` pruebas y el
antecedente R04-R2 con `0` suites y `0` pruebas. También se conservan las
ejecuciones de código R04-R0 con `176/178` y R04-R1 con `66/68`, junto con sus
correcciones y repeticiones finales aprobadas.

C1 continúa siendo un guard, `productionIntegration` continúa en `false`,
Base44 permanece fuera del alcance, no existe sew-out acreditado y no se afirma
ninguna mejora física. R04-R3 no incluye commit, push, PR ni publicación.

## Brecha histórica

Los informes C1, C2 y C3 citan el archivo histórico:

```text
src/lib/engineV2/__tests__/hatchCContourLastIntegration.test.js
```

Ese archivo no existe ni está versionado en el HEAD inicial de R04. La regresión
vigente es `hatchCContourLastR1.test.js`; los resultados antiguos vinculados al
archivo ausente se conservan únicamente como antecedente administrativo.

## Limitaciones

- No existe sew-out acreditado.
- No existe nueva evidencia física.
- No se afirma mejora física, de registro o densidad.
- No se afirma reducción de puntadas, jumps, trims, comandos o cambios de hilo.
- No se implementan cutout, underlap, booleanas geométricas ni exportación.
- Base44 y `engineV2Bridge` permanecen fuera del alcance.
- R04 no activa integración productiva.
