/**
 * Digitize Mode Strategies
 * Each mode is a complete pipeline strategy, not just a parameter set.
 * Controls: preprocessing, vectorization, AI usage, stitch generation.
 */

export const DIGITIZE_MODES = {
  fast: {
    id: 'fast',
    name: 'Modo Rápido',
    icon: '⚡',
    tagline: 'Velocidad máxima',
    description: 'Menos regiones, curvas simplificadas. Ideal para prototipos o diseños simples.',
    color: 'amber',

    // Preprocessing: minimal — just enough to get clean colors
    preprocess: {
      enabled: true,
      gaussianRadius: 1.5,
      contrastBoost: 1.3,
      saturationBoost: 1.4,
      sharpenEdges: false,
      sharpenStrength: 0,
      outputSize: 512,          // small = fast
      posterizeColors: true,
      posterizeLevels: 4,        // fewer levels = fewer regions
      morphologyCleanup: false,
    },

    // Vectorization: aggressive simplification
    vectorizer: {
      color_count: 4,            // fewer colors = fewer regions
      rdpEpsilon: 0.008,         // more aggressive simplification
      minPixelArea: 800,         // only large blobs
      smoothPasses: 1,
    },

    // Backend / AI
    backend: {
      mode: 'standard',
      use_ia_vision: false,      // no AI — pure geometry
      use_full_bg: false,
      vector_engine: 'potrace',  // fastest engine
      tatami_density: 0.6,       // loose fill — fewer stitches
      max_regions: 30,
    },

    // Stitch strategy
    stitchStrategy: {
      preferFillOverSatin: true,
      underlayEnabled: false,
      adaptiveAngles: false,
      travelOptimize: false,
      useAdaptiveEngine: false,   // fast mode: skip engine for speed
    },

    badge: null,
    recommended_for: ['logos', 'texto', 'diseños simples', 'pruebas rápidas'],
  },

  standard: {
    id: 'standard',
    name: 'Modo Estándar',
    icon: '◎',
    tagline: 'Balance calidad/velocidad',
    description: 'Pipeline equilibrado. Buena calidad sin tiempo excesivo.',
    color: 'slate',

    preprocess: {
      enabled: true,
      gaussianRadius: 1,
      contrastBoost: 1.4,
      saturationBoost: 1.6,
      sharpenEdges: true,
      sharpenStrength: 0.8,
      outputSize: 768,
      posterizeColors: true,
      posterizeLevels: 6,
      morphologyCleanup: true,
    },

    vectorizer: {
      color_count: 6,
      rdpEpsilon: 0.004,
      minPixelArea: 200,
      smoothPasses: 2,
    },

    backend: {
      mode: 'standard',
      use_ia_vision: false,
      use_full_bg: false,
      vector_engine: 'hybrid',
      tatami_density: 0.4,
      max_regions: 80,
    },

    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: false,
      travelOptimize: false,
      useAdaptiveEngine: true,
    },

    badge: null,
    recommended_for: ['bordados generales', 'camisetas', 'gorras'],
  },

  precision: {
    id: 'precision',
    name: 'Modo Precisión',
    icon: '◈',
    tagline: 'Máximo detalle geométrico',
    description: 'Curvas muy refinadas, más regiones, ángulos PCA por región, underlay inteligente. Sin IA generativa.',
    color: 'cyan',

    preprocess: {
      enabled: true,
      gaussianRadius: 0.5,       // minimal blur = preserve edges
      contrastBoost: 1.6,
      saturationBoost: 1.9,
      sharpenEdges: true,
      sharpenStrength: 1.2,      // strong sharpen
      outputSize: 1024,
      posterizeColors: true,
      posterizeLevels: 8,        // more levels = more detail
      morphologyCleanup: true,
    },

    vectorizer: {
      color_count: 10,
      rdpEpsilon: 0.003,         // fine simplification (raised from 0.002 — prevents micro-fragments)
      minPixelArea: 150,         // raised from 60 — filters noise while keeping real small details
      smoothPasses: 3,
    },

    backend: {
      mode: 'precision',
      use_ia_vision: false,
      use_full_bg: false,
      vector_engine: 'hybrid',
      tatami_density: 0.3,       // dense fill
      max_regions: 150,
    },

    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: true,
      travelOptimize: true,
      useAdaptiveEngine: true,
    },

    badge: null,
    recommended_for: ['retratos', 'animales', 'ilustraciones complejas'],
  },

  hybrid: {
    id: 'hybrid',
    name: 'Modo Híbrido',
    icon: '✦',
    tagline: 'Geometría + IA Claude',
    description: 'Vectorización geométrica precisa enriquecida con análisis visual de IA para nombrar y clasificar cada región.',
    color: 'violet',

    preprocess: {
      enabled: true,
      gaussianRadius: 1,
      contrastBoost: 1.5,
      saturationBoost: 1.8,
      sharpenEdges: true,
      sharpenStrength: 0.9,
      outputSize: 1024,
      posterizeColors: true,
      posterizeLevels: 6,
      morphologyCleanup: true,
    },

    vectorizer: {
      color_count: 8,
      rdpEpsilon: 0.003,
      minPixelArea: 120,         // raised from 80 — aligns with contourEngine default minAreaPx
      smoothPasses: 2,
    },

    backend: {
      mode: 'hybrid',
      use_ia_vision: true,       // Claude labels regions
      use_full_bg: false,
      vector_engine: 'hybrid',
      tatami_density: 0.4,
      max_regions: 150,
    },

    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: true,
      travelOptimize: false,
      useAdaptiveEngine: true,
    },

    badge: 'Recomendado',
    recommended_for: ['cualquier diseño', 'mejor relación calidad/tiempo'],
  },

  ultra: {
    id: 'ultra',
    name: 'Modo Ultra',
    icon: '◉',
    tagline: 'Pipeline completo IA',
    description: 'Segmentación IA completa, refinado subpíxel, ajuste Bézier adaptativo, ángulos PCA, underlay inteligente y optimización de recorrido.',
    color: 'emerald',

    preprocess: {
      enabled: true,
      gaussianRadius: 0.5,
      contrastBoost: 1.7,
      saturationBoost: 2.0,
      sharpenEdges: true,
      sharpenStrength: 1.4,
      outputSize: 2048,          // max resolution
      posterizeColors: true,
      posterizeLevels: 10,
      morphologyCleanup: true,
    },

    vectorizer: {
      color_count: 12,
      rdpEpsilon: 0.002,         // fine — raised from 0.001 (sub-pixel epsilon → oversegmentation)
      minPixelArea: 80,          // raised from 30 — micro-detail threshold that doesn't pass noise
      smoothPasses: 3,           // reduced from 4 — 3 passes sufficient, 4th adds no visual quality
    },

    backend: {
      mode: 'ultra',
      use_ia_vision: true,
      use_full_bg: true,         // full background analysis
      vector_engine: 'hybrid',
      tatami_density: 0.25,      // ultra-dense fill
      max_regions: 200,
    },

    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: true,
      travelOptimize: true,
      bezierFitting: true,
      subpixelRefine: true,
      useAdaptiveEngine: true,
    },

    badge: 'Ultra',
    recommended_for: ['retratos detallados', 'arte complejo', 'producción profesional'],
  },

  ai: {
    id: 'ai',
    name: 'AI Mode',
    icon: '🧠',
    tagline: 'Segmentación inteligente',
    description: 'IA detecta regiones automáticamente, clasifica tipos de puntada y optimiza la paleta de colores.',
    color: 'violet',
    preprocess: {
      enabled: true,
      gaussianRadius: 1,
      contrastBoost: 1.5,
      saturationBoost: 1.8,
      sharpenEdges: true,
      sharpenStrength: 1.0,
      outputSize: 1024,
      posterizeColors: true,
      posterizeLevels: 8,
      morphologyCleanup: true,
    },
    vectorizer: { color_count: 8, rdpEpsilon: 0.003, minPixelArea: 120, smoothPasses: 2 },
    backend: {
      mode: 'hybrid',
      use_ia_vision: true,
      use_full_bg: false,
      vector_engine: 'hybrid',
      tatami_density: 0.4,
      max_regions: 150,
    },
    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: true,
      travelOptimize: true,
      useAdaptiveEngine: true,
    },
    params: {
      ai_segmentation: true,
      auto_stitch_classification: true,
      color_optimization: true,
      smart_sequencing: true,
      confidence_threshold: 0.8,
    },
    badge: 'New',
    recommended_for: ['Automático', 'Análisis visual', 'Optimización IA'],
  },

  intelligent: {
    id: 'intelligent',
    name: 'Modo Inteligente',
    icon: '✨',
    tagline: 'Motor adaptativo automático',
    description: 'Analiza tu diseño y aplica el motor óptimo para cada región: rápido para bordes simples, precisión para detalles finos, IA para regiones complejas.',
    color: 'violet',
    preprocess: {
      enabled: true,
      gaussianRadius: 1,
      contrastBoost: 1.5,
      saturationBoost: 1.8,
      sharpenEdges: true,
      sharpenStrength: 1.0,
      outputSize: 1024,
      posterizeColors: true,
      posterizeLevels: 8,
      morphologyCleanup: true,
    },
    vectorizer: { color_count: 8, rdpEpsilon: 0.003, minPixelArea: 120, smoothPasses: 2 },
    backend: {
      mode: 'hybrid',
      use_ia_vision: true,
      use_full_bg: false,
      vector_engine: 'hybrid',
      tatami_density: 0.4,
      max_regions: 150,
    },
    stitchStrategy: {
      preferFillOverSatin: false,
      underlayEnabled: true,
      adaptiveAngles: true,
      travelOptimize: true,
      useAdaptiveEngine: true,
    },
    params: {
      adaptive: true,
      auto_select_engine: true,
      region_analysis: true,
      smart_merge: true,
    },
    badge: 'Smart',
    recommended_for: ['Automático', 'Máxima calidad', 'Sin configurar'],
  },
};

/** Returns the strategy object for a given mode id */
export function getModeStrategy(modeId) {
  return DIGITIZE_MODES[modeId] || DIGITIZE_MODES.hybrid;
}

/** Maps a mode's color name to Tailwind class fragments */
export const MODE_COLORS = {
  amber:  { border: 'border-amber-500/60',  bg: 'bg-amber-900/20',  text: 'text-amber-300',  badge: 'bg-amber-600/30 text-amber-300 border-amber-500/30' },
  slate:  { border: 'border-slate-500/60',  bg: 'bg-slate-900/20',  text: 'text-slate-300',  badge: 'bg-slate-600/30 text-slate-300 border-slate-500/30'  },
  cyan:   { border: 'border-cyan-500/60',   bg: 'bg-cyan-900/20',   text: 'text-cyan-300',   badge: 'bg-cyan-600/30 text-cyan-300 border-cyan-500/30'     },
  violet: { border: 'border-violet-500/60', bg: 'bg-violet-900/20', text: 'text-violet-300', badge: 'bg-violet-600/30 text-violet-300 border-violet-500/30' },
  emerald:{ border: 'border-emerald-500/60',bg: 'bg-emerald-900/20',text: 'text-emerald-300',badge: 'bg-emerald-600/30 text-emerald-300 border-emerald-500/30' },
};