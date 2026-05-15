const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadServerFunction(functionName) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const dependencyStartName = functionName === 'parseXMLTemplate'
        ? 'splitUnsafeCdataTerminatorsForTag'
        : functionName;
    const start = source.indexOf(`function ${dependencyStartName}`);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in server.js`);
    }

    const functionStart = source.indexOf(`function ${functionName}`, start);
    const bodyStart = source.indexOf('{', functionStart);
    if (bodyStart < 0) {
        throw new Error(`Unable to find body for ${functionName} in server.js`);
    }
    let depth = 0;
    let end = -1;
    for (let i = bodyStart; i < source.length; i += 1) {
        const char = source[i];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end < 0) {
        throw new Error(`Unable to find end of ${functionName} in server.js`);
    }

    const context = {
        Utils,
        console,
        parseInt,
        parseFloat,
        Number,
        Array
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.${functionName} = ${functionName};`,
        context
    );
    return context[functionName];
}

test('parseXMLTemplate preserves literal CDATA terminators inside generation prompts', () => {
    Globals.config = { strictXMLParsing: true };
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate');
    const parsed = parseXMLTemplate([
        '<template>',
        '<systemPrompt>system</systemPrompt>',
        '<generationPrompt><![CDATA[before ]]> after]]></generationPrompt>',
        '</template>'
    ].join(''));

    assert.equal(parsed.systemPrompt, 'system');
    assert.equal(parsed.generationPrompt, 'before ]]> after');
});

test('scene summary parser extracts the final scenes block from prose-heavy responses', () => {
    Globals.config = { strictXMLParsing: true };
    const parseSceneSummaryResponse = loadServerFunction('parseSceneSummaryResponse');
    const scenes = parseSceneSummaryResponse([
        'Step 1: discussion with <candidate>broken example text',
        'Step 2: more prose',
        'Step 3:',
        '<scenes>',
        '<scene>',
        '<index>1</index>',
        '<summary>The party regroups and plans.</summary>',
        '<details>- The group has a plan</details>',
        '<quote><character>Exis</character><text>Move.</text></quote>',
        '</scene>',
        '</scenes>'
    ].join('\n'), [
        { globalIndex: 42, entryId: 'entry-42' }
    ]);

    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].startIndex, 42);
    assert.equal(scenes[0].summary, 'The party regroups and plans.');
});

test('scene summary requests disable whole-response XML validation', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const sceneRequestStart = source.indexOf("metadataLabel: 'scene_summarize'");
    assert.notEqual(sceneRequestStart, -1);
    const requestBlock = source.slice(sceneRequestStart, sceneRequestStart + 500);

    assert.match(requestBlock, /validateXML:\s*false/);
});
