const test = require('node:test');
const assert = require('node:assert/strict');

const {
    snapshotPlayerActionBaseContextForSlop
} = require('../api.js');

test('player-action slop snapshot captures the exact rendered prefix', () => {
    const promptData = {
        systemPrompt: '  Shared system prompt  ',
        generationPrompt: '  Shared base context\n[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]Player action instructions  ',
        liveValidator() {}
    };
    promptData.self = promptData;

    const snapshot = snapshotPlayerActionBaseContextForSlop(promptData);

    assert.deepEqual(snapshot, {
        systemPrompt: 'Shared system prompt',
        generationPromptPrefix: 'Shared base context\n'
    });
    assert.equal(Object.isFrozen(snapshot), true);
});

test('player-action slop snapshot rejects invalid rendered prompt data', () => {
    assert.throws(
        () => snapshotPlayerActionBaseContextForSlop(null),
        /requires parsed prompt data/
    );
    assert.throws(
        () => snapshotPlayerActionBaseContextForSlop({
            systemPrompt: 'System',
            generationPrompt: 'No marker here'
        }),
        /requires exactly one internal end marker/
    );
    assert.throws(
        () => snapshotPlayerActionBaseContextForSlop({
            systemPrompt: 'System',
            generationPrompt: 'Before[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]After[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]Again'
        }),
        /requires exactly one internal end marker/
    );
});
