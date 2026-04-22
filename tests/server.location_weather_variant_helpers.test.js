const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

function loadVariantHelpers({ hasWeather = true } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function slugifyLocationVariantKeyPart(value, fallback = ');
    const end = source.indexOf('\nfunction parseImageDataUrl(dataUrl) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate location weather variant helpers in server.js');
    }

    const functionSource = source.slice(start, end);
    const clearedJobs = [];
    const warnings = [];
    const deterministicTemplateEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'templates'), { noCache: true }),
        {
            autoescape: false,
            throwOnUndefined: false,
            trimBlocks: true,
            lstripBlocks: true
        }
    );
    const context = {
        JSON,
        Date,
        console: {
            ...console,
            warn: (...args) => warnings.push(args.join(' '))
        },
        deterministicTemplateEnv,
        generatedImages: new Map(),
        gameLocations: new Map(),
        clearEntityJob: (...args) => {
            clearedJobs.push(args);
        },
        clearedJobs,
        warnings,
        Globals: {
            getWorldTimeContext: () => ({
                segment: 'night',
                lighting: 'Moonlit night',
                lightLevelDescription: 'Moonlit night',
                timeLabel: '11:30 PM',
                dateLabel: '1 Spring',
                season: 'Spring',
                dayIndex: 0,
                timeMinutes: 1410
            })
        },
        resolveLocationHasWeather: () => hasWeather,
        findRegionByLocationId: () => ({ id: 'region-1' }),
        resolveRegionWeatherForPrompt: () => ({
            name: 'Heavy Rain',
            description: 'Rain falls hard enough to bead on stone and blur distant shapes.'
        })
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.slugifyLocationVariantKeyPart = slugifyLocationVariantKeyPart;
this.buildLocationWeatherVariantKey = buildLocationWeatherVariantKey;
this.resolveLocationWeatherVariantConditions = resolveLocationWeatherVariantConditions;
this.buildLocationWeatherVariantPrompt = buildLocationWeatherVariantPrompt;
this.resolveLocationWeatherVariantSourceImage = resolveLocationWeatherVariantSourceImage;
this.logEditedImageSizeWarning = logEditedImageSizeWarning;
this.attachCompletedLocationWeatherVariantJob = attachCompletedLocationWeatherVariantJob;`,
        context
    );

    return context;
}

test('location weather variant keys normalize lighting and weather labels', () => {
    const helpers = loadVariantHelpers();
    assert.equal(
        helpers.buildLocationWeatherVariantKey({
            sourceImageId: 'img_abc_123',
            lightingKey: 'Moonlit Night',
            weatherKey: 'Heavy Rain!'
        }),
        'img-abc-123__moonlit-night__heavy-rain'
    );
});

test('sheltered location conditions omit weather labels and use sheltered key', () => {
    const helpers = loadVariantHelpers({ hasWeather: false });
    const conditions = helpers.resolveLocationWeatherVariantConditions({
        id: 'location-1',
        imageId: 'base-image'
    });

    assert.equal(conditions.hasLocalWeather, false);
    assert.equal(conditions.weatherName, null);
    assert.equal(conditions.weatherKey, 'sheltered');
    assert.equal(conditions.variantKey, 'base-image__moonlit-night__sheltered');
});

test('location weather variant prompt renders current lighting and weather conditions', () => {
    const helpers = loadVariantHelpers();
    const conditions = helpers.resolveLocationWeatherVariantConditions({
        id: 'location-1',
        imageId: 'base-image'
    });
    const prompt = helpers.buildLocationWeatherVariantPrompt(
        {
            name: 'Old Bridge',
            shortDescription: 'A stone bridge.',
            description: '<p>An arched bridge over a canal.</p>'
        },
        conditions,
        {
            sourceImageMetadata: {
                prompt: 'wide concept art of an old stone bridge'
            }
        }
    );

    assert.match(prompt, /Lighting: Moonlit night/);
    assert.match(prompt, /Weather: Heavy Rain/);
    assert.doesNotMatch(prompt, /<p>/);
});

test('outside-visible weather variant prompt labels weather as outside', () => {
    const helpers = loadVariantHelpers({ hasWeather: 'outside' });
    const conditions = helpers.resolveLocationWeatherVariantConditions({
        id: 'location-1',
        imageId: 'base-image'
    });
    const prompt = helpers.buildLocationWeatherVariantPrompt(
        {
            name: 'Windowed Gallery',
            shortDescription: 'A windowed interior.',
            description: 'A gallery where storms are visible through broad windows.'
        },
        conditions,
        {
            sourceImageMetadata: {
                prompt: 'wide concept art of a windowed gallery'
            }
        }
    );

    assert.equal(conditions.weatherScope, 'outside');
    assert.match(prompt, /Weather outside: Heavy Rain/);
    assert.doesNotMatch(prompt, /Weather: Heavy Rain/);
});

test('location weather variant source resolution identifies weather variants as invalid sources', () => {
    const helpers = loadVariantHelpers();
    helpers.generatedImages.set('weathered-image', {
        id: 'weathered-image',
        source: 'location_weather_variant',
        sourceImageId: 'base-image'
    });

    const source = helpers.resolveLocationWeatherVariantSourceImage({
        id: 'location-1',
        imageId: 'weathered-image'
    });

    assert.equal(source.sourceImageId, 'weathered-image');
    assert.equal(source.isWeatherVariantSource, true);
    assert.equal(source.originalSourceImageId, 'base-image');
});

test('location weather variant size mismatch warning includes source and edited dimensions', () => {
    const helpers = loadVariantHelpers();

    helpers.logEditedImageSizeWarning({
        job: {
            payload: {
                isLocationWeatherVariant: true,
                locationId: 'location-1',
                sourceImageId: 'base-image',
                variantKey: 'base-image__moonlit-night__heavy-rain'
            }
        },
        sourceDimensions: { width: 1920, height: 1080 },
        editedDimensions: { width: 1600, height: 1600 },
        editedImageId: 'variant-image'
    });

    assert.equal(helpers.warnings.length, 1);
    assert.match(helpers.warnings[0], /location-1/);
    assert.match(helpers.warnings[0], /base-image__moonlit-night__heavy-rain/);
    assert.match(helpers.warnings[0], /source base-image is 1920x1080/);
    assert.match(helpers.warnings[0], /edited variant-image is 1600x1600/);
});

test('completed location weather variant jobs attach only when the source image still matches', () => {
    const helpers = loadVariantHelpers();
    const variants = new Map();
    const location = {
        id: 'location-1',
        imageId: 'base-image',
        getImageVariant: key => variants.get(key) || null,
        setImageVariant: (key, entry) => variants.set(key, JSON.parse(JSON.stringify(entry)))
    };
    helpers.gameLocations.set(location.id, location);
    helpers.generatedImages.set('variant-image', { id: 'variant-image' });

    const attached = helpers.attachCompletedLocationWeatherVariantJob(
        {
            id: 'job-1',
            payload: {
                isLocationWeatherVariant: true,
                locationId: location.id,
                sourceImageId: 'base-image',
                variantKey: 'base-image__moonlit-night__heavy-rain',
                conditions: { lightingLabel: 'Moonlit night', weatherName: 'Heavy Rain' },
                prompt: 'Edit for heavy rain.'
            }
        },
        { imageId: 'variant-image' }
    );

    assert.equal(attached, true);
    assert.equal(location.imageId, 'base-image');
    assert.equal(variants.get('base-image__moonlit-night__heavy-rain').imageId, 'variant-image');
    assert.equal(variants.get('base-image__moonlit-night__heavy-rain').jobId, null);
    assert.equal(helpers.generatedImages.has('variant-image'), true);
});

test('stale location weather variant jobs discard generated metadata without attaching', () => {
    const helpers = loadVariantHelpers();
    const variants = new Map();
    const location = {
        id: 'location-1',
        imageId: 'new-base-image',
        getImageVariant: key => variants.get(key) || null,
        setImageVariant: (key, entry) => variants.set(key, JSON.parse(JSON.stringify(entry)))
    };
    helpers.gameLocations.set(location.id, location);
    helpers.generatedImages.set('stale-variant-image', { id: 'stale-variant-image' });

    const attached = helpers.attachCompletedLocationWeatherVariantJob(
        {
            id: 'job-2',
            payload: {
                isLocationWeatherVariant: true,
                locationId: location.id,
                sourceImageId: 'old-base-image',
                variantKey: 'old-base-image__moonlit-night__heavy-rain'
            }
        },
        { imageId: 'stale-variant-image' }
    );

    assert.equal(attached, false);
    assert.equal(variants.size, 0);
    assert.equal(helpers.generatedImages.has('stale-variant-image'), false);
});
