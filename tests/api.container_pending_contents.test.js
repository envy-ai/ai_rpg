const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const {
    validateGeneratedContainerContentsAgainstSeeds
} = require('../ContainerContentsGeneration.js');

test('container inventory routes generate pending container contents before serializing payloads', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');

    assert.match(source, /async function ensureContainerContentsGenerated\(container, \{ location = null \} = \{\}\)/);
    assert.match(source, /await ensureContainerContentsGenerated\(container, \{ location \}\)/);
    assert.match(source, /app\.get\('\/api\/things\/:id\/container', async \(req, res\) =>/);
    assert.match(source, /app\.get\('\/api\/player', async \(req, res\) =>/);
    assert.match(source, /await ensurePendingContainerContentsForThings\(currentPlayer\.getInventoryItems\(\)\)/);
    assert.match(source, /const containerContentsGenerationPromises = new WeakMap\(\)/);
    assert.match(source, /containerContentsGenerationPromises\.get\(container\)/);
    assert.match(source, /containerContentsGenerationPromises\.set\(container, generationPromise\)/);
    assert.match(source, /containerContentsGenerationPromises\.delete\(container\)/);
});

test('container contents generator uses the dedicated contents prompt and clears pending seeds after success', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateContainerContentsForThing');
    const end = source.indexOf('\nfunction buildThingPromptItem', start);
    assert.notEqual(start, -1, 'Could not locate generateContainerContentsForThing');
    assert.notEqual(end, -1, 'Could not locate function after generateContainerContentsForThing');

    const functionSource = source.slice(start, end);
    assert.match(functionSource, /promptType:\s*'thing-generator-contents'/);
    assert.match(functionSource, /runGenerationPromptCompletion/);
    assert.match(functionSource, /parseThingsXml/);
    assert.match(functionSource, /validateXMLStrict:\s*true/);
    assert.match(functionSource, /requiredRegex:\s*\/<items/);
    assert.match(functionSource, /strictXml:\s*true/);
    assert.match(functionSource, /withRetry\(async \(\) =>/);
    assert.match(functionSource, /validateGeneratedContainerContentsAgainstSeeds\(parsed, pendingContents/);
    assert.match(functionSource, /resolveConfiguredPromptMaxAttempts\(config\?\.ai/);
    assert.match(functionSource, /thing_generator_contents_validation_failure/);
    assert.match(functionSource, /container\.addInventoryItem\(thing\)/);
    assert.match(functionSource, /container\.clearContainerContents\(\)/);
    assert.match(functionSource, /LLMClient\.logPrompt/);
});

test('container contents validation accepts the exact seed names and counts in any order', () => {
    const result = validateGeneratedContainerContentsAgainstSeeds([
        { name: 'Copper Key', count: 1 },
        { name: 'Travel Biscuit', count: 3 }
    ], [
        { name: 'Travel Biscuit', count: 3 },
        { name: 'Copper Key', count: 1 }
    ], { containerName: 'Canvas Satchel' });

    assert.deepEqual(result, [
        { name: 'Copper Key', count: 1 },
        { name: 'Travel Biscuit', count: 3 }
    ]);
});

test('container contents validation rejects substituted items and changed counts', () => {
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: 'Canvas Satchel', count: 1 }],
            [{ name: 'Copper Key', count: 1 }],
            { containerName: 'Canvas Satchel' }
        ),
        /did not preserve the exact pending names and counts.*Copper Key.*Canvas Satchel/
    );
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: 'Copper Key', count: 2 }],
            [{ name: 'Copper Key', count: 1 }],
            { containerName: 'Canvas Satchel' }
        ),
        /did not preserve the exact pending names and counts/
    );
});
