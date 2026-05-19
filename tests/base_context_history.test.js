const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
    shouldIncludeEntryInBaseContextHistory
} = require('../base_context_history.js');

test('base-context history includes prompt-excluded log entries only when all entry types are requested', () => {
    const hiddenGenericEntry = {
        type: 'generic-prompt-response',
        role: 'assistant',
        content: 'Prior generic prompt response.',
        metadata: {
            excludeFromBaseContextHistory: true
        }
    };

    assert.equal(
        shouldIncludeEntryInBaseContextHistory(hiddenGenericEntry, {
            hasRenderableContent: true
        }),
        false
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(hiddenGenericEntry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
});

test('base-context history all-entry mode includes status and level-up entries with renderable text', () => {
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'status-summary',
            role: 'assistant',
            content: 'Status changed.'
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'level-up',
            role: 'assistant',
            content: 'Level up.'
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'tool-call-debug',
            role: 'system',
            content: ''
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: false
        }),
        false
    );
});

test('generic prompt route requests full-entry-type base context while no-context prompt stays isolated', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    assert.match(
        source,
        /prepareBasePromptContext\(\{\s*locationOverride:\s*location,\s*includeAllHistoryEntryTypes:\s*isGenericPromptAction\s*&&\s*!isNoContextPromptAction\s*\}\)/
    );
});
