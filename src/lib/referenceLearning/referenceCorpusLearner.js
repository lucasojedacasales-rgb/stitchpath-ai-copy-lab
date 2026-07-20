/**
 * referenceCorpusLearner.js — Reference Learning Engine v2 — RUN_REFERENCE_LEARNING
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador principal: procesa TODOS los archivos de referencia subidos y
 * extrae conocimiento técnico profesional real (no simulado).
 *
 * Flujo:
 *   archivos DST/DSB buenos → parsear comandos → dividir en bloques técnicos →
 *   extraer métricas → detectar patrones → minar reglas → crear perfiles →
 *   guardar conocimiento → permitir aplicar al Professional Mode.
 *
 * learnFromReferenceCorpus(parsedFiles, onProgress) es la acción ejecutable
 * que dispara el botón "🧠 APRENDER DEL CORPUS". Lee-only respecto al motor:
 * produce reglas/perfiles, no toca encoders ni la regresión.
 */

import { buildReferenceCorpus, summarizeCorpus } from './referenceCorpus';
import { mineProfessionalRules, rulesByCategory } from './professionalRuleMiner';
import { generateLearnedProfiles } from './learnedProfessionalProfiles';
import { mineDensityAngleCompensationRules } from './densityAngleCompensationMiner';
import { applyLearnedProfileToMotor } from './applyLearnedProfileToMotor';
import { generateReferenceLearningEngineReport } from './referenceLearningEngineReport';
import { selectBestLearnedProfileForCurrentDesign } from './referenceDesignSelector';
import { compareCurrentDesignToLearnedCorpus } from './referenceDesignComparator';
import { buildProfessionalPresetFromLearnedProfile } from './learnedPresetBuilder';

const PHASE_LABELS = {
  parsing: 'Analizando archivo',
  building_corpus: 'Construyendo corpus técnico',
  mining_rules: 'Minando reglas profesionales',
  generating_profiles: 'Generando perfiles aprendidos',
  summarizing: 'Calculando estadísticas globales',
  presets: 'Generando presets de motor recomendados',
  report: 'Generando informe de aprendizaje',
  done: 'Aprendizaje completado',
};

const BLOCK_TYPES = [
  'fill_tatami', 'satin_border', 'running_outline', 'double_run_detail',
  'underlay', 'travel_jump', 'detail_block', 'dense_fill', 'loose_fill',
  'color_change_block', 'unknown',
];

/**
 * @param {Array<object>} parsedFiles — cada uno de referenceFileParser.parseReferenceFile
 *   (con .commands, .metadata, .filename, .format)
 * @param {(progress: object) => void} [onProgress]
 * @returns {Promise<object>} resultado del aprendizaje
 */
export async function learnFromReferenceCorpus(parsedFiles, onProgress, embeddedProject = null) {
  const files = Array.isArray(parsedFiles) ? parsedFiles : [];
  const total = files.length;
  if (total === 0) {
    return { error: 'Sube archivos DST/DSB antes de aprender.' };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const failedFiles = [];
  const validParsed = [];

  // FASE 1 — parsear/validar cada archivo (uno a uno, con progreso)
  for (let i = 0; i < files.length; i++) {
    const p = files[i];
    onProgress?.({
      phase: 'parsing',
      label: PHASE_LABELS.parsing,
      index: i + 1,
      total,
      filename: p?.filename || `archivo_${i + 1}`,
      percent: Math.round(((i) / total) * 100),
    });
    await tick();
    if (!p || !p.commands || p.commands.length === 0) {
      failedFiles.push({ filename: p?.filename || `archivo_${i + 1}`, reason: 'Sin comandos decodificables' });
      continue;
    }
    validParsed.push(p);
  }

  if (validParsed.length === 0) {
    return {
      error: 'Ningún archivo pudo parsearse. Sube archivos DST/DSB válidos.',
      totalFiles: total, validFiles: 0, failedFiles,
    };
  }

  // FASE 2 — construir corpus (divide en bloques técnicos + métricas)
  onProgress?.({ phase: 'building_corpus', label: PHASE_LABELS.building_corpus, percent: 30 });
  await tick();
  const corpus = buildReferenceCorpus(validParsed);

  // FASE 3 — minar reglas profesionales
  onProgress?.({ phase: 'mining_rules', label: PHASE_LABELS.mining_rules, percent: 55 });
  await tick();
  const learnedRules = mineProfessionalRules(corpus);

  // FASE 4 — crear perfiles aprendidos
  onProgress?.({ phase: 'generating_profiles', label: PHASE_LABELS.generating_profiles, percent: 70 });
  await tick();
  const learnedProfiles = generateLearnedProfiles(corpus, learnedRules);

  // FASE 5 — estadísticas globales + conteo de bloques
  onProgress?.({ phase: 'summarizing', label: PHASE_LABELS.summarizing, percent: 82 });
  await tick();
  const corpusSummary = summarizeCorpus(corpus);
  const dac = mineDensityAngleCompensationRules(corpus);
  const blockCounts = aggregateBlockCounts(corpus);
  const globalProfessionalStats = buildGlobalStats(corpus, corpusSummary, dac, blockCounts);

  // FASE 6 — presets de motor recomendados por perfil
  onProgress?.({ phase: 'presets', label: PHASE_LABELS.presets, percent: 90 });
  await tick();
  const recommendedMotorPresets = buildRecommendedPresets(learnedProfiles, learnedRules);

  // FASE 7 — informe markdown
  // Si hay un diseño activo (embeddedProject), comparar contra el corpus y
  // seleccionar perfil automáticamente para que el informe tenga secciones 5 y 6.
  onProgress?.({ phase: 'report', label: PHASE_LABELS.report, percent: 96 });
  await tick();
  let comparison = null;
  let appliedProfile = null;
  let appliedPatch = null;
  let designName = null;
  if (embeddedProject && embeddedProject.commands && embeddedProject.commands.length > 0) {
    designName = embeddedProject.name || 'Diseño actual';
    const selection = selectBestLearnedProfileForCurrentDesign(
      embeddedProject.regions || [], embeddedProject.commands, learnedProfiles
    );
    if (selection.selectedProfile) {
      comparison = compareCurrentDesignToLearnedCorpus(
        embeddedProject.commands, embeddedProject.regions || [],
        selection.selectedProfile, learnedRules, corpusSummary
      );
      comparison.selectedProfile = selection.selectedProfile;
      comparison.confidence = selection.confidence;
      appliedProfile = selection.selectedProfile;
      appliedPatch = buildProfessionalPresetFromLearnedProfile(selection.selectedProfile, learnedRules);
    }
  }
  const learningReportMarkdown = generateReferenceLearningEngineReport({
    corpus,
    rules: learnedRules,
    profiles: learnedProfiles,
    comparison,
    appliedProfile,
    appliedPatch,
    designName,
  });

  onProgress?.({ phase: 'done', label: PHASE_LABELS.done, percent: 100 });

  return {
    corpusSummary,
    fileAnalyses: corpus,          // entries con technicalBlocks, metrics, etc.
    learnedRules,
    learnedProfiles,
    globalProfessionalStats,
    recommendedMotorPresets,
    learningReportMarkdown,
    // contadores resumen
    totalFiles: total,
    validFiles: corpus.length,
    failedFiles,
    blockCounts,
    dacSummary: dac.summary,
    generatedAt: new Date().toISOString(),
    corpusVersion: 2,
  };
}

// ── Agregación de bloques técnicos ──────────────────────────────────────────
function aggregateBlockCounts(corpus) {
  const counts = {};
  for (const t of BLOCK_TYPES) counts[t] = 0;
  let total = 0;
  for (const e of corpus) {
    for (const b of e.technicalBlocks || []) {
      const t = b.blockType || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
      total++;
    }
  }
  // roles adicionales
  const roles = { fill: 0, underlay: 0, outline_outer: 0, outline_inner: 0, detail: 0, travel: 0 };
  for (const e of corpus) {
    for (const b of e.technicalBlocks || []) {
      const r = b.probableRole;
      if (roles[r] !== undefined) roles[r]++;
    }
  }
  return { byType: counts, byRole: roles, total };
}

function buildGlobalStats(corpus, summary, dac, blockCounts) {
  const avg = summary ? summary.avg : {};
  return {
    fileCount: corpus.length,
    blockCount: blockCounts.total,
    blockCounts,
    avgStitchCount: avg.stitchCount || 0,
    avgColorCount: avg.colorCount || 0,
    avgJumpCount: avg.jumpCount || 0,
    avgTrimCount: avg.trimCount || 0,
    avgDensity: avg.estimatedDensity || 0,
    avgShortStitchRatio: avg.shortStitchRatio || 0,
    avgDuplicateRatio: avg.duplicateRatio || 0,
    avgLongVisibleStitchRatio: avg.longVisibleStitchRatio || 0,
    avgTrimDensity: avg.trimDensity || 0,
    patternFreq: summary ? summary.patternFreq : {},
    dacSummary: dac.summary,
  };
}

function buildRecommendedPresets(profiles, rules) {
  return profiles.map((p) => ({
    profileId: p.name,
    profileLabel: p.label,
    matchedFiles: (p.matchedFiles || []).length,
    motorPatch: applyLearnedProfileToMotor(p, rules),
  }));
}

export { PHASE_LABELS };