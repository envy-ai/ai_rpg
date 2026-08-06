const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'public', 'js', 'image-manager.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(root, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(root, 'public', 'css', 'main.scss'), 'utf8');

test('ComfyUI sampler progress is forwarded through realtime image job updates', () => {
    assert.match(serverSource, /function updateComfyRenderProgress\(job, progressEvent = \{\}\)/);
    assert.match(serverSource, /renderProgress = Math\.round\(fraction \* 1000\) \/ 10/);
    assert.match(serverSource, /onProgress: progressEvent => updateComfyRenderProgress\(job, progressEvent\)/);
    assert.match(serverSource, /job\.isRendering = false;[\s\S]*phase: 'rendering-complete'/);
    assert.match(serverSource, /isRendering: job\.isRendering === true/);
    assert.match(managerSource, /this\.activeRenderJobs = new Map\(\)/);
    assert.match(managerSource, /normalizedType === 'item' \|\| normalizedType === 'scenery'/);
    assert.match(managerSource, /return `\$\{this\._normalizeEntityType\(entityType\)\}:\$\{entityId \|\| ''\}`/);
    assert.match(managerSource, /renderProgress: update\.renderProgress/);
    assert.match(managerSource, /this\._dispatch\('image:job-progress', detail\)/);
});

test('active image renders use spinner and progress overlays with a seasonal variant mode', () => {
    assert.match(viewSource, /entity-image-render-state__spinner/);
    assert.match(viewSource, /entity-image-render-state__progress-fill/);
    assert.match(viewSource, /const seasonalLocationVariant = payload\.isLocationWeatherVariant === true/);
    assert.match(viewSource, /const entityType = normalizeImageEntityType\(payload\.entityType\)/);
    assert.match(viewSource, /vehiclePipImage\?\.dataset\?\.vehiclePipLocationId === entityId/);
    assert.match(viewSource, /progressFill\.style\.width = `\$\{renderProgress\}%`/);
    assert.match(scssSource, /\.entity-image-render-state\s*\{[\s\S]*background: rgba\(15, 23, 42, 0\.97\)/);
    assert.match(scssSource, /\.entity-image-render-state--seasonal\s*\{[\s\S]*background: rgba\(15, 23, 42, 0\.28\)/);
    assert.match(scssSource, /\.entity-image-render-state__progress\s*\{[\s\S]*height: 4px/);
});

test('character portrait placeholders reserve the configured render aspect ratio', () => {
    assert.match(serverSource, /function resolveCharacterImageDimensions\(configuration = config\)/);
    assert.match(serverSource, /const characterPortraitDimensions = resolveCharacterImageDimensions\(config\)/);
    assert.match(serverSource, /characterPortraitWidth: characterPortraitDimensions\.width/);
    assert.match(serverSource, /characterPortraitHeight: characterPortraitDimensions\.height/);
    assert.match(viewSource, /--character-portrait-aspect-ratio: \{\{ characterPortraitWidth \}\} \/ \{\{ characterPortraitHeight \}\}/);
    assert.match(viewSource, /--player-portrait-aspect-ratio: \{\{ characterPortraitWidth \}\} \/ \{\{ characterPortraitHeight \}\}/);
    assert.match(scssSource, /\.entity-card--npc\s*\{[\s\S]*aspect-ratio: var\(--character-portrait-aspect-ratio\)/);
    assert.match(scssSource, /\.party-portrait\s*\{[\s\S]*aspect-ratio: var\(--character-portrait-aspect-ratio\)/);
    assert.match(scssSource, /\.npc-view-image\s*\{[\s\S]*aspect-ratio: var\(--character-portrait-aspect-ratio\)/);
    assert.match(scssSource, /\.chat-player-portrait\s*\{[\s\S]*aspect-ratio: var\(--player-portrait-aspect-ratio\)/);
});
