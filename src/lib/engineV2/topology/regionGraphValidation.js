const ALLOWED_EDGE_RELATIONS = new Set(['contains', 'overlaps', 'touches']);

function issue(code, path, message) {
  return { code, path, message };
}

export function validateRegionGraphV2(graph, regions = []) {
  const errors = [];
  const warnings = [];
  if (!graph || typeof graph !== 'object') return { valid: false, errors: [issue('INVALID_GRAPH', 'graph', 'RegionGraphV2 must be an object.')], warnings };
  if (graph.version !== '2-region-graph') errors.push(issue('INVALID_GRAPH_VERSION', 'version', 'RegionGraphV2 version is invalid.'));
  if (!Array.isArray(graph.regionIds) || !graph.nodes || typeof graph.nodes !== 'object') {
    errors.push(issue('INVALID_GRAPH_STRUCTURE', 'regionIds,nodes', 'Graph requires regionIds and nodes.'));
    return { valid: false, errors, warnings };
  }
  const sourceIds = new Set((Array.isArray(regions) ? regions : []).map(region => region?.id));
  const graphIds = new Set(graph.regionIds);
  if (graphIds.size !== graph.regionIds.length) errors.push(issue('DUPLICATE_GRAPH_REGION_ID', 'regionIds', 'Graph regionIds must be unique.'));
  Object.keys(graph.nodes).forEach(regionId => {
    if (!graphIds.has(regionId) || !sourceIds.has(regionId)) errors.push(issue('UNKNOWN_GRAPH_NODE', `nodes.${regionId}`, `Node references unknown region "${regionId}".`));
  });
  const componentIds = Array.isArray(graph.componentIds) ? graph.componentIds : [];
  if (new Set(componentIds).size !== componentIds.length) errors.push(issue('DUPLICATE_COMPONENT_ID', 'componentIds', 'Component ids must be unique.'));
  graph.regionIds.forEach((regionId, index) => {
    if (!sourceIds.has(regionId)) errors.push(issue('UNKNOWN_GRAPH_REGION', `regionIds[${index}]`, `Graph references unknown region "${regionId}".`));
    const node = graph.nodes[regionId];
    if (!node) {
      errors.push(issue('MISSING_GRAPH_NODE', `nodes.${regionId}`, `Missing node for region "${regionId}".`));
      return;
    }
    if (node.regionId !== regionId) errors.push(issue('NODE_ID_MISMATCH', `nodes.${regionId}.regionId`, 'Node regionId does not match its key.'));
    if (node.parentId && !graphIds.has(node.parentId)) errors.push(issue('UNKNOWN_PARENT', `nodes.${regionId}.parentId`, `Unknown parent "${node.parentId}".`));
    if (!componentIds.includes(node.disconnectedComponentId)) errors.push(issue('UNKNOWN_COMPONENT_ID', `nodes.${regionId}.disconnectedComponentId`, 'Node references an unknown component.'));
    for (const field of ['childIds', 'containingRegionIds', 'containedRegionIds', 'overlappingRegionIds', 'touchingRegionIds']) {
      if (!Array.isArray(node[field])) {
        errors.push(issue('INVALID_NODE_RELATIONS', `nodes.${regionId}.${field}`, `${field} must be an array.`));
        continue;
      }
      node[field].forEach(referenceId => {
        if (!graphIds.has(referenceId)) errors.push(issue('UNKNOWN_NODE_REFERENCE', `nodes.${regionId}.${field}`, `Unknown region "${referenceId}".`));
      });
    }
  });

  Object.values(graph.nodes).forEach(node => {
    if (node.parentId && !graph.nodes[node.parentId]?.childIds?.includes(node.regionId)) {
      errors.push(issue('PARENT_CHILD_MISMATCH', `nodes.${node.regionId}.parentId`, 'Parent does not list this node as a child.'));
    }
    const seen = new Set();
    let current = node.regionId;
    while (current) {
      if (seen.has(current)) {
        errors.push(issue('CIRCULAR_PARENT_RELATION', `nodes.${node.regionId}.parentId`, 'Parent relationship contains a cycle.'));
        break;
      }
      seen.add(current);
      current = graph.nodes[current]?.parentId ?? null;
    }
  });

  const edgeKeys = new Set();
  (Array.isArray(graph.edges) ? graph.edges : []).forEach((edge, index) => {
    if (!ALLOWED_EDGE_RELATIONS.has(edge?.relation)) errors.push(issue('INVALID_EDGE_RELATION', `edges[${index}].relation`, `Invalid relation "${edge?.relation}".`));
    if (!graphIds.has(edge?.fromRegionId) || !graphIds.has(edge?.toRegionId)) errors.push(issue('UNKNOWN_EDGE_REGION', `edges[${index}]`, 'Edge references an unknown region.'));
    const key = `${edge?.relation}:${edge?.fromRegionId}:${edge?.toRegionId}`;
    if (edgeKeys.has(key)) errors.push(issue('DUPLICATE_GRAPH_EDGE', `edges[${index}]`, 'Duplicate graph edge.'));
    edgeKeys.add(key);
  });

  const expectedRoots = [...graphIds].filter(id => !graph.nodes[id]?.parentId).sort();
  const actualRoots = Array.isArray(graph.rootIds) ? [...graph.rootIds].sort() : [];
  if (JSON.stringify(expectedRoots) !== JSON.stringify(actualRoots)) errors.push(issue('INVALID_ROOT_IDS', 'rootIds', 'rootIds do not match parent relationships.'));
  return { valid: errors.length === 0, errors, warnings };
}
