'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { migrateOperationalIds } = require('../OperationalIdMigration.js');

test('migrated image identity resolves its original asset filename and URL without renaming', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'migration-image-'));
    const imageDir = path.join(root, 'public', 'generated-images');
    fs.mkdirSync(imageDir, { recursive: true });
    const oldId = 'e581178b-cd44-4f6c-95e2-a9b90266d5dd';
    const filename = `${oldId}.png`, url = `/generated-images/${filename}`;
    fs.writeFileSync(path.join(imageDir, filename), 'fixture image bytes');
    const migrated = migrateOperationalIds({ generatedImages: { [oldId]: { id: oldId, images: [{ filename, url }] } }, things: { sample: { imageId: oldId } } }).serialized;
    const newId = migrated.things.sample.imageId;
    assert.match(newId, /^image_\d+$/);
    assert.equal(migrated.generatedImages[newId].images[0].url, url);
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveImageFilePath(imageId) {'), end = source.indexOf('\nfunction hasExistingImage(', start);
    assert.ok(start >= 0 && end > start);
    const resolve = vm.runInNewContext(`${source.slice(start, end)}\nresolveImageFilePath;`, {
        fs, path, __dirname: root, generatedImages: new Map(Object.entries(migrated.generatedImages)), KNOWN_IMAGE_EXTENSIONS: ['.png']
    });
    assert.equal(resolve(newId), path.join(imageDir, filename));
    assert.deepEqual(fs.readdirSync(imageDir), [filename]);
});
