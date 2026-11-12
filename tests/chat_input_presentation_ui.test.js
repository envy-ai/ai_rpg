const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`${name} body should close`);
}

function loadPresentation() {
    const context = {};
    vm.createContext(context);
    vm.runInContext(`${extractFunction(chatSource, 'getPlayerChatInputPresentation')}\nthis.present = getPlayerChatInputPresentation;`, context);
    return entry => JSON.parse(JSON.stringify(context.present(entry)));
}

function parseStoredInputPrefix(options) {
    const assignmentStart = apiSource.indexOf('                        const inputPrefix = isQuestionAction');
    assert.notEqual(assignmentStart, -1, 'the API parser should derive its stored input prefix');
    const assignmentEnd = apiSource.indexOf('                        if (inputPrefix) {', assignmentStart);
    assert.notEqual(assignmentEnd, -1, 'the API parser should store its derived input prefix');
    const parserFragment = apiSource.slice(assignmentStart, assignmentEnd)
        + 'if (inputPrefix) { metadata.inputPrefix = inputPrefix; }';
    const context = { ...options, metadata: {} };
    vm.runInNewContext(parserFragment, context);
    return context.metadata.inputPrefix || null;
}

function shouldPersistUserEntry(suppressGenericPromptHistory) {
    const expression = apiSource.match(/const shouldPersistUserEntry = !suppressGenericPromptHistory;/)?.[0];
    assert.ok(expression, 'the API should gate storage from the parser no-log decision');
    return vm.runInNewContext(`${expression}\nshouldPersistUserEntry`, { suppressGenericPromptHistory });
}

test('special player chat prefixes map to their distinct labels and reconstruct stripped prefixes', () => {
    const present = loadPresentation();
    const cases = [
        ['?', 'user-question', 'How should I answer?', 'question', 'Question', '? How should I answer?'],
        ['@', 'user-generic-prompt', 'Describe the room.', 'generic', 'Meta prompt', '@ Describe the room.'],
        ['@@', 'user-generic-prompt', 'Describe privately.', 'generic', 'Private meta prompt', '@@ Describe privately.'],
        ['\\', 'user-generic-prompt', 'Continue without context.', 'generic', 'No-context prompt', '\\ Continue without context.']
    ];

    for (const [prefix, type, content, category, label, expectedContent] of cases) {
        const result = present({ role: 'user', type, content, metadata: { inputPrefix: prefix } });
        assert.equal(result.prefix, prefix);
        assert.equal(result.type, category);
        assert.equal(result.label, label);
        assert.equal(result.content, expectedContent);
    }
});

test('visible creative, forced-event, and comment prefixes are not duplicated', () => {
    const present = loadPresentation();
    const cases = [
        ['! Search the desk.', 'creative', 'Creative action'],
        ['!! A sudden storm begins.', 'forced-event', 'Forced event']
    ];
    for (const [content, type, label] of cases) {
        const result = present({ role: 'user', content });
        assert.equal(result.content, content);
        assert.equal(result.type, type);
        assert.equal(result.label, label);
    }
});


test('comments hide only their control marker while retaining Markdown and stored text', () => {
    const present = loadPresentation();
    const original = { role: 'user', content: '# **Bold** and *italic*\n\nSecond paragraph.' };
    const result = present(original);
    assert.equal(result.type, 'comment');
    assert.equal(result.label, 'Comment');
    assert.equal(result.prefix, '#');
    assert.equal(result.content, '**Bold** and *italic*\n\nSecond paragraph.');
    assert.equal(original.content, '# **Bold** and *italic*\n\nSecond paragraph.');
    assert.equal(present({ role: 'user', content: '# ## Heading' }).content, '## Heading');
    assert.equal(present({ role: 'user', content: '#     code' }).content, '    code');
    assert.equal(present({ role: 'assistant', content: '# Heading' }), null);
});

test('legacy generic entries keep meta styling without inventing an exact prefix', () => {
    const present = loadPresentation();
    const cases = [
        'Legacy stripped prompt.',
        '# Legacy heading.',
        '!! A literal request from an old log.'
    ];
    for (const content of cases) {
        const result = present({ role: 'user', type: 'user-generic-prompt', content });
        assert.equal(result.type, 'generic');
        assert.equal(result.label, 'Meta prompt');
        assert.equal(result.prefix, '');
        assert.equal(result.content, content);
    }
});

test('legacy questions keep question styling even when stripped content begins with a marker', () => {
    const present = loadPresentation();
    const result = present({ role: 'user', type: 'user-question', content: '# topic' });
    assert.equal(result.type, 'question');
    assert.equal(result.label, 'Question');
    assert.equal(result.prefix, '?');
    assert.equal(result.content, '? # topic');
});

test('stored prefix metadata overrides a conflicting visible marker in the remaining prompt body', () => {
    const present = loadPresentation();
    const result = present({
        role: 'user',
        type: 'user-generic-prompt',
        content: '@literal text',
        metadata: { inputPrefix: '@@' }
    });
    assert.equal(result.type, 'generic');
    assert.equal(result.label, 'Private meta prompt');
    assert.equal(result.prefix, '@@');
    assert.equal(result.content, '@@ @literal text');
});

test('transient @@@ input remains presentation-capable while API persistence records only parsed prefixes', () => {
    const present = loadPresentation();
    const transient = present({ role: 'user', content: '@@@ One-shot question.' });
    assert.equal(transient.prefix, '@@@');
    assert.equal(transient.label, 'Unlogged meta prompt');
    assert.match(apiSource, /const shouldPersistUserEntry = !suppressGenericPromptHistory/);
    assert.equal(parseStoredInputPrefix({
        isQuestionAction: false,
        isGenericPromptAction: true,
        genericMarkerLength: 1,
        trimmedVisibleContent: '@ A prompt.'
    }), '@');
    assert.equal(parseStoredInputPrefix({
        isQuestionAction: false,
        isGenericPromptAction: true,
        genericMarkerLength: 2,
        trimmedVisibleContent: '@@ A prompt.'
    }), '@@');
    assert.equal(parseStoredInputPrefix({
        isQuestionAction: false,
        isGenericPromptAction: true,
        genericMarkerLength: 3,
        trimmedVisibleContent: '@@@ A prompt.'
    }), '@@@');
    assert.equal(shouldPersistUserEntry(true), false, '@@@ stays transient under the parser no-log decision');
    assert.equal(shouldPersistUserEntry(false), true);
    assert.equal(parseStoredInputPrefix({
        isQuestionAction: false,
        isGenericPromptAction: false,
        genericMarkerLength: 0,
        trimmedVisibleContent: 'A normal action.'
    }), null);
});

