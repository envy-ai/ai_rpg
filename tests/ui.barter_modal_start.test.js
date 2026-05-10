const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('barter modal confirms before starting expensive session prompt', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const modalBlock = extractBlock(
        source,
        'id="barterStartConfirmModal"',
        'id="barterQuantityModal"'
    );
    const openBlock = extractBlock(
        source,
        'async function openBarterModal',
        'function shouldConcludeBarterSessionOnClose'
    );
    const confirmIndex = openBlock.indexOf('requestBarterStartConfirmation(npc)');
    const fetchIndex = openBlock.indexOf('/trade/session');

    assert.match(modalBlock, /Barter with/);
    assert.notEqual(confirmIndex, -1);
    assert.notEqual(fetchIndex, -1);
    assert.ok(confirmIndex < fetchIndex);
});

test('barter modal shows loading spinners instead of empty inventory text while session prompts run', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const renderPanelBlock = extractBlock(
        source,
        'function renderBarterOfferPanel',
        'function renderBarterModal'
    );
    const openBlock = extractBlock(
        source,
        'async function openBarterModal',
        'function shouldConcludeBarterSessionOnClose'
    );

    assert.match(source, /let barterSessionLoading = false/);
    assert.match(renderPanelBlock, /barterSessionLoading/);
    assert.match(renderPanelBlock, /barter-modal__loading/);
    assert.match(renderPanelBlock, /Loading inventory/);
    assert.match(openBlock, /barterSessionLoading = true/);
    assert.match(openBlock, /renderBarterModal\(\)/);
});

test('barter start confirmation participates in shared modal backdrop handling', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const closeBlock = extractBlock(
        source,
        'function closeBarterStartConfirmModal',
        'function requestBarterStartConfirmation'
    );
    const backdropBlock = extractBlock(
        source,
        'function hideNpcBackdropIfNoSharedModalOpen',
        'function showThingContainerShell'
    );

    assert.match(closeBlock, /hideNpcBackdropIfNoSharedModalOpen\(\)/);
    assert.match(backdropBlock, /barterStartConfirmModal/);
});
