const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');
const axios = require('axios');
const ComfyUIClient = require('../ComfyUIClient.js');
const LLMClient = require('../LLMClient.js');

const root = path.resolve(__dirname, '..');

test('AI model unload during image generation defaults to false', () => {
    const config = load(fs.readFileSync(path.join(root, 'config.default.yaml'), 'utf8'));
    assert.equal(config.ai.unload_during_image_generation, false);
    assert.equal(config.ai.terminate_during_image_generation, false);
    assert.equal(config.ai.local_startup_script_path, null);
});

test('AI model unload setting rejects non-boolean values', () => {
    const errors = LLMClient.getConfigurationErrors({
        backend: 'openai_compatible',
        endpoint: 'http://router.example:8080/v1',
        apiKey: 'test-key',
        model: 'test-model',
        unload_during_image_generation: 'yes'
    });
    assert.match(errors.join('\n'), /unload_during_image_generation must be a boolean/i);
});

test('System Configuration exposes an explicit true/false AI unload checkbox', () => {
    const source = fs.readFileSync(path.join(root, 'views', 'config.njk'), 'utf8');
    assert.match(
        source,
        /name="ai\.unload_during_image_generation::boolean"[\s\S]*?value="false"/
    );
    assert.match(
        source,
        /id="ai-unload-during-image-generation"[\s\S]*?name="ai\.unload_during_image_generation::boolean"[\s\S]*?value="true"/
    );
    assert.match(
        source,
        /id="ai-terminate-during-image-generation"[\s\S]*?name="ai\.terminate_during_image_generation::boolean"[\s\S]*?value="true"/
    );
    assert.match(source, /name="ai\.local_startup_script_path::string"/);
});

test('AI model terminate setting requires a startup script and cannot combine with router unload', () => {
    const missingScriptErrors = LLMClient.getConfigurationErrors({
        backend: 'openai_compatible',
        endpoint: 'http://localhost:5005/v1',
        apiKey: 'test-key',
        model: 'test-model',
        terminate_during_image_generation: true
    });
    assert.match(missingScriptErrors.join('\n'), /local_startup_script_path is required/i);

    const conflictingErrors = LLMClient.getConfigurationErrors({
        backend: 'openai_compatible',
        endpoint: 'http://localhost:5005/v1',
        apiKey: 'test-key',
        model: 'test-model',
        unload_during_image_generation: true,
        terminate_during_image_generation: true,
        local_startup_script_path: '/tmp/start-llama.sh'
    });
    assert.match(conflictingErrors.join('\n'), /cannot both be true/i);
});

test('server initializes ComfyUI for cache-preserving pre-prompt cleanup even when rendering is disabled', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

    assert.match(source, /function isComfyModelCleanupModeConfigured\(configuration = config\)/);
    assert.match(source, /const promptCleanupEnabled = isComfyModelCleanupModeConfigured\(config\)/);
    assert.match(source, /if \(!imageGenerationEnabled && !promptCleanupEnabled\)/);
    assert.match(source, /LLMClient\.setComfyModelCleanupHandler\(async \(\{ metadataLabel, signal \}\) =>/);
    assert.match(source, /await comfyUIClient\.releaseVram\(\{ signal \}\)/);
    assert.doesNotMatch(source, /comfyUIClient\.unloadModels\(\)/);
    assert.match(source, /configureComfyModelCleanupBeforePrompts\(\)/);
});

test('all image job producers use the coordinated enqueue helper', () => {
    const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
    const directServerPushes = serverSource.match(/jobQueue\.push\(jobId\)/g) || [];

    assert.equal(directServerPushes.length, 1, 'only enqueueImageJob may push directly to jobQueue');
    assert.doesNotMatch(apiSource, /jobQueue\.push\(jobId\)/);
    assert.match(apiSource, /const job = createImageJob\(jobId, payload\);\s*enqueueImageJob\(jobId\);/);
    assert.match(
        serverSource,
        /imageGenerationModelLifecycle\.run\(\{\s*mode: lifecycleMode,\s*renderBatch: drainImageJobQueue/
    );
});

test('server initializes the managed local llama process only after ComfyUI and preserves cleanup ordering', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(source, /await initializeImageEngine\(\)[\s\S]*?await initializeManagedLocalLlamaServer\(\)/);
    assert.match(
        source,
        /beforeStart: async \(\) => \{[\s\S]*?clearComfyVramForManagedLocalLlamaStartup\(\)[\s\S]*?waitUntilReady: readiness => waitForManagedLlamaServerReady/
    );
    assert.match(source, /await comfyUIClient\.releaseVram\(\)/);
    assert.doesNotMatch(source, /comfyUIClient\.unloadModels\(\)/);
    assert.match(source, /'comfy_cache_monitor_fallback'/);
    assert.match(source, /configureManagedLocalModelStartupBeforePrompts\(\)/);
    assert.match(source, /localLlamaServerProcess\.switchStartupScriptPath/);
    assert.match(source, /resolveManagedLocalLlamaStartupScriptCandidates\(config\)/);
});

test('a configured local startup script activates managed process startup independently of image handoff flags', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const resolverSource = source.slice(
        source.indexOf('function resolveInitialManagedLocalLlamaAiConfig'),
        source.indexOf('function resolveManagedLocalLlamaStartupScriptCandidates')
    );
    const initializerSource = source.slice(
        source.indexOf('async function initializeManagedLocalLlamaServer'),
        source.indexOf('function enqueueImageJob')
    );

    assert.match(
        resolverSource,
        /resolveImageGenerationModelLifecycleMode\(configuration\) === 'terminate'/
    );
    assert.match(resolverSource, /return configuredPath \? aiConfig : null/);
    assert.doesNotMatch(
        initializerSource,
        /resolveImageGenerationModelLifecycleMode\(\) !== 'terminate'/
    );
    assert.match(initializerSource, /const aiConfig = resolveInitialManagedLocalLlamaAiConfig\(\)/);
    assert.match(
        initializerSource,
        /startupScriptPath: resolveLocalLlamaStartupScriptPathFromAiConfig\(aiConfig\)/
    );
    assert.match(
        initializerSource,
        /if \(resolveImageGenerationModelLifecycleMode\(\) !== 'none'\)[\s\S]*?clearComfyVramForManagedLocalLlamaStartup/
    );
});

test('managed local llama startup continues when ComfyUI is unreachable but still fails for reachable cleanup errors', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(source, /function isComfyUiUnavailableError\(error\)/);
    assert.match(source, /ECONNREFUSED\|ECONNRESET\|ENOTFOUND\|EHOSTUNREACH\|ENETUNREACH\|ETIMEDOUT/);
    assert.match(
        source,
        /async function clearComfyVramForManagedLocalLlamaStartup[\s\S]*?if \(!isComfyUiUnavailableError\(error\)\) \{[\s\S]*?throw error;[\s\S]*?continuing because there are no reachable ComfyUI models to release/
    );
});

test('ComfyUI releaseVram uses Cache Monitor without calling the standard free endpoint', { concurrency: false }, async () => {
    const originalPost = axios.post;
    let captured = null;
    axios.post = async (url, payload, options) => {
        captured = { url, payload, options };
        return { data: { released: true, released_bytes: 4096 } };
    };

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        });
        const result = await client.releaseVram();
        assert.equal(result.success, true);
        assert.equal(result.fallbackUsed, false);
        assert.equal(captured.url, 'http://comfy.example:8188/comfyui-cache-monitor/release_vram');
        assert.deepEqual(captured.payload, {});
        assert.equal(result.data.released_bytes, 4096);
    } finally {
        axios.post = originalPost;
    }
});

test('ComfyUI releaseVram falls back to full cleanup when Cache Monitor is unavailable', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const captured = [];
    axios.post = async (url, payload, options) => {
        captured.push({ url, payload, options });
        if (url.endsWith('/comfyui-cache-monitor/release_vram')) {
            throw new Error('Request failed with status code 404');
        }
        return { data: { fallback: 'complete' } };
    };

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        });
        const result = await client.releaseVram();
        assert.equal(result.success, true);
        assert.equal(result.fallbackUsed, true);
        assert.match(result.cacheMonitorError, /status code 404/);
        assert.deepEqual(captured.map(call => ({ url: call.url, payload: call.payload })), [
            {
                url: 'http://comfy.example:8188/comfyui-cache-monitor/release_vram',
                payload: {}
            },
            {
                url: 'http://comfy.example:8188/free',
                payload: {
                    unload_models: true,
                    free_memory: true
                }
            }
        ]);
    } finally {
        axios.post = originalPost;
    }
});

test('ComfyUI releaseVram cancellation aborts immediately without invoking the full-cleanup fallback', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const calls = [];
    const controller = new AbortController();
    axios.post = async (url, payload, options = {}) => {
        calls.push({ url, payload });
        return await new Promise((resolve, reject) => {
            const onAbort = () => reject(options.signal?.reason || new Error('cancelled'));
            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });
        });
    };

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        });
        const releasePromise = client.releaseVram({ signal: controller.signal });
        controller.abort(new Error('Stop & Undo requested.'));

        await assert.rejects(
            releasePromise,
            error => {
                assert.equal(error.name, 'AbortError');
                assert.match(error.message, /Stop & Undo requested/);
                return true;
            }
        );
        assert.deepEqual(calls.map(call => call.url), [
            'http://comfy.example:8188/comfyui-cache-monitor/release_vram'
        ]);
    } finally {
        axios.post = originalPost;
    }
});
