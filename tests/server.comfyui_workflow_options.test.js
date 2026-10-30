const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorkflowOptionsHandler(objectInfo) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf("app.get('/api/comfyui/workflow-options', async (_req, res) => {");
    const end = source.indexOf("\napp.get('/api/image-workflow-presets'", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate ComfyUI workflow options route in server.js');
    }

    let handler;
    const context = {
        __dirname: path.resolve(__dirname, '..'),
        fs,
        path,
        comfyUIClient: { getObjectInfo: async () => objectInfo },
        app: {
            get(route, callback) {
                if (route === '/api/comfyui/workflow-options') handler = callback;
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    if (typeof handler !== 'function') {
        throw new Error('Unable to capture ComfyUI workflow options handler');
    }
    return handler;
}

test('workflow options expose deduplicated, sorted sampler and scheduler values from supported nodes', async () => {
    const options = {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['z-model.safetensors', 'a-model.safetensors']] } } },
        KSampler: { input: { required: {
            sampler_name: [['euler', 'dpmpp_2m', 'euler']],
            scheduler: [['normal', 'simple']]
        } } },
        KSamplerAdvanced: { input: { required: {
            sampler_name: [['dpmpp_2m', 'heun']],
            scheduler: [['karras', 'normal']]
        } } },
        KSamplerSelect: { input: { required: { sampler_name: ['COMBO', { options: ['heun', 'lms'] }] } } },
        BasicScheduler: { input: { required: { scheduler: ['COMBO', { options: ['beta', 'karras'] }] } } },
        CLIPLoader: { input: { required: {
            clip_name: [['encoder.safetensors']],
            type: [['stable_diffusion', 'qwen_image']]
        } } },
        CLIPLoaderGGUF: { input: { required: { type: ['COMBO', { options: ['flux', 'qwen_image'] }] } } },
        DualCLIPLoader: { input: { required: { type: [['sdxl', 'flux']] } } },
        DualCLIPLoaderGGUF: { input: { required: { type: ['COMBO', { options: ['qwen_image', 'sdxl'] }] } } },
        VAELoader: { input: { required: { vae_name: [['vae.safetensors']] } } },
        LoraLoader: { input: { required: { lora_name: [['style.safetensors']] } } }
    };
    const handler = loadWorkflowOptionsHandler(options);
    let body;
    const response = {
        json(value) { body = value; },
        status(code) { this.statusCode = code; return this; }
    };

    await handler({}, response);

    assert.deepEqual(JSON.parse(JSON.stringify(body)), {
        model: ['a-model.safetensors', 'z-model.safetensors'],
        text_encoder: ['encoder.safetensors'],
        text_encoder_type: ['flux', 'qwen_image', 'sdxl', 'stable_diffusion'],
        vae: ['vae.safetensors'],
        loras: ['style.safetensors'],
        sampler: ['dpmpp_2m', 'euler', 'heun', 'lms'],
        scheduler: ['beta', 'karras', 'normal', 'simple'],
        workflows: fs.readdirSync(path.join(__dirname, '..', 'imagegen')).filter(name => name.endsWith('.json.njk')).sort((a, b) => a.localeCompare(b))
    });
});
