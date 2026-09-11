const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

function extractBlock(startNeedle, endNeedle) {
    const start = viewSource.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = viewSource.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return viewSource.slice(start, end);
}

test('location items expose a mobile inspect/pickup icon toggle with inspect selected by default', () => {
    const markup = extractBlock(
        '<div class="location-item-mobile-action-toggle"',
        '<div class="location-entity-grid" id="locationItems">'
    );

    assert.match(markup, /zoom_in\.svg/);
    assert.match(markup, /pick_up\.svg/);
    assert.match(markup, /data-location-item-action-mode="inspect"[^>]*aria-pressed="true"/);
    assert.match(markup, /data-location-item-action-mode="pickup"[^>]*aria-pressed="false"/);
    assert.match(markup, /aria-live="polite"/);
});

test('pickup mode captures only mobile non-control item taps and gives the item to the active player', () => {
    const handler = extractBlock(
        'function wireMobileLocationItemAction(card, thing, { locationId = null } = {})',
        'window.registerInventoryDropTarget = registerInventoryDropTarget;'
    );

    assert.match(handler, /isNarrowMobileViewport\(\)/);
    assert.match(handler, /locationItemMobileActionMode !== 'pickup'/);
    assert.match(handler, /event\.target\.closest\([^\n]*entity-context-menu-button[^\n]*button/);
    assert.match(handler, /event\.stopImmediatePropagation\(\)/);
    assert.match(handler, /ownerId: playerId/);
    assert.match(handler, /ownerType: 'player'/);
    assert.match(handler, /handleGiveThingToOwner/);
    assert.match(handler, /}, true\);/);
});

test('the themed interaction toggle is visible only at mobile width', () => {
    assert.match(scssSource, /\.location-item-mobile-action-toggle\s*\{\s*display:\s*none;/);
    assert.match(scssSource, /@media \(max-width: 768px\)[\s\S]*?\.location-item-mobile-action-toggle\s*\{[\s\S]*?display:\s*inline-flex;/);
    assert.match(scssSource, /\.location-item-mobile-action-toggle__button[\s\S]*?&\.is-active/);
    assert.match(scssSource, /data-mobile-item-action-mode="pickup"/);
});

test('the delegated pickup icon exists and uses the local Material icon coordinate system', () => {
    const iconSource = fs.readFileSync(path.join(rootDir, 'assets', 'material-icons', 'misc', 'pick_up.svg'), 'utf8');
    assert.match(iconSource, /<svg[^>]*viewBox="0 -960 960 960"/);
    assert.match(iconSource, /<path\b/);
    const pathData = iconSource.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1] || '';
    assert.ok((pathData.match(/M/g) || []).length >= 2, 'hand and detached item should be separate path contours');
});
