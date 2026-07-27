import { getConnectedComponent, getRegionAncestors } from '../topology/regionGraph.js';
import { cloneProposalWithDependencies } from './embroideryPlanningModel.js';

const FILL_ROLES = new Set(['base_fill', 'foreground_fill']);
const DETAIL_ROLES = new Set(['internal_detail', 'dark_detail', 'highlight']);
const OUTLINE_ROLES = new Set(['inner_outline', 'outer_outline']);
const isAutomatic = proposal => proposal && !proposal.excluded && proposal.proposedEmbroideryRole !== 'manual_review';

function nearestStitchableFill(proposal, byRegionId, graph) {
  return getRegionAncestors(graph, proposal.regionId)
    .map(regionId => byRegionId.get(regionId))
    .find(candidate => isAutomatic(candidate) && FILL_ROLES.has(candidate.proposedEmbroideryRole));
}

function topologicalLayers(proposals) {
  const active = proposals.filter(isAutomatic);
  const ids = new Set(active.map(item => item.id));
  const dependencies = new Map(active.map(item => [item.id, new Set(item.dependencyIds.filter(id => ids.has(id)))]));
  const layers = [];
  const emitted = new Set();
  while (emitted.size < active.length) {
    const ready = active.filter(item => !emitted.has(item.id) && [...dependencies.get(item.id)].every(id => emitted.has(id)))
      .map(item => item.id).sort();
    if (!ready.length) return { layers, cycleCount: active.length - emitted.size };
    layers.push(ready);
    ready.forEach(id => emitted.add(id));
  }
  return { layers, cycleCount: 0 };
}

export function buildEmbroideryProposalDependencies(proposals, regions, graph, semanticResult, config) {
  const sorted = [...(Array.isArray(proposals) ? proposals : [])].sort((a, b) => a.id.localeCompare(b.id));
  const byRegionId = new Map(sorted.map(item => [item.regionId, item]));
  const warnings = [];
  const withDependencies = sorted.map(proposal => {
    if (!isAutomatic(proposal)) return cloneProposalWithDependencies(proposal, []);
    const dependencies = new Set();
    if (FILL_ROLES.has(proposal.proposedEmbroideryRole) && proposal.semanticRole !== 'background') {
      const parent = nearestStitchableFill(proposal, byRegionId, graph);
      if (parent) dependencies.add(parent.id);
    }
    if (DETAIL_ROLES.has(proposal.proposedEmbroideryRole)) {
      const parent = nearestStitchableFill(proposal, byRegionId, graph);
      if (parent) dependencies.add(parent.id);
      else warnings.push({ code: 'MISSING_STITCHABLE_PARENT', proposalId: proposal.id, message: 'Detail has no stitchable containing fill.' });
    }
    if (proposal.proposedEmbroideryRole === 'inner_outline') {
      const component = new Set(getConnectedComponent(graph, proposal.regionId));
      sorted.filter(candidate => isAutomatic(candidate) && candidate.id !== proposal.id
        && component.has(candidate.regionId) && (FILL_ROLES.has(candidate.proposedEmbroideryRole) || DETAIL_ROLES.has(candidate.proposedEmbroideryRole)))
        .forEach(candidate => dependencies.add(candidate.id));
    }
    if (proposal.proposedEmbroideryRole === 'outer_outline') {
      const component = new Set(getConnectedComponent(graph, proposal.regionId));
      sorted.filter(candidate => isAutomatic(candidate) && candidate.id !== proposal.id
        && component.has(candidate.regionId) && !OUTLINE_ROLES.has(candidate.proposedEmbroideryRole))
        .forEach(candidate => dependencies.add(candidate.id));
    }
    return cloneProposalWithDependencies(proposal, [...dependencies]);
  });
  const topology = topologicalLayers(withDependencies);
  return {
    proposals: withDependencies,
    warnings: warnings.sort((a, b) => `${a.code}:${a.proposalId}`.localeCompare(`${b.code}:${b.proposalId}`)),
    dependencyCount: withDependencies.reduce((sum, item) => sum + item.dependencyIds.length, 0),
    dependencyCycleCount: topology.cycleCount,
    executionLayers: topology.layers,
    config,
    semanticResult,
    sourceRegionCount: Array.isArray(regions) ? regions.length : 0,
  };
}

function proposalMap(plan) {
  return new Map((plan?.proposals || []).map(item => [item.id, item]));
}

export function getProposalAncestors(plan, proposalId) {
  const byId = proposalMap(plan);
  const result = [];
  const seen = new Set();
  const visit = id => {
    const proposal = byId.get(id);
    (proposal?.dependencyIds || []).sort().forEach(dependencyId => {
      if (seen.has(dependencyId)) return;
      seen.add(dependencyId);
      result.push(dependencyId);
      visit(dependencyId);
    });
  };
  visit(proposalId);
  return result;
}

export function getProposalDescendants(plan, proposalId) {
  const proposals = [...(plan?.proposals || [])].sort((a, b) => a.id.localeCompare(b.id));
  const result = [];
  const seen = new Set();
  const visit = id => proposals.filter(item => item.dependencyIds.includes(id)).forEach(item => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    result.push(item.id);
    visit(item.id);
  });
  visit(proposalId);
  return result;
}

export function getProposalExecutionLayers(plan) {
  if (Array.isArray(plan?.executionLayers)) return plan.executionLayers.map(layer => [...layer]);
  return topologicalLayers(plan?.proposals || []).layers;
}
