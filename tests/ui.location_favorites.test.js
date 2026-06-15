const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('Play tab exposes a Favorites subtab after world map with the solid star icon', () => {
    const viewSource = read('views/index.njk');
    const worldMapIndex = viewSource.indexOf('id="tab-world-map-tab"');
    const favoritesIndex = viewSource.indexOf('id="tab-favorites-tab"');
    const characterIndex = viewSource.indexOf('id="tab-character-tab"');

    assert.notEqual(worldMapIndex, -1, 'world map tab should exist');
    assert.notEqual(favoritesIndex, -1, 'favorites tab should exist');
    assert.notEqual(characterIndex, -1, 'character tab should exist');
    assert.ok(worldMapIndex < favoritesIndex, 'favorites tab should be after world map');
    assert.ok(favoritesIndex < characterIndex, 'favorites tab should be before character');
    assert.match(viewSource, /id="tab-favorites-tab"[\s\S]*?data-tab="favorites"[\s\S]*?star_solid\.svg/);
    assert.match(viewSource, /<section class="tab-panel" id="tab-favorites"/);
    assert.match(viewSource, /id="favoritesList"/);
});

test('current location image has a favorite toggle that swaps outline and solid stars', () => {
    const viewSource = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(viewSource, /id="locationFavoriteToggle"/);
    assert.match(viewSource, /id="locationFavoriteToggleIcon"/);
    assert.match(viewSource, /\/assets\/material-icons\/misc\/star\.svg/);
    assert.match(viewSource, /\/assets\/material-icons\/misc\/star_solid\.svg/);
    assert.match(viewSource, /function syncLocationFavoriteToggle/);
    assert.match(viewSource, /async function setCurrentLocationFavorite/);
    assert.match(scssSource, /\.location-favorite-toggle/);
    assert.match(scssSource, /#facc15|gold|yellow/i);
});

test('current location favorite toggle uses transparent chrome and hugs the image corner', () => {
    const scssSource = read('public/css/main.scss');
    const blockMatch = scssSource.match(/\.location-favorite-toggle\s*\{(?<body>[\s\S]*?)\n\}/);

    assert.ok(blockMatch?.groups?.body, 'favorite toggle style block should exist');
    const body = blockMatch.groups.body;

    assert.match(body, /top:\s*4px;/);
    assert.match(body, /left:\s*4px;/);
    assert.match(body, /border:\s*none;/);
    assert.match(body, /background:\s*transparent;/);
    assert.doesNotMatch(body, /box-shadow:/);
});

test('Favorites tab list sits in the same dark rounded box style as faction panels', () => {
    const scssSource = read('public/css/main.scss');
    const blockMatch = scssSource.match(/\.favorites-panel\s*\{(?<body>[\s\S]*?)\n\}/);

    assert.ok(blockMatch?.groups?.body, 'favorites panel style block should exist');
    const body = blockMatch.groups.body;

    assert.match(body, /padding:\s*18px 22px 24px;/);
    assert.match(body, /border-radius:\s*18px;/);
    assert.match(body, /background:\s*rgba\(15,\s*18,\s*34,\s*0\.88\);/);
    assert.match(body, /border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.08\);/);
    assert.match(body, /box-shadow:\s*0 20px 50px rgba\(6,\s*9,\s*20,\s*0\.35\);/);
});

test('Favorites use a dedicated API route and reuse map travel behavior', () => {
    const apiSource = read('api.js');
    const viewSource = read('views/index.njk');

    assert.match(apiSource, /app\.put\('\/api\/locations\/:id\/favorite'/);
    assert.match(apiSource, /location\.favorite\s*=\s*resolvedFavorite/);
    assert.match(apiSource, /buildLocationResponse\(location\)/);
    assert.match(viewSource, /\/api\/locations\/\$\{encodeURIComponent\(locationId\)\}\/favorite/);
    assert.match(viewSource, /function renderFavoriteLocations/);
    assert.match(viewSource, /function travelToFavoriteLocation/);
    assert.ok(
        viewSource.includes('window.travelToAdjacentLocationFromMap(locationId);'),
        'favorites should invoke the shared map travel helper with its default confirmed navigation behavior'
    );
});

test('Favorite location cards include computed shortest-route travel times', () => {
    const apiSource = read('api.js');
    const viewSource = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(apiSource, /computedTravelTimeMinutes/);
    assert.match(apiSource, /Location\.findShortestTravelTimeMinutes\(currentLocationForFavorites,\s*location\)/);
    assert.match(viewSource, /function resolveFavoriteLocationTravelTimeText/);
    assert.match(viewSource, /favorite-location-card__travel-time/);
    assert.match(viewSource, /computedTravelTimeMinutes/);
    assert.match(viewSource, /Travel \$\{formatMinutesCompactDurationLabel/);
    assert.match(scssSource, /\.favorite-location-card__travel-time/);
});

test('Favorites tab activation can request a refresh before location display init registers the helper', () => {
    const viewSource = read('views/index.njk');

    assert.match(viewSource, /function requestFavoriteLocationsRefresh\(options = \{\}\)/);
    assert.match(viewSource, /tabName === 'favorites'\) \{\s*requestFavoriteLocationsRefresh\(\);/);
    assert.match(viewSource, /window\.refreshFavoriteLocations\s*=\s*refreshFavoriteLocations/);
    assert.match(viewSource, /pendingFavoriteLocationsRefreshOptions/);
});
