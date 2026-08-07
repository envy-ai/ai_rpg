const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LLMClient = require('../LLMClient.js');
const LlamaCppRouterClient = require('../LlamaCppRouterClient.js');

function cachePath(directory, model) {
    return path.join(directory, LlamaCppRouterClient.buildSlotCacheFilename(model));
}

function buildConfig(directory) {
    return {
        router_preload_model: 'preload-model',
        ai: {
            endpoint: 'http://127.0.0.1:5005/v1/',
            model: 'base-model',
            local_startup_script_path: './scripts/start-router.sh',
            router_slot_cache_directory: directory
        },
        ai_model_overrides: {
            alternate: {
                prompts: ['alternate_prompt'],
                model: 'alternate-model'
            },
            remote: {
                prompts: ['remote_prompt'],
                model: 'remote-model',
                local_startup_script_path: ''
            }
        }
    };
}

test('router context-cache discovery includes exact local configured models only', () => {
    const directory = path.join(os.tmpdir(), 'ai-rpg-router-cache-discovery');
    const paths = LLMClient.resolveRouterContextCachePaths(buildConfig(directory));

    assert.deepEqual(paths, [
        cachePath(directory, 'alternate-model'),
        cachePath(directory, 'base-model'),
        cachePath(directory, 'preload-model')
    ].sort());
    assert.equal(paths.includes(cachePath(directory, 'remote-model')), false);
});

test('async termination cleanup deletes configured caches without touching unrelated files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-router-cache-async-'));
    const config = buildConfig(directory);
    const expectedPaths = LLMClient.resolveRouterContextCachePaths(config);
    const unrelatedPath = path.join(directory, 'another-program-cache.bin');
    const messages = [];

    try {
        for (const filePath of expectedPaths) {
            fs.writeFileSync(filePath, 'cache');
        }
        fs.writeFileSync(unrelatedPath, 'unrelated');

        const result = await LLMClient.deleteRouterContextCacheFiles({
            configOverride: config,
            logger: { log: message => messages.push(message) }
        });

        assert.deepEqual(result.deleted.sort(), expectedPaths);
        assert.equal(expectedPaths.every(filePath => !fs.existsSync(filePath)), true);
        assert.equal(fs.existsSync(unrelatedPath), true);
        assert.equal(messages.length, expectedPaths.length);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        LLMClient.resetModelSwitchTracking();
    }
});

test('synchronous process-exit fallback deletes configured caches', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-router-cache-sync-'));
    const config = buildConfig(directory);
    const expectedPaths = LLMClient.resolveRouterContextCachePaths(config);

    try {
        for (const filePath of expectedPaths) {
            fs.writeFileSync(filePath, 'cache');
        }

        const result = LLMClient.deleteRouterContextCacheFilesSync({
            configOverride: config,
            logger: { log: () => {} }
        });

        assert.deepEqual(result.deleted.sort(), expectedPaths);
        assert.equal(expectedPaths.every(filePath => !fs.existsSync(filePath)), true);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        LLMClient.resetModelSwitchTracking();
    }
});

test('termination cleanup reports deletion failures after attempting every cache', async () => {
    const directory = path.join(os.tmpdir(), 'ai-rpg-router-cache-errors');
    const config = buildConfig(directory);
    const attempted = [];

    await assert.rejects(
        () => LLMClient.deleteRouterContextCacheFiles({
            configOverride: config,
            fileSystem: {
                promises: {
                    unlink: async filePath => {
                        attempted.push(filePath);
                        const error = new Error('permission denied');
                        error.code = 'EACCES';
                        throw error;
                    }
                }
            },
            logger: { log: () => {} }
        }),
        error => {
            assert.equal(error instanceof AggregateError, true);
            assert.match(error.message, /one or more llama\.cpp context cache files/i);
            return true;
        }
    );
    assert.equal(attempted.length, 3);
    LLMClient.resetModelSwitchTracking();
});
