const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}`);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in views/index.njk`);
    }

    const signatureEnd = source.indexOf(') {', start);
    const openBrace = signatureEnd >= 0
        ? source.indexOf('{', signatureEnd)
        : source.indexOf('{', start);
    if (openBrace < 0) {
        throw new Error(`Unable to locate body for ${functionName} in views/index.njk`);
    }

    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${functionName} from views/index.njk`);
}

function loadLocationVariantDisplayHelpers() {
    const source = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
    const helperNames = [
        'buildLocationVariantDisplayCacheKey',
        'rememberLocationVariantDisplay',
        'getCachedLocationVariantDisplay',
        'forgetLocationVariantDisplay',
        'shouldPreserveDisplayImageOverride'
    ];
    const functionSource = helperNames.map(name => extractFunction(source, name)).join('\n\n');
    const context = {
        Map,
        String,
        Boolean
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.buildLocationVariantDisplayCacheKey = buildLocationVariantDisplayCacheKey;
this.rememberLocationVariantDisplay = rememberLocationVariantDisplay;
this.getCachedLocationVariantDisplay = getCachedLocationVariantDisplay;
this.forgetLocationVariantDisplay = forgetLocationVariantDisplay;
this.shouldPreserveDisplayImageOverride = shouldPreserveDisplayImageOverride;`,
        context
    );

    return {
        buildLocationVariantDisplayCacheKey: context.buildLocationVariantDisplayCacheKey,
        rememberLocationVariantDisplay: context.rememberLocationVariantDisplay,
        getCachedLocationVariantDisplay: context.getCachedLocationVariantDisplay,
        forgetLocationVariantDisplay: context.forgetLocationVariantDisplay,
        shouldPreserveDisplayImageOverride: context.shouldPreserveDisplayImageOverride
    };
}

test('location variant display cache is scoped to location and source image', () => {
    const {
        buildLocationVariantDisplayCacheKey,
        rememberLocationVariantDisplay,
        getCachedLocationVariantDisplay,
        forgetLocationVariantDisplay
    } = loadLocationVariantDisplayHelpers();
    const cache = new Map();

    assert.equal(buildLocationVariantDisplayCacheKey(' loc-1 ', ' base-1 '), 'loc-1::base-1');
    assert.equal(buildLocationVariantDisplayCacheKey('loc-1', ''), null);

    const stored = rememberLocationVariantDisplay(cache, {
        locationId: ' loc-1 ',
        sourceImageId: ' base-1 ',
        imageId: ' variant-rain ',
        imageUrl: '/api/images/variant-rain/file',
        altText: 'Rainy grove'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(stored)), {
        locationId: 'loc-1',
        sourceImageId: 'base-1',
        imageId: 'variant-rain',
        imageUrl: '/api/images/variant-rain/file',
        altText: 'Rainy grove'
    });
    assert.equal(getCachedLocationVariantDisplay(cache, 'loc-1', 'base-1').imageId, 'variant-rain');
    assert.equal(getCachedLocationVariantDisplay(cache, 'loc-1', 'base-2'), null);
    assert.equal(getCachedLocationVariantDisplay(cache, 'loc-2', 'base-1'), null);

    assert.equal(forgetLocationVariantDisplay(cache, 'loc-1', 'base-2'), false);
    assert.equal(cache.size, 1);
    assert.equal(forgetLocationVariantDisplay(cache, 'loc-1', 'base-1'), true);
    assert.equal(getCachedLocationVariantDisplay(cache, 'loc-1', 'base-1'), null);
});

test('render helper preserves a cached variant display when base image lookup is skipped', () => {
    const { shouldPreserveDisplayImageOverride } = loadLocationVariantDisplayHelpers();

    assert.equal(shouldPreserveDisplayImageOverride({
        displayImageUrl: '/api/images/variant-rain/file',
        requestedImageId: 'base-1',
        force: false,
        result: {
            skipped: true,
            imageId: 'base-1'
        }
    }), true);

    assert.equal(shouldPreserveDisplayImageOverride({
        displayImageUrl: '/api/images/variant-rain/file',
        requestedImageId: 'base-1',
        force: false,
        result: {
            skipped: true,
            imageId: 'base-2'
        }
    }), false);

    assert.equal(shouldPreserveDisplayImageOverride({
        displayImageUrl: '/api/images/variant-rain/file',
        requestedImageId: 'base-1',
        force: true,
        result: {
            skipped: true,
            imageId: 'base-1'
        }
    }), false);
});

test('current location renderer wires cached variants into the initial image and background', () => {
    const source = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');

    assert.match(source, /const cachedLocationVariant = baseLocationImageId[\s\S]+getCachedLocationVariantDisplay\(locationVariantDisplayCache, location\.id, baseLocationImageId\)/);
    assert.match(source, /displayImageId: cachedLocationVariant\?\.imageId \|\| null/);
    assert.match(source, /displayImageUrl: cachedLocationVariant\?\.imageUrl \|\| null/);
    assert.match(source, /const imageUrl = currentCachedLocationVariant\?\.imageUrl[\s\S]+updateAdventureBackground\(imageUrl\)/);
});
