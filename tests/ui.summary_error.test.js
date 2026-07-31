const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const chatSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'chat.js'),
    'utf8'
);

function extractClassMethod(source, methodName) {
    const start = source.indexOf(`    ${methodName}(`);
    assert.notEqual(start, -1, `${methodName} should exist`);

    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `${methodName} should have a body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') {
            depth += 1;
        } else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${methodName}.`);
}

test('summary_error websocket messages open an alert containing the server stack', () => {
    assert.match(
        chatSource,
        /case 'summary_error':\s*this\.handleSummaryError\(payload\);/
    );

    const alerts = [];
    const context = {
        alert: message => alerts.push(message),
        console: { error() {} }
    };
    vm.createContext(context);
    vm.runInContext(`
class Harness {
${extractClassMethod(chatSource, 'handleSummaryError')}
}
this.harness = new Harness();
`, context);

    context.harness.handleSummaryError({
        message: 'Scene summary response was empty.',
        stack: 'Error: Scene summary response was empty.\n    at summarizeScenesForHistoryRange (server.js:8384:15)'
    });

    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /^Automatic summary failed:/);
    assert.match(alerts[0], /Scene summary response was empty/);
    assert.match(alerts[0], /server\.js:8384:15/);
});
