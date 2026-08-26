const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { ImageWorkflowPresetStore } = require('../ImageWorkflowPresetStore.js');

const root = path.join(__dirname, '..');

function createStore(t, initialPresets = null) {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, 'tmp', 'image-workflow-presets-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'image-workflow-presets.yaml');
    if (initialPresets) {
        fs.writeFileSync(filePath, yaml.dump(initialPresets), 'utf8');
    }
    return { store: new ImageWorkflowPresetStore(filePath), filePath, directory };
}

test('shared preset store starts empty when its standalone YAML does not exist', async t => {
    const { store } = createStore(t);
    assert.deepEqual(await store.load(), { generation: {}, edit: {} });
});

test('shared preset store saves and reloads generation presets independently of game config', async t => {
    const { store, filePath } = createStore(t);
    const result = await store.savePreset({
        mode: 'generation',
        name: 'Krea 2',
        settings: {
            family: 'krea2',
            custom_template: '',
            model: 'krea.safetensors',
            resolutions: { location: { width: 1920, height: 1080 } }
        }
    });

    assert.equal(result.filePath, filePath);
    assert.equal(result.presets.generation['Krea 2'].family, 'krea2');
    assert.deepEqual(await store.load(), result.presets);
});

test('shared preset store protects names and strips edit resolutions', async t => {
    const { store } = createStore(t, {
        generation: {},
        edit: {
            Existing: { family: 'qwen' }
        }
    });

    await assert.rejects(
        store.savePreset({ mode: 'edit', name: 'Existing', settings: { family: 'flux_klein' } }),
        error => error.code === 'PRESET_EXISTS'
    );
    const result = await store.savePreset({
        mode: 'edit',
        name: 'Existing',
        overwrite: true,
        settings: {
            family: 'flux_klein',
            resolutions: { location: { width: 1024, height: 1024 } }
        }
    });
    assert.equal(result.presets.edit.Existing.family, 'flux_klein');
    assert.equal(Object.hasOwn(result.presets.edit.Existing, 'resolutions'), false);
});
