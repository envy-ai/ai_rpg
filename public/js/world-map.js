(() => {
  const REGION_NODE_PREFIX = 'region:';
  let worldCyInstance = null;
  let worldMapRequestId = 0;
  let hullOverlayInstance = null;
  let convexHullPadding = 100;
  let convexHullCornerRadius = 100;

  function destroyWorldCyInstance() {
    if (hullOverlayInstance) {
      try {
        hullOverlayInstance.destroy?.();
      } catch (error) {
        console.warn('Failed to destroy convex hull overlays:', error);
      }
      hullOverlayInstance = null;
    }

    if (worldCyInstance) {
      try {
        worldCyInstance.destroy();
      } catch (error) {
        console.warn('Failed to destroy world map Cytoscape instance:', error);
      }
      worldCyInstance = null;
    }
  }

  function ensureWorldCytoscape(container) {
    if (!container) {
      throw new Error('World map container is missing.');
    }

    destroyWorldCyInstance();

    const cytoscapeLib = window.cytoscape;
    if (!cytoscapeLib) {
      throw new Error('Cytoscape not loaded');
    }
    if (!cytoscapeLib.__fcoseRegistered && typeof window.cytoscapeFcose === 'function') {
      window.cytoscapeFcose(cytoscapeLib);
      cytoscapeLib.__fcoseRegistered = true;
    }
    if (!cytoscapeLib.__eulerRegistered && typeof window.cytoscapeEuler === 'function') {
      window.cytoscapeEuler(cytoscapeLib);
      cytoscapeLib.__eulerRegistered = true;
    }

    const cy = cytoscapeLib({
      container,
      textureOnViewport: false,
      wheelSensitivity: 1
    });

    cy.style([
      {
        selector: 'node',
        style: {
          'font-family': 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          'color': '#f0f9ff'
        }
      },
      {
        selector: 'node.location-node',
        style: {
          'shape': 'ellipse',
          'background-color': '#67e8f9',
          'label': 'data(label)',
          'font-size': '6px',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': '6px',
          'text-background-color': '#0f172a',
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'text-wrap': 'wrap',
          'text-max-width': '90px',
          'width': 56,
          'height': 56,
          'border-width': 1.5,
          'border-color': '#082f49',
          'shadow-blur': 8,
          'shadow-color': 'rgba(14, 165, 233, 0.45)'
        }
      },
      {
        selector: 'node.location-node.visited',
        style: {
          'border-width': 2.5,
          'border-color': '#facc15'
        }
      },
      {
        selector: 'node.location-node.visited[imageUrl]',
        style: {
          'background-image': 'data(imageUrl)',
          'background-fit': 'cover',
          'background-clip': 'node',
          'background-position-x': '50%',
          'background-position-y': '50%',
          'background-repeat': 'no-repeat'
        }
      },
      {
        selector: 'node.location-node.stub',
        style: {
          'background-color': '#f472b6'
        }
      },
      {
        selector: 'node.region-label',
        style: {
          'shape': 'roundrectangle',
          'background-opacity': 0,
          'border-width': 0,
          'label': 'data(label)',
          'font-size': '11px',
          'font-weight': 600,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '200px',
          'text-background-color': 'data(labelBackground)',
          'text-background-opacity': 0.85,
          'text-background-padding': '4px 10px',
          'text-background-shape': 'roundrectangle',
          'text-outline-width': 4,
          'text-outline-color': 'data(labelOutline)',
          'color': 'data(labelTextColor)',
          'width': 80,
          'height': 32,
          'opacity': 0.98
        }
      },
      {
        selector: 'node.region-group',
        style: {
          'background-color': 'data(groupFill)',
          'background-opacity': 0,
          'border-width': 2,
          'border-color': 'data(groupBorder)',
          'border-opacity': 0,
          'border-style': 'dashed',
          'label': '',
          'width': 20,
          'height': 20,
          'padding': '12px',
          'opacity': 1,
          'events': 'no'
        }
      },
      {
        selector: 'node.region-label:hover',
        style: {
          'cursor': 'pointer',
          'text-outline-width': 5
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'curve-style': 'straight',
          'edge-distances': 'node-position',
          'line-color': '#bae6fd',
          'target-arrow-color': '#bae6fd',
          'target-arrow-shape': 'triangle'
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
        selector: 'node.location-node.current',
        style: {
          'border-color': '#ea580c',
          'border-width': 4,
          'shadow-blur': 18,
          'shadow-color': '#ea580c'
        }
      }
    ]);

    cy.zoomingEnabled(true);
    cy.userZoomingEnabled(true);
    cy.userPanningEnabled(true);
    worldCyInstance = cy;
    return cy;
  }

  function showWorldMapError(message = 'Unable to load world map.') {
    const container = document.getElementById('worldMapContainer');
    if (!container) {
      console.error('World map container missing; cannot render error.');
      return;
    }
    destroyWorldCyInstance();
    container.classList.add('map-placeholder');
    container.innerHTML = `<div class="map-error">${message}</div>`;
  }

  function hashNumber(input) {
    if (!input) return 0;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function getRegionColors(regionId) {
    const hash = hashNumber(regionId || '');
    const hue = hash % 360;
    const saturation = 45 + (hash % 25);
    const baseLightness = 12 + (hash % 12);
    const borderLightness = baseLightness + 20;
    const bubbleLightness = clamp(baseLightness + 25, 25, 75);
    const labelLightness = clamp(baseLightness + 15, 15, 60);
    const sat = clamp(saturation, 30, 70);
    const borderSat = clamp(saturation + 10, 35, 80);
    return {
      fill: `hsl(${hue}, ${sat}%, ${clamp(baseLightness + 20, 20, 70)}%)`,
      border: `hsl(${hue}, ${borderSat}%, ${clamp(borderLightness + 15, 35, 85)}%)`,
      bubbleFill: `hsla(${hue}, ${sat}%, ${bubbleLightness}%, 0.18)`,
      bubbleFillOpacity: '0.18',
      labelBackground: `hsla(${hue}, ${sat}%, ${labelLightness}%, 0.55)`,
      labelOutline: 'rgba(8, 15, 23, 0.9)',
      labelTextColor: '#e0f2fe'
    };
  }

  function buildRegionLabelNodes(regions, colorLookup) {
    if (!Array.isArray(regions)) return [];
    return regions.map(region => {
      const colors = colorLookup.get(region.id) || getRegionColors(region.id);
      return {
        data: {
          id: `${REGION_NODE_PREFIX}${region.id}`,
          regionId: region.id,
          label: region.name || region.id,
          labelBackground: colors.labelBackground,
          labelOutline: colors.labelOutline,
          labelTextColor: colors.labelTextColor
        },
        classes: 'region-label',
        grabbable: false,
        selectable: false,
        locked: true
      };
    });
  }

  function buildRegionGroupNodes(regions, colorLookup) {
    if (!Array.isArray(regions)) return [];
    return regions.map(region => ({
      data: {
        id: `${REGION_NODE_PREFIX}${region.id}:group`,
        regionId: region.id,
        groupFill: (colorLookup.get(region.id) || {}).bubbleFill || 'rgba(56, 189, 248, 0.12)',
        groupBorder: (colorLookup.get(region.id) || {}).border || 'rgba(56, 189, 248, 0.65)'
      },
      classes: 'region-group',
      grabbable: false,
      selectable: false
    }));
  }

  function buildLocationNodes(locations, regionGroupLookup) {
    if (!Array.isArray(locations)) return [];
    return locations.map(location => {
      const classes = ['location-node'];
      if (location.visited) classes.push('visited');
      if (location.isStub) classes.push('stub');
      return {
        data: {
          id: location.id,
          label: location.name || location.id,
          regionId: location.regionId,
          parent: regionGroupLookup.get(location.regionId) || undefined,
          visited: Boolean(location.visited),
          isStub: Boolean(location.isStub),
          imageUrl: location.image?.url || null
        },
        classes: classes.join(' ')
      };
    });
  }

  function buildLocationEdges(locations) {
    const locationIds = new Set(locations.map(loc => loc.id));
    const edgeMap = new Map();

    for (const location of locations) {
      for (const exit of location.exits || []) {
        const destinationId = exit.destination;
        if (!destinationId || !locationIds.has(destinationId)) continue;

        const key = `${location.id}->${destinationId}`;
        const reverseKey = `${destinationId}->${location.id}`;
        const isBidirectional = exit.bidirectional !== false;

        if (edgeMap.has(reverseKey)) {
          const reverseEdge = edgeMap.get(reverseKey);
          reverseEdge.data.bidirectional = true;
          reverseEdge.classes = 'bidirectional';
          continue;
        }

        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            data: {
              id: `${location.id}_${destinationId}`,
              source: location.id,
              target: destinationId,
              bidirectional: isBidirectional
            },
            classes: isBidirectional ? 'bidirectional' : undefined
          });
        }
      }
    }

    return Array.from(edgeMap.values());
  }

  function positionRegionLabels(cy, regions = []) {
    if (!cy) return;
    const locationNodes = cy.nodes('.location-node');
    for (const region of regions) {
      const labelNode = cy.getElementById(`${REGION_NODE_PREFIX}${region.id}`);
      if (!labelNode || !labelNode.isNode()) continue;

      const members = locationNodes.filter(node => node.data('regionId') === region.id);
      if (!members.length) {
        labelNode.style('display', 'none');
        continue;
      }
      const bounds = members.boundingBox();
      const x = bounds.x1 + (bounds.w || 0) / 2;
      const y = bounds.y1 + (bounds.h || 0) / 2;
      labelNode.unlock();
      labelNode.position({ x, y });
      labelNode.lock();
      labelNode.style('display', 'element');
    }
  }

  function applyRegionConvexHulls(cy, regions = [], colorLookup, padding, cornerRadius = 24) {
    if (!cy || typeof cy.convexHulls !== 'function') {
      return null;
    }

    const plugin = cy.convexHulls({
      padding,
      cornerRadius,
      fill: 'rgba(56, 189, 248, 0.15)',
      stroke: '#38bdf8',
      lineWidth: 2
    });

    const locationNodes = cy.nodes('.location-node');
    for (const region of regions) {
      const members = locationNodes.filter(node => node.data('regionId') === region.id);
      if (members.length < 3) {
        continue;
      }
      const colors = colorLookup.get(region.id) || getRegionColors(region.id);
      plugin.addPath(members, {
        padding,
        cornerRadius,
        fill: colors.bubbleFill,
        stroke: colors.border,
        lineWidth: 2.5
      });
    }

    return plugin;
  }

  function attachWorldMapEvents(cy, container) {
    if (!cy || !container) return;

    cy.off('tap');
    cy.off('cxttap');

    cy.on('tap', 'node.location-node', event => {
      const node = event.target;
      if (!node) return;
      const locationId = node.id();
      if (!locationId || !node.data('visited') || node.hasClass('current')) return;

      if (typeof window.travelToAdjacentLocationFromMap === 'function') {
        window.travelToAdjacentLocationFromMap(locationId, { focusAdventureTab: true });
      }
    });

    cy.on('cxttap', 'node.location-node', event => {
      const node = event.target;
      if (!node) return;
      const locationId = node.id();
      if (!locationId) return;

      if (event.originalEvent) {
        event.originalEvent.preventDefault?.();
        event.originalEvent.stopPropagation?.();
      }

      const anchorPoint = (() => {
        if (event.originalEvent && Number.isFinite(event.originalEvent.clientX) && Number.isFinite(event.originalEvent.clientY)) {
          return { x: event.originalEvent.clientX, y: event.originalEvent.clientY };
        }
        if (event.renderedPosition) {
          const rect = container.getBoundingClientRect();
          return {
            x: rect.left + event.renderedPosition.x,
            y: rect.top + event.renderedPosition.y
          };
        }
        return null;
      })();

      if (typeof window.openLocationContextMenuForLocationId === 'function') {
        window.openLocationContextMenuForLocationId(locationId, {
          useFloatingMenu: true,
          focusAdventureTab: false,
          anchorPoint
        });
      }
    });

    cy.on('tap', 'node.region-label', event => {
      const node = event.target;
      if (!node) return;
      const regionId = node.data('regionId');
      if (!regionId) return;
      if (typeof window.activateTab === 'function') {
        window.__AIRPG_NEXT_REGION_MAP_ID = regionId;
        window.activateTab('map');
        return;
      }
      window.loadRegionMap?.(regionId);
    });
  }

  function renderWorldMap(world) {
    if (!world) throw new Error('World data is required to render the world map.');

    const container = document.getElementById('worldMapContainer');
    if (!container) {
      throw new Error('World map container not found.');
    }

    container.classList.remove('map-placeholder');
    container.innerHTML = '';
    container.dataset.regionCount = String(world.regions?.length || 0);
    container.dataset.locationCount = String(world.locations?.length || 0);
    container.setAttribute('aria-label', 'World map of known regions and locations');

    const cy = ensureWorldCytoscape(container);
    worldCyInstance = cy;
    const regions = Array.isArray(world.regions) ? world.regions : [];
    const regionColorLookup = new Map(regions.map(region => [region.id, getRegionColors(region.id)]));
    const regionGroupNodes = buildRegionGroupNodes(regions, regionColorLookup);
    const regionGroupLookup = new Map(regionGroupNodes.map(node => [node.data.regionId, node.data.id]));
    const locationNodes = buildLocationNodes(world.locations || [], regionGroupLookup);
    const regionLabelNodes = buildRegionLabelNodes(regions, regionColorLookup);
    const edges = buildLocationEdges(world.locations || []);

    cy.add([
      ...regionGroupNodes,
      ...locationNodes,
      ...regionLabelNodes,
      ...edges
    ]);

    attachWorldMapEvents(cy, container);

    cy.nodes('node.location-node').forEach(node => {
      node.toggleClass('visited', Boolean(node.data('visited')));
      node.toggleClass('stub', Boolean(node.data('isStub')));
    });

    cy.nodes('node.location-node, node.region-label').forEach(node => {
      if (!node.data('label')) node.data('label', node.id());
    });

    cy.nodes().removeClass('current');
    if (world.currentLocationId) {
      const currentNode = cy.getElementById(world.currentLocationId);
      if (currentNode && currentNode.isNode()) currentNode.addClass('current');
    }

    const getNodeGroupId = node => {
      if (!node || !node.isNode()) {
        return null;
      }
      const parent = node.parent();
      return parent && parent.empty ? null : (parent?.id() || null);
    };

    const layoutOptions = {
      name: 'fcose',
      animate: false,
      randomize: false,
      nodeSeparation: 40,
      nodeRepulsion: 4500,
      gravity: 0.7,
      idealEdgeLength: edge => {
        const sourceGroup = getNodeGroupId(edge.source());
        const targetGroup = getNodeGroupId(edge.target());
        if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
          return 28;
        }
        return 48;
      },
      edgeElasticity: edge => {
        const sourceGroup = getNodeGroupId(edge.source());
        const targetGroup = getNodeGroupId(edge.target());
        if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
          return 0.95;
        }
        return 0.45;
      },
      padding: 32,
      nestingFactor: 0.9,
      nodeDimensionsIncludeLabels: true
    };

    const layout = cy.layout(layoutOptions);

    layout.on('layoutstop', () => {
      positionRegionLabels(cy, regions);
      hullOverlayInstance?.destroy();
      hullOverlayInstance = applyRegionConvexHulls(
        cy,
        regions,
        regionColorLookup,
        convexHullPadding,
        convexHullCornerRadius
      );
    });

    layout.run();
  }

  function loadWorldMap(options = {}) {
    const container = document.getElementById('worldMapContainer');
    if (!container) {
      console.warn('World map container missing; cannot load.');
      return Promise.resolve(null);
    }

    const requestId = ++worldMapRequestId;
    if (!options.silent) {
      container.classList.add('map-placeholder');
      container.textContent = 'Loading world map...';
    }

    return fetch('/api/map/world', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (requestId !== worldMapRequestId) {
          return null;
        }
        if (!response.ok || !data?.success || !data.world) {
          const message = data?.error || 'Failed to load world map data.';
          showWorldMapError(message);
          return null;
        }
        renderWorldMap(data.world);
        return data.world;
      })
      .catch(error => {
        if (requestId === worldMapRequestId) {
          showWorldMapError(error?.message || 'World map request failed.');
        }
        return null;
      });
  }

  window.loadWorldMap = loadWorldMap;
  window.adjustBubblePadding = function adjustBubblePadding(nextPadding, nextCornerRadius = convexHullCornerRadius) {
    const parsed = Number(nextPadding);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.warn('Ignoring invalid hull padding value:', nextPadding);
      return false;
    }
    convexHullPadding = parsed;
    const parsedRadius = Number(nextCornerRadius);
    if (Number.isFinite(parsedRadius) && parsedRadius >= 0) {
      convexHullCornerRadius = parsedRadius;
    }
    window.loadWorldMap?.({ silent: true });
    return true;
  };
})();
