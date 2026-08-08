import { createProposalReviewDecisionV2 } from './reviewDecisionModel.js';
import { draftIdFor } from './embroideryObjectDraftModel.js';

const issue = (code, path, message) => ({ code, path, message });

function topology(candidates) {
  const byId = new Map(candidates.map(item => [draftIdFor(item.proposal.id), item]));
  const emitted = new Set(); const layers = [];
  while (emitted.size < candidates.length) {
    const ready = [...byId.keys()].filter(id => !emitted.has(id) && (byId.get(id).dependencyIds || []).every(dependencyId => emitted.has(dependencyId))).sort();
    if (!ready.length) return { executionLayers: layers, dependencyCycleCount: candidates.length - emitted.size };
    layers.push(ready); ready.forEach(id => emitted.add(id));
  }
  return { executionLayers: layers, dependencyCycleCount: 0 };
}

export function translateProposalDependenciesToDrafts({ proposals = [], decisions = [], draftCandidates = [], config = {} }) {
  const proposalMap = new Map(proposals.map(item => [item.id, item]));
  const candidateMap = new Map(draftCandidates.map(item => [item.proposal.id, item]));
  const blocked = new Map();
  const warnings = []; const errors = [];
  let changed = true;
  while (changed) {
    changed = false;
    [...candidateMap.values()].sort((a, b) => a.proposal.id.localeCompare(b.proposal.id)).forEach(candidate => {
      const missing = (candidate.proposal.dependencyIds || []).filter(dependencyId => !candidateMap.has(dependencyId));
      if (!missing.length) return;
      if (config.blockOnMissingDependency !== false) {
        candidateMap.delete(candidate.proposal.id);
        blocked.set(candidate.proposal.id, missing);
        errors.push(issue('REQUIRED_DEPENDENCY_NOT_MATERIALIZED', `proposals.${candidate.proposal.id}.dependencyIds`, `Required dependencies were not materialized: ${missing.join(', ')}.`));
        changed = true;
      } else {
        warnings.push(issue('MISSING_DEPENDENCY_OMITTED', `proposals.${candidate.proposal.id}.dependencyIds`, `Missing dependencies were omitted: ${missing.join(', ')}.`));
      }
    });
  }
  const translatedDecisions = decisions.map(decision => {
    const missing = blocked.get(decision.proposalId);
    if (!missing) return decision;
    return createProposalReviewDecisionV2({
      ...decision,
      action: 'blocked',
      automatic: true,
      reasonCode: 'REQUIRED_DEPENDENCY_NOT_MATERIALIZED',
      reason: `Required dependencies were not materialized: ${missing.join(', ')}.`,
      evidence: [...decision.evidence, { code: 'REQUIRED_DEPENDENCY_NOT_MATERIALIZED', dependencyIds: [...missing] }],
    });
  });
  const translatedCandidates = [...candidateMap.values()].sort((a, b) => a.proposal.id.localeCompare(b.proposal.id)).map(candidate => ({
    ...candidate,
    dependencyIds: (candidate.proposal.dependencyIds || []).filter(id => candidateMap.has(id)).map(draftIdFor).sort(),
  }));
  const graph = topology(translatedCandidates);
  if (graph.dependencyCycleCount) errors.push(issue('DRAFT_DEPENDENCY_CYCLE', 'draftCandidates', 'Translated draft dependencies contain a cycle.'));
  return {
    decisions: translatedDecisions,
    draftCandidates: translatedCandidates,
    blockedProposalIds: [...blocked.keys()].sort(),
    errors,
    warnings,
    dependencyCount: translatedCandidates.reduce((sum, item) => sum + item.dependencyIds.length, 0),
    dependencyCycleCount: graph.dependencyCycleCount,
    executionLayers: graph.executionLayers,
    proposalMap,
  };
}

function draftMap(materialization) {
  return new Map((materialization?.drafts || []).map(item => [item.id, item]));
}

export function getDraftAncestors(materialization, draftId) {
  const byId = draftMap(materialization); const result = []; const seen = new Set();
  const visit = id => (byId.get(id)?.dependencyIds || []).sort().forEach(dependencyId => { if (!seen.has(dependencyId)) { seen.add(dependencyId); result.push(dependencyId); visit(dependencyId); } });
  visit(draftId); return result;
}

export function getDraftDescendants(materialization, draftId) {
  const drafts = [...(materialization?.drafts || [])].sort((a, b) => a.id.localeCompare(b.id)); const result = []; const seen = new Set();
  const visit = id => drafts.filter(item => item.dependencyIds.includes(id)).forEach(item => { if (!seen.has(item.id)) { seen.add(item.id); result.push(item.id); visit(item.id); } });
  visit(draftId); return result;
}

export function getDraftExecutionLayers(materialization) {
  return Array.isArray(materialization?.executionLayers) ? materialization.executionLayers.map(layer => [...layer]) : topology((materialization?.drafts || []).map(draft => ({ proposal: { id: draft.proposalId }, dependencyIds: draft.dependencyIds }))).executionLayers;
}
