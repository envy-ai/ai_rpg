const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const api = require('../api.js');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

function buildFilename(imageId, extension, collections = {}, metadata = null) {
    return api.buildGeneratedImageDownloadFilename({
        imageId,
        filepath: path.join('/generated-images', `${imageId}.${extension}`),
        metadata,
        ...collections
    });
}

test('generated image downloads use character and thing names', () => {
    const players = new Map([
        ['npc-1', { id: 'npc-1', name: 'Éowyn: Shield/Maiden', imageId: 'portrait-1' }]
    ]);
    const things = new Map([
        ['thing-1', { id: 'thing-1', name: 'Moonlit Blade', thingType: 'item', imageId: 'thing-image-1' }]
    ]);

    assert.equal(buildFilename('portrait-1', 'png', { players, things }), 'Éowyn Shield Maiden.png');
    assert.equal(buildFilename('thing-image-1', 'webp', { players, things }), 'Moonlit Blade.webp');
});

test('generated image downloads use location names for base images and display variants', () => {
    const gameLocations = new Map([
        ['location-1', {
            id: 'location-1',
            name: 'The Glass Harbor',
            imageId: 'base-image-1',
            imageVariants: {
                rainy: { imageId: 'variant-image-1' }
            }
        }]
    ]);

    assert.equal(buildFilename('base-image-1', 'jpg', { gameLocations }), 'The Glass Harbor.jpg');
    assert.equal(buildFilename('variant-image-1', 'png', { gameLocations }), 'The Glass Harbor.png');
});

test('generated image downloads describe exits by destination and fall back to the image id', () => {
    const gameLocations = new Map([
        ['destination-1', { id: 'destination-1', name: 'Sunken Observatory' }]
    ]);
    const gameLocationExits = new Map([
        ['exit-1', { id: 'exit-1', destination: 'destination-1', imageId: 'exit-image-1' }]
    ]);

    assert.equal(
        buildFilename('exit-image-1', 'gif', { gameLocations, gameLocationExits }),
        'Exit to Sunken Observatory.gif'
    );
    assert.equal(buildFilename('orphan-image-1', 'png'), 'generated-image-orphan-image-1.png');
});

test('generated image file responses provide an inline descriptive filename', () => {
    assert.match(apiSource, /contentDisposition\(downloadFilename, \{ type: 'inline' \}\)/);
    assert.match(apiSource, /res\.setHeader\('Content-Disposition'/);
});
