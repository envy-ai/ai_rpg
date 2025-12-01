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
              expanded
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
        continue;
      }

      if (!internalEdgeMap.has(key)) {
        internalEdgeMap.set(key, {
          data: {
            id: `${loc.id}_${destinationId}`,
            source: loc.id,
            target: destinationId,
            bidirectional: isBidirectional
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
    if (!node || node.hasClass('region-exit')) {
      return;
    }
    const locationId = node.id();
    if (!locationId) {
      return;
    }
    if (event.originalEvent) {
      event.originalEvent.preventDefault?.();
      event.originalEvent.stopPropagation?.();
    }
    if (typeof window.openLocationContextMenuForLocationId === 'function') {
      let anchorPoint = null;
      if (event.originalEvent && Number.isFinite(event.originalEvent.clientX) && Number.isFinite(event.originalEvent.clientY)) {
        anchorPoint = {
          x: event.originalEvent.clientX,
          y: event.originalEvent.clientY
        };
      } else if (event.renderedPosition && container) {
        const rect = container.getBoundingClientRect();
        anchorPoint = {
          x: rect.left + event.renderedPosition.x,
          y: rect.top + event.renderedPosition.y
        };
      }
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

  const addStubNodeAndEdge = ({ sourceId, created, position }) => {
    if (!cyInstance || !sourceId || !created) {
      return;
    }

    const nodeId = created.destinationId || created.stubId || null;
    if (!nodeId) {
      return;
    }
    const label = created.name || 'New Stub';

    let node = cyInstance.getElementById(nodeId);
    if (!node || node.empty()) {
      node = cyInstance.add({
        group: 'nodes',
        data: {
          id: nodeId,
          label,
          isStub: true,
          visited: false
        },
        position: position || undefined
      });
    } else if (position) {
      node.position(position);
    }
    node.addClass('stub');

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

    runLayout();
  };

  const createStubExit = async ({ sourceId, position, name, description, type }) => {
    const payload = {
      type,
      name,
      description: description || '',
      clientId: window.AIRPG_CLIENT_ID || null
    };

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
    }
  };

  const openCreateStubModal = ({ sourceId, position }) => {
    if (!sourceId || !position) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'map-stub-modal__overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2000';

    const dialog = document.createElement('div');
    dialog.className = 'map-stub-modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.background = '#0f172a';
    dialog.style.color = '#e2e8f0';
    dialog.style.borderRadius = '12px';
    dialog.style.boxShadow = '0 18px 55px rgba(0,0,0,0.35)';
    dialog.style.padding = '18px';
    dialog.style.width = '360px';
    dialog.style.maxWidth = '90vw';
    dialog.style.border = '1px solid rgba(255,255,255,0.08)';

    const title = document.createElement('h3');
    title.textContent = 'Create stub';
    title.style.margin = '0 0 12px';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';

    const form = document.createElement('form');
    form.className = 'map-stub-modal__form';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '10px';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    nameLabel.style.fontSize = '13px';
    nameLabel.style.fontWeight = '600';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.style.width = '100%';
    nameInput.style.padding = '8px';
    nameInput.style.borderRadius = '8px';
    nameInput.style.border = '1px solid rgba(255,255,255,0.15)';
    nameInput.style.background = '#0b1220';
    nameInput.style.color = '#e2e8f0';
    nameLabel.appendChild(nameInput);

    const descLabel = document.createElement('label');
    descLabel.textContent = 'Description (optional)';
    descLabel.style.fontSize = '13px';
    descLabel.style.fontWeight = '600';
    const descInput = document.createElement('textarea');
    descInput.rows = 3;
    descInput.style.width = '100%';
    descInput.style.padding = '8px';
    descInput.style.borderRadius = '8px';
    descInput.style.border = '1px solid rgba(255,255,255,0.15)';
    descInput.style.background = '#0b1220';
    descInput.style.color = '#e2e8f0';
    descLabel.appendChild(descInput);

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Type';
    typeLabel.style.fontSize = '13px';
    typeLabel.style.fontWeight = '600';
    const typeSelect = document.createElement('select');
    typeSelect.style.width = '100%';
    typeSelect.style.padding = '8px';
    typeSelect.style.borderRadius = '8px';
    typeSelect.style.border = '1px solid rgba(255,255,255,0.15)';
    typeSelect.style.background = '#0b1220';
    typeSelect.style.color = '#e2e8f0';
    const optionLocation = document.createElement('option');
    optionLocation.value = 'location';
    optionLocation.textContent = 'Location';
    const optionRegion = document.createElement('option');
    optionRegion.value = 'region';
    optionRegion.textContent = 'Region';
    typeSelect.appendChild(optionLocation);
    typeSelect.appendChild(optionRegion);
    typeLabel.appendChild(typeSelect);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
    actions.style.marginTop = '4px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '8px 12px';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.border = '1px solid rgba(255,255,255,0.2)';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = '#e2e8f0';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Create';
    submitBtn.style.padding = '8px 12px';
    submitBtn.style.borderRadius = '8px';
    submitBtn.style.border = 'none';
    submitBtn.style.background = '#38bdf8';
    submitBtn.style.color = '#0b1220';
    submitBtn.style.fontWeight = '700';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);

    form.appendChild(nameLabel);
    form.appendChild(descLabel);
    form.appendChild(typeLabel);
    form.appendChild(actions);

    dialog.appendChild(title);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
    };

    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) {
        close();
      }
    });

    cancelBtn.addEventListener('click', () => {
      close();
    });

    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const name = nameInput.value.trim();
      const description = descInput.value.trim();
      const type = typeSelect.value === 'region' ? 'region' : 'location';
      if (!name) {
        nameInput.focus();
        return;
      }
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await createStubExit({ sourceId, position, name, description, type });
        close();
      } catch (error) {
        window.alert(error?.message || 'Failed to create stub');
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    nameInput.focus();
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
