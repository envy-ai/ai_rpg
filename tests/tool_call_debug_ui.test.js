const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');

function toPlainObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadToolCallDebugDisplayHelpers() {
    const start = chatSource.indexOf('function decodeToolCallDebugXmlEntities');
    const end = chatSource.indexOf('\nclass AIRPGChat', start);
    assert.notEqual(start, -1, 'Could not locate prepareToolCallDebugSectionValue');
    assert.notEqual(end, -1, 'Could not locate AIRPGChat class boundary');

    const context = { Array, Object, String };
    vm.createContext(context);
    vm.runInContext(
        `${chatSource.slice(start, end)}
this.prepareToolCallDebugSectionValue = prepareToolCallDebugSectionValue;
this.prepareToolCallDebugSectionDisplay = prepareToolCallDebugSectionDisplay;`,
        context
    );
    return {
        prepareToolCallDebugSectionValue: context.prepareToolCallDebugSectionValue,
        prepareToolCallDebugSectionDisplay: context.prepareToolCallDebugSectionDisplay
    };
}

test('tool-call debug display extracts readable result and error content fields only', () => {
    const {
        prepareToolCallDebugSectionValue,
        prepareToolCallDebugSectionDisplay
    } = loadToolCallDebugDisplayHelpers();
    const originalResult = {
        content: '&lt;toolResult&gt;Baato &amp; Mira&apos;s &quot;lock&quot;&lt;/toolResult&gt;',
        metadata: {
            note: '&lt;keep metadata escaped&gt;'
        }
    };

    const displayResult = prepareToolCallDebugSectionValue('Result', originalResult);

    assert.equal(
        displayResult.content,
        '<toolResult>Baato & Mira\'s "lock"</toolResult>'
    );
    assert.equal(displayResult.metadata.note, '&lt;keep metadata escaped&gt;');
    assert.equal(originalResult.content, '&lt;toolResult&gt;Baato &amp; Mira&apos;s &quot;lock&quot;&lt;/toolResult&gt;');

    const displayError = prepareToolCallDebugSectionValue('Error', {
        message: 'Tool failed.',
        result: {
            content: '&lt;toolError&gt;&lt;message&gt;Nope&lt;/message&gt;&lt;/toolError&gt;'
        }
    });
    assert.equal(
        displayError.result.content,
        '<toolError><message>Nope</message></toolError>'
    );

    const displayParameters = prepareToolCallDebugSectionValue('Parameters', {
        content: '&lt;literal user input&gt;'
    });
    assert.equal(displayParameters.content, '&lt;literal user input&gt;');

    const resultDisplay = prepareToolCallDebugSectionDisplay('Result', originalResult);
    assert.deepEqual(toPlainObject(resultDisplay.contentFields), [{
        path: 'content',
        content: '<toolResult>Baato & Mira\'s "lock"</toolResult>'
    }]);
    assert.equal(resultDisplay.jsonValue.content, '[shown below]');
    assert.equal(resultDisplay.jsonValue.metadata.note, '&lt;keep metadata escaped&gt;');

    const errorDisplay = prepareToolCallDebugSectionDisplay('Error', {
        message: 'Tool failed.',
        result: {
            content: '&lt;toolError&gt;&lt;message&gt;Nope&lt;/message&gt;&lt;/toolError&gt;'
        }
    });
    assert.deepEqual(toPlainObject(errorDisplay.contentFields), [{
        path: 'result.content',
        content: '<toolError><message>Nope</message></toolError>'
    }]);
    assert.equal(errorDisplay.jsonValue.result.content, '[shown below]');

    const parametersDisplay = prepareToolCallDebugSectionDisplay('Parameters', {
        content: '&lt;literal user input&gt;'
    });
    assert.deepEqual(toPlainObject(parametersDisplay.contentFields), []);
    assert.equal(parametersDisplay.jsonValue.content, '&lt;literal user input&gt;');
});
