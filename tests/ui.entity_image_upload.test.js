const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const modalDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'modals_overlays.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

function extractUploadResultHandler() {
    const start = viewSource.indexOf('function applyUploadedEntityImageResult(data = {})');
    const end = viewSource.indexOf('async function submitEntityImageUpload(event)', start);
    assert.ok(start >= 0, 'Expected applyUploadedEntityImageResult to exist');
    assert.ok(end > start, 'Expected submitEntityImageUpload to follow applyUploadedEntityImageResult');
    return viewSource.slice(start, end);
}

test('entity image upload modal exists and posts image replacements', () => {
    assertIncludes(viewSource, 'id="entityImageUploadModal"');
    assertIncludes(viewSource, 'id="entityImageUploadFile"');
    assertIncludes(viewSource, 'accept="image/png,image/jpeg,image/webp,image/gif"');
    assertIncludes(viewSource, 'function openEntityImageUploadModal({ entityType, entityId, entityName');
    assertIncludes(viewSource, 'async function submitEntityImageUpload(event)');
    assertIncludes(viewSource, "await readFileAsDataUrl(file, 'Image upload')");
    assertIncludes(viewSource, "fetch('/api/images/upload'");
    assertIncludes(viewSource, 'renderEntityImages(entityType, entityId');
});

test('NPC and player upload results use the shared currentNpcData cache', () => {
    const uploadResultHandler = extractUploadResultHandler();
    assertIncludes(uploadResultHandler, 'const npcDataCache = window.currentNpcData instanceof Map ? window.currentNpcData : null;');
    assertIncludes(uploadResultHandler, 'if (npcDataCache) {');
    assertIncludes(uploadResultHandler, 'npcDataCache.set(entityId, cloneActorRecord(actor) || { ...actor });');
});

test('location context menus expose Upload Image', () => {
    assertIncludes(viewSource, 'id="locationImageUploadButton"');
    assertIncludes(viewSource, 'id="mapLocationMenuUploadImageButton"');
    assertIncludes(viewSource, 'locationImageUploadButton.addEventListener');
    assertIncludes(viewSource, 'mapLocationMenuUploadImageButton.addEventListener');
    assertIncludes(viewSource, 'openLocationImageUploadModal()');
});

test('thing and character context menus expose Upload Image', () => {
    assertIncludes(viewSource, "uploadImageButton.textContent = 'Upload Image';");
    assertIncludes(viewSource, 'openThingImageUploadModal(thingDataCache.get(thing.id) || thing');
    assertIncludes(viewSource, "characterUploadImageButton.textContent = 'Upload Image';");
    assertIncludes(viewSource, 'openCharacterImageUploadModal(npcDataCache.get(npc.id) || npc');
});

test('entity image upload modal has styling and docs', () => {
    assertIncludes(scssSource, '.entity-image-upload-preview');
    assertIncludes(scssSource, '.entity-image-upload-status');
    assertIncludes(chatDocs, 'Upload Image');
    assertIncludes(modalDocs, '#entityImageUploadModal');
});
