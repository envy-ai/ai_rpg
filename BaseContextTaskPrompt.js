'use strict';

const Globals = require('./Globals.js');

/**
 * Places a self-contained task prompt after the shared base context so it
 * reuses the cached prompt prefix (only one KV cache is usually available).
 * The task's own system instructions move into <taskInstructions> because the
 * system prompt must stay identical across prompts.
 *
 * Uses Globals.renderBaseContextTaskPrompt, registered by server.js. Without a
 * registered renderer (isolated unit tests) the standalone prompt is returned.
 */
async function wrapTaskInBaseContext({ systemPrompt = '', taskPrompt = '' } = {}) {
    const renderer = Globals.renderBaseContextTaskPrompt;
    if (typeof renderer !== 'function') {
        return { systemPrompt, generationPrompt: taskPrompt, usesBaseContext: false };
    }
    const instructions = typeof systemPrompt === 'string' && systemPrompt.trim()
        ? `<taskInstructions>\n${systemPrompt.trim()}\n</taskInstructions>\n`
        : '';
    const rendered = await renderer({ taskPrompt: `${instructions}${taskPrompt}` });
    if (!rendered?.systemPrompt || !rendered?.generationPrompt) {
        throw new Error('Base-context task prompt rendering returned no system or generation prompt.');
    }
    return { systemPrompt: rendered.systemPrompt, generationPrompt: rendered.generationPrompt, usesBaseContext: true };
}

module.exports = { wrapTaskInBaseContext };
