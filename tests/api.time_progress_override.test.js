const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadTimeProgressOverrideHelper() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const applyTimeProgressOverrideToEventResults = ({');
    const end = source.indexOf('\n        const findLocationExitById = (exitId) => {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate applyTimeProgressOverrideToEventResults in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {};
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.applyTimeProgressOverrideToEventResults = applyTimeProgressOverrideToEventResults;`,
        context
    );
    return context.applyTimeProgressOverrideToEventResults;
}

function toPlain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('time progress override updates destination split-event summary when present', () => {
    const applyTimeProgressOverrideToEventResults = loadTimeProgressOverrideHelper();

    const eventResult = { timeProgress: { advancedMinutes: 3 } };
    const originEventResult = { timeProgress: { advancedMinutes: 3 } };
    const destinationEventResult = { timeProgress: { advancedMinutes: 3 } };

    applyTimeProgressOverrideToEventResults({
        timeProgress: { advancedMinutes: 65, transitions: [{ type: 'segment' }] },
        eventResult,
        originEventResult,
        destinationEventResult
    });

    assert.deepEqual(toPlain(eventResult.timeProgress), {
        advancedMinutes: 65,
        transitions: [{ type: 'segment' }]
    });
    assert.deepEqual(toPlain(destinationEventResult.timeProgress), {
        advancedMinutes: 65,
        transitions: [{ type: 'segment' }]
    });
    assert.deepEqual(toPlain(originEventResult.timeProgress), { advancedMinutes: 3 });
});

test('time progress override falls back to origin split-event summary when no destination result exists', () => {
    const applyTimeProgressOverrideToEventResults = loadTimeProgressOverrideHelper();

    const eventResult = { timeProgress: { advancedMinutes: 2 } };
    const originEventResult = { timeProgress: { advancedMinutes: 2 } };

    applyTimeProgressOverrideToEventResults({
        timeProgress: { advancedMinutes: 45 },
        eventResult,
        originEventResult,
        destinationEventResult: null
    });

    assert.deepEqual(toPlain(eventResult.timeProgress), { advancedMinutes: 45 });
    assert.deepEqual(toPlain(originEventResult.timeProgress), { advancedMinutes: 45 });
});
