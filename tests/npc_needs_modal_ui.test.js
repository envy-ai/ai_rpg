const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('needs modal renderer uses compact slider and number rows without redundant controls', () => {
    const renderBlock = extractBlock(viewSource, 'function renderNpcNeedsEntries(data)', 'function updateThingEditStatus');

    assert.match(renderBlock, /row\.className = 'npc-adjustment-entry npc-adjustment-entry--needs npc-needs-entry';/);
    assert.match(renderBlock, /labelEl\.className = 'npc-adjustment-label npc-adjustment-label--needs npc-needs-label';/);
    assert.match(renderBlock, /slider\.className = 'npc-needs-slider';/);
    assert.match(renderBlock, /numberInput\.type = 'number';/);
    assert.match(renderBlock, /slider\.style\.setProperty\('--npc-needs-color', entry\.color\);/);
    assert.match(renderBlock, /slider\.style\.accentColor = entry\.color;/);
    assert.match(renderBlock, /numberInput\.setAttribute\('aria-label', `Set \$\{needName\} value`\);/);

    assert.doesNotMatch(renderBlock, /npc-needs-progress/);
    assert.doesNotMatch(renderBlock, /npc-needs-meta/);
    assert.doesNotMatch(renderBlock, /npc-needs-buttons/);
    assert.doesNotMatch(renderBlock, /npc-needs-thresholds/);
    assert.doesNotMatch(renderBlock, /npc-needs-value-display/);
    assert.doesNotMatch(renderBlock, /Current effect:/);
    assert.doesNotMatch(renderBlock, /formatNeedBarAudienceLabel/);
});

test('needs modal styles define compact responsive rows and colored sliders', () => {
    assert.match(scssSource, /\.npc-needs-entry\s*\{[\s\S]*display:\s*grid/);
    assert.match(scssSource, /\.npc-needs-entry\s*\{[\s\S]*grid-template-columns:\s*minmax\(130px, 180px\) minmax\(180px, 1fr\) 96px/);
    assert.match(scssSource, /\.npc-needs-slider\s*\{[\s\S]*accent-color:\s*var\(--npc-needs-color, #818cf8\)/);
    assert.match(scssSource, /\.npc-needs-value-input\s*\{[\s\S]*width:\s*100%/);
    assert.match(scssSource, /@media \(max-width: 640px\)[\s\S]*\.npc-needs-entry\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});
