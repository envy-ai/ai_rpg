const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, functionName) {
    const marker = `function ${functionName}`;
    const start = source.indexOf(marker);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in server.js`);
    }

    let parenDepth = 0;
    let bodyStart = -1;
    for (let index = start + marker.length; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            parenDepth += 1;
        } else if (char === ')') {
            parenDepth -= 1;
        } else if (char === '{' && parenDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    if (bodyStart < 0) {
        throw new Error(`Unable to locate ${functionName} body in server.js`);
    }

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${functionName} from server.js`);
}

function loadNameRegenFilteringHelpers() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const helperNames = [
        'locationNameContainsSlopWord',
        'isLocationNameBanned',
        'filterAllowedLocationNameCandidates',
        'chooseRegionName'
    ];
    const functionSource = helperNames
        .map(name => extractFunction(source, name))
        .join('\n\n');

    const context = {
        Set,
        Array,
        console,
        getSlopWordList: () => [],
        Region: { getByName: () => null },
        Location: { getByName: () => null }
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.isLocationNameBanned = isLocationNameBanned;
this.filterAllowedLocationNameCandidates = filterAllowedLocationNameCandidates;
this.chooseRegionName = chooseRegionName;`,
        context
    );

    return {
        isLocationNameBanned: context.isLocationNameBanned,
        filterAllowedLocationNameCandidates: context.filterAllowedLocationNameCandidates,
        chooseRegionName: context.chooseRegionName
    };
}

test('location name validation accepts the exact slop-word rules for the regeneration pass', () => {
    const { isLocationNameBanned } = loadNameRegenFilteringHelpers();

    assert.equal(isLocationNameBanned('Starforge Annex', new Set(), ['starforge']), true);
    assert.equal(isLocationNameBanned('Copper Annex', new Set(), ['starforge']), false);
});

test('alternate location name candidates are filtered before selection', () => {
    const { filterAllowedLocationNameCandidates } = loadNameRegenFilteringHelpers();

    const candidates = filterAllowedLocationNameCandidates([
        'Rusty Flagon Annex',
        'Ashen Overlook',
        'Original Crystal Hall',
        'Copper Gate',
        'Copper Gate'
    ], {
        bannedSet: new Set(['rusty flagon']),
        slopWords: ['ashen'],
        originalName: 'Original Crystal Hall'
    });

    assert.deepEqual(Array.from(candidates), ['Copper Gate']);
});

test('region alternate selection skips candidates rejected by the same slop rules', () => {
    const { chooseRegionName } = loadNameRegenFilteringHelpers();
    const region = {
        id: 'region-bad',
        name: 'Crystal Reach'
    };

    const selection = chooseRegionName({
        region,
        candidateNames: ['Starforge Reach', 'Copper Reach'],
        bannedSet: new Set(),
        slopWords: ['starforge'],
        usedNames: new Set(),
        regionLabel: 'Crystal Reach'
    });

    assert.equal(selection.selectedName, 'Copper Reach');
    assert.equal(region.name, 'Copper Reach');
    assert.deepEqual(Array.from(selection.candidates), ['Copper Reach']);
});
