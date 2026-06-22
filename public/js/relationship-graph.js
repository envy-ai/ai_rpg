(function relationshipGraphModule(root) {
  'use strict';

  const CHARACTER_NODE_PREFIX = 'character:';
  const MISSING_NODE_PREFIX = 'missing:';
  const RELATIONSHIP_NODE_RADIUS = 39;
  const RELATIONSHIP_CURVE_DISTANCE = 58;
  const RELATIONSHIP_ENDPOINT_OFFSET = 10;
  let relationshipCyInstance = null;
  let relationshipGraphRequestId = 0;

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function characterNodeId(characterId) {
    return `${CHARACTER_NODE_PREFIX}${characterId}`;
  }

  function missingNodeId(characterId) {
    return `${MISSING_NODE_PREFIX}${characterId}`;
  }

  function isHiddenActor(actor) {
    return Boolean(actor && actor.hiddenFromPlayer === true);
  }

  function encodeSvg(svg) {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function escapeSvgText(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function getActorId(actor) {
    const id = normalizeText(actor?.id);
    if (!id) {
      throw new Error('Relationship graph actor is missing an id.');
    }
    return id;
  }

  function getActorLabel(actor) {
    return normalizeText(actor?.name) || getActorId(actor);
  }

  function getInitials(name) {
    const words = normalizeText(name).split(/\s+/).filter(Boolean);
    if (!words.length) {
      return '?';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return `${words[0][0] || ''}${words[words.length - 1][0] || ''}`.toUpperCase();
  }

  function buildInitialsPortraitUrl(name) {
    const initials = escapeSvgText(getInitials(name));
    return encodeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#0ea5e9"/><stop offset="55%" stop-color="#14b8a6"/><stop offset="100%" stop-color="#facc15"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><text x="48" y="56" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#082f49">${initials}</text></svg>`);
  }

  function buildMissingCharacterPortraitUrl() {
    return encodeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#991b1b"/><circle cx="48" cy="48" r="42" fill="#b91c1c" stroke="#fecaca" stroke-width="4"/><text x="48" y="61" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">?</text></svg>');
  }

  const missingCharacterPortraitUrl = buildMissingCharacterPortraitUrl();

  function getActorImageUrl(actor) {
    const explicitUrl = normalizeText(actor?.image?.url);
    if (explicitUrl) {
      return explicitUrl;
    }

    const imageId = normalizeText(actor?.imageId);
    if (!imageId) {
      return buildInitialsPortraitUrl(getActorLabel(actor));
    }

    const manager = root.AIRPG?.imageManager;
    if (manager && typeof manager.buildImageUrl === 'function') {
      return manager.buildImageUrl(imageId);
    }
    return `/api/images/${encodeURIComponent(imageId)}/file`;
  }

  function normalizeRelationships(rawRelationships, sourceId) {
    if (!rawRelationships || typeof rawRelationships !== 'object' || Array.isArray(rawRelationships)) {
      return [];
    }

    return Object.entries(rawRelationships).map(([rawTargetId, rawLabel]) => {
      const targetId = normalizeText(rawTargetId);
      const label = normalizeText(rawLabel);
      if (!targetId) {
        throw new Error(`Relationship graph edge from ${sourceId} is missing a target id.`);
      }
      if (!label) {
        throw new Error(`Relationship graph edge from ${sourceId} to ${targetId} is missing a label.`);
      }
      return { targetId, label };
    });
  }

  function buildCharacterNode(actor, currentPlayerId) {
    const id = getActorId(actor);
    const classes = ['relationship-character'];
    if (id === currentPlayerId) {
      classes.push('current-player');
    }
    if (actor?.isNPC === false || actor?.isPlayer === true) {
      classes.push('player-character');
    }

    return {
      data: {
        id: characterNodeId(id),
        characterId: id,
        label: getActorLabel(actor),
        imageUrl: getActorImageUrl(actor)
      },
      classes: classes.join(' ')
    };
  }

  function buildMissingCharacterNode(characterId) {
    return {
      data: {
        id: missingNodeId(characterId),
        characterId,
        label: `Unknown: ${characterId}`,
        imageUrl: missingCharacterPortraitUrl
      },
      classes: 'relationship-character missing-character'
    };
  }

  function formatGraphNumber(value) {
    if (!Number.isFinite(value)) {
      throw new Error(`Relationship graph geometry value is not finite: ${value}`);
    }
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function formatEndpoint(endpoint) {
    return `${formatGraphNumber(endpoint.x)}px ${formatGraphNumber(endpoint.y)}px`;
  }

  function calculateClockwiseEdgePresentation(sourcePosition, targetPosition, options = {}) {
    const nodeRadius = Number.isFinite(options.nodeRadius) ? options.nodeRadius : RELATIONSHIP_NODE_RADIUS;
    const curveDistance = Number.isFinite(options.curveDistance) ? options.curveDistance : RELATIONSHIP_CURVE_DISTANCE;
    const endpointOffset = Number.isFinite(options.endpointOffset)
      ? options.endpointOffset
      : RELATIONSHIP_ENDPOINT_OFFSET;

    const sourceX = Number(sourcePosition?.x);
    const sourceY = Number(sourcePosition?.y);
    const targetX = Number(targetPosition?.x);
    const targetY = Number(targetPosition?.y);
    if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) {
      throw new Error('Relationship graph edge geometry requires finite source and target positions.');
    }

    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(length) || length === 0) {
      throw new Error('Relationship graph cannot draw a curve between identical node positions.');
    }

    const ux = dx / length;
    const uy = dy / length;
    const clockwiseNormal = {
      x: -uy,
      y: ux
    };
    const endpointOffsetVector = {
      x: clockwiseNormal.x * endpointOffset,
      y: clockwiseNormal.y * endpointOffset
    };

    const sourceEndpoint = {
      x: ux * nodeRadius + endpointOffsetVector.x,
      y: uy * nodeRadius + endpointOffsetVector.y
    };
    const targetEndpoint = {
      x: -ux * nodeRadius + endpointOffsetVector.x,
      y: -uy * nodeRadius + endpointOffsetVector.y
    };
    const sourceAbsolute = {
      x: sourceX + sourceEndpoint.x,
      y: sourceY + sourceEndpoint.y
    };
    const targetAbsolute = {
      x: targetX + targetEndpoint.x,
      y: targetY + targetEndpoint.y
    };
    const midpoint = {
      x: (sourceAbsolute.x + targetAbsolute.x) / 2,
      y: (sourceAbsolute.y + targetAbsolute.y) / 2
    };
    const controlPoint = {
      x: midpoint.x + clockwiseNormal.x * curveDistance,
      y: midpoint.y + clockwiseNormal.y * curveDistance
    };
    const labelPosition = {
      x: (sourceAbsolute.x + 2 * controlPoint.x + targetAbsolute.x) / 4,
      y: (sourceAbsolute.y + 2 * controlPoint.y + targetAbsolute.y) / 4
    };

    return {
      sourceEndpoint: formatEndpoint(sourceEndpoint),
      targetEndpoint: formatEndpoint(targetEndpoint),
      controlPointDistance: formatGraphNumber(curveDistance),
      labelPosition: {
        x: formatGraphNumber(labelPosition.x),
        y: formatGraphNumber(labelPosition.y)
      },
      controlPoint: {
        x: formatGraphNumber(controlPoint.x),
        y: formatGraphNumber(controlPoint.y)
      }
    };
  }

  function buildElements(players, currentPlayerId = null) {
    if (!Array.isArray(players)) {
      throw new Error('Relationship graph requires a players array.');
    }

    const normalizedCurrentPlayerId = normalizeText(currentPlayerId);
    const allActorsById = new Map();
    const visibleActorsById = new Map();

    for (const actor of players) {
      const actorId = getActorId(actor);
      allActorsById.set(actorId, actor);
      if (!isHiddenActor(actor)) {
        visibleActorsById.set(actorId, actor);
      }
    }

    const includedActorIds = new Set();
    const missingTargetIds = new Set();
    const edges = [];

    for (const [sourceId, actor] of visibleActorsById.entries()) {
      const relationships = normalizeRelationships(actor.relationships, sourceId);
      for (const relationship of relationships) {
        const targetExists = allActorsById.has(relationship.targetId);
        const targetVisible = visibleActorsById.has(relationship.targetId);

        if (targetExists && !targetVisible) {
          continue;
        }

        includedActorIds.add(sourceId);
        const targetNodeId = targetVisible
          ? characterNodeId(relationship.targetId)
          : missingNodeId(relationship.targetId);

        if (targetVisible) {
          includedActorIds.add(relationship.targetId);
        } else {
          missingTargetIds.add(relationship.targetId);
        }

        edges.push({
          data: {
            id: `relationship:${sourceId}->${relationship.targetId}`,
            source: characterNodeId(sourceId),
            target: targetNodeId,
            label: relationship.label
          },
          classes: 'relationship-edge clockwise-curve'
        });
      }
    }

    const nodes = [];
    for (const [actorId, actor] of visibleActorsById.entries()) {
      if (includedActorIds.has(actorId)) {
        nodes.push(buildCharacterNode(actor, normalizedCurrentPlayerId));
      }
    }
    for (const missingId of missingTargetIds) {
      nodes.push(buildMissingCharacterNode(missingId));
    }

    return [...nodes, ...edges];
  }

  function destroyRelationshipGraph() {
    if (!relationshipCyInstance) {
      return;
    }
    try {
      relationshipCyInstance.destroy();
    } catch (error) {
      console.warn('Failed to destroy relationship graph Cytoscape instance:', error);
    }
    relationshipCyInstance = null;
  }

  function registerLayouts(cytoscapeLib) {
    if (!cytoscapeLib) {
      throw new Error('Cytoscape not loaded');
    }
    if (!cytoscapeLib.__fcoseRegistered && typeof root.cytoscapeFcose === 'function') {
      root.cytoscapeFcose(cytoscapeLib);
      cytoscapeLib.__fcoseRegistered = true;
    }
    if (!cytoscapeLib.__eulerRegistered && typeof root.cytoscapeEuler === 'function') {
      root.cytoscapeEuler(cytoscapeLib);
      cytoscapeLib.__eulerRegistered = true;
    }
  }

  function ensureRelationshipCytoscape(container) {
    if (!container) {
      throw new Error('Relationship graph container is missing.');
    }
    const cytoscapeLib = root.cytoscape;
    registerLayouts(cytoscapeLib);
    destroyRelationshipGraph();

    const cy = cytoscapeLib({
      container,
      textureOnViewport: false,
      wheelSensitivity: 0.7
    });

    cy.style([
      {
        selector: 'node.relationship-character',
        style: {
          'shape': 'ellipse',
          'width': 78,
          'height': 78,
          'background-color': '#0f172a',
          'background-image': 'data(imageUrl)',
          'background-fit': 'cover',
          'background-clip': 'node',
          'background-position-x': '50%',
          'background-position-y': '50%',
          'background-repeat': 'no-repeat',
          'border-width': 2.5,
          'border-color': '#38bdf8',
          'label': 'data(label)',
          'font-family': 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          'font-size': '10px',
          'font-weight': 600,
          'color': '#e0f2fe',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 10,
          'text-wrap': 'wrap',
          'text-max-width': '128px',
          'text-background-color': '#0f172a',
          'text-background-opacity': 0.9,
          'text-background-padding': '3px',
          'text-background-shape': 'roundrectangle',
          'shadow-blur': 14,
          'shadow-color': 'rgba(56, 189, 248, 0.28)',
          'z-index-compare': 'manual',
          'z-index': 100
        }
      },
      {
        selector: 'node.relationship-label',
        style: {
          'shape': 'roundrectangle',
          'width': 1,
          'height': 1,
          'background-opacity': 0,
          'border-width': 0,
          'label': 'data(label)',
          'font-family': 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          'font-size': '10px',
          'font-weight': 700,
          'color': '#ffffff',
          'text-outline-color': '#000000',
          'text-outline-width': 3,
          'text-outline-opacity': 0.95,
          'text-rotation': 'none',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '118px',
          'text-background-opacity': 0,
          'events': 'no',
          'z-compound-depth': 'top',
          'z-index-compare': 'manual',
          'z-index': 1000
        }
      },
      {
        selector: 'node.relationship-character.current-player',
        style: {
          'border-color': '#facc15',
          'border-width': 4,
          'shadow-blur': 18,
          'shadow-color': 'rgba(250, 204, 21, 0.5)'
        }
      },
      {
        selector: 'node.relationship-character.missing-character',
        style: {
          'border-color': '#fecaca',
          'border-width': 3,
          'shadow-color': 'rgba(239, 68, 68, 0.45)',
          'color': '#fecaca'
        }
      },
      {
        selector: 'edge.relationship-edge',
        style: {
          'width': 2.5,
          'curve-style': 'unbundled-bezier',
          'control-point-weights': 0.5,
          'control-point-distances': 56,
          'line-color': '#99f6e4',
          'target-arrow-color': '#99f6e4',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'filled',
          'arrow-scale': 1.05,
          'source-distance-from-node': 8,
          'target-distance-from-node': 8,
          'label': '',
          'z-compound-depth': 'bottom',
          'z-index-compare': 'manual',
          'z-index': 10
        }
      }
    ]);

    cy.userZoomingEnabled(true);
    cy.userPanningEnabled(true);
    relationshipCyInstance = cy;
    return cy;
  }

  function getRelationshipGraphContainer() {
    return root.document?.getElementById('relationshipGraphContainer') || null;
  }

  function setRelationshipGraphStatus(message, statusType = 'info') {
    const container = getRelationshipGraphContainer();
    if (!container) {
      throw new Error('Relationship graph container is missing.');
    }
    destroyRelationshipGraph();
    container.classList.add('relationship-graph-status');
    container.classList.toggle('relationship-graph-status--error', statusType === 'error');
    container.textContent = message;
  }

  function clearRelationshipGraphStatus(container) {
    container.classList.remove('relationship-graph-status', 'relationship-graph-status--error');
    container.textContent = '';
  }

  function getLayoutOptions(elementCount) {
    const cytoscapeLib = root.cytoscape;
    if (elementCount <= 4) {
      return {
        name: 'circle',
        animate: false,
        padding: 56
      };
    }
    if (cytoscapeLib?.__fcoseRegistered) {
      return {
        name: 'fcose',
        animate: false,
        fit: true,
        padding: 70,
        nodeRepulsion: 9000,
        idealEdgeLength: 170,
        edgeElasticity: 0.28,
        nestingFactor: 0.8
      };
    }
    if (cytoscapeLib?.__eulerRegistered) {
      return {
        name: 'euler',
        animate: false,
        fit: true,
        padding: 70,
        springLength: edge => (edge?.data('label') ? 170 : 130)
      };
    }
    return {
      name: 'cose',
      animate: false,
      fit: true,
      padding: 70,
      idealEdgeLength: 170
    };
  }

  function buildRelationshipLabelNode(edge, presentation) {
    return {
      data: {
        id: `relationship-label:${edge.id()}`,
        relationshipEdgeId: edge.id(),
        label: normalizeText(edge.data('label'))
      },
      position: presentation.labelPosition,
      classes: 'relationship-label',
      grabbable: false,
      selectable: false,
      locked: true
    };
  }

  function updateRelationshipEdgeGeometry(cy) {
    if (!cy) {
      throw new Error('Relationship graph Cytoscape instance is missing.');
    }

    cy.nodes('.relationship-label').remove();
    const labelNodes = [];

    cy.edges('.relationship-edge').forEach(edge => {
      const source = edge.source()[0];
      const target = edge.target()[0];
      if (!source || !target) {
        throw new Error(`Relationship graph edge ${edge.id()} is missing a source or target node.`);
      }

      const presentation = calculateClockwiseEdgePresentation(source.position(), target.position());
      edge.style({
        'edge-distances': 'endpoints',
        'source-endpoint': presentation.sourceEndpoint,
        'target-endpoint': presentation.targetEndpoint,
        'control-point-distances': presentation.controlPointDistance
      });
      labelNodes.push(buildRelationshipLabelNode(edge, presentation));
    });

    if (labelNodes.length) {
      cy.add(labelNodes);
      cy.nodes('.relationship-label').forEach(labelNode => {
        labelNode.lock();
      });
    }
  }

  function finalizeRelationshipGraphLayout(cy) {
    updateRelationshipEdgeGeometry(cy);
    cy.fit(cy.elements(), 56);
  }

  function renderRelationshipGraph(elements) {
    const container = getRelationshipGraphContainer();
    if (!container) {
      throw new Error('Relationship graph container is missing.');
    }
    clearRelationshipGraphStatus(container);

    const cy = ensureRelationshipCytoscape(container);
    cy.add(elements);

    const layout = cy.layout(getLayoutOptions(elements.length));
    layout.on('layoutstop', () => {
      finalizeRelationshipGraphLayout(cy);
    });
    layout.run();
    cy.on('dragfree', 'node.relationship-character', () => {
      finalizeRelationshipGraphLayout(cy);
    });
    root.setTimeout?.(() => {
      try {
        finalizeRelationshipGraphLayout(cy);
      } catch (_) {
        // Cytoscape may already be destroyed if the tab reloads quickly.
      }
    }, 0);
  }

  async function loadRelationshipGraph() {
    const requestId = relationshipGraphRequestId + 1;
    relationshipGraphRequestId = requestId;
    const reloadButton = root.document?.getElementById('relationshipGraphReloadButton') || null;
    if (reloadButton) {
      reloadButton.disabled = true;
    }

    try {
      setRelationshipGraphStatus('Loading relationships...');
      if (typeof root.fetch !== 'function') {
        throw new Error('Fetch API not available; cannot load relationships.');
      }
      const response = await root.fetch('/api/players', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      if (!Array.isArray(data.players)) {
        throw new Error('/api/players did not return a players array.');
      }
      if (requestId !== relationshipGraphRequestId) {
        return null;
      }

      const elements = buildElements(data.players, data.currentPlayer || null);
      const hasEdges = elements.some(element => normalizeText(element?.data?.source));
      if (!hasEdges) {
        setRelationshipGraphStatus('No relationships recorded yet.');
        return elements;
      }

      renderRelationshipGraph(elements);
      return elements;
    } catch (error) {
      console.warn('Failed to load relationship graph:', error);
      if (requestId === relationshipGraphRequestId) {
        setRelationshipGraphStatus(`Failed to load relationships: ${error?.message || error}`, 'error');
      }
      return null;
    } finally {
      if (reloadButton && requestId === relationshipGraphRequestId) {
        reloadButton.disabled = false;
      }
    }
  }

  function initRelationshipGraphControls() {
    const reloadButton = root.document?.getElementById('relationshipGraphReloadButton') || null;
    reloadButton?.addEventListener('click', () => {
      loadRelationshipGraph();
    });
  }

  root.loadRelationshipGraph = loadRelationshipGraph;
  root.AIRPGRelationshipGraph = {
    buildElements,
    calculateClockwiseEdgePresentation,
    destroy: destroyRelationshipGraph,
    load: loadRelationshipGraph
  };

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', initRelationshipGraphControls);
    } else {
      initRelationshipGraphControls();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
