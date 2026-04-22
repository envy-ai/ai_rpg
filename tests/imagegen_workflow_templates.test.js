const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');

function renderImagegenWorkflow(templateName, imageOverrides = {}) {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(['imagegen']),
        { autoescape: false }
    );
    env.addFilter('json', value => JSON.stringify(String(value)).slice(1, -1));
    const image = {
        prompt: 'Shift the scene to a rainy midnight atmosphere.',
        negativePrompt: '',
        sourceFilename: 'airpg-location-variants/source.png',
        width: 768,
        height: 512,
        steps: 4,
        seed: 12345,
        denoise: 0.45,
        cfg: 6,
        sampler: 'euler',
        scheduler: 'simple',
        ...imageOverrides
    };
    return JSON.parse(env.render(templateName, { image }));
}

function findWorkflowNode(workflow, predicate) {
    return Object.entries(workflow)
        .map(([id, node]) => ({ id, node }))
        .find(({ node }) => predicate(node)) || null;
}

test('flux2 edit workflow prints the rendered image prompt to the ComfyUI console', () => {
    const workflow = renderImagegenWorkflow('flux2_klein_edit.json.njk');

    const promptTextNode = findWorkflowNode(workflow, node =>
        node.class_type === 'Text Multiline'
        && node.inputs?.text === 'Shift the scene to a rainy midnight atmosphere.'
    );
    assert.ok(promptTextNode, 'expected a Text Multiline node containing the rendered prompt');

    const consoleNode = findWorkflowNode(workflow, node =>
        node.class_type === 'Text to Console'
        && node.inputs?.label === 'Final Prompt'
    );
    assert.ok(consoleNode, 'expected a Text to Console node labeled Final Prompt');
    assert.deepEqual(consoleNode.node.inputs.text, [promptTextNode.id, 0]);

    const showNode = findWorkflowNode(workflow, node =>
        node.class_type === 'easy showAnything'
    );
    assert.ok(showNode, 'expected an easy showAnything node to force console output execution');
    assert.deepEqual(showNode.node.inputs.anything, [consoleNode.id, 0]);

    const positivePromptNode = findWorkflowNode(workflow, node =>
        node.class_type === 'CLIPTextEncode'
        && node._meta?.title === 'CLIP Text Encode (Positive Prompt)'
    );
    assert.ok(positivePromptNode, 'expected the positive CLIPTextEncode node');
    assert.deepEqual(positivePromptNode.node.inputs.text, [promptTextNode.id, 0]);
});
