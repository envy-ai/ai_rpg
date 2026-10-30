const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const sceneIllustration = require('../mods/scene-illustration/mod.js');

test('scene illustration prompt history filters diagnostics before selecting the recent window', async () => {
    const routeHandlers = new Map();
    const location = {
        id: 'loc-1',
        name: 'Old Harbor',
        description: 'Rain blows over the quay.',
        scenery: [],
        getDetails() { return this; }
    };
    const chatHistory = [
        ...Array.from({ length: 6 }, (_unused, index) => ({
            id: `story-${index}`,
            role: index % 2 ? 'user' : 'assistant',
            content: `SCENE_STORY_${index}`,
            timestamp: `2026-10-27T12:00:0${index}.000Z`
        })),
        { id: 'typed-debug', role: 'assistant', type: 'tool-call-debug', content: 'SCENE_DEBUG_TYPE', timestamp: '2026-10-27T12:00:10.000Z' },
        { id: 'metadata-debug', role: 'assistant', type: 'player-action', content: 'SCENE_DEBUG_META', metadata: { debugToolCalls: true }, timestamp: '2026-10-27T12:00:11.000Z' },
        { id: 'structured-check', role: 'assistant', content: 'SCENE_CHECK_ARRAY', checkResults: [{ result: 'failed' }], timestamp: '2026-10-27T12:00:12.000Z' },
        { id: 'legacy-debug', role: 'assistant', content: 'Tool call debug: 1 call\nSCENE_DEBUG_LEGACY', timestamp: '2026-10-27T12:00:13.000Z' }
    ];
    const originalHistory = structuredClone(chatHistory);
    const scope = {
        app: {},
        modName: 'scene-illustration',
        modDir: path.join(require('node:os').tmpdir(), `scene-illustration-test-${process.pid}`),
        registerModRoute(method, route, handler) { routeHandlers.set(`${method} ${route}`, handler); },
        renderModPrompt() {},
        config: { imagegen: { enabled: false } },
        chatHistory,
        currentPlayer: { id: 'player-1', name: 'Mara', currentLocation: location.id, partyMembers: new Set() },
        gameLocations: new Map([[location.id, location]]),
        regions: new Map(),
        players: new Map(),
        Location: { get: id => id === location.id ? location : null },
        findRegionByLocationId: () => null,
        nunjucks,
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'prompt' }),
        generateImageId: () => 'unused',
        createImageJob() { throw new Error('Image job creation should not run for prompt-context inspection.'); },
        processJobQueue() {},
        jobQueue: [],
        imageJobs: new Map(),
        addJobSubscriber() {},
        getJobSnapshot() {}
    };

    sceneIllustration.register(scope);
    const context = await scope.sceneIllustration.buildSceneContext();

    assert.deepEqual(context.recentMessages.map(message => message.content), [
        'SCENE_STORY_1', 'SCENE_STORY_2', 'SCENE_STORY_3', 'SCENE_STORY_4', 'SCENE_STORY_5'
    ]);
    assert.deepEqual(chatHistory, originalHistory, 'building prompt context does not alter raw chat history');
    assert.ok(routeHandlers.has('post /generate'), 'test exercises the registered production mod path');
});
