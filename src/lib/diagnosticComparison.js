function fileInfo(analysis) {
  return {
    name: analysis.meta?.name ?? null,
    sha256: analysis.meta?.sha256 ?? null,
    sizeBytes: analysis.meta?.sizeBytes ?? null,
  };
}

function blockMetrics(analysis, index) {
  const block = analysis.blocks?.[index];
  if (!block) return null;
  let stitches = 0, jumps = 0;
  const types = analysis.geometry?.types;
  if (types) for (let i = block.start; i < block.end && i < types.length; i++) {
    if (types[i] === 0) stitches++;
    if (types[i] === 1) jumps++;
  }
  const coverage = analysis.coverageBlocks?.find((item) => item.index === index);
  return {
    index, colorIndex: block.colorIndex, points: block.end - block.start, stitches, jumps,
    occupancyMm2: coverage?.bufferedOccupiedAreaMm2 ?? coverage?.occupiedAreaMm2 ?? 0,
    coverage: coverage || null,
  };
}

const percent = (a, b) => a ? +(((b - a) / a) * 100).toFixed(2) : (b ? 100 : 0);

export function compareDiagnosticBlocks(a, b) {
  const max = Math.max(a.blocks?.length || 0, b.blocks?.length || 0);
  const changedBlocks = [], unchangedBlocks = [], blocksOnlyInA = [], blocksOnlyInB = [];
  for (let index = 0; index < max; index++) {
    const A = blockMetrics(a, index), B = blockMetrics(b, index);
    if (!A) { blocksOnlyInB.push(B); continue; }
    if (!B) { blocksOnlyInA.push(A); continue; }
    const occupancyAbsoluteDifference = Math.abs(A.occupancyMm2 - B.occupancyMm2);
    const occupancyBase = Math.max(Math.abs(A.occupancyMm2), Math.abs(B.occupancyMm2));
    const occupancyRelativeDifference = occupancyBase ? occupancyAbsoluteDifference / occupancyBase : 0;
    const changed = A.colorIndex !== B.colorIndex || A.points !== B.points || A.stitches !== B.stitches || A.jumps !== B.jumps || (occupancyAbsoluteDifference >= 2 && occupancyRelativeDifference >= 0.01);
    const comparison = {
      index, colorA: A.colorIndex, colorB: B.colorIndex,
      pointsA: A.points, pointsB: B.points, stitchesA: A.stitches, stitchesB: B.stitches,
      jumpsA: A.jumps, jumpsB: B.jumps, occupancyA: A.occupancyMm2, occupancyB: B.occupancyMm2,
      occupancyAbsoluteDifference: +occupancyAbsoluteDifference.toFixed(3),
      occupancyRelativeDifference: +(occupancyRelativeDifference * 100).toFixed(3),
      differencePercentage: percent(A.points, B.points),
      differencesPercent: { points: percent(A.points, B.points), stitches: percent(A.stitches, B.stitches), jumps: percent(A.jumps, B.jumps), occupancy: percent(A.occupancyMm2, B.occupancyMm2) },
    };
    if (changed) changedBlocks.push(comparison);
    else unchangedBlocks.push(comparison);
  }
  return { changedBlocks, unchangedBlocks, blocksOnlyInA, blocksOnlyInB };
}

export function buildDiagnosticComparison(a, b, localDate = new Date()) {
  const blocksA = a.blocks || [];
  const blocksB = b.blocks || [];
  const blockComparison = compareDiagnosticBlocks(a, b);
  const thresholds = {
    lateCoveringLayer: {
      minimumBlockCount: 3, lastThirdStartFormula: 'ceil(blockCount * 2 / 3)', minimumConditions: 2,
      bufferedPreviousCoverageRatio: 0.30, envelopeOverlapWithPreviousUnion: 0.80,
      pointCountVersusPreviousMedian: 5, segmentCountVersusPreviousMedian: 5,
      bufferedAreaVersusPreviousUnion: 0.35,
    },
    changedBlock: { occupancyAbsoluteDifferenceMm2: 2, occupancyRelativeDifference: 0.01 },
  };
  const lateCoveringLayers = { A: [], B: [] };
  const descriptiveWarnings = { A: [], B: [] };
  const blockOccupancy = { A: [], B: [] };
  for (const slot of ['A', 'B']) {
    const analysis = slot === 'A' ? a : b;
    const blockCount = analysis.blocks?.length || 0;
    const lastThirdStart = Math.ceil(blockCount * 2 / 3);
    const gridMm = analysis.parser?.config?.coverageGridMm ?? 0.5;
    let previousBufferedArea = 0;
    const coverageBlocks = [...(analysis.coverageBlocks || [])].sort((x, y) => x.index - y.index);
    for (const block of coverageBlocks) {
      const reasons = [];
      if (block.bufferedPreviousCoverageRatio >= thresholds.lateCoveringLayer.bufferedPreviousCoverageRatio) reasons.push('BUFFERED_PREVIOUS_COVERAGE_GTE_30');
      if (block.envelopeOverlapWithPreviousUnion >= thresholds.lateCoveringLayer.envelopeOverlapWithPreviousUnion) reasons.push('ENVELOPE_OVERLAP_GTE_80');
      if (block.pointCountVersusPreviousMedian >= thresholds.lateCoveringLayer.pointCountVersusPreviousMedian) reasons.push('POINT_COUNT_GTE_5X_PREVIOUS_MEDIAN');
      if (block.segmentCountVersusPreviousMedian >= thresholds.lateCoveringLayer.segmentCountVersusPreviousMedian) reasons.push('SEGMENT_COUNT_GTE_5X_PREVIOUS_MEDIAN');
      if (previousBufferedArea > 0 && block.bufferedOccupiedAreaMm2 >= previousBufferedArea * thresholds.lateCoveringLayer.bufferedAreaVersusPreviousUnion) reasons.push('BUFFERED_AREA_GTE_35_PREVIOUS_UNION');
      const isLate = blockCount >= thresholds.lateCoveringLayer.minimumBlockCount && block.index >= lastThirdStart && block.index > 0 && previousBufferedArea > 0 && reasons.length >= thresholds.lateCoveringLayer.minimumConditions;
      const classifications = (block.classifications || []).filter((item) => item !== 'LATE_COVERING_LAYER');
      if (isLate) classifications.push('LATE_COVERING_LAYER');
      const normalized = { ...block, classifications, reasons: isLate ? reasons : [], lastThirdStart };
      blockOccupancy[slot].push(normalized);
      if (isLate) lateCoveringLayers[slot].push(normalized);
      const warnings = classifications.filter((item) => item === 'HIGH_OCCUPANCY_BLOCK' || item === 'ABNORMAL_BLOCK_COMPLEXITY');
      if (warnings.length) descriptiveWarnings[slot].push({ ...normalized, classifications: warnings });
      const overlapArea = (block.bufferedOverlapWithPreviousUnion || 0) * gridMm * gridMm;
      previousBufferedArea = Math.max(0, previousBufferedArea + (block.bufferedOccupiedAreaMm2 || 0) - overlapArea);
    }
  }
  const delta = (key) => (b.summary?.[key] ?? 0) - (a.summary?.[key] ?? 0);
  return {
    schema: 'engine-v2-comparison',
    version: 1,
    analysisDateLocal: localDate.toLocaleString(),
    analysisDateIso: localDate.toISOString(),
    parser: a.parser || b.parser || null,
    files: { A: fileInfo(a), B: fileInfo(b) },
    differencesBMinusA: {
      stitched: delta('stitchCount'), jumps: delta('jumpCount'), records: delta('recordsTotal'),
      blocks: blocksB.length - blocksA.length, colors: delta('colorChangeCount'),
    },
    dimensions: { A: a.summary?.extents || null, B: b.summary?.extents || null },
    coverageBufferMm: a.parser?.config?.coverageBufferMm ?? b.parser?.config?.coverageBufferMm ?? 0.6,
    thresholds,
    blockOccupancy,
    unchangedBlocks: blockComparison.unchangedBlocks,
    changedBlocks: blockComparison.changedBlocks,
    blocksOnlyInA: blockComparison.blocksOnlyInA,
    blocksOnlyInB: blockComparison.blocksOnlyInB,
    lateCoveringLayers,
    descriptiveWarnings,
    suspectBlocks: lateCoveringLayers,
    structuralErrors: { A: a.errors || [], B: b.errors || [] },
  };
}