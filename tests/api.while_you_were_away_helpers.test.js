const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { DOMParser } = require('@xmldom/xmldom');

function normalizeTravelProseDestinationField(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.]+$/g, '');
    const emptySentinels = new Set([
        'n/a',
        'na',
        'none',
        'no',
        'omit',
        'null',
        'not applicable'
    ]);
    if (emptySentinels.has(normalized)) {
        return null;
    }

    return trimmed;
}

function sanitizeForXml(input) {
    return `<root>${input}</root>`
        .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
        .replace(/<\s*br\s*>/gi, '<br/>')
        .replace(/<\s*hr\s*>/gi, '<hr/>');
}

function stripToXmlPayload(input) {
    if (typeof input !== 'string') {
        throw new TypeError('stripToXmlPayload requires a string input.');
    }
    const start = input.indexOf('<');
    const end = input.lastIndexOf('>');
    if (start === -1 || end === -1 || end <= start) {
        return '';
    }
    return input.slice(start, end + 1);
}

function getDirectChildElementByTagName(parentNode, tagName) {
    if (!parentNode || typeof tagName !== 'string' || !tagName.trim()) {
        return null;
    }

    const targetTag = tagName.trim().toLowerCase();
    const childNodes = parentNode.childNodes || [];
    for (let index = 0; index < childNodes.length; index += 1) {
        const node = childNodes[index];
        if (!node || node.nodeType !== 1) {
            continue;
        }
        const nodeName = typeof node.nodeName === 'string' ? node.nodeName.toLowerCase() : '';
        if (nodeName === targetTag) {
            return node;
        }
    }

    return null;
}

function getDirectChildTextByTagName(parentNode, tagName) {
    const childNode = getDirectChildElementByTagName(parentNode, tagName);
    if (!childNode) {
        return '';
    }
    return typeof childNode.textContent === 'string' ? childNode.textContent : '';
}

function parseStructuredTravelProseDestination(destinationNode, { fieldLabel = 'travel destination' } = {}) {
    if (!destinationNode) {
        return null;
    }

    const locationNode = getDirectChildElementByTagName(destinationNode, 'location');
    const regionNode = getDirectChildElementByTagName(destinationNode, 'region');
    if (!locationNode && !regionNode) {
        const destinationText = normalizeTravelProseDestinationField(destinationNode.textContent || '');
        if (destinationText) {
            throw new Error(`${fieldLabel} must use <location> and <region> child tags.`);
        }
        return null;
    }

    const locationText = normalizeTravelProseDestinationField(locationNode ? (locationNode.textContent || '') : '');
    const regionText = normalizeTravelProseDestinationField(regionNode ? (regionNode.textContent || '') : '');
    if (!locationText && !regionText) {
        return null;
    }
    if (regionText && !locationText) {
        return `${regionText}|`;
    }
    if (!regionText && locationText) {
        return locationText;
    }
    return `${regionText}|${locationText}`;
}

function normalizeNpcNameKey(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase();
}

function createLocation({ id, name, regionId, npcIds = [] }) {
    return {
        id,
        name,
        regionId,
        npcIds: npcIds.slice(),
        addNpcId(npcId) {
            if (!this.npcIds.includes(npcId)) {
                this.npcIds.push(npcId);
            }
        },
        removeNpcId(npcId) {
            this.npcIds = this.npcIds.filter(id => id !== npcId);
        }
    };
}

function loadWhileYouWereAwayHelpers({
    config = { ai: {} },
    currentPlayer = null,
    players = new Map(),
    gameLocations = new Map(),
    regions = new Map(),
    prepareBasePromptContext = async () => ({ whileYouWereAwayNpcs: [] }),
    llmResponse = '',
    promptTemplate = {
        systemPrompt: 'system',
        generationPrompt: 'generation'
    }
} = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function resolveRegionForLocationObject(location) {');
    const end = source.indexOf('\n        function collectNpcLastMention(name) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate while-you-were-away helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const pushedEntries = [];

    const resolveRegionByLocationId = (locationId) => {
        for (const region of regions.values()) {
            if (Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) {
                return region;
            }
        }
        return null;
    };

    const resolveLocationByIdOrName = (value) => {
        if (typeof value !== 'string' || !value.trim()) {
            return null;
        }
        const trimmed = value.trim();
        if (gameLocations.has(trimmed)) {
            return gameLocations.get(trimmed);
        }
        for (const location of gameLocations.values()) {
            if (String(location.name || '').trim().toLowerCase() === trimmed.toLowerCase()) {
                return location;
            }
        }
        return null;
    };

    const resolveLocationInRegionByName = (region, locationName) => {
        if (!region || typeof locationName !== 'string') {
            return null;
        }
        const normalizedLocationName = locationName.trim().toLowerCase();
        for (const locationId of region.locationIds || []) {
            const location = resolveLocationByIdOrName(locationId);
            if (!location) {
                continue;
            }
            if (String(location.name || '').trim().toLowerCase() === normalizedLocationName) {
                return location;
            }
        }
        return null;
    };

    const regionByName = new Map();
    for (const region of regions.values()) {
        regionByName.set(String(region.name || '').trim().toLowerCase(), region);
    }

    const context = {
        Object,
        Array,
        Number,
        Math,
        Set,
        Map,
        console,
        Utils: {
            parseXmlDocument: (xml, mimeType) => new DOMParser().parseFromString(xml, mimeType)
        },
        config,
        currentPlayer,
        players,
        gameLocations,
        regions,
        sanitizeForXml,
        stripToXmlPayload,
        getDirectChildElementByTagName,
        getDirectChildTextByTagName,
        parseStructuredTravelProseDestination,
        normalizeTravelProseDestinationField,
        normalizeNpcNameKey,
        resolveLocationByIdOrName,
        resolveLocationInRegionByName,
        findRegionByLocationId: resolveRegionByLocationId,
        resolveRegionNameForLocationId: (locationId) => {
            const region = resolveRegionByLocationId(locationId);
            return region ? region.name : null;
        },
        Location: {
            get: resolveLocationByIdOrName
        },
        Region: {
            get: id => regions.get(id) || null,
            getByName: name => regionByName.get(String(name || '').trim().toLowerCase()) || null
        },
        promptEnv: {
            render: () => '<template><systemPrompt>system</systemPrompt><generationPrompt>generation</generationPrompt></template>'
        },
        parseXMLTemplate: () => ({ ...promptTemplate }),
        prepareBasePromptContext,
        LLMClient: {
            chatCompletion: async () => llmResponse,
            logPrompt: () => {}
        },
        requireLocationId: (value, label) => {
            if (typeof value !== 'string' || !value.trim()) {
                throw new Error(`${label} is missing a valid location id.`);
            }
            return value.trim();
        },
        pushChatEntry: (entry, collector = null, locationId = null) => {
            const stored = {
                ...entry,
                locationId: locationId || entry.locationId
            };
            pushedEntries.push(stored);
            if (Array.isArray(collector)) {
                collector.push(stored);
            }
            return stored;
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.parseWhileYouWereAwayResponse = parseWhileYouWereAwayResponse;
this.resolveWhileYouWereAwayDestination = resolveWhileYouWereAwayDestination;
this.runWhileYouWereAwayPrompt = runWhileYouWereAwayPrompt;`,
        context
    );

    return {
        parseWhileYouWereAwayResponse: context.parseWhileYouWereAwayResponse,
        resolveWhileYouWereAwayDestination: context.resolveWhileYouWereAwayDestination,
        runWhileYouWereAwayPrompt: context.runWhileYouWereAwayPrompt,
        pushedEntries,
        context
    };
}

test('parseWhileYouWereAwayResponse parses XML updates and percentage deltas', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira spent the morning working the market.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>energy</needBarId>
        <delta>-10%</delta>
      </needBarEffect>
    </needBarChanges>
    <travelDestination>
      <region>Vale</region>
    </travelDestination>
  </characterUpdate>
</characterUpdates>
`, {
        expectedNameKeys: new Set(['mira'])
    });

    assert.equal(parsed.proseForPlayer, null);
    assert.equal(parsed.updates.length, 1);
    assert.equal(parsed.updates[0].name, 'Mira');
    assert.equal(parsed.updates[0].needBarChanges[0].needBarId, 'energy');
    assert.equal(parsed.updates[0].needBarChanges[0].deltaPercent, -10);
    assert.equal(parsed.updates[0].travelDestination, 'Vale|');
});

test('parseWhileYouWereAwayResponse allows additional arriving characters marked with HERE', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira spent the morning working the market.</update>
  </characterUpdate>
  <characterUpdate>
    <name>Toma</name>
    <update>Toma arrived late in the afternoon and is still here.</update>
    <travelDestination>HERE</travelDestination>
  </characterUpdate>
</characterUpdates>
`, {
        expectedNameKeys: new Set(['mira'])
    });

    assert.equal(parsed.updates.length, 2);
    assert.equal(parsed.updates[0].arrivedHere, false);
    assert.equal(parsed.updates[1].name, 'Toma');
    assert.equal(parsed.updates[1].arrivedHere, true);
    assert.equal(parsed.updates[1].travelDestination, null);
});

test('parseWhileYouWereAwayResponse reads optional proseForPlayer from response wrapper', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira spent the morning working the market.</update>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>
    Mira looks up from the market stall and gives you a quick summary of the day.

    She keeps her voice low as the lunch crowd mills around nearby.
  </proseForPlayer>
</response>
`, {
        expectedNameKeys: new Set(['mira'])
    });

    assert.equal(parsed.updates.length, 1);
    assert.equal(
        parsed.proseForPlayer,
        'Mira looks up from the market stall and gives you a quick summary of the day.\n\nShe keeps her voice low as the lunch crowd mills around nearby.'
    );
});

test('resolveWhileYouWereAwayDestination prefers the current region and supports region-only travel', () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha' });
    const alphaInn = createLocation({ id: 'inn-alpha', name: 'Inn', regionId: 'alpha' });
    const betaInn = createLocation({ id: 'inn-beta', name: 'Inn', regionId: 'beta' });
    const gate = createLocation({ id: 'beta-gate', name: 'Gate', regionId: 'beta' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square', 'inn-alpha'], entranceLocationId: 'square' }],
        ['beta', { id: 'beta', name: 'Beta', locationIds: ['beta-gate', 'inn-beta'], entranceLocationId: 'beta-gate' }]
    ]);
    const gameLocations = new Map([
        [square.id, square],
        [alphaInn.id, alphaInn],
        [betaInn.id, betaInn],
        [gate.id, gate]
    ]);

    const { resolveWhileYouWereAwayDestination } = loadWhileYouWereAwayHelpers({
        gameLocations,
        regions
    });

    const preferred = resolveWhileYouWereAwayDestination('Inn', {
        currentRegion: regions.get('alpha')
    });
    assert.equal(preferred.location.id, 'inn-alpha');

    const regionOnly = resolveWhileYouWereAwayDestination('Beta|');
    assert.equal(regionOnly.location.id, 'beta-gate');
});

test('runWhileYouWereAwayPrompt applies need deltas, moves NPCs, and records a hidden history entry', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const alphaInn = createLocation({ id: 'inn-alpha', name: 'Inn', regionId: 'alpha' });
    const betaInn = createLocation({ id: 'inn-beta', name: 'Inn', regionId: 'beta' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square', 'inn-alpha'], entranceLocationId: 'square' }],
        ['beta', { id: 'beta', name: 'Beta', locationIds: ['inn-beta'], entranceLocationId: 'inn-beta' }]
    ]);
    const gameLocations = new Map([
        [square.id, square],
        [alphaInn.id, alphaInn],
        [betaInn.id, betaInn]
    ]);

    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        _bars: [{ id: 'energy', name: 'Energy', value: 50, min: 0, max: 100 }],
        getNeedBars() {
            return this._bars.map(bar => ({ ...bar }));
        },
        setNeedBarValue(identifier, nextValue) {
            const normalized = String(identifier).trim().toLowerCase();
            const bar = this._bars.find(candidate => (
                String(candidate.id || '').trim().toLowerCase() === normalized
                || String(candidate.name || '').trim().toLowerCase() === normalized
            ));
            if (!bar) {
                throw new Error(`Unknown need bar "${identifier}".`);
            }
            bar.value = nextValue;
            return { ...bar };
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };

    const players = new Map([[npc.id, npc]]);
    const currentPlayer = {
        id: 'player',
        name: 'Baato',
        currentLocation: 'square'
    };

    const collector = [];
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        currentPlayer,
        players,
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    lastSeenAgeMinutes: 330,
                    lastSeenTimeAgo: '5 hours and 30 minutes ago'
                }
            ]
        }),
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira ate a proper meal and then headed to the inn to rest.</update>
      <needBarChanges>
        <needBarEffect>
          <needBarId>energy</needBarId>
          <delta>25</delta>
        </needBarEffect>
      </needBarChanges>
      <travelDestination>
        <location>Inn</location>
      </travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Mira waves you over and quickly fills you in before returning to the inn.</proseForPlayer>
</response>
`
    });

    const storedEntry = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        entryCollector: collector,
        parentEntryId: 'parent-1'
    });

    assert.equal(npc._bars[0].value, 75);
    assert.equal(npc.currentLocation, 'inn-alpha');
    assert.equal(square.npcIds.includes('mira'), false);
    assert.equal(alphaInn.npcIds.includes('mira'), true);

    assert.equal(storedEntry.type, 'while-you-were-away');
    assert.equal(storedEntry.parentId, 'parent-1');
    assert.match(storedEntry.content, /Update on Mira since Baato last saw them 5 hours and 30 minutes ago:/);
    assert.match(storedEntry.content, /Mira went to Inn in Alpha/);
    assert.equal(collector.length, 2);
    assert.equal(pushedEntries.length, 2);
    assert.equal(pushedEntries[1].type, 'while-you-were-away-player');
    assert.equal(pushedEntries[1].parentId, 'parent-1');
    assert.match(pushedEntries[1].content, /Mira waves you over and quickly fills you in before returning to the inn\./);
});

test('runWhileYouWereAwayPrompt silently ignores inactive need bars returned by the prompt', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const warnings = [];
    const originalWarn = console.warn;

    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        _activeBars: [],
        _storedBars: [{ id: 'energy', name: 'Energy', value: 50, min: 0, max: 100 }],
        _setCalls: [],
        getNeedBars(options = {}) {
            return (options?.scope === 'stored' ? this._storedBars : this._activeBars).map(bar => ({ ...bar }));
        },
        setNeedBarValue(identifier, nextValue) {
            this._setCalls.push({ identifier, nextValue });
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        players: new Map([[npc.id, npc]]),
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    lastSeenAgeMinutes: 300,
                    lastSeenTimeAgo: '5 hours ago'
                }
            ]
        }),
        llmResponse: `
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira mostly kept to herself.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>energy</needBarId>
        <delta>-10%</delta>
      </needBarEffect>
    </needBarChanges>
  </characterUpdate>
</characterUpdates>
`
    });

    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const storedEntry = await runWhileYouWereAwayPrompt({
            locationOverride: square,
            locationId: square.id
        });

        assert.equal(npc._setCalls.length, 0);
        assert.equal(warnings.length, 0);
        assert.equal(storedEntry.type, 'while-you-were-away');
    } finally {
        console.warn = originalWarn;
    }
});

test('runWhileYouWereAwayPrompt warns and ignores nonexistent need bars returned by the prompt', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const warnings = [];
    const originalWarn = console.warn;

    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        _setCalls: [],
        getNeedBars() {
            return [];
        },
        setNeedBarValue(identifier, nextValue) {
            this._setCalls.push({ identifier, nextValue });
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        players: new Map([[npc.id, npc]]),
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    lastSeenAgeMinutes: 300,
                    lastSeenTimeAgo: '5 hours ago'
                }
            ]
        }),
        llmResponse: `
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira mostly kept to herself.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>voidness</needBarId>
        <delta>-10%</delta>
      </needBarEffect>
    </needBarChanges>
  </characterUpdate>
</characterUpdates>
`
    });

    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const storedEntry = await runWhileYouWereAwayPrompt({
            locationOverride: square,
            locationId: square.id
        });

        assert.equal(npc._setCalls.length, 0);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Ignoring unknown while-you-were-away need bar "voidness" for "Mira"\./);
        assert.equal(storedEntry.type, 'while-you-were-away');
    } finally {
        console.warn = originalWarn;
    }
});

test('runWhileYouWereAwayPrompt skips the prompt when everyone was seen too recently', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);

    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        getNeedBars() {
            return [];
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        players: new Map([[npc.id, npc]]),
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    lastSeenAgeMinutes: 239,
                    lastSeenTimeAgo: '3 hours and 59 minutes ago'
                }
            ]
        }),
        llmResponse: ''
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id
    });

    assert.equal(result, null);
});

test('runWhileYouWereAwayPrompt allows arrival updates for current-location NPCs not listed as candidates', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira', 'toma'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);

    const mira = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        _bars: [],
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };
    const toma = {
        id: 'toma',
        isNPC: true,
        name: 'Toma',
        currentLocation: 'square',
        _bars: [],
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        players: new Map([
            [mira.id, mira],
            [toma.id, toma]
        ]),
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    lastSeenAgeMinutes: 300,
                    lastSeenTimeAgo: '5 hours ago'
                }
            ]
        }),
        llmResponse: `
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira spent the afternoon tending to the square.</update>
  </characterUpdate>
  <characterUpdate>
    <name>Toma</name>
    <update>Toma arrived from the road shortly before the player got here and is lingering in the square.</update>
    <travelDestination>HERE</travelDestination>
  </characterUpdate>
</characterUpdates>
`
    });

    const storedEntry = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id
    });

    assert.equal(storedEntry.type, 'while-you-were-away');
    assert.match(storedEntry.content, /Update on Mira since Baato last saw them 5 hours ago:/);
    assert.match(storedEntry.content, /Update on Toma since Baato last saw them some time ago:/);
    assert.match(storedEntry.content, /Toma went to Town Square in Alpha/);
});

test('runWhileYouWereAwayPrompt warns and skips arrival updates for NPCs not actually in the exact current location', async () => {
    const mainRoom = createLocation({ id: 'main-room', name: 'Main Room', regionId: 'farmhouse', npcIds: ['ember', 'vervaine'] });
    const kitchen = createLocation({ id: 'kitchen', name: 'Kitchen', regionId: 'farmhouse', npcIds: ['rozalin'] });
    const regions = new Map([
        ['farmhouse', { id: 'farmhouse', name: 'Farmhouse Interior', locationIds: ['main-room', 'kitchen'], entranceLocationId: 'main-room' }]
    ]);
    const gameLocations = new Map([
        [mainRoom.id, mainRoom],
        [kitchen.id, kitchen]
    ]);

    const ember = {
        id: 'ember',
        isNPC: true,
        name: 'Ember',
        currentLocation: 'main-room',
        _bars: [],
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };
    const vervaine = {
        id: 'vervaine',
        isNPC: true,
        name: 'Vervaine Duskweaver',
        currentLocation: 'main-room',
        _bars: [],
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };
    const rozalin = {
        id: 'rozalin',
        isNPC: true,
        name: 'Rozalin',
        currentLocation: 'kitchen',
        _bars: [],
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));

    try {
        const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
            currentPlayer: {
                id: 'player',
                name: 'Exis',
                currentLocation: 'main-room'
            },
            players: new Map([
                [ember.id, ember],
                [vervaine.id, vervaine],
                [rozalin.id, rozalin]
            ]),
            gameLocations,
            regions,
            prepareBasePromptContext: async () => ({
                whileYouWereAwayNpcs: [
                    {
                        id: 'ember',
                        name: 'Ember',
                        lastSeenAgeMinutes: 540,
                        lastSeenTimeAgo: '9 hours ago'
                    },
                    {
                        id: 'vervaine',
                        name: 'Vervaine Duskweaver',
                        lastSeenAgeMinutes: 540,
                        lastSeenTimeAgo: '9 hours ago'
                    }
                ]
            }),
            llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Ember</name>
      <update>Ember has spent the afternoon cleaning aggressively.</update>
    </characterUpdate>
    <characterUpdate>
      <name>Vervaine Duskweaver</name>
      <update>Vervaine has been waiting in the walls with unnerving patience.</update>
    </characterUpdate>
    <characterUpdate>
      <name>Rozalin</name>
      <update>Rozalin murmurs from the kitchen while recovering.</update>
      <travelDestination>HERE</travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Ember and Vervaine are both here when Exis returns, while Rozalin can only be heard from the kitchen.</proseForPlayer>
</response>
`
        });

        const storedEntry = await runWhileYouWereAwayPrompt({
            locationOverride: mainRoom,
            locationId: mainRoom.id
        });

        assert.equal(storedEntry.type, 'while-you-were-away');
        assert.equal(pushedEntries.length, 2);
        assert.equal(pushedEntries[1].type, 'while-you-were-away-player');
        assert.match(storedEntry.content, /Update on Ember since Exis last saw them 9 hours ago:/);
        assert.match(storedEntry.content, /Update on Vervaine Duskweaver since Exis last saw them 9 hours ago:/);
        assert.doesNotMatch(storedEntry.content, /Rozalin/);
        assert.equal(rozalin.currentLocation, 'kitchen');
        assert.equal(kitchen.npcIds.includes('rozalin'), true);
        assert.equal(mainRoom.npcIds.includes('rozalin'), false);
        assert.equal(warnings.length, 1);
        assert.match(
            warnings[0],
            /Ignoring while-you-were-away arrival update "Rozalin" because no matching NPC is currently at "Main Room"\./
        );
    } finally {
        console.warn = originalWarn;
    }
});
