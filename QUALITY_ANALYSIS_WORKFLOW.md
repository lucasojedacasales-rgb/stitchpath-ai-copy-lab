# Workflow: Análisis de Calidad + Auto-Ajuste Automático

## ¿Qué hace el sistema?

El sistema **recopila datos de cada digitización exitosa** y entrena los motores para auto-ajustarse automáticamente en futuros proyectos similares.

```
Digitización 1 → Análisis → DigitizationDecision (guardado)
Digitización 2 → Análisis → DigitizationDecision (guardado)
...
Digitización N → trainAutoAdjustment() → Reglas dinámicas compiladas
                                         ↓
Próximo Proyecto → Aplicar reglas automáticamente → Resultado óptimo
```

---

## 1. FASE: ANÁLISIS DE CALIDAD (Inmediatamente después de digitalizar)

### Ubicación
**Left Panel** → "Análisis de Calidad" (debajo de ConfigPanel)

### Botones
- **"Analizar"**: Ejecuta `analyzeDigitizationQuality(project_id)`
- **"Entrenar IA"**: Ejecuta `trainAutoAdjustment()` para compilar reglas

### Qué Genera el Análisis

```javascript
{
  success: true,
  decision_id: "6a4328229a7ba294f6c5cdad",
  analysis: {
    detail_visibility: "HIGH",      // ¿Se detectaron detalles finos?
    color_separation: "GOOD",       // ¿Se separaron bien los colores?
    layer_integrity: "PERFECT",     // ¿Están fills antes de contornos?
    stitch_distribution: "UNEVEN",  // ¿Es el espaciado parejo?
    overall_rating: 7               // Puntuación final (0-10)
  },
  summary: {
    total_regions: 42,
    avg_quality: 7,
    recommendations: [
      "Increase max_colors in K-means clustering",
      "Consider adaptive density scaling"
    ]
  }
}
```

### Interpretación de Métricas

| Métrica | HIGH/EXCELLENT | MEDIUM/GOOD | LOW/POOR |
|---------|---|---|---|
| **detail_visibility** | Detalles < 10mm² detectados | Algunos detalles pequeños | Detalles finos perdidos |
| **color_separation** | 0 colores duplicados | 1-2 duplicados | > 2 duplicados |
| **layer_integrity** | Fills priority ≤ Satins | Mostly correct | Desordenado |
| **stitch_distribution** | CV < 1.0 | CV 1-2 | CV > 2 |

---

## 2. FASE: DECISIÓN (¿Qué hacer si rating < 8?)

### SI overall_rating ≥ 8 → ✓ LISTO PARA PRODUCCIÓN

```
✓ El diseño está digitalizado profesionalmente
✓ No necesita refinamientos
✓ Se puede exportar a máquina
```

### SI 6 ≤ overall_rating < 8 → ⚠ REFINAMIENTOS SUGERIDOS

1. **Identificar métrica baja** (detail_visibility, color_separation, etc.)
2. **Aplicar dinámica rule** correspondiente (ver tabla abajo)
3. **Re-correr pipeline** con parámetros ajustados
4. **Re-analizar** hasta rating ≥ 8

### SI overall_rating < 6 → ❌ REVISIÓN MANUAL

Posibles causas:
- Imagen muy baja resolución
- Imagen demasiado compleja / ambigua
- Configuración inicial muy desajustada

**Acciones**:
1. Revisar imagen (¿ruido? ¿compresión mala?)
2. Ajustar config manualmente (mode, width, height, color_count)
3. Re-digitalizar

---

## 3. TABLA: DYNAMIC RULES (Automáticas)

### Rule 1: detail_visibility = LOW

**Síntoma**: Ojos, nariz, detalles finos no se detectan.

**Acciones automáticas**:
```javascript
minAreaPx: 60 → 45 (20% menos)
minAreaRelative: 0.00015 → 0.0001 (30% menos)
enable_sub_pixel_refinement: true
chaikinPasses: 3 → 4
```

**Cuándo se activa**:
- tiny_regions (area < 5mm²) < 3
- O corner_count promedio < 6

---

### Rule 2: color_separation = POOR

**Síntoma**: Colores iguales o muy similares se fusionan en una región.

**Acciones automáticas**:
```javascript
maxColors: 8 → 10 (aumentar +2, cap 16)
// Mantener Lab color space (ya activo)
// Aplicar post-processing color threshold
```

**Cuándo se activa**:
- duplicate_colors > 2
- O saturación promedio > 0.8

---

### Rule 3: layer_integrity = ISSUES

**Síntoma**: Contornos se dibujan ANTES de fills (tapar o desorden).

**Acciones automáticas**:
```javascript
// Re-asignar priority automáticamente:
for (region in regions) {
  if (region.stitch_type == 'fill')       priority = 1
  if (region.stitch_type == 'satin')      priority = 5
  if (region.stitch_type == 'running')    priority = 8
}
```

**Cuándo se activa**:
- max(priority_fill) > min(priority_satin)

---

### Rule 4: stitch_distribution = UNEVEN

**Síntoma**: Ciertas regiones tienen muchos más stitches que otras.

**Acciones automáticas**:
```javascript
// Densidad adaptativa:
for (region in regions) {
  base_density = config.tatami_density
  
  if (area_mm2 < 20) {
    density = base_density * 1.5  // Más denso para detalles
  } else if (area_mm2 > 500) {
    density = base_density * 0.8  // Menos denso para fills grandes
  } else {
    density = base_density         // Normal
  }
}
```

**Cuándo se activa**:
- Coefficient of variation (CV) > 1.5

---

## 4. FLUJO COMPLETO: Ejemplo Práctico

### Paso 1: Digitalizar un nuevo design (Flor)
```
1. Subir imagen flor.png
2. Configurar: 50mm × 50mm, algodón, hybrid mode
3. Click "Procesar"
4. Pipeline genera 38 regiones
```

### Paso 2: Analizar Calidad
```
1. Left panel → "Análisis de Calidad"
2. Click "Analizar"
   ↓ genera DigitizationDecision
   detail_visibility: MEDIUM  ❌ (pétalos pequeños no visibles)
   color_separation: EXCELLENT ✓
   layer_integrity: PERFECT ✓
   stitch_distribution: BALANCED ✓
   overall_rating: 6 ⚠
```

### Paso 3: Auto-ajuste Automático
```
Sistema detecta: detail_visibility = MEDIUM
Aplica Rule 1:
  minAreaPx: 60 → 45
  minAreaRelative: 0.00015 → 0.0001
  chaikinPasses: 3 → 4

UI sugiere: "Aplicar ajustes y re-digitalizar"
```

### Paso 4: Re-digitalizar
```
1. Click "Procesar" nuevamente (con parámetros ajustados)
2. Pipeline genera 42 regiones (4 pétalos finos nuevos)
3. Click "Analizar"
   ↓
   detail_visibility: HIGH ✓
   overall_rating: 8 ✓✓✓
   
Panel sugiere: "Listo para producción ✓"
```

---

## 5. TRAINING: Compilar Reglas Globales

**Después de 3-5 digitizaciones exitosas**:

1. Click **"Entrenar IA"** en Quality Analysis Panel
2. `trainAutoAdjustment()` analiza todos los DigitizationDecisions
3. Genera tabla de patrones:

```javascript
{
  design_size_distribution: {
    avg_width: 85.3,
    avg_height: 87.6,
    min_width: 50,
    max_width: 150,
  },
  successful_settings: {
    avg_min_area_px: 58,
    avg_max_colors: 8.2,
    satin_compact_threshold: 0.31,
    thread_diameter_mm: 0.32,
  },
  recommendations: [
    "Design < 50mm²: use character_cartoon preset",
    "Design > 500mm²: increase max_colors to 12",
    "tiny_regions > 10: enable sub-pixel refinement",
  ]
}
```

4. Este output **automáticamente actualiza los defaults** del pipeline

---

## 6. UI PANEL: QualityAnalysisPanel

```
┌─────────────────────────────────────┐
│ Análisis de Calidad                  │
├─────────────────────────────────────┤
│ [Analizar]  [Entrenar IA]            │
│                                      │
│ Rating General: [8/10] ✓             │
│                                      │
│ Detalles:      HIGH          ✓       │
│ Colores:       EXCELLENT     ✓       │
│ Capas:         PERFECT       ✓       │
│ Distribución:  BALANCED      ✓       │
│                                      │
│ "Listo para producción"              │
│                                      │
│ Recomendaciones:                     │
│ • Diseño está digitizado a nivel     │
│   profesional                        │
│ • Sin refinamientos necesarios       │
│                                      │
│ ✓ Análisis completado — 42 regiones  │
└─────────────────────────────────────┘
```

---

## 7. GUARDAR & EXPORTAR DECISIÓN

Cada análisis genera un DigitizationDecision entity:

```json
{
  "design_name": "Yoshi",
  "digitize_mode": "hybrid",
  "region_count": 42,
  "total_stitches": 6297,
  "engine_decisions": {
    "contour_engine": { minAreaPx: 60, maxColors: 8, ... },
    "region_builder": { satin_compact_wide: 0.3, ... },
    "renderer": { canvas_background: "#4a4a4a", ... }
  },
  "quality_assessment": {
    "detail_visibility": "HIGH",
    "color_separation": "EXCELLENT",
    "layer_integrity": "PERFECT",
    "overall_rating": 8,
    "notes": "Professional digitization ready for production"
  },
  "improvements_applied": [
    { change: "Implemented geometric compactness classification", impact: "CRITICAL" }
  ],
  "lessons_learned": {
    "what_worked": [...],
    "what_failed": [...],
    "optimal_settings_for_design_type": "Character/cartoon designs: maxColors=8, minAreaPx=60"
  }
}
```

Cada decisión se **guarda automáticamente en la BD** (DigitizationDecision).
El sistema las usa para entrenar próximos ajustes.

---

## 8. PRÓXIMOS DESIGNS: AUTO-AJUSTE

Cuando digitalices un nuevo proyecto **similar** (ej, otro cartoon):

```
1. Sistema detecta: "Design 70mm×70mm, cartoon style"
2. Busca en DigitizationDecisions históricos
3. Encuentra settings óptimos previos (minAreaPx=60, maxColors=8)
4. Auto-aplica esos parámetros
5. Resultado: rating 8+ en primer intento ✓
```

Sin necesidad de manual tuning.

---

## RESUMEN: Ciclo Completo

```
┌─────────────────────────────────────────────────────────────┐
│ DIGITIZACIÓN                                                 │
│ (Subir imagen → Procesar → 42 regiones generadas)           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ ANÁLISIS (Quality Panel)                                     │
│ → detail_visibility: HIGH, rating: 8/10                      │
│ → DigitizationDecision guardado                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
         ¿Rating >= 8?
                 │
        ┌────────┴────────┐
        │                 │
       SÍ                NO
        │                 │
        ↓                 ↓
    ✓ LISTO         Aplicar reglas
    PRODUCCIÓN      dinámicas
                        │
                        ↓
                   Re-digitalizar
                        │
                        ↓
                    Re-analizar
                        │
                        └──→ (loop hasta ✓)
                        
        ↓ (después de 5+ exitosas)
        
┌─────────────────────────────────────────────────────────────┐
│ ENTRENAMIENTO (Click "Entrenar IA")                          │
│ → Compilar patrones de todos los DigitizationDecisions       │
│ → Generar auto-ajuste rules para próximos proyectos          │
│ → Auto-apply en diseños similares                            │
└─────────────────────────────────────────────────────────────┘
```

---

## CONCLUSIÓN

El sistema **cierra el loop**: documentar → entrenar → automatizar.

Cada digitización enseña al pipeline.
Próximo proyecto similar: **resultado perfecto automático**, sin tuning manual.

✓ **Sistema completamente funcional y documentado**.