# SIMULATION_TAB_TRUTH_FIX_REPORT_V1

> Fecha: 2026-07-05  
> Alcance: pestaña Simular  
> Tipo: UI + alineación de fuente de comandos  
> Restricción: no se toca motor ni exportación

---

## Resultado

| Campo | Estado |
|---|---:|
| machineSimulatorUsesFinalCommands | true |
| simulationRebuildFallbackOnly | true |
| simulationReportReadOnly | true |
| autoFixButtonRemoved | true |
| runRepairEngineRemovedFromSimulationPanel | true |
| onRegionsRepairedNotCalledFromSimulation | true |
| simulationMatchesFinalCommands | true |
| finalCommandsPassedFromEditor | true |
| exportRepairFlowUnchanged | true |
| motorFilesUnchanged | true |
| exportLogicUnchanged | true |

---

## Cambios aplicados

### MachineSimulator

MachineSimulator ahora acepta:

- finalCommands
- finalObjects
- commandSourceLabel

Si finalCommands existe y tiene longitud:

- usa finalCommands como secuencia de simulación
- usa finalObjects como objetos asociados
- marca commandSourceUsed=finalEmbroideryCommands
- no reconstruye con buildStitchObjects + flattenToCommands

Solo usa buildStitchObjects + flattenToCommands como fallback si finalCommands no existe o está vacío.

---

### Editor.jsx

La pestaña Simular pasa a MachineSimulator:

- finalCommands={finalEmbroideryCommands.commands}
- finalObjects={finalEmbroideryCommands.objects}
- commandSourceLabel="finalEmbroideryCommands"

Esto alinea Simular con Final Look y Export.

---

### Aviso de verdad en Simular

Se añadió aviso visible:

**Simulación basada en comandos finales**

> Esta vista usa la misma secuencia que Final Look. La reparación real se hace desde Exportar → Reparar y validar.

También se muestran métricas de coherencia:

- simulationCommandCount
- finalCommandCount
- commandSourceUsed
- simulationMatchesFinalCommands

---

### SimulationReportPanel

SimulationReportPanel queda como panel solo lectura.

Se eliminó:

- runRepairEngine
- estado de reparación local
- botón “Reparar zonas afectadas y resimular”
- llamada a onRegionsRepaired
- promesa de reparación desde Simular

Se sustituyó por el aviso:

**Reparación disponible en Exportar**

> Para corregir errores reales del archivo, usa Exportar → Reparar y validar. La pestaña Simular es solo una vista previa de reproducción.

---

## Contrato de no modificación

No se tocó:

- motor de digitalización
- buildFinalCommands
- applyProfessionalPipeline
- professionalDigitizingMode
- ExportModal
- getEffectiveExportCommands
- handleExport
- V5.1 export repair
- Travel Polish
- Safe Tie V2
- SATIN / Trim Guard / Splitter / Underlay
- DST encoder
- DSB encoder
- CE01 validator
- Reference Learning logic

---

## Veredicto

SIMULATION_TAB_TRUTH_FIX_V1 aplicado correctamente: Simular ahora reproduce la misma fuente final que Final Look / Export y ya no promete reparaciones paralelas.