/**
 * Machine Validator — Industrial Embroidery Executability Assessment
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates whether a design can be physically sewn on a home machine (Caydo CE01).
 *
 * PRINCIPLE: Status is based on EXPORTABLE STITCH COMMANDS, not visual geometry.
 * Visual geometry (node count, curve density) generates non-blocking warnings.
 *
 * Classification:
 *   SAFE    — executable without problems (score ≥ 80, no critical command issues)
 *   RISKY   — may fail or deform (score 40–79)
 *   INVALID — will break or be ignored (score < 40, or critical command issue)
 *
 * Returns:
 *   { status, ce01Ready, score, commandIssues, geometryWarnings,
 *     optimizationSuggestions, issues, recommendation, stats, exportSummary }
 */

import { DEFAULT_MACHINE } from './exportPipeline';

// ─── Thresholds ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  maxNodesPerObject: 200,       // visual — warning only, not blocking
  maxStitchDensityPerMm2: 4,    // stitches per mm² — critical if exceeded
  maxJumpWithoutTrim: 3.5,      // mm — warning above this without trim
  maxJumpPhysical: 12.1,        // mm — DST physical limit (critical)
  maxJumpRisky: 8.0,            // mm — risky jump without trim
  maxStitchLength: 12.1,        // mm
  scoreSafe: 80,
  scoreRisky: 40,
  // El límite anterior de 12000 era demasiado conservador. Se recalibra porque una muestra Wilcom funcional aceptada por CE01 contiene ~33845 puntadas.
  maxStitches: 35000,
  highRiskStitches: 50000,
  hoopW: 100,
  hoopH: 100,
  maxTotalJumpsSafe: 250,       // aligned with ce01Validator (RISKY when >250)
  maxTotalJumpsRisky: 500,      // aligned with ce01Validator
  maxTotalTrimsSafe: 80,        // aligned with ce01Validator (RISKY when >80)
  maxTotalTrimsRisky: 150,      // aligned with ce01Validator
};

// ─── Penalty weights ─────────────────────────────────────────────────────────
const PENALTY = {
  CRITICAL: 25,   // makes design INVALID by itself
  MAJOR: 8,       // significant risk
  MINOR: 1,       // cosmetic / minor concern
  INFO: 0,        // geometry warnings — no deduction
};

const MAX_PENALTY_PER_CATEGORY = 15; // cap deductions per category

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

export function validateForMachine(regions, commands, config = {}, machine = {}) {
  const ms = { ...DEFAULT_MACHINE, ...machine };
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // ── Run all category checks ─────────────────────────────────────────────
  const geomResult = checkGeometry(regions, w, h);      // returns { warnings, suggestions }
  const densityIssues = checkDensity(regions, commands, w, h);
  const jumpIssues = checkJumps(commands, ms);
  const structIssues = checkStructure(regions);
  const trimIssues = checkTrimThreads(commands);

  const commandIssues = [...densityIssues, ...jumpIssues, ...structIssues, ...trimIssues];
  const geometryWarnings = geomResult.warnings;
  const optimizationSuggestions = geomResult.suggestions;

  // ── Compute score (command issues only, geometry warnings don't deduct) ──
  let score = 100;
  let criticalCount = 0;
  const categoryDeduction = {};

  for (const issue of commandIssues) {
    const penalty = PENALTY[issue.severity] || 0;
    if (penalty === 0) continue;
    const cat = issue.category;
    categoryDeduction[cat] = (categoryDeduction[cat] || 0) + penalty;
    if (issue.severity === 'CRITICAL') criticalCount++;
  }

  for (const [cat, ded] of Object.entries(categoryDeduction)) {
    score -= Math.min(ded, MAX_PENALTY_PER_CATEGORY);
  }

  // Any critical command issue caps score at 35
  if (criticalCount > 0) score = Math.min(score, 35);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ── Classify ────────────────────────────────────────────────────────────
  let status;
  if (criticalCount > 0 || score < THRESHOLDS.scoreRisky) status = 'INVALID';
  else if (score >= THRESHOLDS.scoreSafe) status = 'SAFE';
  else status = 'RISKY';

  // ── Logs ────────────────────────────────────────────────────────────────
  console.log(`[ce01-validator] command issues: ${commandIssues.length}`);
  console.log(`[ce01-validator] geometry warnings: ${geometryWarnings.length}`);
  console.log(`[ce01-validator] blocking issues: ${commandIssues.filter(i => i.severity === 'CRITICAL').length}`);
  console.log(`[ce01-validator] score from commands: ${score}`);
  console.log(`[ce01-validator] node count warnings: ${geometryWarnings.filter(g => g.type === 'high_node_count').length}`);
  console.log(`[ce01-validator] final status: ${status}`);
  console.log(`[ce01-validator] export uses commands: true`);

  // ── Recommendation ──────────────────────────────────────────────────────
  const recommendation = buildRecommendation(status, commandIssues, geometryWarnings, score);

  // ── Stats ───────────────────────────────────────────────────────────────
  const totalStitches = commands.filter(c => c.type === 'stitch').length;
  const totalJumps = commands.filter(c => c.type === 'jump').length;
  const totalTrims = commands.filter(c => c.type === 'trim').length;
  const colorChanges = commands.filter(c => c.type === 'colorChange').length;

  const stats = {
    totalObjects: regions.filter(r => r.visible !== false).length,
    totalStitches,
    totalJumps,
    totalTrims,
    colorChanges,
    criticalCount,
    majorCount: commandIssues.filter(i => i.severity === 'MAJOR').length,
    minorCount: commandIssues.filter(i => i.severity === 'MINOR').length,
    geometryWarningCount: geometryWarnings.length,
  };

  // ── Export summary ──────────────────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of commands) {
    if (c.type === 'stitch' || c.type === 'jump') {
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
  }
  const exportSummary = {
    stitches: totalStitches,
    jumps: totalJumps,
    trims: totalTrims,
    colors: colorChanges + 1,
    widthMm: isFinite(minX) ? +(maxX - minX).toFixed(1) : 0,
    heightMm: isFinite(minY) ? +(maxY - minY).toFixed(1) : 0,
    estimatedTime: +(totalStitches / (machine.maxSpeed || 800)).toFixed(2),
  };

  return {
    status,
    ce01Ready: status !== 'INVALID',
    score,
    commandIssues,
    geometryWarnings,
    optimizationSuggestions,
    issues: commandIssues, // backward compat
    recommendation,
    stats,
    exportSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY — visual warnings only (no score deduction)
// ═══════════════════════════════════════════════════════════════════════════

function checkGeometry(regions, w, h) {
  const warnings = [];
  const suggestions = [];

  for (const r of regions) {
    if (r.visible === false) continue;
    const pts = r.path_points || [];
    if (pts.length < 2) continue;

    const mmPts = pts.map(([nx, ny]) => [nx * w, ny * h]);
    let perimeter = 0;
    for (let i = 1; i < mmPts.length; i++) {
      perimeter += Math.hypot(mmPts[i][0] - mmPts[i-1][0], mmPts[i][1] - mmPts[i-1][1]);
    }
    const nodeDensity = pts.length / Math.max(perimeter, 1);

    // High node count — WARNING, not blocking
    if (pts.length > THRESHOLDS.maxNodesPerObject) {
      warnings.push({
        type: 'high_node_count',
        severity: 'medium',
        blocking: false,
        regionId: r.id,
        message: `Región "${r.name || r.id}": ${pts.length} nodos visuales (recomendado ≤${THRESHOLDS.maxNodesPerObject}). Puede simplificarse para rendimiento.`,
      });
      suggestions.push({
        type: 'simplify_geometry',
        regionId: r.id,
        message: `Simplificar "${r.name || r.id}" con RDP ε=1mm para reducir nodos de ${pts.length} a ≤200.`,
      });
    } else if (nodeDensity > 8 && pts.length > 30) {
      warnings.push({
        type: 'high_node_density',
        severity: 'low',
        blocking: false,
        regionId: r.id,
        message: `Región "${r.name || r.id}": densidad de nodos ${nodeDensity.toFixed(1)}/mm — micro-detalles visuales.`,
      });
    }
  }

  return { warnings, suggestions };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DENSITY — command-level (can block)
// ═══════════════════════════════════════════════════════════════════════════

function checkDensity(regions, commands, w, h) {
  const issues = [];
  const totalArea = w * h;
  const totalStitches = commands.filter(c => c.type === 'stitch').length;
  const globalDensity = totalStitches / Math.max(totalArea, 1);

  if (globalDensity > THRESHOLDS.maxStitchDensityPerMm2) {
    issues.push({
      severity: 'CRITICAL',
      category: 'DENSITY',
      rule: 'D1',
      message: `Saturación global: ${globalDensity.toFixed(2)} stitches/mm² (máx ${THRESHOLDS.maxStitchDensityPerMm2}). El tejido se deformará.`,
      recommendation: 'Reducir densidad o aumentar área del diseño.',
    });
  } else if (globalDensity > THRESHOLDS.maxStitchDensityPerMm2 * 0.75) {
    issues.push({
      severity: 'MAJOR',
      category: 'DENSITY',
      rule: 'D2',
      message: `Densidad alta: ${globalDensity.toFixed(2)} stitches/mm² — riesgo de arrugado.`,
      recommendation: 'Considerar medium-low density.',
    });
  }

  if (totalStitches > THRESHOLDS.highRiskStitches) {
    issues.push({
      severity: 'MAJOR',
      category: 'DENSITY',
      rule: 'D4',
      message: `${totalStitches} puntadas — riesgo alto de tiempo/memoria; no es INVALID automático sin evidencia real de rechazo CE01.`,
      recommendation: 'Verificar rendimiento en máquina antes de producción larga.',
    });
  } else if (totalStitches > THRESHOLDS.maxStitches) {
    issues.push({
      severity: 'MINOR',
      category: 'DENSITY',
      rule: 'D4',
      message: `${totalStitches} puntadas — conteo alto pero aceptable como no bloqueante para CE01 recalibrada.`,
      recommendation: 'Revisar tiempo de costura; no reducir densidad automáticamente.',
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
//  JUMPS — command-level (can block)
// ═══════════════════════════════════════════════════════════════════════════

function checkJumps(commands, ms) {
  const issues = [];
  let prevX = 0, prevY = 0;
  let longJumpsWithoutTrim = 0;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c || c.type !== 'jump') {
      if (c && c.x !== undefined) { prevX = c.x; prevY = c.y; }
      continue;
    }

    const dist = Math.hypot(c.x - prevX, c.y - prevY);
    const isFirstInSeq = i === 0 || commands[i-1].type !== 'jump';
    const prevCmd = i > 0 ? commands[i-1] : null;
    const hasStitchBefore = prevCmd && (prevCmd.type === 'stitch' || prevCmd.type === 'jump');

    // Jump exceeding physical limit — CRITICAL
    if (dist > THRESHOLDS.maxJumpPhysical) {
      issues.push({
        severity: 'CRITICAL',
        category: 'JUMPS',
        rule: 'J2',
        index: i,
        message: `Salto de ${dist.toFixed(1)}mm excede límite físico de ${THRESHOLDS.maxJumpPhysical}mm.`,
        recommendation: 'Dividir en sub-saltos ≤12.1mm.',
      });
    }

    // Jump >3.5mm without trim — severity depends on distance
    if (isFirstInSeq && hasStitchBefore && dist > THRESHOLDS.maxJumpWithoutTrim && prevCmd.type !== 'trim') {
      longJumpsWithoutTrim++;
      if (longJumpsWithoutTrim <= 10) {
        issues.push({
          severity: dist > THRESHOLDS.maxJumpRisky ? 'MAJOR' : 'MINOR',
          category: 'JUMPS',
          rule: 'J1',
          index: i,
          message: `Salto de ${dist.toFixed(1)}mm sin trim previo.`,
          recommendation: 'Insertar trim antes del salto.',
        });
      }
    }

    prevX = c.x; prevY = c.y;
  }

  if (longJumpsWithoutTrim > 10) {
    issues.push({
      severity: 'MAJOR',
      category: 'JUMPS',
      rule: 'J3',
      message: `${longJumpsWithoutTrim} saltos >3.5mm sin trim — exceso de arrastre de hilo.`,
      recommendation: 'Activar trim automático en saltos >3.5mm.',
    });
  }

  // ── Total jump count — global pathing efficiency ──
  const totalJumps = commands.filter(c => c.type === 'jump').length;
  if (totalJumps > THRESHOLDS.maxTotalJumpsRisky) {
    issues.push({
      severity: 'MAJOR',
      category: 'JUMPS',
      rule: 'J4',
      message: `${totalJumps} saltos totales — demasiado alto para un diseño doméstico simple.`,
      recommendation: 'Usar Travel Path Optimizer para reducir saltos.',
    });
  } else if (totalJumps > THRESHOLDS.maxTotalJumpsSafe) {
    issues.push({
      severity: 'MINOR',
      category: 'JUMPS',
      rule: 'J4',
      message: `${totalJumps} saltos totales — algo elevado para CE01.`,
      recommendation: 'Considerar optimizar el travel path.',
    });
  }

  // ── Total trim count — excessive cuts slow production ──
  const totalTrims = commands.filter(c => c.type === 'trim').length;
  if (totalTrims > THRESHOLDS.maxTotalTrimsRisky) {
    issues.push({
      severity: 'MAJOR',
      category: 'TRIM',
      rule: 'T3',
      message: `${totalTrims} trims totales — exceso de cortes para CE01.`,
      recommendation: 'Reducir trims innecesarios con Travel Path Optimizer.',
    });
  } else if (totalTrims > THRESHOLDS.maxTotalTrimsSafe) {
    issues.push({
      severity: 'MINOR',
      category: 'TRIM',
      rule: 'T3',
      message: `${totalTrims} trims totales — algo elevado.`,
      recommendation: 'Considerar reducir trims.',
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRUCTURE — command-level (can block)
// ═══════════════════════════════════════════════════════════════════════════

function checkStructure(regions) {
  const issues = [];

  for (const r of regions) {
    if (r.visible === false) continue;
    const pts = r.path_points || [];

    if (pts.length === 0) {
      issues.push({
        severity: 'CRITICAL',
        category: 'STRUCTURE',
        rule: 'S1',
        message: `Región "${r.name || r.id}": 0 puntos — bloque vacío.`,
        recommendation: 'Eliminar región.',
      });
      continue;
    }

    // Self-intersecting — only CRITICAL if severe
    if (pts.length >= 4 && r.stitch_type !== 'running_stitch') {
      const crossings = countSelfIntersections(pts);
      if (crossings > 2) {
        issues.push({
          severity: 'CRITICAL',
          category: 'STRUCTURE',
          rule: 'S4',
          message: `Región "${r.name || r.id}": ${crossings} auto-intersecciones — path corrupto.`,
          recommendation: 'Re-trazar contorno.',
        });
      } else if (crossings > 0) {
        issues.push({
          severity: 'MINOR',
          category: 'STRUCTURE',
          rule: 'S4',
          message: `Región "${r.name || r.id}": ${crossings} auto-intersección(es) menor(es).`,
          recommendation: 'Revisar contorno.',
        });
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRIM / TIE-OFF — command-level (reduced severity)
// ═══════════════════════════════════════════════════════════════════════════

function checkTrimThreads(commands) {
  const issues = [];
  const blocks = [];
  let currentBlock = { stitches: [], color: null, hasTrim: false };

  for (const c of commands) {
    if (c.type === 'colorChange') {
      if (currentBlock.stitches.length > 0) blocks.push(currentBlock);
      currentBlock = { stitches: [], color: c.color, hasTrim: false };
      continue;
    }
    if (c.type === 'stitch') currentBlock.stitches.push(c);
    if (c.type === 'trim') currentBlock.hasTrim = true;
    if (c.type === 'end') { if (currentBlock.stitches.length > 0) blocks.push(currentBlock); break; }
  }
  if (currentBlock.stitches.length > 0) blocks.push(currentBlock);

  let blocksWithoutTieOff = 0;
  for (const block of blocks) {
    if (block.stitches.length < 3) continue; // too small to require tie-off
    if (!block.hasTrim) blocksWithoutTieOff++;
  }

  if (blocksWithoutTieOff > 5) {
    issues.push({
      severity: 'MINOR',
      category: 'TRIM',
      rule: 'T2',
      message: `${blocksWithoutTieOff} bloques sin tie-off/trim — el hilo puede soltarse en algunos bloques.`,
      recommendation: 'Considerar añadir trim automático al final de cada bloque.',
    });
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RECOMMENDATION BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildRecommendation(status, commandIssues, geometryWarnings, score) {
  const criticals = commandIssues.filter(i => i.severity === 'CRITICAL');
  const majors = commandIssues.filter(i => i.severity === 'MAJOR');

  if (status === 'INVALID') {
    const reasons = criticals.slice(0, 2).map(c => c.message);
    return `NO EJECUTABLE (score ${score}/100). ${reasons.join(' ')} Corregir antes de exportar.`;
  }

  if (status === 'RISKY') {
    const topIssues = majors.slice(0, 2).map(m => m.recommendation);
    const geomNote = geometryWarnings.length > 0 ? ` · ${geometryWarnings.length} advertencia(s) de geometría visual (no bloqueante)` : '';
    return `EJECUTABLE CON RIESGO (score ${score}/100). ${topIssues.join(' ')}${geomNote}`;
  }

  const geomNote = geometryWarnings.length > 0 ? ` · ${geometryWarnings.length} advertencia(s) visual(es) no bloqueantes` : '';
  return `SEGURO (score ${score}/100). Diseño ejecutable en máquina doméstica${geomNote}.`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function countSelfIntersections(points) {
  let count = 0;
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2) continue;
      if (segmentsCross(points[i], points[i+1], points[j], points[j+1])) count++;
    }
  }
  return count;
}

function segmentsCross(p1, p2, p3, p4) {
  const d1 = crossProduct(p3, p4, p1);
  const d2 = crossProduct(p3, p4, p2);
  const d3 = crossProduct(p1, p2, p3);
  const d4 = crossProduct(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function crossProduct(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}