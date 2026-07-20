function blockKey(block) {
  return `${block.colorIndex}:${block.end - block.start}`;
}

function fileInfo(analysis) {
  return {
    name: analysis.meta?.name ?? null,
    sha256: analysis.meta?.sha256 ?? null,
    sizeBytes: analysis.meta?.sizeBytes ?? null,
  };
}

function blockSummary(block) {
  return { colorIndex: block.colorIndex, points: block.end - block.start, start: block.start, end: block.end };
}

export function buildDiagnosticComparison(a, b, localDate = new Date()) {
  const blocksA = a.blocks || [];
  const blocksB = b.blocks || [];
  const keysA = new Set(blocksA.map(blockKey));
  const keysB = new Set(blocksB.map(blockKey));
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
    blockOccupancy: { A: a.coverageBlocks || [], B: b.coverageBlocks || [] },
    blocksOnlyInA: blocksA.filter((x) => !keysB.has(blockKey(x))).map(blockSummary),
    blocksOnlyInB: blocksB.filter((x) => !keysA.has(blockKey(x))).map(blockSummary),
    suspectBlocks: { A: a.suspectBlocks || [], B: b.suspectBlocks || [] },
    structuralErrors: { A: a.errors || [], B: b.errors || [] },
  };
}