const cytoscape = (() => {
  const cy = window.cytoscape;
  if (!cy) {
    throw new Error('Cytoscape runtime not found.');
  }
  if (!cy.__fcoseRegistered && typeof window.cytoscapeFcose === 'function') {
    window.cytoscapeFcose(cy);
    cy.__fcoseRegistered = true;
  }
  return cy;
})();

let cyInstance = null;

function getCy(container) {
  if (!cyInstance) {
    cyInstance = cytoscape({
      container,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#67e8f9',
            'label': 'data(label)',
            'color': '#0f172a',
            'font-size': '14px',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 60,
            'height': 60
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#bae6fd',
            'target-arrow-color': '#bae6fd',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier'
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
      ],
      elements: [],
      layout: { name: 'fcose' },
      wheelSensitivity: 0.2
    });
  }
  return cyInstance;
}

function showMapError(message) {
  const container = document.getElementById('mapContainer');
  if (!container) return;
  container.classList.add('map-placeholder');
  container.innerHTML = `<div class="map-error">${message}</div>`;
}

async function loadRegionMap() {
  const container = document.getElementById('mapContainer');
  if (!container) return;

  container.classList.add('map-placeholder');
  container.textContent = 'Loading map...';

  try {
    const response = await fetch('/api/map/region');
    const data = await response.json();
    if (!data.success) {
      showMapError(data.error || 'Failed to load region map');
      return;
    }

    renderMap(data.region);
  } catch (error) {
    showMapError(error.message);
  }
}

function renderMap(region) {
  const container = document.getElementById('mapContainer');
  if (!container) return;

  container.classList.remove('map-placeholder');
  container.innerHTML = '';

  const cy = getCy(container);

  const nodes = region.locations.map(loc => ({
    data: {
      id: loc.id,
      label: loc.name,
      isStub: Boolean(loc.isStub)
    }
  }));

  const edges = [];
  for (const loc of region.locations) {
    for (const exit of loc.exits || []) {
      if (!exit.destination) continue;
      edges.push({
        data: {
          id: `${loc.id}_${exit.destination}`,
          source: loc.id,
          target: exit.destination,
          directed: exit.bidirectional !== false
        }
      });
    }
  }

  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  cy.nodes().forEach(node => {
    node.toggleClass('stub', node.data('isStub'));
  });

  cy.layout({ name: 'fcose', animate: true, randomize: true }).run();

  cy.nodes().removeClass('current');
  if (region.currentLocationId) {
    const current = cy.getElementById(region.currentLocationId);
    if (current) current.addClass('current');
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
