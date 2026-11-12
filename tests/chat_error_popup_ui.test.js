const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public', 'js', 'chat.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(repoRoot, 'api.js'), 'utf8');

function extractClassMethod(source, methodName) {
    const start = source.indexOf(`    ${methodName}(`) >= 0
        ? source.indexOf(`    ${methodName}(`)
        : source.indexOf(`    async ${methodName}(`);
    assert.notEqual(start, -1, `${methodName} should exist`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `${methodName} should have parameters`);
    let parenDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            parenDepth += 1;
        } else if (char === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `${methodName} should close parameters`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `${methodName} should have body`);
    let braceDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${methodName}`);
}

test('chat request failures show an error popup instead of only adding a system entry', () => {
    const submitSource = extractClassMethod(chatSource, 'submitChatMessage');

    assert.match(chatSource, /showChatErrorPopup\(message\)\s*\{/);
    assert.match(chatSource, /window\.AIRPG_PAGE_FEEDBACK\.showError\(message\)/);
    assert.match(
        submitSource,
        /if\s*\(data\.error\)\s*\{[\s\S]*?const errorMessage\s*=\s*data\.error;[\s\S]*?this\.showChatErrorPopup\(this\.createMessageRequestError\(data, errorMessage\)\);/,
        'server-returned chat errors should open the popup'
    );
    assert.match(
        submitSource,
        /catch\s*\(error\)\s*\{[\s\S]*?const errorMessage\s*=\s*`Connection error: \$\{error\.message\}`;[\s\S]*?this\.showChatErrorPopup\(error\);/,
        'network failures should open the popup'
    );
    assert.match(
        submitSource,
        /Array\.isArray\(data\.questCompletionErrors\)[\s\S]*?this\.showChatErrorPopup\(questErrorMessage\);/,
        'quest reward failures should open the popup without rejecting the completed objective response'
    );
    assert.match(
        submitSource,
        /Array\.isArray\(data\.postProcessingErrors\)[\s\S]*?const stack = typeof entry\?\.stack === 'string'[\s\S]*?return stack \? `\$\{message\}\\n\\n\$\{stack\}` : message;[\s\S]*?this\.showChatErrorPopup\(postProcessingErrorMessage\);/,
        'partial event-application failures should show their original backtrace while keeping committed successes'
    );
    assert.match(
        apiSource,
        /responseData\.postProcessingErrors = eventResult\.postProcessingErrors\.slice\(\)/,
        'successful event processing must return partial application errors alongside committed outcomes'
    );
});

test('slash repair failures display the original server stack once and propagate the error', async () => {
    const stack = 'Error: Repair failed\n    at actualRepair (repair.js:42:9)';
    const payload = { success: false, error: 'Repair failed', stack };
    const context = vm.createContext({ fetch: async () => ({ ok: false, status: 500, json: async () => payload }) });
    vm.runInContext(`class Harness { ${extractClassMethod(chatSource, 'postSlashCommandRequest')} } this.Harness = Harness;`, context);
    const harness = new context.Harness();
    const popups = [], messages = [];
    harness.showChatErrorPopup = text => popups.push(text);
    harness.addMessage = (...args) => messages.push(args);
    harness.consumePromptFailure = () => false;
    await assert.rejects(harness.postSlashCommandRequest('/api/slash-command', { command: 'repair_status_effects' }), error => {
        assert.equal(error.message, 'Repair failed');
        assert.equal(error.stack, stack);
        return true;
    });
    assert.deepEqual(popups, [stack]);
    assert.deepEqual(messages, []);

    payload.promptFailure = { id: 'prompt-failure' };
    harness.consumePromptFailure = data => data.promptFailure === payload.promptFailure;
    await assert.rejects(harness.postSlashCommandRequest('/api/slash-command', { command: 'repair_status_effects' }), error => error.promptFailure === payload.promptFailure);
    assert.deepEqual(popups, [stack], 'the prompt failure owner prevents a second popup');
});

test('reprocess event warnings remain visible alongside original slash failure details', async () => {
    const payload = { success: false, error: 'Reprocess failed', stack: 'original stack', warnings: ['Earlier event was skipped'] };
    const context = vm.createContext({ fetch: async () => ({ ok: false, status: 500, json: async () => payload }) });
    vm.runInContext(`class Harness { ${extractClassMethod(chatSource, 'postSlashCommandRequest')} } this.Harness = Harness;`, context);
    const harness = new context.Harness();
    const popups = [], messages = [];
    harness.showChatErrorPopup = value => popups.push(value);
    harness.addMessage = (...args) => messages.push(args);
    harness.consumePromptFailure = () => false;
    await assert.rejects(harness.postSlashCommandRequest('/api/slash-command', { command: 'reprocess_events' }), /Reprocess failed/);
    assert.deepEqual(messages, [['system', 'Earlier event was skipped', true]]);
    assert.deepEqual(popups, ['Earlier event was skipped\n\noriginal stack']);
});
