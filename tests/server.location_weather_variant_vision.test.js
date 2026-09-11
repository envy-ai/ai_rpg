const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');

function loadVisionVariantHarness({ buildVisionPrompt } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateLocationWeatherVariant(location, options = {}) {');
    const end = source.indexOf('\n// Function to generate location exit passage image', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate generateLocationWeatherVariant in server.js');
    }

    let generatedJob = 0;
    const deletedImages = [];
    const queuedJobs = [];
    const variants = new Map();
    const context = {
        console,
        Math,
        config: {
            imagegen: {
                enabled: true,
                engine: 'comfyui',
                workflow: { edit: { custom_template: 'vision-edit.json' } },
                location_settings: { image: {} },
                default_settings: { image: {} }
            }
        },
        comfyUIClient: {},
        fs: { existsSync: () => true },
        path: { join: (...parts) => parts.join('/') },
        __dirname: '/project',
        JOB_STATUS: { QUEUED: 'queued', PROCESSING: 'processing' },
        runtimeGenerationId: 1,
        imageJobs: new Map(),
        locationWeatherVariantGenerationPromises: new Map(),
        generatedImages: new Map([['base-image', { id: 'base-image', width: 900, height: 600 }]]),
        shouldUseSeasonalImageVision: () => true,
        resolveLocationWeatherVariantSourceImage: () => ({
            sourceImageId: 'base-image',
            sourceImageMetadata: { id: 'base-image', width: 900, height: 600 },
            isWeatherVariantSource: false
        }),
        hasExistingImage: imageId => imageId === 'base-image' || Boolean(context.generatedImages.get(imageId)),
        resolveImageJobWorkflowTemplate: () => 'vision-edit.json',
        resolveLocationWeatherVariantConditions: () => ({
            variantKey: 'base-image__spring__night__yes__rain__vision-v1',
            sourceImageId: 'base-image',
            weatherScope: 'yes',
            weatherName: 'Rain'
        }),
        resolveImageFilePath: () => '/project/base-image.png',
        buildLocationWeatherVariantVisionPrompt: buildVisionPrompt || (async () => 'N/A'),
        buildLocationWeatherVariantPrompt: () => {
            throw new Error('Vision failures must not fall back to the deterministic prompt.');
        },
        generateImageId: () => `job-${++generatedJob}`,
        buildNegativePrompt: value => value,
        resolveMegapixels: value => value || null,
        createImageJob: (id, payload) => {
            const job = { id, status: 'queued', payload };
            context.imageJobs.set(id, job);
            return job;
        },
        enqueueImageJob: id => queuedJobs.push(id),
        setEntityJob: () => {},
        getJobSnapshot: id => context.imageJobs.get(id) || null,
        addJobSubscriber: () => {},
        deletedImages
    };
    const location = {
        id: 'location-1',
        imageId: 'base-image',
        getImageVariant: key => variants.get(key) || null,
        setImageVariant: (key, value) => variants.set(key, { ...value }),
        removeImageVariant: key => {
            const value = variants.get(key) || null;
            variants.delete(key);
            return value;
        }
    };
    const originalDelete = context.generatedImages.delete.bind(context.generatedImages);
    context.generatedImages.delete = imageId => {
        deletedImages.push(imageId);
        return originalDelete(imageId);
    };

    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.generateLocationWeatherVariant = generateLocationWeatherVariant;`, context);
    return {
        context,
        location,
        variants,
        queuedJobs,
        deletedImages,
        generate: context.generateLocationWeatherVariant
    };
}

test('vision N/A aliases the base image, dedupes concurrent preflight, and force keeps base metadata', async () => {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const harness = loadVisionVariantHarness({
        buildVisionPrompt: async () => {
            calls += 1;
            await gate;
            return 'N/A';
        }
    });

    const first = harness.generate(harness.location, { clientId: 'first' });
    const second = harness.generate(harness.location, { clientId: 'second' });
    assert.equal(calls, 1);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.reason, 'no-changes-needed');
    assert.equal(secondResult.imageId, 'base-image');
    assert.equal(harness.queuedJobs.length, 0);
    assert.equal(harness.variants.size, 1);
    assert.equal(Array.from(harness.variants.values())[0].imageId, 'base-image');
    assert.equal(harness.context.locationWeatherVariantGenerationPromises.size, 0);

    const forced = await harness.generate(harness.location, { force: true });
    assert.equal(forced.reason, 'no-changes-needed');
    assert.deepEqual(harness.deletedImages, []);
    assert.equal(harness.context.generatedImages.has('base-image'), true);
});

test('a malformed vision result fails before cache mutation or image-job queueing', async () => {
    const harness = loadVisionVariantHarness({
        buildVisionPrompt: async () => {
            throw new Error('Seasonal image vision response must contain exactly one <imageEditingInstructions> root.');
        }
    });

    await assert.rejects(
        () => harness.generate(harness.location),
        /exactly one <imageEditingInstructions> root/
    );
    assert.equal(harness.variants.size, 0);
    assert.equal(harness.queuedJobs.length, 0);
    assert.equal(harness.context.locationWeatherVariantGenerationPromises.size, 0);
});

test('vision preflight does not attach an alias or job after the base image changes', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const harness = loadVisionVariantHarness({
        buildVisionPrompt: async () => {
            await gate;
            return 'N/A';
        }
    });

    const resultPromise = harness.generate(harness.location);
    harness.location.imageId = 'replacement-base-image';
    release();

    const result = await resultPromise;
    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'stale-source-image');
    assert.equal(harness.variants.size, 0);
    assert.equal(harness.queuedJobs.length, 0);
});

test('vision prompt uses the base-context include, attaches base image bytes, and parses XML entities', async () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function imageFileToDataUrl(filePath) {');
    const end = source.indexOf('\nfunction resolveLocationWeatherVariantSourceImage(location) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate seasonal vision prompt helpers in server.js');
    }

    const calls = [];
    const logs = [];
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')),
        { autoescape: false, throwOnUndefined: false }
    );
    promptEnv.addGlobal('randomword', () => 'test');
    promptEnv.addGlobal('rarityDefinitions', []);
    const baseContext = {
        config: {},
        setting: {
            name: 'Test Setting', description: '', theme: '', genre: 'Fantasy', tone: 'Quiet',
            startingLocationType: '', magicLevel: '', techLevel: '', difficulty: '',
            currencyName: 'coin', currencyNamePlural: 'coins', currencyValueNotes: '',
            writingStyleNotes: '', baseContextPreamble: '', races: [], attributes: [], skills: []
        },
        currentRegion: { name: 'Test Region', description: '', secrets: [], locations: [], connectedRegions: [] },
        currentPlayer: { name: 'Tester', description: '', class: '', race: '', currency: 0, statusEffects: [], skills: [], abilities: [], inventory: [], needs: [], currentQuests: [] },
        contextRegion: null, worldOutline: { regions: [] }, factions: [], party: [], partyMemberIds: [], npcs: [],
        itemsInScene: [], additionalLore: '', itemContext: '', abilityContext: '', plotSummary: '', plotExpander: '',
        plotAnalysis: null, activeMysteryThreads: [], recentGameHistory: '', currentVehicle: null,
        npcActivityTargetCount: 0, npcActivityCandidates: [], npcActivityExcludedNames: [],
        worldTime: { dayIndex: 0, timeMinutes: 0, dateLabel: 'Day 1', timeLabel: '12:00 PM', segment: 'day', season: 'Spring', lighting: 'Daylight', hasLocalWeather: true },
        bannedTropes: []
    };
    const context = {
        path,
        fs: { readFileSync: () => Buffer.from('base-image-bytes') },
        Utils,
        promptEnv,
        buildBasePromptContext: () => baseContext,
        runTrackedImagePromptGeneration: callback => callback(),
        parseXMLTemplate: rendered => ({
            systemPrompt: (rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/) || [])[1] || '',
            generationPrompt: (rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/) || [])[1] || ''
        }),
        LLMClient: {
            chatCompletion: async request => {
                calls.push(request);
                return 'Interior reasoning is considered first.\n<imageEditingInstructions>Preserve windows &amp; add rain-darkened light.</imageEditingInstructions>';
            },
            logPrompt: entry => logs.push(entry)
        }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.buildPrompt = buildLocationWeatherVariantVisionPrompt;`, context);

    const result = await context.buildPrompt(
        { id: 'location-1', name: 'Archive', description: 'A stone archive with tall windows.' },
        { season: 'Winter', seasonDescription: 'Cold rain and bare branches.', weatherName: 'Heavy Rain', weatherDescription: 'Steady rain.', timeLabel: '11:30 PM', lightingLabel: 'Moonlit night' },
        '/tmp/base-image.png'
    );

    assert.equal(result, 'Preserve windows & add rain-darkened light.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].metadataLabel, 'generate_seasonal_image_vision');
    assert.equal(calls[0].multimodal, true);
    assert.equal(calls[0].preferDedicatedMultimodalConfiguration, true);
    const userContent = calls[0].messages.at(-1).content;
    assert.equal(userContent[1].image_url.url, 'data:image/png;base64,YmFzZS1pbWFnZS1ieXRlcw==');
    assert.match(userContent[0].text, /Season: Winter/);
    assert.match(userContent[0].text, /Weather: Heavy Rain/);
    assert.match(userContent[0].text, /Time of Day: 11:30 PM/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].metadataLabel, 'generate_seasonal_image_vision');
});
