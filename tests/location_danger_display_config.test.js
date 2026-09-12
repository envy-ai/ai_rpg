const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function renderPlayPage(showLocationDanger) {
    const env = nunjucks.configure(path.join(root, 'views'), {
        autoescape: false,
        noCache: true,
        throwOnUndefined: false
    });
    return env.render('index.njk', {
        showLocationDanger,
        characterPortraitWidth: 768,
        characterPortraitHeight: 1024,
        rarityDefinitions: {},
        needBarDefinitions: [],
        pointPoolFormulas: {},
        chatHistory: [],
        thingImageBadges: [],
        thingContextActions: [],
        thingEditFields: [],
        playerEditFields: [],
        modScripts: [],
        modStyles: []
    });
}

test('location danger display defaults off and is strictly forwarded to the Play template', () => {
    const defaults = yaml.load(read('config.default.yaml'));
    const serverSource = read('server.js');

    assert.equal(defaults.show_location_danger, false);
    assert.match(serverSource, /showLocationDanger: config\.show_location_danger === true/);
    assert.match(serverSource, /show_location_danger must be a boolean when provided/);
});

test('Play template omits the location danger indicator unless enabled', () => {
    assert.doesNotMatch(renderPlayPage(false), /id="locationDangerLevel"/);
    assert.doesNotMatch(renderPlayPage(undefined), /id="locationDangerLevel"/);
    assert.match(renderPlayPage(true), /id="locationDangerLevel"/);
});

test('configuration page preserves the location danger display option', () => {
    const configView = read('views/config.njk');
    const defaults = yaml.load(read('config.default.yaml'));
    const env = nunjucks.configure(path.join(root, 'views'), {
        autoescape: false,
        noCache: true,
        throwOnUndefined: false
    });
    const renderConfig = enabled => env.render('config.njk', {
        config: { ...defaults, show_location_danger: enabled },
        modConfigs: [],
        modelOptions: [],
        gameLoaded: false
    });

    assert.match(configView, /name="show_location_danger::boolean" value="false"/);
    assert.match(configView, /id="show-location-danger"[^>]+name="show_location_danger::boolean"[^>]+value="true"/);
    assert.doesNotMatch(
        renderConfig(false),
        /id="show-location-danger"[^>]+checked/
    );
    assert.match(
        renderConfig(true),
        /id="show-location-danger"[^>]+checked/
    );
});
