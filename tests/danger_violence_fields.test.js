const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Faction = require('../Faction.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const SettingInfo = require('../SettingInfo.js');

const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
const settingsSource = fs.readFileSync(require.resolve('../views/settings.njk'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const chatToolSource = fs.readFileSync(require.resolve('../chat_tool_calls.js'), 'utf8');
const baseContextTemplate = fs.readFileSync(require.resolve('../prompts/base-context.xml.njk'), 'utf8');
const mainScssSource = fs.readFileSync(require.resolve('../public/css/main.scss'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} should exist`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
    return source.slice(start, end);
}

function inputTagById(source, id) {
    const match = source.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `input #${id} should exist`);
    return match[0];
}

function createRegion() {
    return new Region({
        id: `danger-test-region-${Date.now()}-${Math.random()}`,
        name: 'Danger Test Region',
        description: 'A region used to verify persisted location danger.'
    });
}

test('Location dangerLevel defaults for legacy data, accepts unbounded integers, and persists', () => {
    const region = createRegion();
    try {
        const legacyLocation = new Location({
            id: `danger-test-legacy-${Date.now()}-${Math.random()}`,
            name: 'Legacy Clearing',
            description: 'A clearing saved before danger ratings existed.',
            regionId: region.id
        });
        assert.equal(legacyLocation.dangerLevel, 1);
        assert.equal(legacyLocation.toJSON().dangerLevel, 1);

        const location = new Location({
            id: `danger-test-location-${Date.now()}-${Math.random()}`,
            name: 'Wolfwood',
            description: 'A forest with many predators.',
            regionId: region.id,
            dangerLevel: 4
        });
        assert.equal(location.dangerLevel, 4);

        location.dangerLevel = -3;
        assert.equal(location.dangerLevel, -3);
        assert.equal(location.toJSON().dangerLevel, -3);

        const restored = new Location({
            ...location.toJSON(),
            id: `danger-test-restored-${Date.now()}-${Math.random()}`,
            checkRegionId: true
        });
        assert.equal(restored.dangerLevel, -3);
    } finally {
        Location.clear();
        Region.removeFromIndex(region);
    }
});

test('Location dangerLevel rejects non-integers instead of clamping', () => {
    const region = createRegion();
    try {
        for (const dangerLevel of [1.5, '3', NaN]) {
            assert.throws(() => new Location({
                id: `danger-test-invalid-${Date.now()}-${Math.random()}`,
                name: 'Invalid Danger',
                description: 'This construction must fail.',
                regionId: region.id,
                dangerLevel
            }), /danger/i);
        }

        const location = new Location({
            id: `danger-test-setter-${Date.now()}-${Math.random()}`,
            name: 'Setter Test',
            description: 'This location starts with valid danger.',
            regionId: region.id,
            dangerLevel: 2
        });
        location.dangerLevel = 0;
        assert.equal(location.dangerLevel, 0);
        location.dangerLevel = 6;
        assert.equal(location.dangerLevel, 6);
        for (const dangerLevel of [2.25, '4']) {
            assert.throws(() => {
                location.dangerLevel = dangerLevel;
            }, /danger/i);
            assert.equal(location.dangerLevel, 6, 'an invalid assignment must not mutate dangerLevel');
        }
    } finally {
        Location.clear();
        Region.removeFromIndex(region);
    }
});

test('Faction violenceLevel defaults for legacy data, accepts integers 1-5, and round-trips', () => {
    Faction.clear();
    try {
        const legacyFaction = new Faction({ name: 'Legacy Faction' });
        assert.equal(legacyFaction.violenceLevel, 1);
        assert.equal(legacyFaction.toJSON().violenceLevel, 1);

        const faction = new Faction({ name: 'Iron Host', violenceLevel: 4 });
        assert.equal(faction.violenceLevel, 4);

        faction.violenceLevel = 5;
        assert.equal(faction.toJSON().violenceLevel, 5);

        const restored = Faction.fromJSON(faction.toJSON());
        assert.equal(restored.violenceLevel, 5);
    } finally {
        Faction.clear();
    }
});

test('Faction violenceLevel rejects values outside integer range instead of clamping', () => {
    Faction.clear();
    try {
        for (const violenceLevel of [0, 6, 1.5, '3', NaN]) {
            assert.throws(
                () => new Faction({ name: `Invalid Violence ${String(violenceLevel)}`, violenceLevel }),
                /violence/i
            );
        }

        const faction = new Faction({ name: 'Setter Faction', violenceLevel: 2 });
        for (const violenceLevel of [0, 6, 2.25, '4']) {
            assert.throws(() => {
                faction.violenceLevel = violenceLevel;
            }, /violence/i);
            assert.equal(faction.violenceLevel, 2, 'an invalid assignment must not mutate violenceLevel');
        }
    } finally {
        Faction.clear();
    }
});

test('world-profile faction drafts persist and validate violenceLevel', () => {
    SettingInfo.clear();
    try {
        const legacy = new SettingInfo({
            name: 'Legacy Faction Profile',
            defaultFactions: [{ id: 'legacy', name: 'Legacy Guild' }]
        });
        assert.equal(legacy.defaultFactions[0].violenceLevel, 1);

        const setting = new SettingInfo({
            name: 'Violence Profile',
            defaultFactions: [{ id: 'iron', name: 'Iron Guild', violenceLevel: 4 }]
        });
        assert.equal(setting.toJSON().defaultFactions[0].violenceLevel, 4);
        assert.equal(SettingInfo.fromJSON(setting.toJSON()).defaultFactions[0].violenceLevel, 4);

        for (const violenceLevel of [0, 6, 1.5]) {
            assert.throws(() => new SettingInfo({
                name: `Invalid Profile ${violenceLevel}`,
                defaultFactions: [{ name: 'Invalid Guild', violenceLevel }]
            }), /violenceLevel/);
        }
    } finally {
        SettingInfo.clear();
    }
});

test('location and faction APIs accept and validate their rating fields', () => {
    const factionViolenceNormalizer = sourceBetween(
        apiSource,
        'const normalizeFactionViolenceLevel =',
        'const normalizeFactionAssets ='
    );
    const createFactionRoute = sourceBetween(
        apiSource,
        "app.post('/api/factions',",
        "app.put('/api/factions/:id',"
    );
    const updateFactionRoute = sourceBetween(
        apiSource,
        "app.put('/api/factions/:id',",
        "app.delete('/api/factions/:id',"
    );
    const updateLocationRoute = sourceBetween(
        apiSource,
        "app.put('/api/locations/:id',",
        "app.get('/api/locations/:id/relocation-options',"
    );
    const updateRegionRoute = sourceBetween(
        apiSource,
        "app.put('/api/regions/:id',",
        "app.post('/api/npcs/generate-aliases',"
    );

    assert.match(createFactionRoute, /violenceLevel/);
    assert.match(createFactionRoute, /normalizeFactionViolenceLevel\(body\.violenceLevel\)/);
    assert.match(createFactionRoute, /status\(400\)/);
    assert.match(updateFactionRoute, /violenceLevel/);
    assert.match(updateFactionRoute, /normalizeFactionViolenceLevel\(body\.violenceLevel\)/);
    assert.match(updateFactionRoute, /status\(400\)/);
    assert.match(factionViolenceNormalizer, /typeof value !== 'number'/);
    assert.match(factionViolenceNormalizer, /Number\.isInteger\(value\)/);
    assert.match(factionViolenceNormalizer, /value < 1 \|\| value > 5/);

    assert.match(updateLocationRoute, /dangerLevel/);
    assert.match(updateLocationRoute, /Number\.isInteger/);
    assert.match(updateLocationRoute, /status\(400\)/);
    assert.doesNotMatch(updateLocationRoute, /Math\.(?:max|min|round)\([^\n]*dangerLevel/);
    assert.match(updateRegionRoute, /dangerModifier/);
    assert.match(updateRegionRoute, /dangerModifierRaw === null \? 0/);
    assert.match(updateRegionRoute, /Number\.isInteger\(resolvedDangerModifier\)/);
    assert.match(factionViolenceNormalizer, /value === null/);
});

test('location danger and faction violence appear in view and edit surfaces', () => {
    assert.match(indexSource, /id="locationDangerLevel"/);
    assert.match(indexSource, /const LOCATION_DANGER_SKULL_COUNT = 4/);
    assert.match(indexSource, /const filledSkullCount = effectiveDangerLevel - 1/);
    assert.match(indexSource, /index < filledSkullCount/);
    assert.match(indexSource, /Danger: \$\{effectiveDangerLevel\} out of 5/);
    assert.match(mainScssSource, /\.location-danger-level\s*\{[\s\S]*?margin-left:\s*auto/);
    assert.match(mainScssSource, /\.location-danger-skull\s*\{[\s\S]*?opacity:\s*0\.25/);
    assert.match(mainScssSource, /&\.is-filled\s*\{[\s\S]*?opacity:\s*1/);
    const locationDangerInput = inputTagById(indexSource, 'locationEditDangerLevel');
    assert.match(locationDangerInput, /type="number"/);
    assert.doesNotMatch(locationDangerInput, /min=/);
    assert.doesNotMatch(locationDangerInput, /max=/);
    assert.match(indexSource, /locationEditDangerLevelInput/);
    assert.match(indexSource, /payload\.dangerLevel/);
    assert.match(indexSource, /label:\s*'Danger'/);
    assert.match(indexSource, /label:\s*'Danger Base'/);
    assert.match(indexSource, /label:\s*'Region Modifier'/);

    const regionDangerInput = inputTagById(indexSource, 'regionEditDangerModifier');
    assert.match(regionDangerInput, /type="number"/);
    assert.doesNotMatch(regionDangerInput, /min=/);
    assert.doesNotMatch(regionDangerInput, /max=/);
    assert.match(indexSource, /dangerModifier:\s*dangerModifierValue/);

    const factionViolenceInput = inputTagById(indexSource, 'factionViolenceLevel');
    const factionCreateViolenceInput = inputTagById(indexSource, 'factionCreateViolenceLevel');
    for (const inputTag of [factionViolenceInput, factionCreateViolenceInput]) {
        assert.match(inputTag, /type="number"/);
        assert.match(inputTag, /min="1"/);
        assert.match(inputTag, /max="5"/);
    }
    assert.match(indexSource, /violenceLevelInput/);
    assert.match(indexSource, /violenceLevel:\s*[^,}\n]+/);
    assert.match(indexSource, /<span>Violence<\/span>/);

    const settingsViolenceInput = inputTagById(settingsSource, 'settingsFactionViolenceLevel');
    assert.match(settingsViolenceInput, /type="number"/);
    assert.match(settingsViolenceInput, /min="1"/);
    assert.match(settingsViolenceInput, /max="5"/);
    assert.match(settingsSource, /violenceLevel:\s*1/);
});

test('direct edit tool source exposes and validates all danger fields', () => {
    assert.match(chatToolSource, /location:[\s\S]*?'dangerLevel'/);
    assert.match(chatToolSource, /region:[\s\S]*?'dangerModifier'/);
    assert.match(chatToolSource, /faction:[\s\S]*?'violenceLevel'/);
    assert.match(chatToolSource, /normalizeUpsertFactionFields[\s\S]*?fieldName === 'violenceLevel'/);
    assert.match(chatToolSource, /fieldName === 'dangerModifier' \? 0 : 1/);
    assert.match(chatToolSource, /resolveEffectiveLocationDanger/);
});

test('Region dangerModifier defaults to zero, accepts unbounded integers, and persists', () => {
    const region = createRegion();
    try {
        assert.equal(region.dangerModifier, 0);
        region.dangerModifier = -7;
        const restored = Region.fromJSON({ ...region.toJSON(), id: `${region.id}-restored` });
        assert.equal(restored.dangerModifier, -7);
        assert.throws(() => { region.dangerModifier = 1.5; }, /dangerModifier/);
        assert.equal(region.dangerModifier, -7);
    } finally {
        Region.clear();
    }
});

test('danger and violence ratings remain outside ordinary LLM base context', () => {
    const currentLocationContext = sourceBetween(
        serverSource,
        'const currentLocationContext = location ? {',
        '} : null;'
    );
    const factionContext = sourceBetween(
        serverSource,
        'const factionSummaries = [];',
        'const weatherScope ='
    );

    assert.doesNotMatch(currentLocationContext, /dangerLevel/);
    assert.doesNotMatch(factionContext, /violenceLevel/);
    assert.doesNotMatch(baseContextTemplate, /dangerLevel|violenceLevel/);
});
