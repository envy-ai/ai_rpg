const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

function extractFunction(source, name) {
    const signature = `function ${name}(`;
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Unable to locate ${name}.`);

    const paramsStart = source.indexOf('(', start);
    let paramsDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        if (source[index] === '(') {
            paramsDepth += 1;
        } else if (source[index] === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `Unable to locate ${name} parameter end.`);

    const bodyStart = source.indexOf('{', paramsEnd);
    let bodyDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') {
            bodyDepth += 1;
        } else if (source[index] === '}') {
            bodyDepth -= 1;
            if (bodyDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }
    throw new Error(`Unable to locate ${name} end.`);
}

test('shared modal ability sorter alphabetizes names without mutating the source array', () => {
    const functionSource = extractFunction(viewSource, 'alphabetizeAbilities');
    const alphabetizeAbilities = Function(`${functionSource}; return alphabetizeAbilities;`)();
    const abilities = [
        { name: 'Zephyr Step' },
        { name: 'arcane Ward' },
        { name: 'Blink' }
    ];

    const sorted = alphabetizeAbilities(abilities);

    assert.deepEqual(sorted.map(ability => ability.name), [
        'arcane Ward',
        'Blink',
        'Zephyr Step'
    ]);
    assert.deepEqual(abilities.map(ability => ability.name), [
        'Zephyr Step',
        'arcane Ward',
        'Blink'
    ]);
});

test('every ability-bearing modal render path uses the shared alphabetizer', () => {
    assert.match(
        extractFunction(viewSource, 'getPlayerAbilityEntriesForModal'),
        /alphabetizeAbilities\(player\.abilities\)/
    );
    assert.match(
        extractFunction(viewSource, 'renderPlayerAbilitySelectionCards'),
        /const options = alphabetizeAbilities\(selection\?\.options\);/
    );
    assert.match(
        extractFunction(viewSource, 'populateNpcAbilities'),
        /const entries = alphabetizeAbilities\(abilities\);/
    );
    assert.match(
        extractFunction(viewSource, 'renderAbilityCards'),
        /const safeAbilities = alphabetizeAbilities\(abilities\);/
    );
});
