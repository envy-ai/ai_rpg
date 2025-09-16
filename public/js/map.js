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

function ensureCytoscape(container) {
  if (!cyInstance) {
    const cytoscape = getCytoscape(container);
    cytoscape.style([
      {
        selector: 'node',
        style: {
          'background-color': '#67e8f9',
          'label': 'data(label)',
          'color': '#0f172a',
          'font-size': '14px',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 62,
          'height': 62
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
            'source-arrow-shape': 'triangle'
          }
        },
        {
          selector: '.current',
          style: {
          'background-color': '#facc15',
          'border-color': '#ea580c',
          'border-width': 4
        }
      },
      {
        selector: '.stub',
        style: {
          'background-color': '#f472b6'
        }
      }
    ]);
    cytoscape.zoomingEnabled(true);
    cytoscape.userZoomingEnabled(true);
    cytoscape.userPanningEnabled(true);
    cyInstance = cytoscape;
  }
  return cyInstance;
}

function loadRegionMap() {
  const container = document.getElementById('mapContainer');
  if (!container) return;

  container.classList.add('map-placeholder');
  container.textContent = 'Loading map...';

  fetch('/api/map/region')
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

  const cy = ensureCytoscape(container);
  const nodes = region.locations.map(loc => ({
    data: {
      id: loc.id,
      label: loc.name,
      isStub: Boolean(loc.isStub)
    }
  }));

  const edgeMap = new Map();
  for (const loc of region.locations) {
    for (const exit of loc.exits || []) {
      if (!exit.destination) continue;

      const key = `${loc.id}->${exit.destination}`;
      const reverseKey = `${exit.destination}->${loc.id}`;
      const isBidirectional = exit.bidirectional !== false;

      if (edgeMap.has(reverseKey)) {
        const existing = edgeMap.get(reverseKey);
        existing.data.bidirectional = true;
        existing.classes = 'bidirectional';
        continue;
      }

      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          data: {
            id: `${loc.id}_${exit.destination}`,
            source: loc.id,
            target: exit.destination,
            bidirectional: isBidirectional
          },
          classes: isBidirectional ? 'bidirectional' : undefined
        });
      }
    }
  }

  const edges = Array.from(edgeMap.values());

  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  cy.nodes().forEach(node => node.toggleClass('stub', node.data('isStub')));
  cy.layout({ name: 'fcose', animate: true, randomize: true }).run();

  cy.nodes().removeClass('current');
  if (region.currentLocationId) {
    const current = cy.getElementById(region.currentLocationId);
    if (current) current.addClass('current');
  }
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
