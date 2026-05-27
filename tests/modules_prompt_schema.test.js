const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('registered Thing field descriptions can include active module slot-type options', () => {
    const registrySource = read('ModExtensionRegistry.js');
    const chatToolSource = read('chat_tool_calls.js');
    const serverSource = read('server.js');

    assert.match(registrySource, /descriptionProvider/);
    assert.match(registrySource, /xmlPromptPlaceholderProvider/);
    assert.match(chatToolSource, /descriptionContext/);
    assert.match(chatToolSource, /getActiveSettingSnapshot/);
    assert.match(serverSource, /descriptionContext/);
    assert.match(serverSource, /getThingGeneratorPromptFields/);
});

test('modules mod field descriptions mention the configured slot type options', () => {
    const source = read('mods/modules/mod.js');

    assert.match(source, /buildSlotTypeOptionsText/);
    assert.match(source, /moduleSlots/);
    assert.match(source, /moduleType/);
    assert.match(source, /Only equippable items may have module slots/);
    assert.match(source, /Configured module slot types/);
});

test('attack handling applies base item and installed module target effects', () => {
    const source = read('api.js');

    assert.match(source, /const weaponEffects = \(\(\) =>/);
    assert.match(source, /weaponThing\.causeStatusEffectOnTarget/);
    assert.match(source, /collectThingTargetStatusEffectContributions/);
    assert.match(source, /for \(const weaponEffect of weaponEffects\)/);
    assert.match(source, /appliedStatusEffects/);
});
