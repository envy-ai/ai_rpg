const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('play page exposes registered Thing image badges to the client renderer', () => {
    const serverSource = read('server.js');
    const viewSource = read('views/index.njk');

    assert.match(serverSource, /thingImageBadges:\s*modExtensionRegistry\.getThingImageBadges\(\)/);
    assert.match(viewSource, /window\.AIRPG_CONFIG\.thingImageBadges\s*=/);
    assert.match(viewSource, /function getModThingImageBadges\(thing\)/);
    assert.match(viewSource, /getThingPropertyBadges\(thing\)[\s\S]*getModThingImageBadges\(thing\)/);
});

test('play page resolves mod Thing image badges from active setting asset path fields', () => {
    const viewSource = read('views/index.njk');

    assert.match(viewSource, /function resolveModThingBadgeAssetUrl\(badge\)/);
    assert.match(viewSource, /badge\.assetPathSetting/);
    assert.match(viewSource, /window\.currentSetting\?\.modSettings/);
    assert.match(viewSource, /\/mods\/\$\{badge\.modName\}\/assets\/\$\{normalizedAssetPath\}/);
    assert.match(viewSource, /function resolveModThingBadgeLabel\(badge\)/);
    assert.match(viewSource, /badge\.labelSetting/);
    assert.match(viewSource, /isModuleCompatibleBadge\s*\?\s*`\$\{configuredLabel\.trim\(\)\}-compatible`\s*:\s*configuredLabel\.trim\(\)/);
});

test('item image badge renderer supports positioned SVG masks and raster images', () => {
    const viewSource = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(viewSource, /entity-image-badges--top-left/);
    assert.match(viewSource, /entity-image-badge__mask/);
    assert.match(viewSource, /entity-image-badge__image/);
    assert.match(viewSource, /renderImageBadgeVisual/);
    assert.match(scssSource, /\.entity-image-badges--top-left/);
    assert.match(scssSource, /\.entity-image-badge__mask/);
    assert.match(scssSource, /\.entity-image-badge__image/);
});

test('mod loader serves mod assets for client badge images', () => {
    const source = read('ModLoader.js');

    assert.match(source, /const assetsDir = path\.join\(manifest\.dir, 'assets'\)/);
    assert.match(source, /app\.use\(`\/mods\/\$\{manifest\.name\}\/assets`/);
});

test('play page exposes registered Thing context actions and edit fields', () => {
    const serverSource = read('server.js');
    const apiSource = read('api.js');
    const viewSource = read('views/index.njk');

    assert.match(serverSource, /thingContextActions:\s*modExtensionRegistry\.getThingContextActions\(\)/);
    assert.match(serverSource, /thingEditFields:\s*modExtensionRegistry\.getEntityFields\('thing',\s*\{\s*exposeToEditModal:\s*true\s*\}\)/);
    assert.match(viewSource, /window\.AIRPG_CONFIG\.thingContextActions\s*=/);
    assert.match(viewSource, /window\.AIRPG_CONFIG\.thingEditFields\s*=/);
    assert.match(viewSource, /function getModThingContextActions\(thing, options = \{\}\)/);
    assert.match(viewSource, /function renderThingEditModFields\(thing = \{\}\)/);
    assert.match(viewSource, /function collectThingEditModFieldValues\(\)/);
    assert.match(apiSource, /app\.post\('\/api\/mod-thing-context-actions\/:actionId'/);
    assert.match(apiSource, /getThingContextActionRecord\(actionId\)/);
});
