const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { DOMParser } = require('@xmldom/xmldom');
const ProjectUtils = require('../Utils.js');

function normalizemoveTurnResultDestinationField(value) {
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

function parseStructuredmoveTurnResultDestination(destinationNode, { fieldLabel = 'travel destination' } = {}) {
    if (!destinationNode) {
        return null;
    }

    const locationNode = getDirectChildElementByTagName(destinationNode, 'location');
    const regionNode = getDirectChildElementByTagName(destinationNode, 'region');
    if (!locationNode && !regionNode) {
        const destinationText = normalizemoveTurnResultDestinationField(destinationNode.textContent || '');
        if (destinationText) {
            throw new Error(`${fieldLabel} must use <location> and <region> child tags.`);
        }
        return null;
    }

    const locationText = normalizemoveTurnResultDestinationField(locationNode ? (locationNode.textContent || '') : '');
    const regionText = normalizemoveTurnResultDestinationField(regionNode ? (regionNode.textContent || '') : '');
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

function createLocation({ id, name, regionId, npcIds = [], thingIds = [], visited = true, lastVisitedTime = null }) {
    return {
        id,
        name,
        regionId,
        visited,
        lastVisitedTime,
        npcIds: npcIds.slice(),
        thingIds: thingIds.slice(),
        minutesSinceLastVisit(currentTime = null) {
            if (this.lastVisitedTime === null || this.lastVisitedTime === undefined) {
                return null;
            }
            const referenceTime = currentTime === null || currentTime === undefined
                ? 0
                : Number(currentTime);
            if (!Number.isFinite(referenceTime)) {
                throw new Error('Location minutesSinceLastVisit reference time must be finite.');
            }
            return referenceTime - this.lastVisitedTime;
        },
        addNpcId(npcId) {
            if (!this.npcIds.includes(npcId)) {
                this.npcIds.push(npcId);
            }
        },
        removeNpcId(npcId) {
            this.npcIds = this.npcIds.filter(id => id !== npcId);
        },
        addThingId(thingId) {
            if (!this.thingIds.includes(thingId)) {
                this.thingIds.push(thingId);
            }
            const thing = activeTestThings?.get?.(thingId) || null;
            if (thing) {
                thing.metadata = { ...(thing.metadata || {}), locationId: id };
            }
        },
        removeThingId(thingId) {
            const before = this.thingIds.length;
            this.thingIds = this.thingIds.filter(id => id !== thingId);
            const removed = this.thingIds.length !== before;
            const thing = activeTestThings?.get?.(thingId) || null;
            if (removed && thing?.metadata?.locationId === id) {
                const metadata = { ...thing.metadata };
                delete metadata.locationId;
                thing.metadata = metadata;
            }
            return removed;
        }
    };
}

let activeTestThings = null;

function createThing({ id, name, metadata = {} }) {
    return {
        id,
        name,
        metadata: { ...metadata }
    };
}

function loadWhileYouWereAwayHelpers({
    config = { ai: {} },
    currentPlayer = null,
    players = new Map(),
    things = new Map(),
    gameLocations = new Map(),
    regions = new Map(),
    prepareBasePromptContext = async () => ({ whileYouWereAwayNpcs: [] }),
    llmResponse = '',
    captureChatCompletionOptions = null,
    promptTemplate = {
        systemPrompt: 'system',
        generationPrompt: 'generation'
    },
    applySlopRemoval = async (text) => ({
        text,
        ran: false,
        slopWords: [],
        slopRegexes: [],
        slopNgrams: []
    }),
    recordSlopRemovalEntry = null,
    eventsRunEventChecks = async () => null,
    appendEventSummariesToChat = () => {},
    globalsElapsedTime = typeof currentPlayer?.elapsedTime === 'number' ? currentPlayer.elapsedTime : 0,
    globalsTotalWorldMinutes = globalsElapsedTime,
    useTinyBrainWhileAway = false
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

    const pushChatEntry = (entry, collector = null, locationId = null) => {
        const stored = {
            ...entry,
            id: entry.id || `entry-${pushedEntries.length + 1}`,
            locationId: locationId || entry.locationId
        };
        pushedEntries.push(stored);
        if (Array.isArray(collector)) {
            collector.push(stored);
        }
        return stored;
    };

    const defaultRecordSlopRemovalEntry = ({ data, parentId = null, locationId = null } = {}, collector = null) => (
        pushChatEntry({
            role: 'assistant',
            type: 'slop-remover',
            parentId,
            slopRemoval: data,
            locationId
        }, collector, locationId)
    );

    const context = {
        Object,
        Array,
        Number,
        Math,
        Set,
        Map,
        console,
        Utils: {
            parseXmlDocument: (xml, mimeType) => new DOMParser().parseFromString(xml, mimeType),
            formatAbsoluteWorldMinutesAgo: ProjectUtils.formatAbsoluteWorldMinutesAgo
        },
        config,
        Globals: {
            config,
            elapsedTime: globalsElapsedTime,
            getTotalWorldMinutes: () => globalsTotalWorldMinutes,
            scrubGeneratedBrackets: value => value
        },
        currentPlayer,
        players,
        things,
        gameLocations,
        regions,
        sanitizeForXml,
        stripToXmlPayload,
        getDirectChildElementByTagName,
        getDirectChildTextByTagName,
        parseStructuredmoveTurnResultDestination,
        normalizemoveTurnResultDestinationField,
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
            chatCompletion: async (options) => {
                if (typeof captureChatCompletionOptions === 'function') {
                    captureChatCompletionOptions(options);
                }
                return llmResponse;
            },
            logPrompt: () => {}
        },
        Events: {
            runEventChecks: eventsRunEventChecks
        },
        appendEventSummariesToChat,
        applySlopRemoval,
        isTinyBrainPromptEnabled: () => useTinyBrainWhileAway,
        configureTinyBrainPromptContext: () => ({
            renderState: { completedCheckpoints: {} }
        }),
        runTinyBrainNarrativePrompt: async () => ({
            result: { aiResponse: llmResponse },
            liveDeslopController: null
        }),
        recordSlopRemovalEntry: recordSlopRemovalEntry || defaultRecordSlopRemovalEntry,
        requireLocationId: (value, label) => {
            if (typeof value !== 'string' || !value.trim()) {
                throw new Error(`${label} is missing a valid location id.`);
            }
            return value.trim();
        },
        pushChatEntry
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

test('parseWhileYouWereAwayResponse parses XML updates and absolute need bar values', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira spent the morning working the market.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>energy</needBarId>
        <value>75%</value>
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
    assert.equal(parsed.updates[0].needBarChanges[0].valuePercent, 75);
    assert.equal(parsed.updates[0].travelDestination, 'Vale|');
});

test('parseWhileYouWereAwayResponse strips nonnumeric need bar value text and skips blanks', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira caught up with friends and rested.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>energy</needBarId>
        <value>about 80%</value>
      </needBarEffect>
      <needBarEffect>
        <needBarId>sanity</needBarId>
        <value>N/A</value>
      </needBarEffect>
      <needBarEffect>
        <needBarId>social</needBarId>
        <value> </value>
      </needBarEffect>
    </needBarChanges>
  </characterUpdate>
</characterUpdates>
`, {
        expectedNameKeys: new Set(['mira'])
    });

    assert.equal(parsed.updates.length, 1);
    assert.equal(parsed.updates[0].needBarChanges.length, 1);
    assert.equal(parsed.updates[0].needBarChanges[0].needBarId, 'energy');
    assert.equal(parsed.updates[0].needBarChanges[0].valuePercent, 80);
});

test('parseWhileYouWereAwayResponse clamps out-of-range need bar value percentages', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<characterUpdates>
  <characterUpdate>
    <name>Mira</name>
    <update>Mira pushed herself past exhaustion and then recovered with help.</update>
    <needBarChanges>
      <needBarEffect>
        <needBarId>energy</needBarId>
        <value>125%</value>
      </needBarEffect>
      <needBarEffect>
        <needBarId>social</needBarId>
        <value>-25%</value>
      </needBarEffect>
    </needBarChanges>
  </characterUpdate>
</characterUpdates>
`, {
        expectedNameKeys: new Set(['mira'])
    });

    assert.equal(parsed.updates.length, 1);
    assert.equal(parsed.updates[0].needBarChanges.length, 2);
    assert.equal(parsed.updates[0].needBarChanges[0].needBarId, 'energy');
    assert.equal(parsed.updates[0].needBarChanges[0].valuePercent, 100);
    assert.equal(parsed.updates[0].needBarChanges[1].needBarId, 'social');
    assert.equal(parsed.updates[0].needBarChanges[1].valuePercent, 0);
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

test('parseWhileYouWereAwayResponse reads itemSceneryMoves from response wrapper', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<response>
  <characterUpdates></characterUpdates>
  <proseForPlayer>The cart is waiting beside the south gate.</proseForPlayer>
  <itemSceneryMoves>
    <itemName>Supply Cart</itemName>
    <itemName> </itemName>
    <itemName>Folding Barricade</itemName>
  </itemSceneryMoves>
</response>
`, {
        expectedNameKeys: new Set()
    });

    assert.deepEqual(Array.from(parsed.itemSceneryMoves), ['Supply Cart', 'Folding Barricade']);
});

test('parseWhileYouWereAwayResponse allows empty characterUpdates when no names are expected', () => {
    const { parseWhileYouWereAwayResponse } = loadWhileYouWereAwayHelpers();
    const parsed = parseWhileYouWereAwayResponse(`
<response>
  <characterUpdates></characterUpdates>
  <proseForPlayer>The old room smells faintly of dust and cold ash.</proseForPlayer>
</response>
`, {
        expectedNameKeys: new Set()
    });

    assert.equal(parsed.updates.length, 0);
    assert.equal(parsed.proseForPlayer, 'The old room smells faintly of dust and cold ash.');
});

test('runWhileYouWereAwayPrompt requires a complete response wrapper from LLMClient', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const capturedOptions = [];

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: []
        }),
        llmResponse: `
<response>
  <characterUpdates></characterUpdates>
  <proseForPlayer>The square is quiet.</proseForPlayer>
</response>
`,
        captureChatCompletionOptions: options => capturedOptions.push(options)
    });

    await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        returnEntries: true
    });

    assert.equal(capturedOptions.length, 1);
    assert.equal(capturedOptions[0].metadataLabel, 'while_you_were_away');
    assert.equal(capturedOptions[0].validateXML, false);
    assert.equal(typeof capturedOptions[0].requiredRegex?.test, 'function');
    assert.match(
        '<response><characterUpdates></characterUpdates></response>',
        capturedOptions[0].requiredRegex
    );
    assert.doesNotMatch(
        '<response><characterUpdates></characterUpdates>',
        capturedOptions[0].requiredRegex
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

test('runWhileYouWereAwayPrompt applies absolute need values, moves NPCs, and records a hidden history entry', async () => {
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
        _bars: [{ id: 'energy', name: 'Energy', value: 500, min: 0, max: 1000 }],
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
          <value>75</value>
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
        parentEntryId: 'parent-1',
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(npc._bars[0].value, 750);
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

test('TinyBrain while-you-were-away suppression keeps bookkeeping and event checks without visible prose', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const collector = [];
    const eventCheckTexts = [];
    const eventSummaryCalls = [];
    let slopRemovalCalls = 0;
    const replacementArrivalEntry = {
        id: 'arrival-prose',
        timestamp: '2026-08-07T12:00:00.000Z',
        type: 'player-action'
    };
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        config: { ai: { tinybrain: true }, slop_buster: true },
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square'
        },
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({ whileYouWereAwayNpcs: [] }),
        llmResponse: `
<response>
  <characterUpdates></characterUpdates>
  <proseForPlayer>The repaired fountain runs again.</proseForPlayer>
</response>
`,
        useTinyBrainWhileAway: true,
        applySlopRemoval: async text => {
            slopRemovalCalls += 1;
            return { text, ran: false, slopWords: [], slopRegexes: [], slopNgrams: [] };
        },
        eventsRunEventChecks: async ({ textToCheck }) => {
            eventCheckTexts.push(textToCheck);
            return { structured: [{ type: 'alterLocation' }] };
        },
        appendEventSummariesToChat: options => eventSummaryCalls.push(options)
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        returnEntries: true,
        entryCollector: collector,
        parentEntryId: replacementArrivalEntry.id,
        suppressVisibleProse: true,
        replacementArrivalEntry
    });

    assert.equal(result.hiddenEntry.type, 'while-you-were-away');
    assert.equal(result.visibleEntry, null);
    assert.equal(result.parentLinkEntry, replacementArrivalEntry);
    assert.equal(slopRemovalCalls, 0);
    assert.equal(pushedEntries.some(entry => entry.type === 'while-you-were-away-player'), false);
    assert.equal(eventCheckTexts.length, 1);
    assert.match(eventCheckTexts[0], /The repaired fountain runs again/);
    assert.equal(eventSummaryCalls.length, 1);
    assert.equal(eventSummaryCalls[0].parentId, replacementArrivalEntry.id);
    assert.equal(eventSummaryCalls[0].timestamp, replacementArrivalEntry.timestamp);
});

test('runWhileYouWereAwayPrompt skips unvisited arrival locations before rendering prompt', async () => {
    const newRoom = createLocation({ id: 'new-room', name: 'New Room', regionId: 'alpha' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['new-room'], entranceLocationId: 'new-room' }]
    ]);
    const gameLocations = new Map([[newRoom.id, newRoom]]);
    let prepared = false;
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'new-room'
        },
        gameLocations,
        regions,
        prepareBasePromptContext: async () => {
            prepared = true;
            throw new Error('Prompt context should not be prepared for unvisited arrivals.');
        }
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: newRoom,
        locationId: newRoom.id,
        locationWasVisitedBeforeArrival: false,
        returnEntries: true
    });

    assert.equal(prepared, false);
    assert.equal(pushedEntries.length, 0);
    assert.equal(result.hiddenEntry, null);
    assert.equal(result.visibleEntry, null);
    assert.equal(result.eventResult, null);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'unvisited_location');
});

test('runWhileYouWereAwayPrompt skips when pre-arrival visit snapshot is missing', async () => {
    const newRoom = createLocation({
        id: 'new-room',
        name: 'New Room',
        regionId: 'alpha',
        visited: true,
        lastVisitedTime: 120
    });
    const gameLocations = new Map([[newRoom.id, newRoom]]);
    let prepared = false;
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'new-room'
        },
        gameLocations,
        prepareBasePromptContext: async () => {
            prepared = true;
            throw new Error('Prompt context should not be prepared without a pre-arrival visit snapshot.');
        }
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: newRoom,
        locationId: newRoom.id,
        returnEntries: true
    });

    assert.equal(prepared, false);
    assert.equal(pushedEntries.length, 0);
    assert.equal(result.hiddenEntry, null);
    assert.equal(result.visibleEntry, null);
    assert.equal(result.eventResult, null);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'unvisited_location');
});

test('runWhileYouWereAwayPrompt skips previously visited locations below the revisit threshold', async () => {
    const square = createLocation({
        id: 'square',
        name: 'Town Square',
        regionId: 'alpha',
        visited: true,
        lastVisitedTime: 100
    });
    const gameLocations = new Map([[square.id, square]]);

    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        config: {
            ai: {},
            while_you_were_away_threshold_minutes: 30
        },
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square',
            elapsedTime: 110
        },
        gameLocations,
        prepareBasePromptContext: async () => {
            throw new Error('Prompt context should not be prepared for too-recent location revisits.');
        },
        llmResponse: '<response><characterUpdates></characterUpdates></response>'
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        locationLastVisitedTimeBeforeArrival: square.lastVisitedTime,
        returnEntries: true
    });

    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'recent_location_visit');
    assert.equal(pushedEntries.length, 0);
});

test('runWhileYouWereAwayPrompt compares revisit threshold against total world minutes', async () => {
    const square = createLocation({
        id: 'square',
        name: 'Town Square',
        regionId: 'alpha',
        npcIds: ['mira'],
        visited: true,
        lastVisitedTime: 7097
    });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        _bars: [],
        getNeedBars() {
            return this._bars;
        },
        setNeedBarValue() {
            throw new Error('No need bars should be changed in this test.');
        },
        setLocation(destination) {
            this.currentLocation = typeof destination === 'string' ? destination : destination.id;
        }
    };
    const players = new Map([[npc.id, npc]]);
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        config: {
            ai: {},
            while_you_were_away_threshold_minutes: 30
        },
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square',
            elapsedTime: 480
        },
        players,
        gameLocations,
        regions,
        globalsElapsedTime: 480,
        globalsTotalWorldMinutes: 7680,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [{ id: npc.id, name: npc.name }]
        }),
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira kept watch while the player was away.</update>
    </characterUpdate>
  </characterUpdates>
</response>
`
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        locationLastVisitedTimeBeforeArrival: square.lastVisitedTime,
        returnEntries: true
    });

    assert.equal(result.skipped, undefined);
    assert.equal(pushedEntries.some(entry => entry.type === 'while-you-were-away'), true);
});

test('runWhileYouWereAwayPrompt runs scoped event checks while ignoring handled need bars and arrivals', async () => {
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
        _bars: [{ id: 'energy', name: 'Energy', value: 500, min: 0, max: 1000 }],
        getNeedBars() {
            return this._bars.map(bar => ({ ...bar }));
        },
        setNeedBarValue(identifier, nextValue) {
            const bar = this._bars.find(candidate => candidate.id === identifier);
            if (!bar) {
                throw new Error(`Unknown need bar "${identifier}".`);
            }
            bar.value = nextValue;
        }
    };
    const eventCheckCalls = [];
    const summaryCalls = [];

    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
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
      <update>Mira repaired the old notice board while waiting in the square.</update>
      <needBarChanges>
        <needBarEffect>
          <needBarId>energy</needBarId>
          <value>75%</value>
        </needBarEffect>
      </needBarChanges>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>The notice board has a fresh brace and Mira gestures toward it.</proseForPlayer>
</response>
`,
        eventsRunEventChecks: async (options = {}) => {
            eventCheckCalls.push(options);
            return {
                structured: { parsed: { alter_location: ['Town Square'] }, rawEntries: {} },
                experienceAwards: [],
                currencyChanges: [{ amount: 2 }],
                environmentalDamageEvents: [],
                needBarChanges: [{ shouldNotAppear: true }],
                dispositionChanges: [],
                factionReputationChanges: [],
                timeProgress: null
            };
        },
        appendEventSummariesToChat: (summaryOptions, collector) => {
            summaryCalls.push(summaryOptions);
            if (Array.isArray(collector)) {
                collector.push({
                    id: 'event-summary-1',
                    type: 'event-summary',
                    parentId: summaryOptions.parentId || null,
                    locationId: summaryOptions.locationId || null
                });
            }
        }
    });

    const collector = [];
    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        entryCollector: collector,
        returnEntries: true,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(eventCheckCalls.length, 1);
    assert.match(eventCheckCalls[0].textToCheck, /Mira repaired the old notice board/);
    assert.match(eventCheckCalls[0].textToCheck, /The notice board has a fresh brace/);
    assert.equal(eventCheckCalls[0].suppressNeedBarEventChecks, true);
    assert.equal(eventCheckCalls[0].suppressHousekeeping, true);
    assert.equal(eventCheckCalls[0].suppressMoveEvents, true);
    assert.equal(eventCheckCalls[0].suppressTimeAdvance, true);
    assert.deepEqual(Array.from(eventCheckCalls[0].ignoredEventKeys).sort(), ['needbar_change', 'npc_arrival_departure', 'thing_move_with_character'].sort());
    assert.match(eventCheckCalls[0].eventCheckIgnoreInstructions, /while-you-were-away event pass/);
    assert.equal(result.eventResult.currencyChanges[0].amount, 2);
    assert.equal(summaryCalls.length, 1);
    assert.equal(summaryCalls[0].summaryLabel, '📋 Events – While You Were Away');
    assert.equal(summaryCalls[0].statusLabel, '🌀 Status Changes – While You Were Away');
    assert.equal(summaryCalls[0].parentId, result.visibleEntry.id);
    assert.equal(summaryCalls[0].needBarChanges, null);
    assert.equal(collector[collector.length - 1].type, 'event-summary');
    assert.equal(pushedEntries[pushedEntries.length - 1].type, 'while-you-were-away-player');
});

test('runWhileYouWereAwayPrompt can return both hidden and visible entries for parent linking', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const currentPlayer = { name: 'Baato', currentLocation: square.id };
    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: square.id,
        _bars: [],
        getNeedBars: () => []
    };
    const players = new Map([[npc.id, npc]]);
    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer,
        players,
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [{
                id: 'mira',
                name: 'Mira',
                lastSeenAgeMinutes: 300,
                lastSeenTimeAgo: '5 hours ago'
            }]
        }),
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira waited near the fountain.</update>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Mira is already waiting by the fountain.</proseForPlayer>
</response>
`
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        returnEntries: true,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(result.hiddenEntry.type, 'while-you-were-away');
    assert.equal(result.visibleEntry.type, 'while-you-were-away-player');
    assert.match(result.visibleEntry.content, /Mira is already waiting by the fountain\./);
});

test('runWhileYouWereAwayPrompt runs slop removal on visible prose and records attachment', async () => {
    const square = createLocation({ id: 'square', name: 'Town Square', regionId: 'alpha', npcIds: ['mira'] });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);
    const currentPlayer = { name: 'Baato', currentLocation: square.id };
    const npc = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: square.id,
        _bars: [],
        getNeedBars: () => []
    };
    const slopCalls = [];
    const { runWhileYouWereAwayPrompt, pushedEntries } = loadWhileYouWereAwayHelpers({
        config: { ai: {}, slop_buster: true },
        currentPlayer,
        players: new Map([[npc.id, npc]]),
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [{
                id: 'mira',
                name: 'Mira',
                lastSeenAgeMinutes: 300,
                lastSeenTimeAgo: '5 hours ago'
            }]
        }),
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira waited near the fountain.</update>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Glimmering prose.</proseForPlayer>
</response>
`,
        applySlopRemoval: async (text, options) => {
            slopCalls.push({ text, options });
            return {
                text: 'Plain prose.',
                ran: true,
                slopWords: ['glimmering'],
                slopRegexes: ['purple sentence'],
                slopNgrams: ['waited near fountain']
            };
        }
    });

    const collector = [];
    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        entryCollector: collector,
        returnEntries: true,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(slopCalls.length, 1);
    assert.equal(slopCalls[0].text, 'Glimmering prose.');
    assert.equal(slopCalls[0].options.returnDiagnostics, true);
    assert.equal(result.visibleEntry.content, 'Plain prose.');
    assert.equal(result.visibleEntry.summary, 'Plain prose.');
    assert.equal(collector.length, 3);
    assert.equal(pushedEntries[1].type, 'while-you-were-away-player');
    assert.equal(pushedEntries[1].content, 'Plain prose.');
    assert.equal(pushedEntries[2].type, 'slop-remover');
    assert.equal(pushedEntries[2].parentId, pushedEntries[1].id);
    assert.deepEqual(Array.from(pushedEntries[2].slopRemoval.slopWords), ['glimmering']);
    assert.deepEqual(Array.from(pushedEntries[2].slopRemoval.slopRegexes), ['purple sentence']);
    assert.deepEqual(Array.from(pushedEntries[2].slopRemoval.slopNgrams), ['waited near fountain']);
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
        <value>40%</value>
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
            locationId: square.id,
            locationWasVisitedBeforeArrival: true
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
        config: {
            ai: {},
            while_you_were_away_threshold_minutes: 240
        },
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
        <value>40%</value>
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
            locationId: square.id,
            locationWasVisitedBeforeArrival: true
        });

        assert.equal(npc._setCalls.length, 0);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Ignoring unknown while-you-were-away need bar "voidness" for "Mira"\./);
        assert.equal(storedEntry.type, 'while-you-were-away');
    } finally {
        console.warn = originalWarn;
    }
});

test('runWhileYouWereAwayPrompt includes NPC candidates regardless of individual last-seen age when location threshold passes', async () => {
    const square = createLocation({
        id: 'square',
        name: 'Town Square',
        regionId: 'alpha',
        npcIds: ['mira'],
        visited: true,
        lastVisitedTime: 0
    });
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
        config: {
            ai: {},
            while_you_were_away_threshold_minutes: 240
        },
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square',
            elapsedTime: 240
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
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira only just ducked out of sight.</update>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>The square has gone quiet since you last passed through.</proseForPlayer>
</response>
`
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        locationLastVisitedTimeBeforeArrival: square.lastVisitedTime,
        returnEntries: true
    });

    assert.equal(result.hiddenEntry.type, 'while-you-were-away');
    assert.match(result.hiddenEntry.content, /Update on Mira since Baato last saw them 3 hours and 59 minutes ago:/);
    assert.match(result.hiddenEntry.content, /Mira only just ducked out of sight\./);
    assert.equal(result.visibleEntry.type, 'while-you-were-away-player');
    assert.equal(result.visibleEntry.content, 'The square has gone quiet since you last passed through.');
});

test('runWhileYouWereAwayPrompt synthesizes current-location candidates from pre-arrival location visit time', async () => {
    const square = createLocation({
        id: 'square',
        name: 'Town Square',
        regionId: 'alpha',
        npcIds: ['mira', 'toma', 'shade'],
        visited: true,
        lastVisitedTime: 120
    });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['square'], entranceLocationId: 'square' }]
    ]);
    const gameLocations = new Map([[square.id, square]]);

    const mira = {
        id: 'mira',
        isNPC: true,
        name: 'Mira',
        currentLocation: 'square',
        getNeedBars() {
            return [];
        }
    };
    const toma = {
        id: 'toma',
        isNPC: true,
        name: 'Toma',
        currentLocation: 'square',
        getNeedBars() {
            return [];
        }
    };
    const shade = {
        id: 'shade',
        isNPC: true,
        name: 'Shade',
        currentLocation: 'square',
        getNeedBars() {
            return [];
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer: {
            id: 'player',
            name: 'Baato',
            currentLocation: 'square',
            elapsedTime: 360
        },
        players: new Map([
            [mira.id, mira],
            [toma.id, toma],
            [shade.id, shade]
        ]),
        gameLocations,
        regions,
        globalsElapsedTime: 360,
        globalsTotalWorldMinutes: 360,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: [],
            npcs: [
                {
                    id: 'mira',
                    name: 'Mira',
                    was_in_player_location_previous_round: false
                },
                {
                    id: 'toma',
                    name: 'Toma',
                    was_in_player_location_previous_round: true
                },
                {
                    id: 'shade',
                    name: 'Shade',
                    hiddenFromPlayer: true,
                    was_in_player_location_previous_round: false
                }
            ]
        }),
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Mira</name>
      <update>Mira kept the square orderly while Baato was away.</update>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Mira is waiting by the fountain.</proseForPlayer>
</response>
`
    });

    const result = await runWhileYouWereAwayPrompt({
        locationOverride: square,
        locationId: square.id,
        locationWasVisitedBeforeArrival: true,
        locationLastVisitedTimeBeforeArrival: square.lastVisitedTime,
        returnEntries: true
    });

    assert.equal(result.hiddenEntry.type, 'while-you-were-away');
    assert.match(result.hiddenEntry.content, /Update on Mira since Baato last saw them 4 hours ago:/);
    assert.match(result.hiddenEntry.content, /Mira kept the square orderly while Baato was away\./);
    assert.doesNotMatch(result.hiddenEntry.content, /Toma/);
    assert.doesNotMatch(result.hiddenEntry.content, /Shade/);
});

test('runWhileYouWereAwayPrompt moves listed origin things to the arrival location only when not inventoried', async () => {
    const origin = createLocation({ id: 'farmyard', name: 'Farmyard', regionId: 'alpha' });
    const destination = createLocation({ id: 'market', name: 'Market', regionId: 'alpha' });
    const otherLocation = createLocation({ id: 'warehouse', name: 'Warehouse', regionId: 'alpha' });
    const regions = new Map([
        ['alpha', { id: 'alpha', name: 'Alpha', locationIds: ['farmyard', 'market', 'warehouse'], entranceLocationId: 'farmyard' }]
    ]);
    const gameLocations = new Map([
        [origin.id, origin],
        [destination.id, destination],
        [otherLocation.id, otherLocation]
    ]);
    const cart = createThing({ id: 'thing-cart', name: 'Supply Cart' });
    const crate = createThing({ id: 'thing-crate', name: 'Distant Crate' });
    const compass = createThing({ id: 'thing-compass', name: 'Pocket Compass' });
    const things = new Map([
        [cart.id, cart],
        [crate.id, crate],
        [compass.id, compass]
    ]);
    activeTestThings = things;
    origin.addThingId(cart.id);
    origin.addThingId(compass.id);
    compass.metadata = { ...(compass.metadata || {}), ownerId: 'player' };
    otherLocation.addThingId(crate.id);

    const currentPlayer = {
        id: 'player',
        name: 'Baato',
        currentLocation: destination.id
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer,
        things,
        gameLocations,
        regions,
        prepareBasePromptContext: async () => ({
            whileYouWereAwayNpcs: []
        }),
        llmResponse: `
<response>
  <characterUpdates></characterUpdates>
  <proseForPlayer>The supply cart rattled in behind you, but the rest of the yard stayed where it was.</proseForPlayer>
  <itemSceneryMoves>
    <itemName>Supply Cart</itemName>
    <itemName>Distant Crate</itemName>
    <itemName>Pocket Compass</itemName>
  </itemSceneryMoves>
</response>
`
    });

    try {
        const result = await runWhileYouWereAwayPrompt({
            locationOverride: destination,
            locationId: destination.id,
            originLocationOverride: origin,
            returnEntries: true,
            locationWasVisitedBeforeArrival: true
        });

        assert.equal(destination.thingIds.includes(cart.id), true);
        assert.equal(origin.thingIds.includes(cart.id), false);
        assert.equal(cart.metadata.locationId, destination.id);

        assert.equal(otherLocation.thingIds.includes(crate.id), true);
        assert.equal(destination.thingIds.includes(crate.id), false);
        assert.equal(crate.metadata.locationId, otherLocation.id);

        assert.equal(origin.thingIds.includes(compass.id), true);
        assert.equal(destination.thingIds.includes(compass.id), false);
        assert.equal(compass.metadata.ownerId, 'player');

        assert.equal(result.visibleEntry.type, 'while-you-were-away-player');
    } finally {
        activeTestThings = null;
    }
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
        locationId: square.id,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(storedEntry.type, 'while-you-were-away');
    assert.match(storedEntry.content, /Update on Mira since Baato last saw them 5 hours ago:/);
    assert.match(storedEntry.content, /Update on Toma since Baato last saw them some time ago:/);
    assert.match(storedEntry.content, /Toma went to Town Square in Alpha/);
});

test('runWhileYouWereAwayPrompt moves HERE arrival updates matched by existing NPC name', async () => {
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
        locationId: mainRoom.id,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(storedEntry.type, 'while-you-were-away');
    assert.equal(pushedEntries.length, 2);
    assert.equal(pushedEntries[1].type, 'while-you-were-away-player');
    assert.match(storedEntry.content, /Update on Ember since Exis last saw them 9 hours ago:/);
    assert.match(storedEntry.content, /Update on Vervaine Duskweaver since Exis last saw them 9 hours ago:/);
    assert.match(storedEntry.content, /Update on Rozalin since Exis last saw them some time ago:/);
    assert.equal(rozalin.currentLocation, 'main-room');
    assert.equal(kitchen.npcIds.includes('rozalin'), false);
    assert.equal(mainRoom.npcIds.includes('rozalin'), true);
});

test('runWhileYouWereAwayPrompt matches HERE arrivals by alias', async () => {
    const mainRoom = createLocation({ id: 'main-room', name: 'Main Room', regionId: 'farmhouse' });
    const kitchen = createLocation({ id: 'kitchen', name: 'Kitchen', regionId: 'farmhouse', npcIds: ['suzu'] });
    const regions = new Map([
        ['farmhouse', { id: 'farmhouse', name: 'Farmhouse Interior', locationIds: ['main-room', 'kitchen'], entranceLocationId: 'main-room' }]
    ]);
    const gameLocations = new Map([
        [mainRoom.id, mainRoom],
        [kitchen.id, kitchen]
    ]);
    const suzu = {
        id: 'suzu',
        isNPC: true,
        name: 'Suzu Mizuhan',
        aliases: ['Suzu'],
        currentLocation: 'kitchen',
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
            currentLocation: 'main-room'
        },
        players: new Map([[suzu.id, suzu]]),
        gameLocations,
        regions,
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Suzu</name>
      <update>Suzu arrived early and started breakfast.</update>
      <travelDestination>HERE</travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Suzu is already in the room.</proseForPlayer>
</response>
`
    });

    const storedEntry = await runWhileYouWereAwayPrompt({
        locationOverride: mainRoom,
        locationId: mainRoom.id,
        locationWasVisitedBeforeArrival: true
    });

    assert.match(storedEntry.content, /Update on Suzu Mizuhan since Baato last saw them some time ago:/);
    assert.equal(suzu.currentLocation, 'main-room');
    assert.equal(kitchen.npcIds.includes('suzu'), false);
    assert.equal(mainRoom.npcIds.includes('suzu'), true);
});

test('runWhileYouWereAwayPrompt keeps current party HERE arrivals in the party only', async () => {
    const mainRoom = createLocation({ id: 'main-room', name: 'Main Room', regionId: 'farmhouse' });
    const regions = new Map([
        ['farmhouse', { id: 'farmhouse', name: 'Farmhouse Interior', locationIds: ['main-room'], entranceLocationId: 'main-room' }]
    ]);
    const gameLocations = new Map([[mainRoom.id, mainRoom]]);
    const partyMemberIds = ['suzu'];
    const suzu = {
        id: 'suzu',
        isNPC: true,
        name: 'Suzu Mizuhan',
        aliases: ['Suzu'],
        currentLocation: null,
        isInPlayerParty: true,
        getNeedBars() {
            return [];
        },
        setLocation() {
            throw new Error('Current party member should not be relocated as a location NPC.');
        }
    };

    const currentPlayer = {
        id: 'player',
        name: 'Baato',
        currentLocation: 'main-room',
        getPartyMembers() {
            return partyMemberIds.slice();
        }
    };

    const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
        currentPlayer,
        players: new Map([[suzu.id, suzu]]),
        gameLocations,
        regions,
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Suzu</name>
      <update>Suzu arrived with Baato and is still beside him.</update>
      <travelDestination>HERE</travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>Suzu steps in beside Baato.</proseForPlayer>
</response>
`
    });

    const storedEntry = await runWhileYouWereAwayPrompt({
        locationOverride: mainRoom,
        locationId: mainRoom.id,
        locationWasVisitedBeforeArrival: true
    });

    assert.match(storedEntry.content, /Update on Suzu Mizuhan since Baato last saw them some time ago:/);
    assert.equal(suzu.currentLocation, null);
    assert.deepEqual(currentPlayer.getPartyMembers(), ['suzu']);
    assert.equal(mainRoom.npcIds.includes('suzu'), false);
});

test('runWhileYouWereAwayPrompt prefers a single former party member among duplicate HERE arrival matches', async () => {
    const mainRoom = createLocation({ id: 'main-room', name: 'Main Room', regionId: 'farmhouse' });
    const barn = createLocation({ id: 'barn', name: 'Barn', regionId: 'farmhouse', npcIds: ['farmhand-a'] });
    const porch = createLocation({ id: 'porch', name: 'Porch', regionId: 'farmhouse', npcIds: ['farmhand-b'] });
    const regions = new Map([
        ['farmhouse', { id: 'farmhouse', name: 'Farmhouse Interior', locationIds: ['main-room', 'barn', 'porch'], entranceLocationId: 'main-room' }]
    ]);
    const gameLocations = new Map([
        [mainRoom.id, mainRoom],
        [barn.id, barn],
        [porch.id, porch]
    ]);
    const firstFarmhand = {
        id: 'farmhand-a',
        isNPC: true,
        name: 'Farmhand',
        currentLocation: 'barn',
        wasEverInPlayerParty: false,
        getNeedBars() {
            return [];
        },
        setLocation(nextLocationId) {
            this.currentLocation = nextLocationId;
        }
    };
    const formerPartyFarmhand = {
        id: 'farmhand-b',
        isNPC: true,
        name: 'Farmhand',
        currentLocation: 'porch',
        wasEverInPlayerParty: true,
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
            currentLocation: 'main-room'
        },
        players: new Map([
            [firstFarmhand.id, firstFarmhand],
            [formerPartyFarmhand.id, formerPartyFarmhand]
        ]),
        gameLocations,
        regions,
        llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Farmhand</name>
      <update>The farmhand came inside after finishing chores.</update>
      <travelDestination>HERE</travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>A farmhand is already here.</proseForPlayer>
</response>
`
    });

    await runWhileYouWereAwayPrompt({
        locationOverride: mainRoom,
        locationId: mainRoom.id,
        locationWasVisitedBeforeArrival: true
    });

    assert.equal(firstFarmhand.currentLocation, 'barn');
    assert.equal(formerPartyFarmhand.currentLocation, 'main-room');
    assert.equal(barn.npcIds.includes('farmhand-a'), true);
    assert.equal(porch.npcIds.includes('farmhand-b'), false);
    assert.equal(mainRoom.npcIds.includes('farmhand-b'), true);
});

test('runWhileYouWereAwayPrompt warns and skips unmatched HERE arrivals without creating NPCs', async () => {
    const mainRoom = createLocation({ id: 'main-room', name: 'Main Room', regionId: 'farmhouse' });
    const regions = new Map([
        ['farmhouse', { id: 'farmhouse', name: 'Farmhouse Interior', locationIds: ['main-room'], entranceLocationId: 'main-room' }]
    ]);
    const gameLocations = new Map([[mainRoom.id, mainRoom]]);
    const players = new Map();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));

    try {
        const { runWhileYouWereAwayPrompt } = loadWhileYouWereAwayHelpers({
            currentPlayer: {
                id: 'player',
                name: 'Baato',
                currentLocation: 'main-room'
            },
            players,
            gameLocations,
            regions,
            llmResponse: `
<response>
  <characterUpdates>
    <characterUpdate>
      <name>Unmatched NPC</name>
      <update>No existing NPC has this name.</update>
      <travelDestination>HERE</travelDestination>
    </characterUpdate>
  </characterUpdates>
  <proseForPlayer>The room is quiet.</proseForPlayer>
</response>
`
        });

        const result = await runWhileYouWereAwayPrompt({
            locationOverride: mainRoom,
            locationId: mainRoom.id,
            returnEntries: true,
            locationWasVisitedBeforeArrival: true
        });

        assert.equal(players.size, 0);
        assert.deepEqual(mainRoom.npcIds, []);
        assert.equal(result.hiddenEntry.content, 'No while-you-were-away character updates were returned.');
        assert.equal(warnings.length, 1);
        assert.match(
            warnings[0],
            /Ignoring while-you-were-away arrival update "Unmatched NPC" because no existing NPC matched that name or alias\./
        );
    } finally {
        console.warn = originalWarn;
    }
});
