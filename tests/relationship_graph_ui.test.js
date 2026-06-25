const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DOMParser } = require('@xmldom/xmldom');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function loadRelationshipGraphModule() {
  const source = read('public/js/relationship-graph.js');
  const window = {};
  const sandbox = {
    window,
    console,
    setTimeout,
    clearTimeout
  };
  window.window = window;
  window.console = console;
  vm.runInNewContext(source, sandbox, { filename: 'public/js/relationship-graph.js' });
  return window.AIRPGRelationshipGraph;
}

function extractSelectorBlock(source, selector) {
  const marker = `selector: '${selector}'`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${selector} style should exist`);
  const nextSelector = source.indexOf('selector:', start + marker.length);
  return nextSelector === -1 ? source.slice(start) : source.slice(start, nextSelector);
}

function collectSvgAttributes(svgSource, attributeNames) {
  const doc = new DOMParser({
    onError(level, message) {
      if (level !== 'warning') {
        throw new Error(message);
      }
    }
  }).parseFromString(svgSource, 'image/svg+xml');
  const values = [];

  function visit(node) {
    if (node.nodeType !== 1) {
      return;
    }

    for (const attributeName of attributeNames) {
      if (node.hasAttribute(attributeName)) {
        values.push({
          nodeName: node.nodeName,
          attributeName,
          value: node.getAttribute(attributeName)
        });
      }
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  }

  visit(doc.documentElement);
  return values;
}

test('play interface declares a relationships tab wired to the Cytoscape graph module', () => {
  const source = read('views/index.njk');

  assert.match(source, /id="tab-relationships-tab"/);
  assert.match(source, /data-tab="relationships"/);
  assert.match(source, /aria-controls="tab-relationships"/);
  assert.match(source, /src="\/assets\/material-icons\/game-tab-icons\/relationship\.svg"/);
  assert.match(source, /id="tab-relationships"/);
  assert.match(source, /id="relationshipGraphContainer"/);
  assert.match(source, /id="relationshipGraphReloadButton"/);
  assert.match(source, /src="\/js\/relationship-graph\.js"/);
  assert.match(source, /tabName === 'relationships'[\s\S]*?window\.loadRelationshipGraph\?\.\(\);/);
});

test('relationship graph module builds portrait nodes and distinct missing-id placeholders', () => {
  const graphModule = loadRelationshipGraphModule();
  assert.equal(typeof graphModule?.buildElements, 'function');

  const elements = graphModule.buildElements([
    {
      id: 'kai',
      name: 'Kai',
      imageId: 'kai-portrait',
      relationships: {
        vesperi: 'trusts',
        'missing-alpha': 'owes',
        secret: 'suspects'
      }
    },
    {
      id: 'vesperi',
      name: 'Vesperi',
      relationships: {
        kai: 'protects',
        'missing-beta': 'searches for'
      }
    },
    {
      id: 'secret',
      name: 'Hidden Operative',
      hiddenFromPlayer: true,
      relationships: {
        kai: 'watches'
      }
    }
  ], 'kai');

  const nodes = elements.filter(element => !element.data.source);
  const edges = elements.filter(element => element.data.source);

  assert.ok(nodes.find(node => node.data.id === 'character:kai' && node.data.imageUrl === '/api/images/kai-portrait/file'));
  assert.ok(nodes.find(node => node.data.id === 'character:vesperi'));

  const missingAlpha = nodes.find(node => node.data.id === 'missing:missing-alpha');
  const missingBeta = nodes.find(node => node.data.id === 'missing:missing-beta');
  assert.ok(missingAlpha, 'first missing target id should render as its own node');
  assert.ok(missingBeta, 'second missing target id should render as its own node');
  assert.notEqual(missingAlpha.data.id, missingBeta.data.id);
  assert.match(missingAlpha.classes, /\bmissing-character\b/);
  assert.match(missingAlpha.data.imageUrl, /%3F/);
  assert.match(missingAlpha.data.label, /missing-alpha/);
  assert.match(missingBeta.data.label, /missing-beta/);

  assert.ok(edges.find(edge => edge.data.source === 'character:kai' && edge.data.target === 'character:vesperi' && edge.data.label === 'trusts'));
  assert.ok(edges.find(edge => edge.data.source === 'character:vesperi' && edge.data.target === 'character:kai' && edge.data.label === 'protects'));
  assert.equal(nodes.some(node => node.data.id === 'character:secret'), false);
  assert.equal(edges.some(edge => edge.data.source === 'character:secret' || edge.data.target === 'character:secret'), false);
  assert.ok(edges.every(edge => /\brelationship-edge\b/.test(edge.classes)));
  assert.ok(edges.every(edge => /\bclockwise-curve\b/.test(edge.classes)));
  assert.equal(edges.some(edge => /\bcurve-positive\b|\bcurve-negative\b/.test(edge.classes)), false);
});

test('relationship graph computes clockwise curves with curve-side endpoints and midpoint labels', () => {
  const graphModule = loadRelationshipGraphModule();
  assert.equal(typeof graphModule?.calculateClockwiseEdgePresentation, 'function');

  const forward = graphModule.calculateClockwiseEdgePresentation({ x: 0, y: 0 }, { x: 100, y: 0 });
  const reciprocal = graphModule.calculateClockwiseEdgePresentation({ x: 100, y: 0 }, { x: 0, y: 0 });

  assert.equal(forward.sourceEndpoint, '39px 10px');
  assert.equal(forward.targetEndpoint, '-39px 10px');
  assert.equal(reciprocal.sourceEndpoint, '-39px -10px');
  assert.equal(reciprocal.targetEndpoint, '39px -10px');

  assert.equal(forward.controlPointDistance, 58);
  assert.equal(reciprocal.controlPointDistance, 58);
  assert.equal(forward.labelPosition.x, 50);
  assert.equal(forward.labelPosition.y, 39);
  assert.equal(reciprocal.labelPosition.x, 50);
  assert.equal(reciprocal.labelPosition.y, -39);
});

test('relationship graph styles live in SCSS and icon asset exists', () => {
  const scssSource = read('public/css/main.scss');
  const graphSource = read('public/js/relationship-graph.js');
  const labelStyle = extractSelectorBlock(graphSource, 'node.relationship-label');
  const relationshipIconPath = path.join(rootDir, 'assets/material-icons/game-tab-icons/relationship.svg');
  const relationshipIconSource = read('assets/material-icons/game-tab-icons/relationship.svg');
  const paintAttributes = collectSvgAttributes(relationshipIconSource, ['fill', 'stroke']);
  const opacityAttributes = collectSvgAttributes(relationshipIconSource, ['opacity', 'fill-opacity', 'stroke-opacity']);

  assert.ok(fs.existsSync(relationshipIconPath));
  assert.ok(paintAttributes.length > 0, 'relationship icon should declare an explicit fill or stroke color');
  assert.deepEqual(
    [...new Set(paintAttributes.filter(({ value }) => value !== 'none').map(({ value }) => value.toLowerCase()))],
    ['#ffffff']
  );
  assert.deepEqual(opacityAttributes, []);
  assert.match(scssSource, /#tab-relationships/);
  assert.match(scssSource, /#relationshipGraphContainer/);
  assert.match(scssSource, /\.relationship-graph-panel/);
  assert.match(scssSource, /\.relationship-graph-status/);
  assert.match(graphSource, /updateRelationshipEdgeGeometry/);
  assert.match(graphSource, /edge-distances': 'endpoints'/);
  assert.match(labelStyle, /'text-rotation': 'none'/);
  assert.match(labelStyle, /'text-outline-color': '#000000'/);
  assert.match(labelStyle, /'text-background-opacity': 0/);
  assert.match(labelStyle, /'z-index-compare': 'manual'/);
  assert.doesNotMatch(labelStyle, /text-background-color/);
});

test('slash-command refresh payloads can request a relationship graph reload', () => {
  const apiSource = read('api.js');
  const chatSource = read('public/js/chat.js');

  assert.match(apiSource, /relationshipGraphRefreshRequested/);
  assert.match(chatSource, /relationshipGraphRefreshRequested[\s\S]*?window\.loadRelationshipGraph/);
});
