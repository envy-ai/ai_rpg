const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('container inventory routes generate pending container contents before serializing payloads', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');

    assert.match(source, /async function ensureContainerContentsGenerated\(container, \{ location = null \} = \{\}\)/);
    assert.match(source, /await ensureContainerContentsGenerated\(container, \{ location \}\)/);
    assert.match(source, /app\.get\('\/api\/things\/:id\/container', async \(req, res\) =>/);
    assert.match(source, /app\.get\('\/api\/player', async \(req, res\) =>/);
    assert.match(source, /await ensurePendingContainerContentsForThings\(currentPlayer\.getInventoryItems\(\)\)/);
});

test('container contents generator uses the dedicated contents prompt and clears pending seeds after success', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateContainerContentsForThing');
    const end = source.indexOf('\nfunction buildThingPromptItem', start);
    assert.notEqual(start, -1, 'Could not locate generateContainerContentsForThing');
    assert.notEqual(end, -1, 'Could not locate function after generateContainerContentsForThing');

    const functionSource = source.slice(start, end);
    assert.match(functionSource, /promptType:\s*'thing-generator-contents'/);
    assert.match(functionSource, /LLMClient\.chatCompletion/);
    assert.match(functionSource, /parseThingsXml/);
    assert.match(functionSource, /container\.addInventoryItem\(thing\)/);
    assert.match(functionSource, /container\.clearContainerContents\(\)/);
    assert.match(functionSource, /LLMClient\.logPrompt/);
});
