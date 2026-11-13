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

test('shared item prompts and named schemas explain charge, duration and module-slot rules', () => {
    const nunjucks = require('nunjucks');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(rootDir, 'prompts')), { autoescape: false });
    const shared = env.render('_includes/item.njk', {
        thingSeed: {}, equipmentSlots: [], rarityDefinitions: [], thingGeneratorPromptFields: [],
        allowHiddenDiscovery: false, attributes: [], skills: [], needBars: []
    });
    assert.match(shared, /(?:numeric|number)[\s\S]{0,160}N\/A|N\/A[\s\S]{0,160}(?:numeric|number)/i);
    assert.match(shared, /continuous[\s\S]{0,160}ammoType|ammoType[\s\S]{0,160}continuous/i);
    assert.match(shared, /duration[\s\S]{0,250}(?:minute|permanent)/i);
    const seeded = env.render('_includes/item.njk', { thingSeed: {
        causeStatusEffectOnTarget: { name: 'Flash', description: 'A flash.', duration: 0 },
        causeStatusEffectOnEquipper: { name: 'Glow', description: 'A glow.', duration: 0 }
    }, equipmentSlots: [], rarityDefinitions: [], thingGeneratorPromptFields: [], allowHiddenDiscovery: false, attributes: [], skills: [], needBars: [] });
    assert.equal((seeded.match(/<duration>0<\/duration>/g) || []).length, 2);

    for (const template of ['thing-generator-single.njk', 'thing-generator-contents.njk', 'item-family.njk', 'location-generator-things.njk']) {
        assert.match(read(`prompts/_includes/${template}`), /include "_includes\/item\.njk"/, `${template} uses the shared full-item guidance`);
    }
    const schema = read('schemas/xml/item.schema.xml');
    assert.match(schema, /continuous[\s\S]{0,300}ammoType|ammoType[\s\S]{0,300}continuous/i);
    assert.match(schema, /(?:numeric|number)/i);
    const moduleSchema = read('mods/modules/schemas/xml/item-fields.schema.xml');
    assert.match(moduleSchema, /equip/i);
    const effectSchema = read('schemas/xml/target-effect.schema.xml');
    assert.match(effectSchema, /duration[\s\S]{0,200}(?:minute|permanent)/i);
});
