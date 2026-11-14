const test = require('node:test');
const assert = require('node:assert/strict');
const Globals = require('../Globals.js');
const { wrapTaskInBaseContext } = require('../BaseContextTaskPrompt.js');

test('without a registered renderer the standalone prompt is returned unchanged', async () => {
    const previous = Globals.renderBaseContextTaskPrompt;
    Globals.renderBaseContextTaskPrompt = undefined;
    try {
        const result = await wrapTaskInBaseContext({ systemPrompt: 'Do the task.', taskPrompt: '{"a":1}' });
        assert.deepEqual(result, { systemPrompt: 'Do the task.', generationPrompt: '{"a":1}', usesBaseContext: false });
    } finally {
        Globals.renderBaseContextTaskPrompt = previous;
    }
});

test('with a renderer the task instructions move after the shared base context', async () => {
    const previous = Globals.renderBaseContextTaskPrompt;
    let received = null;
    Globals.renderBaseContextTaskPrompt = async ({ taskPrompt }) => {
        received = taskPrompt;
        return { systemPrompt: 'SHARED SYSTEM', generationPrompt: `BASE\n${taskPrompt}` };
    };
    try {
        const result = await wrapTaskInBaseContext({ systemPrompt: 'Do the task.', taskPrompt: '{"a":1}' });
        assert.equal(received, '<taskInstructions>\nDo the task.\n</taskInstructions>\n{"a":1}');
        assert.equal(result.systemPrompt, 'SHARED SYSTEM');
        assert.equal(result.generationPrompt, `BASE\n${received}`);
        assert.equal(result.usesBaseContext, true);
    } finally {
        Globals.renderBaseContextTaskPrompt = previous;
    }
});
