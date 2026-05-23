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

test('generated item descriptions do not append duplicated mechanical stat summaries', () => {
    const serverSource = read('server.js');

    assert.doesNotMatch(serverSource, /const extendedDescription =/);
    assert.doesNotMatch(serverSource, /description:\s*extendedDescription/);
    assert.doesNotMatch(serverSource, /descriptionParts\.push\(detailParts\.join\(' \| '\)\)/);
    assert.match(serverSource, /const itemDescription = typeof item\.description === 'string' && item\.description\.trim\(\)/);
    assert.match(serverSource, /description:\s*itemDescription/);
    assert.match(serverSource, /const composedDescription = itemData\?\.description\?\.trim\(\) \|\| `A thing named \$\{finalName\}\.`;/);
});
