const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

function renderImagegenWorkflow(templateName, imageOverrides = {}, configOverrides = {}) {
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
    const templateConfig = {
        ...configOverrides,
        imagegen: {
            lora: 'foo.safetensors',
            ...(configOverrides.imagegen || {})
        }
    };
    return JSON.parse(env.render(templateName, { image, config: templateConfig }));
}

function findWorkflowNode(workflow, predicate) {
    return Object.entries(workflow)
        .map(([id, node]) => ({ id, node }))
        .find(({ node }) => predicate(node)) || null;
}

function listImagegenWorkflowFiles() {
    const imagegenDir = path.join(__dirname, '..', 'imagegen');
    return fs.readdirSync(imagegenDir)
        .filter(name => name.endsWith('.json') || name.endsWith('.json.njk'))
        .map(name => ({
            name,
            source: fs.readFileSync(path.join(imagegenDir, name), 'utf8')
        }));
}

test('imagegen workflows use vanilla primitive text input nodes instead of custom Text Multiline', () => {
    const offenders = listImagegenWorkflowFiles()
        .filter(({ source }) => {
            return source.includes('"class_type": "Text Multiline"');
        })
        .map(({ name }) => name);

    assert.deepEqual(offenders, []);
});

test('imagegen workflows use Crystools display nodes instead of custom Text to Console', () => {
    const offenders = listImagegenWorkflowFiles()
        .filter(({ source }) => source.includes('"class_type": "Text to Console"'))
        .map(({ name }) => name);

    assert.deepEqual(offenders, []);
});

test('flux2 edit workflow prints the rendered image prompt to the ComfyUI console', () => {
    const workflow = renderImagegenWorkflow('flux2_klein_edit.json.njk');

    const promptTextNode = findWorkflowNode(workflow, node =>
        node.class_type === 'PrimitiveStringMultiline'
        && node.inputs?.value === 'Shift the scene to a rainy midnight atmosphere.'
    );
    assert.ok(promptTextNode, 'expected a vanilla Input Text node containing the rendered prompt');

    const consoleNode = findWorkflowNode(workflow, node =>
        node.class_type === 'Show any [Crystools]'
        && node._meta?.title === '🪛 Show any value to console/display'
    );
    assert.ok(consoleNode, 'expected a Crystools Show any output node');
    assert.deepEqual(consoleNode.node.inputs.any_value, [promptTextNode.id, 0]);
    assert.equal(consoleNode.node.inputs.console, true);
    assert.equal(consoleNode.node.inputs.display, true);
    assert.equal(consoleNode.node.inputs.prefix, 'Final Prompt');

    const positivePromptNode = findWorkflowNode(workflow, node =>
        node.class_type === 'CLIPTextEncode'
        && node._meta?.title === 'CLIP Text Encode (Positive Prompt)'
    );
    assert.ok(positivePromptNode, 'expected the positive CLIPTextEncode node');
    assert.deepEqual(positivePromptNode.node.inputs.text, [promptTextNode.id, 0]);
});

test('krea2 workflows use VAE Utils decoder with the Wan x2 VAE and print the prompt', () => {
    for (const templateName of [
        'test_krea_2_simplified.json.njk',
        'test_krea_2_simplified_illustria.json.njk'
    ]) {
        const workflow = renderImagegenWorkflow(templateName);

        const promptTextNode = findWorkflowNode(workflow, node =>
            node.class_type === 'PrimitiveStringMultiline'
            && node.inputs?.value === 'Shift the scene to a rainy midnight atmosphere.'
        );
        assert.ok(promptTextNode, `${templateName} should store the rendered prompt in a vanilla Input Text node`);

        const consoleNode = findWorkflowNode(workflow, node =>
            node.class_type === 'Show any [Crystools]'
            && node._meta?.title === '🪛 Show any value to console/display'
        );
        assert.ok(consoleNode, `${templateName} should print/display the rendered prompt through Crystools`);
        assert.deepEqual(consoleNode.node.inputs.any_value, [promptTextNode.id, 0]);
        assert.equal(consoleNode.node.inputs.console, true);
        assert.equal(consoleNode.node.inputs.display, true);
        assert.equal(consoleNode.node.inputs.prefix, 'Final Prompt');

        const positivePromptNode = findWorkflowNode(workflow, node =>
            node.class_type === 'CLIPTextEncode'
            && node._meta?.title === 'CLIP Text Encode (Prompt)'
        );
        assert.ok(positivePromptNode, `${templateName} should have a positive prompt encoder`);
        assert.deepEqual(positivePromptNode.node.inputs.text, [promptTextNode.id, 0]);

        const vaeLoader = findWorkflowNode(workflow, node =>
            node.class_type === 'VAEUtils_CustomVAELoader'
        );
        assert.ok(vaeLoader, `${templateName} should load the VAE through VAE Utils`);
        assert.equal(
            vaeLoader.node.inputs.vae_name,
            'Wan2.1_VAE_upscale2x_imageonly_real_v1.safetensors'
        );
        assert.equal(vaeLoader.node.inputs.disable_offload, false);

        const vaeDecode = findWorkflowNode(workflow, node =>
            node.class_type === 'VAEUtils_VAEDecodeTiled'
        );
        assert.ok(vaeDecode, `${templateName} should decode latents through VAE Utils`);
        assert.deepEqual(vaeDecode.node.inputs.samples, ['17', 0]);
        assert.deepEqual(vaeDecode.node.inputs.vae, [vaeLoader.id, 0]);
        assert.equal(vaeDecode.node.inputs.upscale, -1);
        assert.equal(vaeDecode.node.inputs.tile, false);
        assert.equal(vaeDecode.node.inputs.tile_size, 512);
        assert.equal(vaeDecode.node.inputs.overlap, 64);
        assert.equal(vaeDecode.node.inputs.temporal_size, 4096);
        assert.equal(vaeDecode.node.inputs.temporal_overlap, 64);

        const halfScale = findWorkflowNode(workflow, node =>
            node.class_type === 'ImageScaleBy'
            && node.inputs?.upscale_method === 'area'
            && node.inputs?.scale_by === 0.5
        );
        assert.ok(halfScale, `${templateName} should scale the decoded image down by half with area sampling`);
        assert.deepEqual(halfScale.node.inputs.image, [vaeDecode.id, 0]);

        const saveNode = findWorkflowNode(workflow, node =>
            node.class_type === 'SaveImageWithMetaData'
        );
        assert.ok(saveNode, `${templateName} should save the scaled output image`);
        assert.deepEqual(saveNode.node.inputs.images, [halfScale.id, 0]);
    }
});

test('krea2 any-lora workflow chains configured and realism LoRAs before sampling', () => {
    const workflow = renderImagegenWorkflow('test_krea_2_any_lora.json.njk');

    const baseLora = workflow['8'];
    assert.ok(baseLora, 'expected existing Krea 2 LoRA node 8');
    assert.equal(baseLora.class_type, 'LoraLoaderModelOnly');
    assert.equal(baseLora.inputs.lora_name, 'krea2/foo.safetensors');

    const realismLora = findWorkflowNode(workflow, node =>
        node.class_type === 'LoraLoaderModelOnly'
        && node.inputs?.lora_name === 'krea2/realism_engine_krea2_v2.safetensors'
    );
    assert.ok(realismLora, 'expected a second LoRA loader for realism_engine_krea2_v2.safetensors');
    assert.equal(realismLora.node.inputs.strength_model, 1);
    assert.deepEqual(realismLora.node.inputs.model, ['8', 0]);

    const sampler = workflow['17'];
    assert.ok(sampler, 'expected KSampler node 17');
    assert.deepEqual(sampler.inputs.model, [realismLora.id, 0]);
});

test('krea2 any-lora workflow reads first LoRA name from config.imagegen.lora', () => {
    const workflow = renderImagegenWorkflow(
        'test_krea_2_any_lora.json.njk',
        {},
        { imagegen: { lora: 'configured-lora.safetensors' } }
    );

    const configuredLora = findWorkflowNode(workflow, node =>
        node.class_type === 'LoraLoaderModelOnly'
        && node.inputs?.lora_name === 'krea2/configured-lora.safetensors'
    );
    assert.ok(configuredLora, 'expected the first LoRA loader to use config.imagegen.lora');
    assert.deepEqual(configuredLora.node.inputs.model, ['4', 0]);
});

test('server passes config into imagegen workflow template variables', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const templateVarsStart = source.indexOf('const templateVars = {');
    const templateVarsEnd = source.indexOf('\n    const engine =', templateVarsStart);
    assert.notEqual(templateVarsStart, -1, 'expected processImageGeneration to define templateVars');
    assert.notEqual(templateVarsEnd, -1, 'expected templateVars to end before engine resolution');

    const templateVarsSource = source.slice(templateVarsStart, templateVarsEnd);
    assert.match(
        templateVarsSource,
        /\bconfig\s*:\s*config\b/,
        'expected full runtime config to be included in imagegen templateVars'
    );
    assert.match(
        source,
        /imagePromptEnv\.render\(workflowTemplate,\s*templateVars\)/,
        'expected imagegen workflow rendering to use templateVars'
    );
});
