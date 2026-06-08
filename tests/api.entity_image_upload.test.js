const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const api = require('../api.js');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const imageDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'images.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

function dataUrl(mimeType, bytes) {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('entity image upload helper preserves supported image MIME extensions', () => {
    assert.equal(typeof api.parseUploadedEntityImageDataUrl, 'function');

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const jpeg = api.parseUploadedEntityImageDataUrl(dataUrl('image/jpeg', jpegBytes));
    assert.equal(jpeg.mimeType, 'image/jpeg');
    assert.equal(jpeg.extension, 'jpg');
    assert.deepEqual(jpeg.buffer, jpegBytes);

    const webpBytes = Buffer.from('RIFF\x04\x00\x00\x00WEBPVP8 ', 'binary');
    const webp = api.parseUploadedEntityImageDataUrl(dataUrl('image/webp', webpBytes));
    assert.equal(webp.mimeType, 'image/webp');
    assert.equal(webp.extension, 'webp');
    assert.deepEqual(webp.buffer, webpBytes);
});

test('entity image upload helper rejects unsupported image MIME types', () => {
    assert.equal(typeof api.parseUploadedEntityImageDataUrl, 'function');
    assert.throws(
        () => api.parseUploadedEntityImageDataUrl('data:image/svg+xml;base64,PHN2Zy8+'),
        /Unsupported image type/
    );
    assert.throws(
        () => api.parseUploadedEntityImageDataUrl(dataUrl('image/png', Buffer.from('not-png'))),
        /do not match the declared image type/
    );
    assert.throws(
        () => api.parseUploadedEntityImageDataUrl('data:image/gif;base64,abc'),
        /not valid base64/
    );
});

test('generic entity image upload API assigns images to supported entity types', () => {
    assertIncludes(apiSource, "app.post('/api/images/upload'");
    assertIncludes(apiSource, 'saveUploadedEntityImage({');
    assertIncludes(apiSource, "case 'location':");
    assertIncludes(apiSource, 'clearLocationImageVariants(entity);');
    assertIncludes(apiSource, "case 'thing':");
    assertIncludes(apiSource, "case 'npc':");
    assertIncludes(apiSource, "case 'player':");
    assertIncludes(apiSource, 'entity.imageId = savedImage.imageId;');
    assertIncludes(apiSource, 'image: savedImage.metadata');
});

test('image API docs describe entity image upload replacement', () => {
    assertIncludes(imageDocs, '## POST /api/images/upload');
    assertIncludes(imageDocs, "entityType: 'location'|'thing'|'item'|'scenery'|'npc'|'player'");
    assertIncludes(imageDocs, 'Supported upload MIME types are PNG, JPEG, WebP, and GIF');
});
