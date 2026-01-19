function registerLayouts() {
  if (typeof window.cytoscape === 'undefined') {
    return;
  }

  const cytoscape = window.cytoscape;

  if (!cytoscape.__fcoseRegistered && typeof window.cytoscapeFcose === 'function') {
    window.cytoscapeFcose(cytoscape);
    cytoscape.__fcoseRegistered = true;
  }

  if (!cytoscape.__eulerRegistered && typeof window.cytoscapeEuler === 'function') {
    window.cytoscapeEuler(cytoscape);
    cytoscape.__eulerRegistered = true;
  }
}

registerLayouts();

function getCytoscape(container) {
  const cy = window.cytoscape;
  if (!cy) {
    throw new Error('Cytoscape not loaded');
  }
  if (!cy.__fcoseRegistered && typeof window.cytoscapeFcose === 'function') {
    window.cytoscapeFcose(cy);
    cy.__fcoseRegistered = true;
  }
  return cy({ container });
}

let cyInstance = null;
let activeRegionId = null;
let linkSourceNodeId = null;
let linkModeActive = false;
let lastGhostPosition = null;
let edgeContextMenu = null;
const LINK_GHOST_NODE_ID = '__link-ghost__';
const LINK_GHOST_EDGE_ID = '__link-ghost-edge__';

function ensureCytoscape(container) {
  if (cyInstance) {
    cyInstance.destroy();
    cyInstance = null;
  }

  const cytoscape = getCytoscape(container);
  cytoscape.style([
    {
      selector: 'node',
      style: {
        'background-color': '#67e8f9',
        'label': 'data(label)',
        'color': '#0f172a',
        'font-size': '6px',

        // put the label *below* the node
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': '6px',     // push it further down (increase if you need more space)

        // label background + rounding
        'text-background-color': '#ffffff',
        'text-background-opacity': .8,          // solid
        'text-background-shape': 'roundrectangle',
        'text-background-padding': '2px',      // breathing room inside the pill
        'text-border-width': 0,                // set >0 if you want an outline
        // 'text-border-color': '#0f172a',
        // 'text-border-opacity': 1,

        // optional: keep long labels tidy
        'text-wrap': 'wrap',
        'text-max-width': '100px',

        'width': 62,
        'height': 62
      }
    },
    {
      selector: 'node.visited',
      style: {
        'border-width': 2,
        'border-color': '#facc15'
      }
    },
    {
      selector: 'node.visited[imageUrl]',
      style: {
        'background-image': 'data(imageUrl)',
        'background-fit': 'cover',
        'background-clip': 'node',
        'background-position-x': '50%',
        'background-position-y': '50%',
        'background-repeat': 'no-repeat',
        'border-width': 3,
        'border-color': '#facc15'
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'curve-style': 'bezier',
        'line-color': '#bae6fd',
        'target-arrow-color': '#bae6fd',
        'target-arrow-shape': 'triangle',
        'source-arrow-shape': 'none'
      }
    },
    {
      selector: 'edge.bidirectional',
      style: {
        'source-arrow-shape': 'triangle',
        'source-arrow-color': '#bae6fd'
      }
    },
    {
      selector: 'edge.link-ghost-edge',
      style: {
        'width': 2,
        'curve-style': 'bezier',
        'line-color': '#fbbf24',
        'target-arrow-color': '#fbbf24',
        'target-arrow-shape': 'triangle',
        'line-style': 'dashed',
        'opacity': 0.85
      }
    },
    {
      selector: 'node.link-ghost-node',
      style: {
        'width': 1,
        'height': 1,
        'opacity': 0,
        'border-width': 0
      }
    },
    {
      selector: '.current',
      style: {
        'border-color': '#ea580c',
        'border-width': 4,
        'shadow-blur': 15,
        'shadow-color': '#ea580c'
      }
    },
    {
      selector: '.stub',
      style: {
        'background-color': '#f472b6'
      }
    },
    {
      selector: 'node.region-exit',
      style: {
        'background-color': '#22c55e',
        'width': 28,
        'height': 28,
        'label': 'data(regionName)',
        'font-size': '9px',
        'font-weight': 500,
        'color': '#ccfbf1',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': '8px',
        'text-outline-width': 3,
        'text-outline-color': 'rgba(15, 23, 42, 0.85)',
        'text-background-opacity': 0,
        'border-width': 2,
        'border-color': '#047857',
        'background-image': 'data(symbolImage)',
        'background-fit': 'cover',
        'background-clip': 'node',
        'shadow-blur': 4,
        'shadow-color': 'rgba(16, 185, 129, 0.35)'
      }
    },
    {
      selector: 'node.region-exit.region-exit-expanded',
      style: {
        'border-color': '#10b981',
        'cursor': 'pointer'
      }
    },
    {
      selector: 'node.region-exit.region-exit-unexpanded',
      style: {
        'border-style': 'dashed',
        'background-color': '#6ee7b7',
        'cursor': 'not-allowed'
      }
    },
    {
      selector: 'edge.region-exit-edge',
      style: {
        'width': 2,
        'curve-style': 'bezier',
        'line-color': '#34d399',
        'target-arrow-color': '#34d399',
        'target-arrow-shape': 'triangle',
        'target-distance-from-node': 12
      }
    }
  ]);
  cytoscape.zoomingEnabled(true);
  cytoscape.userZoomingEnabled(true);
  cytoscape.userPanningEnabled(true);
  cyInstance = cytoscape;
  return cyInstance;
}


function loadRegionMap(regionId = null) {
  const container = document.getElementById('mapContainer');
  if (!container) return;

  container.classList.add('map-placeholder');
  container.textContent = 'Loading map...';

  const titleEl = document.getElementById('mapTitle');
  if (titleEl) {
    titleEl.textContent = 'Loading region…';
  }

  let url = '/api/map/region';
  if (regionId) {
    url += `?regionId=${encodeURIComponent(regionId)}`;
  }

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        showMapError(data.error || 'Failed to load region map');
        return;
      }
      renderMap(data.region);
    })
    .catch(err => showMapError(err.message));
}

function renderMap(region) {
  const container = document.getElementById('mapContainer');
  if (!container) return;

  container.classList.remove('map-placeholder');
  container.innerHTML = '';
  container.dataset.regionId = region.regionId || '';
  container.dataset.regionName = region.regionName || '';
  if (region.regionName) {
    container.setAttribute('aria-label', `Region map for ${region.regionName}`);
  } else {
    container.removeAttribute('aria-label');
  }

  const titleEl = document.getElementById('mapTitle');
  if (titleEl) {
    titleEl.textContent = region.regionName || 'Region Map';
  }

  const cy = ensureCytoscape(container);
  activeRegionId = region.regionId || null;

  const locationIdSet = new Set((region.locations || []).map(loc => loc.id));

  const nodes = region.locations.map(loc => {
    const data = {
      id: loc.id,
      label: loc.name,
      isStub: Boolean(loc.isStub),
      visited: Boolean(loc.visited)
    };
    if (loc.image && typeof loc.image.url === 'string' && loc.image.url.trim()) {
      data.imageUrl = loc.image.url;
    }
    return { data };
  });

  const internalEdgeMap = new Map();
  const regionExitNodes = new Map();
  const regionExitEdges = [];

  for (const loc of region.locations) {
    for (const exit of loc.exits || []) {
      const destinationId = exit.destination;
      const destinationRegionId = exit.destinationRegion || null;
      const isRegionExit = Boolean(destinationRegionId) && !locationIdSet.has(destinationId);
      const isRegionStubTarget = isRegionExit && Boolean(destinationId);

      if (isRegionExit) {
        if (!destinationRegionId) {
          continue;
        }

        const exitNodeId = `region-exit-${exit.id}`;
        const regionName = exit.destinationRegionName || exit.destinationName || 'Unnamed Region';
        const expanded = Boolean(exit.destinationRegionExpanded);
        const symbol = expanded ? '⬈' : '?';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="white" fill-opacity="0"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="80">${symbol}</text></svg>`;
        const symbolImage = `data:image/svg+xml,${encodeURIComponent(svg)}`;

        if (!regionExitNodes.has(exitNodeId)) {
          regionExitNodes.set(exitNodeId, {
            data: {
              id: exitNodeId,
              symbol,
              symbolImage,
              regionName,
              targetRegionId: destinationRegionId,
              expanded,
              isStub: Boolean(isRegionStubTarget),
              stubId: isRegionStubTarget ? destinationId : null
            },
            classes: expanded ? 'region-exit region-exit-expanded' : 'region-exit region-exit-unexpanded'
          });
        }

        regionExitEdges.push({
          data: {
            id: `${loc.id}_${exitNodeId}`,
            source: loc.id,
            target: exitNodeId,
            regionName
          },
          classes: 'region-exit-edge'
        });
        continue;
      }

      if (!destinationId || !locationIdSet.has(destinationId)) {
        continue;
      }

      const key = `${loc.id}->${destinationId}`;
      const reverseKey = `${destinationId}->${loc.id}`;
      const isBidirectional = exit.bidirectional !== false;

      if (internalEdgeMap.has(reverseKey)) {
        const existing = internalEdgeMap.get(reverseKey);
        existing.data.bidirectional = true;
        existing.classes = 'bidirectional';
        existing.data.reverseExitId = existing.data.reverseExitId || exit.id || null;
        continue;
      }

      if (!internalEdgeMap.has(key)) {
        internalEdgeMap.set(key, {
          data: {
            id: `${loc.id}_${destinationId}`,
            source: loc.id,
            target: destinationId,
            bidirectional: isBidirectional,
            forwardExitId: exit.id || null
          },
          classes: isBidirectional ? 'bidirectional' : undefined
        });
      }
    }
  }

  const internalEdges = Array.from(internalEdgeMap.values());

  cy.elements().remove();
  cy.add([
    ...nodes,
    ...Array.from(regionExitNodes.values()),
    ...internalEdges,
    ...regionExitEdges
  ]);

  cy.nodes().forEach(node => node.toggleClass('stub', node.data('isStub')));
  cy.nodes().forEach(node => node.toggleClass('visited', node.data('visited')));
  const runLayout = (options = {}) => {
    if (!cyInstance) return;
    const layout = cyInstance.layout({
      name: 'fcose',
      animate: true,
      animationDuration: 600,
      animationEasing: 'ease-out',
      randomize: false,
      fit: false,
      ...options
    });
    layout.run();
  };

  runLayout({ randomize: true, fit: true });
  cy.boxSelectionEnabled(false);
  cy.nodes().grabify();

  cy.nodes().removeClass('current');
  if (region.currentLocationId) {
    const current = cy.getElementById(region.currentLocationId);
    if (current) current.addClass('current');
  }

  cy.on('tap', 'node.region-exit.region-exit-expanded', event => {
    const node = event.target;
    const targetRegionId = node.data('targetRegionId');
    if (targetRegionId) {
      loadRegionMap(targetRegionId);
    }
  });

  cy.on('tap', 'node', event => {
    const node = event.target;
    if (!node || node.hasClass('region-exit')) {
      return;
    }
    const locationId = node.id();
    if (!locationId) {
      return;
    }
    if (!node.data('visited')) {
      return;
    }
    if (node.hasClass('current')) {
      return;
    }
    if (linkSourceNodeId) {
      // Link mode tap handling is managed by tapend; ignore here.
      return;
    }
    if (typeof window.travelToAdjacentLocationFromMap === 'function') {
      window.travelToAdjacentLocationFromMap(locationId, { focusAdventureTab: true });
    }
  });

  cy.on('cxttap', 'node', event => {
    const node = event.target;
    if (!node) {
      return;
    }
    const isStubNode = Boolean(node.data('isStub'));
    const locationId = node.id();
    if (!locationId) {
      return;
    }
    if (event.originalEvent) {
      event.originalEvent.preventDefault?.();
      event.originalEvent.stopPropagation?.();
    }
    const anchorPoint = (() => {
      if (event.originalEvent && Number.isFinite(event.originalEvent.clientX) && Number.isFinite(event.originalEvent.clientY)) {
        return { x: event.originalEvent.clientX, y: event.originalEvent.clientY };
      }
      if (event.renderedPosition && container) {
        const rect = container.getBoundingClientRect();
        return { x: rect.left + event.renderedPosition.x, y: rect.top + event.renderedPosition.y };
      }
      return null;
    })();
    if (isStubNode) {
      if (anchorPoint) {
        openStubContextMenu(node, anchorPoint);
      }
      return;
    }
    if (node.hasClass('region-exit')) {
      return;
    }
    if (typeof window.openLocationContextMenuForLocationId === 'function') {
      window.openLocationContextMenuForLocationId(locationId, {
        useFloatingMenu: true,
        focusAdventureTab: false,
        anchorPoint
      });
    }
  });

  const resetLinkMode = () => {
    linkSourceNodeId = null;
    linkModeActive = false;
    lastGhostPosition = null;
    if (cyInstance) {
      cyInstance.remove(`#${LINK_GHOST_EDGE_ID}`);
      cyInstance.remove(`#${LINK_GHOST_NODE_ID}`);
    }
    if (cyInstance) {
      cyInstance.nodes().grabify();
    }
  };

  const ensureGhostLink = (sourceId, position) => {
    if (!cyInstance || !position) {
      return;
    }

    cyInstance.remove(`#${LINK_GHOST_EDGE_ID}`);
    cyInstance.remove(`#${LINK_GHOST_NODE_ID}`);

    const ghostNode = cyInstance.add({
      group: 'nodes',
      data: { id: LINK_GHOST_NODE_ID },
      position,
      classes: 'link-ghost-node',
      grabbable: false,
      locked: true
    });

    const ghostEdge = cyInstance.add({
      group: 'edges',
      data: {
        id: LINK_GHOST_EDGE_ID,
        source: sourceId,
        target: LINK_GHOST_NODE_ID
      },
      classes: 'link-ghost-edge'
    });
    ghostEdge.style({ visibility: 'visible', opacity: 0.95 });
    lastGhostPosition = position;
  };

  const toModelPosition = (event) => {
    if (!cyInstance || !container) {
      return null;
    }
    if (event?.position) {
      return event.position;
    }
    const original = event?.originalEvent;
    if (!original || !Number.isFinite(original.clientX) || !Number.isFinite(original.clientY)) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    const pan = cyInstance.pan();
    const zoom = cyInstance.zoom();
    return {
      x: (original.clientX - rect.left - pan.x) / zoom,
      y: (original.clientY - rect.top - pan.y) / zoom
    };
  };

  const addStubNodeAndEdge = ({ sourceId, created, position, exitId = null, preservePosition = false }) => {
    if (!cyInstance || !sourceId || !created) {
      return false;
    }

    const nodeId = created.destinationId || created.stubId || null;
    if (!nodeId) {
      return false;
    }
    const label = created.name || 'New Stub';
    const isRegionStub = created.type === 'region';

    let node = cyInstance.getElementById(nodeId);
    if (!node || node.empty()) {
      node = cyInstance.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label,
          isStub: true,
          visited: false,
          ...(isRegionStub ? { regionName: created.name || label, targetRegionId: created.destinationId || null } : {})
        },
        position: position || undefined
      });
    } else if (position) {
      node.position(position);
    }
    node.addClass(isRegionStub ? 'region-exit region-exit-unexpanded' : 'stub');

    const edgeId = `${sourceId}_${nodeId}`;
    let edge = cyInstance.getElementById(edgeId);
    if (!edge || edge.empty()) {
      edge = cyInstance.add({
        group: 'edges',
        data: {
          id: edgeId,
          source: sourceId,
          target: nodeId,
          bidirectional: true
        },
        classes: 'bidirectional'
      });
    } else {
      edge.addClass('bidirectional');
      edge.data('bidirectional', true);
    }

    if (exitId && edge) {
      edge.data('forwardExitId', exitId);
    }

    if (!preservePosition) {
      runLayout();
    }
    return true;
  };

  window.addMapStubNodeAndEdge = ({ sourceId, created, position, exitId = null, preservePosition = false } = {}) => (
    addStubNodeAndEdge({ sourceId, created, position, exitId, preservePosition })
  );

  const findExitIdForDestination = (locationData, destinationId) => {
    if (!locationData || !destinationId) {
      return null;
    }
    const exits = locationData.exits || null;
    if (Array.isArray(exits)) {
      const match = exits.find(ex => ex && ex.destination === destinationId);
      return match?.id || null;
    }
    if (exits && typeof exits === 'object') {
      for (const exit of Object.values(exits)) {
        if (exit && exit.destination === destinationId) {
          return exit.id || null;
        }
      }
    }
    return null;
  };

  const createStubExit = async ({ sourceId, position, name, description, type, vehicleType, relativeLevel, imageDataUrl }) => {
    const payload = {
      type,
      name,
      description: description || '',
      clientId: window.AIRPG_CLIENT_ID || null
    };

    if (relativeLevel !== null && relativeLevel !== undefined) {
      payload.relativeLevel = relativeLevel;
    }

    if (type === 'region' && vehicleType) {
      payload.vehicleType = vehicleType;
    }

    if (imageDataUrl) {
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
        throw new Error('Reference image must be a base64-encoded data URL.');
      }
      payload.imageDataUrl = imageDataUrl;
    }

    if (type === 'region') {
      payload.parentRegionId = activeRegionId || null;
    } else {
      payload.targetRegionId = activeRegionId || null;
    }

    const response = await fetch(`/api/locations/${encodeURIComponent(sourceId)}/exits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success) {
      const message = result?.error || 'Failed to create stub';
      throw new Error(message);
    }

    if (result?.created) {
      addStubNodeAndEdge({ sourceId, created: result.created, position });
      const exitId = findExitIdForDestination(result?.location, result?.created?.destinationId || null);
      const edge = cyInstance ? cyInstance.getElementById(`${sourceId}_${result?.created?.destinationId}`) : null;
      if (edge && edge.nonempty() && exitId) {
        edge.data('forwardExitId', exitId);
      }
    }
  };

  const downscaleImageDataUrl = (dataUrl, outputType, label = 'Image') => {
    const maxPixels = 2000000;
    const labelText = label || 'Image';
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        reject(new Error(`${labelText} data is missing.`));
        return;
      }
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          reject(new Error(`${labelText} dimensions are invalid.`));
          return;
        }

        const pixelCount = width * height;
        if (pixelCount <= maxPixels) {
          resolve(dataUrl);
          return;
        }

        const scale = Math.sqrt(maxPixels / pixelCount);
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error(`${labelText} resizing failed to initialize.`));
          return;
        }
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        const normalizedType = outputType && outputType.startsWith('image/')
          ? outputType
          : 'image/jpeg';
        const supportsQuality = normalizedType === 'image/jpeg' || normalizedType === 'image/webp';
        const resizedDataUrl = supportsQuality
          ? canvas.toDataURL(normalizedType, 0.9)
          : canvas.toDataURL(normalizedType);
        resolve(resizedDataUrl);
      };
      image.onerror = () => reject(new Error(`${labelText} could not be loaded.`));
      image.src = dataUrl;
    });
  };

  const readStubImageData = async (file) => {
    if (!file) {
      return '';
    }
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Reference image must be an image file.');
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Reference image could not be read.'));
      };
      reader.onerror = () => reject(new Error('Reference image could not be read.'));
      reader.readAsDataURL(file);
    });
    return downscaleImageDataUrl(dataUrl, file.type, 'Reference image');
  };

  const openCreateStubModal = ({ sourceId, position }) => {
    if (!sourceId) {
      window.alert('No source location provided for creating a new exit.');
      return;
    }
    if (typeof window.openNewExitModalFromMap !== 'function') {
      window.alert('New exit form is unavailable.');
      return;
    }
    try {
      const mapPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: position.x, y: position.y }
        : null;
      window.openNewExitModalFromMap({
        originLocationId: sourceId,
        originRegionId: activeRegionId,
        preferredRegionId: activeRegionId,
        mapPosition
      });
    } catch (error) {
      window.alert(error?.message || 'Failed to open the new exit form.');
    }
  };

  const enterLinkMode = (sourceId, position) => {
    linkSourceNodeId = sourceId;
    linkModeActive = true;
    if (cyInstance) {
      cyInstance.nodes().ungrabify();
    }
    ensureGhostLink(sourceId, position);
  };

  cy.on('tapstart', 'node', event => {
    const { originalEvent } = event;
    if (!originalEvent || !originalEvent.shiftKey) {
      return;
    }
    const node = event.target;
    if (!node || node.hasClass('region-exit')) {
      return;
    }
    const startPosition = toModelPosition(event) || node.position();
    enterLinkMode(node.id(), startPosition);
  });

  cy.on('tapend', 'node', async event => {
    if (!linkSourceNodeId) {
      return;
    }
    const sourceId = linkSourceNodeId;
    const dropPosition = toModelPosition(event) || event.position || event.cyPosition || lastGhostPosition || null;

    const findTargetNode = () => {
      if (!cyInstance) {
        return null;
      }
      const pos = toModelPosition(event) || event.position || event.cyPosition || null;
      if (!pos) {
        return null;
      }
      const candidates = cyInstance.nodes().filter(n => {
        if (n.id && n.id() === LINK_GHOST_NODE_ID) return false;
        if (n.hasClass('region-exit')) return false;
        const bb = n.boundingBox();
        return pos.x >= bb.x1 && pos.x <= bb.x2 && pos.y >= bb.y1 && pos.y <= bb.y2;
      });
      return candidates && candidates.length ? candidates[0] : null;
    };

    let node = event.target;
    if (node && node.id && node.id() === LINK_GHOST_NODE_ID) {
      const fallbackNode = findTargetNode();
      node = fallbackNode;
    }

    resetLinkMode();

    if (!node || node.hasClass('link-ghost-node')) {
      openCreateStubModal({ sourceId, position: dropPosition });
      return;
    }
    if (!node || node.hasClass('region-exit')) {
      return;
    }
    const targetId = node.id();
    if (!targetId || node.hasClass('link-ghost-node')) {
      return;
    }
    if (!targetId || targetId === sourceId) {
      return;
    }

    const existingEdges = cyInstance ? cyInstance.$(
      `edge[source = "${sourceId}"][target = "${targetId}"], edge[source = "${targetId}"][target = "${sourceId}"]`
    ) : null;
    if (existingEdges && existingEdges.length) {
      window.alert('An exit already exists between these locations.');
      return;
    }

    const addBidirectionalEdge = () => {
      if (!cyInstance) {
        return;
      }
      const forwardId = `${sourceId}_${targetId}`;
      const reverseId = `${targetId}_${sourceId}`;
      const forward = cyInstance.getElementById(forwardId);
      const reverse = cyInstance.getElementById(reverseId);

      if (forward && forward.nonempty()) {
        forward.addClass('bidirectional');
        forward.data('bidirectional', true);
        return;
      }
      if (reverse && reverse.nonempty()) {
        reverse.addClass('bidirectional');
        reverse.data('bidirectional', true);
        return;
      }

      cyInstance.add({
        group: 'edges',
        data: {
          id: forwardId,
          source: sourceId,
          target: targetId,
          bidirectional: true
        },
        classes: 'bidirectional'
      });
      runLayout();
    };

    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(sourceId)}/exits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'location',
          locationId: targetId,
          clientId: window.AIRPG_CLIENT_ID || null
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        const message = result?.error || `Failed to create exit between ${sourceId} and ${targetId}`;
        window.alert(message);
        return;
      }
      addBidirectionalEdge();
      const exitId = findExitIdForDestination(result?.location, targetId);
      const edge = cyInstance ? cyInstance.getElementById(`${sourceId}_${targetId}`) : null;
      if (edge && edge.nonempty() && exitId) {
        edge.data('forwardExitId', exitId);
      }
    } catch (error) {
      console.warn('Failed to create bidirectional exit:', error);
      window.alert(`Failed to create exit: ${error?.message || error}`);
    }
  });

  cy.on('tap', event => {
    if (event.target === cy || event.target.group && event.target.group() === 'edges') {
      resetLinkMode();
    }
  });

  const updateGhostLinkPosition = (event) => {
    if (!linkModeActive || !linkSourceNodeId) {
      return;
    }
    const position = toModelPosition(event) || event.cyPosition || event.position || null;
    if (!position) {
      return;
    }
    ensureGhostLink(linkSourceNodeId, position);
  };

  cy.on('mousemove', updateGhostLinkPosition);
  cy.on('tapdrag', updateGhostLinkPosition);

  const domPointerMoveHandler = (evt) => {
    if (!linkModeActive || !linkSourceNodeId) {
      return;
    }
    const position = toModelPosition({ originalEvent: evt });
    if (!position) {
      return;
    }
    ensureGhostLink(linkSourceNodeId, position);
  };
  container.addEventListener('pointermove', domPointerMoveHandler);

  const findEdgeAtPosition = (position) => {
    if (!cyInstance || !position) {
      return null;
    }
    const edges = cyInstance.edges().filter(edge => {
      if (edge.hasClass('link-ghost-edge')) {
        return false;
      }
      const bb = edge.boundingBox();
      return position.x >= bb.x1 && position.x <= bb.x2 && position.y >= bb.y1 && position.y <= bb.y2;
    });
    return edges && edges.length ? edges[0] : null;
  };

  const findNodeAtPosition = (position) => {
    if (!cyInstance || !position) {
      return null;
    }
    const nodes = cyInstance.nodes().filter(node => {
      if (node.hasClass('link-ghost-node')) {
        return false;
      }
      const bb = node.boundingBox();
      return position.x >= bb.x1 && position.x <= bb.x2 && position.y >= bb.y1 && position.y <= bb.y2;
    });
    return nodes && nodes.length ? nodes[0] : null;
  };

  const closeEdgeMenu = () => {
    if (edgeContextMenu) {
      edgeContextMenu.remove();
      edgeContextMenu = null;
    }
  };

  const fetchStubInfo = async (stubId) => {
    if (!stubId) return null;
    const response = await fetch(`/api/stubs/${encodeURIComponent(stubId)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success || !result?.stub) {
      throw new Error(result?.error || `Failed to load stub '${stubId}'`);
    }
    return result.stub;
  };

  const deleteStub = async (stubId) => {
    const response = await fetch(`/api/stubs/${encodeURIComponent(stubId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: window.AIRPG_CLIENT_ID || null })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || `Failed to delete stub '${stubId}'`);
    }
    return result;
  };

  const deleteEdgeAndExit = async (edge) => {
    if (!edge || !cyInstance) {
      return;
    }
    const sourceId = edge.data('source');
    const targetId = edge.data('target');
    const forwardExitId = edge.data('forwardExitId') || null;
    const reverseExitId = edge.data('reverseExitId') || null;

    const performDelete = async (originId, exitId) => {
      if (!originId || !exitId) return;
      const clientId = window.AIRPG_CLIENT_ID || null;
      if (!clientId) {
        console.warn('Client ID missing; deletion will not be tagged as self-initiated.');
      }
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const response = await fetch(`/api/locations/${encodeURIComponent(originId)}/exits/${encodeURIComponent(exitId)}${query}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result?.error || `Failed to delete exit '${exitId}'`);
      }
    };

    if (forwardExitId) {
      await performDelete(sourceId, forwardExitId);
    } else if (reverseExitId) {
      await performDelete(targetId, reverseExitId);
    } else {
      throw new Error('No exit id available for deletion.');
    }

    cyInstance.remove(edge);
    runLayout();
  };

  const openEdgeContextMenu = (edge, anchorPoint) => {
    closeEdgeMenu();
    const menu = document.createElement('div');
    menu.className = 'map-edge-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${anchorPoint.x}px`;
    menu.style.top = `${anchorPoint.y}px`;
    menu.style.background = '#0f172a';
    menu.style.color = '#e2e8f0';
    menu.style.border = '1px solid rgba(255,255,255,0.15)';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.zIndex = '2100';
    menu.style.minWidth = '160px';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete exit';
    deleteBtn.style.width = '100%';
    deleteBtn.style.padding = '8px 10px';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.color = '#f87171';
    deleteBtn.style.textAlign = 'left';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.addEventListener('mouseover', () => {
      deleteBtn.style.background = 'rgba(248,113,113,0.08)';
    });
    deleteBtn.addEventListener('mouseout', () => {
      deleteBtn.style.background = 'transparent';
    });
    deleteBtn.addEventListener('click', async () => {
      try {
        await deleteEdgeAndExit(edge);
      } catch (error) {
        window.alert(error?.message || 'Failed to delete exit');
      } finally {
        closeEdgeMenu();
      }
    });

    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);
    edgeContextMenu = menu;

    const onOutside = (evt) => {
      if (!edgeContextMenu) return;
      if (!edgeContextMenu.contains(evt.target)) {
        closeEdgeMenu();
        document.removeEventListener('mousedown', onOutside);
        document.removeEventListener('contextmenu', onOutside);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('contextmenu', onOutside);
  };

  const openStubContextMenu = (node, anchorPoint) => {
    closeEdgeMenu();
    const stubId = node?.data ? (node.data('stubId') || node.id()) : (node?.id?.() || null);
    if (!stubId) {
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'map-edge-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${anchorPoint.x}px`;
    menu.style.top = `${anchorPoint.y}px`;
    menu.style.background = '#0f172a';
    menu.style.color = '#e2e8f0';
    menu.style.border = '1px solid rgba(255,255,255,0.15)';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.zIndex = '2100';
    menu.style.minWidth = '180px';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete stub';
    deleteBtn.style.width = '100%';
    deleteBtn.style.padding = '8px 10px';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.color = '#f87171';
    deleteBtn.style.textAlign = 'left';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.addEventListener('mouseover', () => {
      deleteBtn.style.background = 'rgba(248,113,113,0.08)';
    });
    deleteBtn.addEventListener('mouseout', () => {
      deleteBtn.style.background = 'transparent';
    });
    deleteBtn.addEventListener('click', async () => {
      try {
        const info = await fetchStubInfo(stubId);
        const npcList = Array.isArray(info?.npcs) ? info.npcs : [];
        if (npcList.length) {
          const npcNames = npcList.map(npc => `- ${npc.name || npc.id}`).join('\n');
          const confirmed = window.confirm(
            `This stub has NPCs present:\n${npcNames}\n\nDeleting the stub will remove these NPCs and all connected exits. Continue?`
          );
          if (!confirmed) {
            return;
          }
        } else {
          const confirmed = window.confirm('Delete this stub and all connected exits?');
          if (!confirmed) {
            return;
          }
        }
        await deleteStub(stubId);
        const connected = node.connectedEdges();
        if (connected && connected.length) {
          cyInstance.remove(connected);
        }
        cyInstance.remove(node);
        runLayout();
      } catch (error) {
        window.alert(error?.message || 'Failed to delete stub');
      } finally {
        closeEdgeMenu();
      }
    });

    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);
    edgeContextMenu = menu;

    const onOutside = (evt) => {
      if (!edgeContextMenu) return;
      if (!edgeContextMenu.contains(evt.target)) {
        closeEdgeMenu();
        document.removeEventListener('mousedown', onOutside);
        document.removeEventListener('contextmenu', onOutside);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('contextmenu', onOutside);
  };

  cy.on('cxttap', 'edge', event => {
    const edge = event.target;
    if (!edge || edge.hasClass('link-ghost-edge')) {
      return;
    }
    const originalEvent = event.originalEvent;
    if (originalEvent) {
      originalEvent.preventDefault?.();
      originalEvent.stopPropagation?.();
    }
    let anchorPoint = null;
    if (originalEvent && Number.isFinite(originalEvent.clientX) && Number.isFinite(originalEvent.clientY)) {
      anchorPoint = { x: originalEvent.clientX, y: originalEvent.clientY };
    } else if (event.renderedPosition && container) {
      const rect = container.getBoundingClientRect();
      anchorPoint = {
        x: rect.left + event.renderedPosition.x,
        y: rect.top + event.renderedPosition.y
      };
    }
    if (anchorPoint) {
      openEdgeContextMenu(edge, anchorPoint);
    }
  });

  container.addEventListener('contextmenu', evt => {
    const position = toModelPosition({ originalEvent: evt });
    const node = findNodeAtPosition(position);
    if (node && node.data('isStub')) {
      evt.preventDefault();
      evt.stopPropagation();
      openStubContextMenu(node, { x: evt.clientX, y: evt.clientY });
      return;
    }
    const edge = findEdgeAtPosition(position);
    if (!edge) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    openEdgeContextMenu(edge, { x: evt.clientX, y: evt.clientY });
  });
}

function showMapError(message) {
  const container = document.getElementById('mapContainer');
  if (container) {
    container.classList.add('map-placeholder');
    container.textContent = message;
  }

  const titleEl = document.getElementById('mapTitle');
  if (titleEl) {
    titleEl.textContent = 'Region Map';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const mapTab = document.querySelector('[data-tab="map"]');
  if (mapTab) {
    mapTab.addEventListener('click', () => {
      setTimeout(loadRegionMap, 100);
    });
  }
});

window.loadRegionMap = loadRegionMap;
