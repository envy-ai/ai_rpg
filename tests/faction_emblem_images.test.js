const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const yaml = require('js-yaml');
const sharp = require('sharp');
const Faction = require('../Faction.js');

function loadServerFunction(startMarker, endMarker, exportName, context = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end < 0) {
        throw new Error(`Unable to locate ${exportName} in server.js`);
    }
    const sandbox = { ...context };
    vm.createContext(sandbox);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.exportedFunction = ${exportName};`,
        sandbox
    );
    return sandbox.exportedFunction;
}

test('Faction persists emblem image state through JSON round trips', () => {
    Faction.clear();
    const original = new Faction({
        id: 'faction-emblem-test',
        name: 'The Azure Watch',
        imageId: 'image-123',
        imagePrompt: 'A blue tower on a white field.'
    });

    const restored = Faction.fromJSON(original.toJSON());
    assert.equal(restored.imageId, 'image-123');
    assert.equal(restored.imagePrompt, 'A blue tower on a white field.');
    Faction.clear();
});

test('faction emblem dimensions use their override and otherwise require a configured size', () => {
    const resolveFactionImageDimensions = loadServerFunction(
        'function resolveFactionImageDimensions(configuration = config) {',
        '\n\nfunction getJobSnapshot',
        'resolveFactionImageDimensions',
        { Number, config: {} }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveFactionImageDimensions({
            imagegen: {
                default_settings: { image: { width: 640, height: 960 } },
                faction_settings: { image: { width: 1024, height: 1024 } }
            }
        }))),
        { width: 1024, height: 1024 }
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveFactionImageDimensions({
            imagegen: {
                default_settings: { image: { width: 640, height: 960 } },
                faction_settings: { image: {} }
            }
        }))),
        { width: 640, height: 960 }
    );
    assert.throws(
        () => resolveFactionImageDimensions({ imagegen: { default_settings: { image: {} } } }),
        /missing configured width for faction emblem images/
    );
});

test('generated faction emblems are PNGs with transparent pixels outside the inscribed oval', async () => {
    const maskFactionEmblemImage = loadServerFunction(
        'async function maskFactionEmblemImage(imageBuffer, job) {',
        '\n\nfunction resolveImageJobRenderDimensions',
        'maskFactionEmblemImage',
        { Buffer, Number, sharp }
    );
    const input = await sharp({
        create: {
            width: 20,
            height: 12,
            channels: 4,
            background: { r: 18, g: 93, b: 180, alpha: 1 }
        }
    }).png().toBuffer();

    const untouched = await maskFactionEmblemImage(input, { payload: {} });
    assert.strictEqual(untouched, input);

    const output = await maskFactionEmblemImage(input, { payload: { isFactionEmblem: true } });
    const metadata = await sharp(output).metadata();
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[((y * info.width + x) * info.channels) + 3];

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 12);
    assert.equal(alphaAt(0, 0), 0);
    assert.equal(alphaAt(19, 11), 0);
    assert.equal(alphaAt(10, 6), 255);
});

test('default config and browser UI expose faction emblem generation controls and overlays', () => {
    const config = yaml.load(fs.readFileSync(require.resolve('../config.default.yaml'), 'utf8'));
    const indexSource = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
    const settingsSource = fs.readFileSync(require.resolve('../views/settings.njk'), 'utf8');
    const configSource = fs.readFileSync(require.resolve('../views/config.njk'), 'utf8');
    const workflowSource = fs.readFileSync(require.resolve('../public/js/image-workflow-editor.js'), 'utf8');
    const mapSource = fs.readFileSync(require.resolve('../public/js/map.js'), 'utf8');
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const scssSource = fs.readFileSync(require.resolve('../public/css/main.scss'), 'utf8');

    assert.deepEqual(config.imagegen.faction_settings.image, { width: 1024, height: 1024 });
    assert.equal(Object.hasOwn(config.imagegen.image_prompt_instructions, 'faction'), true);
    assert.match(settingsSource, /name="imagePromptPrefixFaction"/);
    assert.match(settingsSource, /name="imagePromptInstructionsFaction"/);
    assert.match(configSource, /imagegen\.image_prompt_instructions\.faction::string/);
    assert.match(workflowSource, /'faction'/);
    assert.match(indexSource, /function attachFactionEmblem\(/);
    assert.match(indexSource, /factionId: location\.controllingFactionId/);
    assert.match(indexSource, /factionId: entity\?\.factionId/);
    assert.match(indexSource, /emblem\.className = 'faction-list-emblem'/);
    assert.match(indexSource, /copy\.className = 'faction-list-copy'/);
    assert.match(apiSource, /controllingFactionId: region\.controllingFactionId \|\| null/);
    assert.match(mapSource, /window\.attachFactionEmblem\(container, \{[\s\S]*factionId: region\.controllingFactionId,[\s\S]*variant: 'region-map'/);
    assert.match(scssSource, /\.faction-emblem--location/);
    assert.match(scssSource, /\.faction-emblem--region-map\s*\{[\s\S]*top: 16px;[\s\S]*width: clamp\(56px, 60%, 88px\)/);
    assert.match(scssSource, /\.faction-emblem-tooltip/);
    assert.match(indexSource, /faction-emblem-tooltip__emblem/);
    assert.match(indexSource, /\/api\/images\/\$\{encodeURIComponent\(imageId\)\}\/file/);
    assert.match(scssSource, /\.faction-emblem-tooltip__emblem\s*\{[\s\S]*width: 132px;[\s\S]*height: 132px/);
    assert.match(scssSource, /\.faction-emblem-tooltip__header\s*\{[\s\S]*display: flow-root/);
    assert.match(scssSource, /\.faction-list-item\s*\{[\s\S]*grid-template-columns: 44px minmax\(0, 1fr\)/);
});
