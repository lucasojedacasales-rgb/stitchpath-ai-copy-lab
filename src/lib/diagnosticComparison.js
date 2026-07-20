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
  const changedBlocks = [], blocksOnlyInA = [], blocksOnlyInB = [];
  for (let index = 0; index < max; index++) {
    const A = blockMetrics(a, index), B = blockMetrics(b, index);
    if (!A) { blocksOnlyInB.push(B); continue; }
    if (!B) { blocksOnlyInA.push(A); continue; }
    const changed = A.colorIndex !== B.colorIndex || A.points !== B.points || A.stitches !== B.stitches || A.jumps !== B.jumps || A.occupancyMm2 !== B.occupancyMm2;
    if (changed) changedBlocks.push({
      index, colorA: A.colorIndex, colorB: B.colorIndex,
      pointsA: A.points, pointsB: B.points, stitchesA: A.stitches, stitchesB: B.stitches,
      jumpsA: A.jumps, jumpsB: B.jumps, occupancyA: A.occupancyMm2, occupancyB: B.occupancyMm2,
      differencePercentage: percent(A.points, B.points),
      differencesPercent: { points: percent(A.points, B.points), stitches: percent(A.stitches, B.stitches), jumps: percent(A.jumps, B.jumps), occupancy: percent(A.occupancyMm2, B.occupancyMm2) },
    });
  }
  return { changedBlocks, blocksOnlyInA, blocksOnlyInB };
}

export function buildDiagnosticComparison(a, b, localDate = new Date()) {
  const blocksA = a.blocks || [];
  const blocksB = b.blocks || [];
  const blockComparison = compareDiagnosticBlocks(a, b);
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
    blockOccupancy: { A: a.coverageBlocks || [], B: b.coverageBlocks || [] },
    changedBlocks: blockComparison.changedBlocks,
    blocksOnlyInA: blockComparison.blocksOnlyInA,
    blocksOnlyInB: blockComparison.blocksOnlyInB,
    suspectBlocks: { A: a.suspectBlocks || [], B: b.suspectBlocks || [] },
    structuralErrors: { A: a.errors || [], B: b.errors || [] },
  };
}