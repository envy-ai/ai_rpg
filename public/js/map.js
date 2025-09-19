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
    }
  ]);
  cytoscape.zoomingEnabled(true);
  cytoscape.userZoomingEnabled(true);
  cytoscape.userPanningEnabled(true);
  cyInstance = cytoscape;
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
    data: (() => {
      const data = {
        id: loc.id,
        label: loc.name,
        isStub: Boolean(loc.isStub),
        visited: Boolean(loc.visited)
      };
      if (loc.image && typeof loc.image.url === 'string' && loc.image.url.trim()) {
        data.imageUrl = loc.image.url;
      }
      return data;
    })()
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
  cy.nodes().forEach(node => node.toggleClass('visited', node.data('visited')));
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
