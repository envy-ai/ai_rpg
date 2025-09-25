function registerLayouts() {
  if (typeof window.cytoscape !== 'undefined' && typeof window.cytoscapeFcose === 'function') {
    window.cytoscapeFcose(window.cytoscape);
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
        'label': 'data(symbol)',
        'font-size': '14px',
        'color': '#064e3b',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-background-opacity': 0,
        'border-width': 2,
        'border-color': '#047857',
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
        if (!regionExitNodes.has(exitNodeId)) {
          const expanded = Boolean(exit.destinationRegionExpanded);
          const regionName = exit.destinationRegionName || 'Uncharted Region';
          regionExitNodes.set(exitNodeId, {
            data: {
              id: exitNodeId,
              symbol: expanded ? '⬈' : '?',
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
            target: exitNodeId
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
  cy.layout({ name: 'fcose', animate: true, randomize: true }).run();

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
}

function showMapError(message) {
  const container = document.getElementById('mapContainer');
  if (container) {
    container.classList.add('map-placeholder');
    container.textContent = message;
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
