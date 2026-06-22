const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public', 'js', 'chat.js'), 'utf8');

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

function loadSlashCommandActionHarness() {
    const context = {
        Error,
        Number,
        window: {
            location: {
                reloadCalls: 0,
                reload() {
                    this.reloadCalls += 1;
                }
            }
        },
        scheduled: []
    };
    context.window.setTimeout = (callback, delayMs) => {
        context.scheduled.push({ callback, delayMs });
        return context.scheduled.length;
    };
    vm.createContext(context);
    vm.runInContext(`
class Harness {
${extractClassMethod(chatSource, 'handleSlashCommandReplyAction')}
${extractClassMethod(chatSource, 'scheduleSlashCommandPageReload')}

    async requestSlashCommandUpload() {
        throw new Error('requestSlashCommandUpload should not run for reload_page.');
    }
}
this.Harness = Harness;
`, context);
    return { harness: new context.Harness(), context };
}

test('slash command reload_page action schedules a browser reload after the requested delay', async () => {
    const { harness, context } = loadSlashCommandActionHarness();

    await harness.handleSlashCommandReplyAction({ type: 'reload_page', delayMs: 250 });

    assert.equal(context.scheduled.length, 1);
    assert.equal(context.scheduled[0].delayMs, 250);
    assert.equal(context.window.location.reloadCalls, 0);

    context.scheduled[0].callback();
    assert.equal(context.window.location.reloadCalls, 1);
});

test('slash command reload_page action rejects invalid delay values client-side', async () => {
    const { harness } = loadSlashCommandActionHarness();

    await assert.rejects(
        () => harness.handleSlashCommandReplyAction({ type: 'reload_page', delayMs: -1 }),
        /delayMs/
    );
});
