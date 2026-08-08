import { createThreadDefinitionV2 } from '../model.js';
import { deltaE76, deltaE2000, determineColorFamily, hexToLab, parseHexColor } from './colorScience.js';
import { createDraftThreadAssignmentV2 } from './threadAssignmentModel.js';
import { validateThreadCatalog } from './threadCatalogValidation.js';
import { createExactArtworkPaletteEntry } from './threadPaletteModel.js';
import { resolveThreadResolutionConfig, validateThreadResolutionConfig } from './threadResolutionConfig.js';

const issue = (code, path, message) => ({ code, path, message });

function sanitizedCatalogId(id) {
  return String(id).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function threadIdForEntry(entry, policy) {
  return policy === 'artwork_exact' ? `thread:${entry.id}` : `thread:catalog:${sanitizedCatalogId(entry.id)}`;
}

function machineColorFor(entry) {
  return { hex: entry.hex, name: entry.name, manufacturer: entry.manufacturer, code: entry.code, catalogEntryId: entry.id };
}

function blocked(draft, config, reasonCode, reason, normalizedVisualColor = null) {
  return createDraftThreadAssignmentV2({
    draftId: draft?.id,
    regionId: draft?.regionId,
    status: 'blocked',
    visualColor: draft?.visualColor,
    normalizedVisualColor,
    policy: config.policy,
    reasonCode,
    reason,
    evidence: [{ code: reasonCode }],
    source: { resolver: 'engineV2' },
  });
}

function assigned(draft, config, entry, deltaE, exactMatch) {
  const threadId = threadIdForEntry(entry, config.policy);
  const confidence = exactMatch ? 1 : Math.max(0, Math.min(1, 1 - deltaE / Math.max(config.maximumAcceptedDeltaE, 1)));
  return createDraftThreadAssignmentV2({
    draftId: draft.id,
    regionId: draft.regionId,
    status: 'assigned',
    threadId,
    visualColor: draft.visualColor,
    normalizedVisualColor: parseHexColor(draft.visualColor).normalizedHex,
    paletteEntryId: entry.id,
    machineColor: machineColorFor(entry),
    colorFamily: determineColorFamily(entry.hex),
    deltaE,
    exactMatch,
    confidence,
    policy: config.policy,
    reasonCode: exactMatch ? 'THREAD_EXACT_MATCH' : 'THREAD_NEAREST_MATCH',
    reason: exactMatch ? 'Artwork color matched the selected palette entry exactly.' : 'Nearest catalog color selected within the configured tolerance.',
    evidence: [{ code: exactMatch ? 'THREAD_EXACT_MATCH' : 'THREAD_NEAREST_MATCH', deltaE }],
    source: { resolver: 'engineV2', policy: config.policy },
  });
}

function selectNearest(normalizedHex, entries, formula) {
  const artworkLab = hexToLab(normalizedHex).lab;
  const distance = formula === 'cie76' ? deltaE76 : deltaE2000;
  return entries.map(entry => ({ entry, deltaE: distance(artworkLab, hexToLab(entry.hex).lab) }))
    .sort((left, right) => left.deltaE - right.deltaE || left.entry.id.localeCompare(right.entry.id))[0] ?? null;
}

function createThreads(assignments, selectedEntries, config) {
  const assignedItems = assignments.filter(item => item.status === 'assigned');
  const entriesById = new Map(selectedEntries.map(entry => [entry.id, entry]));
  const byThread = new Map();
  assignedItems.forEach(assignment => {
    const values = byThread.get(assignment.threadId) || [];
    values.push(assignment);
    byThread.set(assignment.threadId, values);
  });
  return [...byThread.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([threadId, items]) => {
    const entry = entriesById.get(items[0].paletteEntryId);
    const samples = config.preserveVisualColorSamples ? [...new Set(items.map(item => item.normalizedVisualColor))].sort() : [];
    return createThreadDefinitionV2({
      id: threadId,
      visualColorSamples: samples,
      machineColor: machineColorFor(entry),
      colorFamily: determineColorFamily(entry.hex),
      source: { resolver: 'engineV2', policy: config.policy, physicalSpoolAvailabilityVerified: config.policy !== 'artwork_exact' },
      confidence: Math.min(...items.map(item => item.confidence)),
    });
  });
}

function createSummary(drafts, assignments, threads, config) {
  const assignedItems = assignments.filter(item => item.status === 'assigned');
  const normalizedCounts = new Map();
  assignedItems.forEach(item => normalizedCounts.set(item.normalizedVisualColor, (normalizedCounts.get(item.normalizedVisualColor) || 0) + 1));
  const threadColors = new Map();
  assignedItems.forEach(item => {
    const colors = threadColors.get(item.threadId) || new Set();
    colors.add(item.normalizedVisualColor);
    threadColors.set(item.threadId, colors);
  });
  const assignmentIds = assignments.map(item => item.id);
  const duplicateAssignmentCount = assignmentIds.length - new Set(assignmentIds).size;
  const draftIds = new Set(drafts.map(item => item.id));
  const coveredDraftIds = new Set(assignments.filter(item => draftIds.has(item.draftId)).map(item => item.draftId));
  const silentDraftDropCount = drafts.length - coveredDraftIds.size;
  return {
    sourceDraftCount: drafts.length,
    assignmentCount: assignments.length,
    draftThreadAssignmentCoveragePercent: drafts.length ? (coveredDraftIds.size / drafts.length) * 100 : 100,
    silentDraftDropCount,
    assignedCount: assignedItems.length,
    blockedCount: assignments.filter(item => item.status === 'blocked').length,
    threadDefinitionCount: threads.length,
    exactArtworkThreadCount: config.policy === 'artwork_exact' ? threads.length : 0,
    catalogThreadCount: config.policy === 'artwork_exact' ? 0 : threads.length,
    exactMatchCount: assignedItems.filter(item => item.exactMatch).length,
    approximateMatchCount: assignedItems.filter(item => !item.exactMatch).length,
    invalidArtworkColorCount: assignments.filter(item => item.reasonCode === 'INVALID_ARTWORK_COLOR').length,
    noCatalogMatchCount: assignments.filter(item => item.reasonCode === 'CATALOG_EXACT_MATCH_NOT_FOUND').length,
    outOfToleranceCount: assignments.filter(item => item.reasonCode === 'CATALOG_MATCH_OUT_OF_TOLERANCE').length,
    sharedIdenticalColorCount: [...normalizedCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    paletteConsolidationCount: [...threadColors.values()].reduce((sum, colors) => sum + Math.max(0, colors.size - 1), 0),
    duplicateAssignmentCount,
  };
}

export function resolveDraftThreadAssignments({ drafts = [], config: rawConfig = {} }) {
  const config = resolveThreadResolutionConfig(rawConfig);
  const configValidation = validateThreadResolutionConfig(config);
  const catalogValidation = config.policy === 'artwork_exact' ? { valid: true, entries: [], errors: [], warnings: [] } : validateThreadCatalog(config.catalog);
  const errors = [...configValidation.errors, ...catalogValidation.errors];
  const warnings = [...catalogValidation.warnings];
  const catalogEntries = catalogValidation.entries;
  const sanitizedOwners = new Map();
  if (config.policy !== 'artwork_exact') {
    catalogEntries.forEach(entry => {
      const sanitized = sanitizedCatalogId(entry.id);
      if (!sanitized) errors.push(issue('UNSAFE_CATALOG_THREAD_ID', `catalog.${entry.id}`, 'Catalog ID cannot produce a safe deterministic thread ID.'));
      const owner = sanitizedOwners.get(sanitized);
      if (owner && owner !== entry.id) errors.push(issue('CATALOG_THREAD_ID_COLLISION', 'catalog', `Catalog IDs "${owner}" and "${entry.id}" produce the same thread ID.`));
      else sanitizedOwners.set(sanitized, entry.id);
    });
  }
  const selectedEntries = new Map();
  const unsafeCatalog = config.policy !== 'artwork_exact' && (errors.length > 0 || !catalogValidation.valid);
  const assignments = [...drafts].sort((a, b) => String(a?.id).localeCompare(String(b?.id))).map(draft => {
    const parsed = parseHexColor(draft?.visualColor);
    if (!parsed.valid) return blocked(draft, config, 'INVALID_ARTWORK_COLOR', parsed.error);
    if (!configValidation.valid) return blocked(draft, config, 'INVALID_THREAD_RESOLUTION_CONFIG', 'Thread resolution configuration is invalid.', parsed.normalizedHex);
    if (unsafeCatalog) return blocked(draft, config, 'INVALID_THREAD_CATALOG', 'Thread catalog is invalid; unsafe partial matching was not attempted.', parsed.normalizedHex);
    if (config.policy === 'artwork_exact') {
      const entry = createExactArtworkPaletteEntry(parsed.normalizedHex);
      selectedEntries.set(entry.id, entry);
      return assigned(draft, config, entry, 0, true);
    }
    const exact = catalogEntries.find(entry => entry.hex === parsed.normalizedHex);
    if (exact) {
      selectedEntries.set(exact.id, exact);
      return assigned(draft, config, exact, 0, true);
    }
    if (config.policy === 'catalog_exact') return blocked(draft, config, 'CATALOG_EXACT_MATCH_NOT_FOUND', `No exact catalog match exists for ${parsed.normalizedHex}.`, parsed.normalizedHex);
    const nearest = selectNearest(parsed.normalizedHex, catalogEntries, config.colorDifferenceFormula);
    if (!nearest) return blocked(draft, config, 'CATALOG_MATCH_NOT_FOUND', 'No valid catalog entry is available.', parsed.normalizedHex);
    if (config.blockOutOfToleranceMatches && nearest.deltaE > config.maximumAcceptedDeltaE) return blocked(draft, config, 'CATALOG_MATCH_OUT_OF_TOLERANCE', `Nearest catalog match exceeds maximum Delta E (${nearest.deltaE.toFixed(4)} > ${config.maximumAcceptedDeltaE}).`, parsed.normalizedHex);
    selectedEntries.set(nearest.entry.id, nearest.entry);
    return assigned(draft, config, nearest.entry, nearest.deltaE, false);
  });
  const threads = createThreads(assignments, [...selectedEntries.values()], config);
  const byThreadId = {};
  assignments.filter(item => item.threadId).forEach(item => { (byThreadId[item.threadId] ||= []).push(item); });
  const summary = createSummary(drafts, assignments, threads, config);
  return {
    assignments,
    threads,
    byAssignmentId: Object.fromEntries(assignments.map(item => [item.id, item])),
    byDraftId: Object.fromEntries(assignments.map(item => [item.draftId, item])),
    byThreadId,
    valid: errors.length === 0 && summary.draftThreadAssignmentCoveragePercent === 100 && summary.duplicateAssignmentCount === 0,
    errors,
    warnings,
    summary,
    config,
  };
}
