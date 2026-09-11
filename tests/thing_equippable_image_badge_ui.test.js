const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function loadCollectionBadgeHelpers(viewSource) {
    const helperStart = viewSource.indexOf('const EQUIPPABLE_ITEM_IMAGE_BADGE');
    const helperEnd = viewSource.indexOf('function getModThingContextActions', helperStart);
    assert.notEqual(helperStart, -1, 'equippable badge declaration should exist');
    assert.notEqual(helperEnd, -1, 'equippable badge helper block should have a stable boundary');

    const helperSource = viewSource.slice(helperStart, helperEnd);
    return new Function(
        'getThingSlotInfo',
        'getThingPropertyBadges',
        'normalizeThingListViewMode',
        `${helperSource}\nreturn { isEquippableItemThing, getThingCollectionImageBadges };`
    )(
        thing => ({ canModifyEquipment: Boolean(thing?.slot || thing?.equippedSlot) }),
        () => [{ key: 'existing' }],
        value => value
    );
}

test('shared Thing cards add the sword-shield badge only to equippable items', () => {
    const viewSource = read('views/index.njk');

    assert.match(viewSource, /const EQUIPPABLE_ITEM_IMAGE_BADGE = Object\.freeze\(\{[\s\S]*imageUrl:\s*'\/assets\/material-icons\/misc\/sword_shield\.svg'[\s\S]*position:\s*'top-right'/);
    assert.match(viewSource, /function isEquippableItemThing\(thing\)[\s\S]*normalizedThingType === 'item' && getThingSlotInfo\(thing\)\.canModifyEquipment/);
    assert.match(viewSource, /function getThingCollectionImageBadges\(thing,[\s\S]*!isEquippableItemThing\(thing\)[\s\S]*return badges\.concat\(EQUIPPABLE_ITEM_IMAGE_BADGE\)/);
    assert.equal((viewSource.match(/badges: getThingCollectionImageBadges\(thing, \{ viewMode: resolvedViewMode \}\)/g) || []).length, 2);
});

test('equippable image badge helper distinguishes item slots, thing types, and table mode', () => {
    const viewSource = read('views/index.njk');
    const { isEquippableItemThing, getThingCollectionImageBadges } = loadCollectionBadgeHelpers(viewSource);

    assert.equal(isEquippableItemThing({ thingType: 'item', slot: 'hand' }), true);
    assert.equal(isEquippableItemThing({ thingType: 'ITEM', equippedSlot: 'body' }), true);
    assert.equal(isEquippableItemThing({ thingType: 'item' }), false);
    assert.equal(isEquippableItemThing({ thingType: 'scenery', slot: 'hand' }), false);
    assert.equal(isEquippableItemThing({ slot: 'hand' }), false);

    assert.deepEqual(
        getThingCollectionImageBadges({ thingType: 'item', slot: 'hand' }, { viewMode: 'classic' })
            .map(badge => badge.key),
        ['existing', 'isEquippable']
    );
    assert.deepEqual(
        getThingCollectionImageBadges({ thingType: 'item', slot: 'hand' }, { viewMode: 'grid' })
            .map(badge => badge.key),
        ['existing', 'isEquippable']
    );
    assert.deepEqual(
        getThingCollectionImageBadges({ thingType: 'item', slot: 'hand' }, { viewMode: 'small-grid' })
            .map(badge => badge.key),
        ['existing', 'isEquippable']
    );
    assert.deepEqual(
        getThingCollectionImageBadges({ thingType: 'item', slot: 'hand' }, { viewMode: 'table' })
            .map(badge => badge.key),
        ['existing']
    );
    assert.deepEqual(
        getThingCollectionImageBadges({ thingType: 'item' }, { viewMode: 'classic' })
            .map(badge => badge.key),
        ['existing']
    );
});

test('Thing tables stay badge-free while the tiny thumbnail badge leaves controls unchanged', () => {
    const viewSource = read('views/index.njk');
    const scssSource = read('public/css/main.scss');
    const cssSource = read('public/css/main.css');

    assert.match(viewSource, /if \(resolvedViewMode === 'table'\)[\s\S]*badges: \[\]/);
    assert.match(viewSource, /equippableItem \? 'is-equippable' : ''/);
    assert.match(viewSource, /overlay\.classList\.add\('entity-image-badges--equippable'\)/);
    assert.match(viewSource, /span\.classList\.add\('entity-image-badge--equippable'\)/);

    const overlayRule = scssSource.match(/\.entity-image-badges--equippable\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(overlayRule, /position:\s*absolute/);
    assert.match(overlayRule, /top:\s*\$thing-equippable-image-badge-inset/);
    assert.match(overlayRule, /right:\s*\$thing-equippable-image-badge-inset/);
    assert.match(overlayRule, /pointer-events:\s*none/);
    assert.match(overlayRule, /z-index:\s*1/);

    const badgeRule = scssSource.match(/\.entity-image-badge--equippable\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(badgeRule, /width:\s*calc\(#\{\$thing-image-badge-asset-size\} \/ 3\)/);
    assert.match(badgeRule, /height:\s*calc\(#\{\$thing-image-badge-asset-size\} \/ 3\)/);
    assert.match(scssSource, /\.thing-collection-view--small-grid \.entity-image-badge--equippable\s*\{[\s\S]*width:\s*calc\(#\{\$thing-small-grid-image-badge-asset-size\} \/ 3\)/);

    assert.doesNotMatch(scssSource, /\.thing-collection-card\.is-equippable > \.entity-context-menu-button/);
    assert.doesNotMatch(scssSource, /\.thing-grid-tile\.is-equippable > \.entity-context-menu-button/);
    assert.doesNotMatch(scssSource, /\.thing-grid-tile\.is-equippable \.thing-grid-equipment-pill/);
    assert.match(scssSource, /\.thing-grid-equipment-pill\s*\{[\s\S]*left:\s*50%[\s\S]*z-index:\s*2/);

    const compiledOverlayRule = cssSource.match(/\.entity-image-badges--equippable\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(compiledOverlayRule, /top:\s*2px/);
    assert.match(compiledOverlayRule, /right:\s*2px/);
    assert.match(compiledOverlayRule, /z-index:\s*1/);
    const compiledBadgeRule = cssSource.match(/\.entity-image-badge--equippable\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(compiledBadgeRule, /width:\s*calc\(22px \/ 3\)/);
    assert.match(compiledBadgeRule, /height:\s*calc\(22px \/ 3\)/);
});
