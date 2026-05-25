const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function sliceBetween(source, start, end) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('item tooltips show mechanical bonuses and equipper effects even without a normal equipment slot', () => {
    const tooltipSource = sliceBetween(
        read('views/index.njk'),
        'const formatThingTooltip = (thing = {}) => {',
        'const formatThingTooltipWithCompatibleEquipped ='
    );

    assert.match(tooltipSource, /const hasAttributeBonuses = attributeBonuses\.length > 0;/);
    assert.match(tooltipSource, /const hasEquipperStatusEffect = Boolean\(equipperStatusEffect[\s\S]+if \(isItem && hasEquipperStatusEffect\) \{/);
    assert.doesNotMatch(tooltipSource, /const bonusesHtml = canEquip && attributeBonuses\.length/);
    assert.doesNotMatch(tooltipSource, /if \(canEquip\) \{\s*statusSections\.push\(renderEffectSection\(thing\.causeStatusEffectOnEquipper/);
});

test('item tooltips recognize legacy generated weapon type metadata', () => {
    const viewSource = read('views/index.njk');
    const weaponSource = sliceBetween(
        viewSource,
        'const isWeaponThing = (thing = {}) => {',
        'const normalizeSlotType ='
    );
    const tooltipSource = sliceBetween(
        viewSource,
        'const formatThingTooltip = (thing = {}) => {',
        'const formatThingTooltipWithCompatibleEquipped ='
    );

    assert.match(weaponSource, /thing\.metadata\?\.itemType,/);
    assert.match(tooltipSource, /thing\.metadata\?\.itemType/);
});

test('generated item descriptions do not append duplicated mechanical stat summaries', () => {
    const serverSource = read('server.js');

    assert.doesNotMatch(serverSource, /const extendedDescription =/);
    assert.doesNotMatch(serverSource, /description:\s*extendedDescription/);
    assert.doesNotMatch(serverSource, /descriptionParts\.push\(detailParts\.join\(' \| '\)\)/);
    assert.match(serverSource, /const itemDescription = typeof item\.description === 'string' && item\.description\.trim\(\)/);
    assert.match(serverSource, /description:\s*itemDescription/);
    assert.match(serverSource, /const composedDescription = itemData\?\.description\?\.trim\(\) \|\| `A thing named \$\{finalName\}\.`;/);
});

test('event-generated items store parsed type as Thing itemTypeDetail', () => {
    const serverSource = read('server.js');
    const eventGenerationSource = sliceBetween(
        serverSource,
        'const thing = new Thing({\n                    name: finalName,',
        'const ownerLevelForLog = owner && Number.isFinite(owner?.level)'
    );

    assert.match(eventGenerationSource, /itemTypeDetail:\s*itemData\?\.type \|\| null,/);
    assert.doesNotMatch(eventGenerationSource, /\n\s*type:\s*itemData\?\.type,/);
});
