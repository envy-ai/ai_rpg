const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');

const mod = require('../mods/nsfw-boost/mod.js');
const interestingInstruction = 'Be interesting and random. DO NOT go with the obvious choice for their class, race, or personality.';
const contraryInstruction = 'Pick traits that are contrary to their outward personality.';

function getPromptFieldForRandomValue(randomValue) {
    const originalRandom = Math.random;
    try {
        Math.random = () => randomValue;
        const registry = new ModExtensionRegistry();
        mod.register({
            modDir: path.join(process.cwd(), 'mods', 'nsfw-boost'),
            registerEntityField: field => registry.registerEntityField({ ...field, modName: 'nsfw-boost' }),
            registerBaseContextContributor() {},
            registerSceneSummarizeContributor() {},
            registerPlayerActionPromptStep() {}
        });
        return registry.getEntityField('player', 'sexualTraits');
    } finally {
        Math.random = originalRandom;
    }
}

test('nsfw-boost sexual-traits description appends neither rare instruction on d6 rolls 1-4', () => {
    for (const randomValue of [0, 0.2, 0.4, 0.6]) {
        const field = getPromptFieldForRandomValue(randomValue);
        assert.equal(field.description.includes(interestingInstruction), false);
        assert.equal(field.description.includes(contraryInstruction), false);
        assert.equal(field.xmlPrompt.placeholder, field.description);
    }
});

test('nsfw-boost sexual-traits description appends only the interesting instruction on a d6 roll of 5', () => {
    const field = getPromptFieldForRandomValue(4 / 6);
    assert.equal(field.description.includes(interestingInstruction), true);
    assert.equal(field.description.includes(contraryInstruction), false);
    assert.equal(field.xmlPrompt.placeholder, field.description);
});

test('nsfw-boost sexual-traits description appends only the contrary instruction on a d6 roll of 6', () => {
    const field = getPromptFieldForRandomValue(0.999999);
    assert.equal(field.description.includes(interestingInstruction), false);
    assert.equal(field.description.includes(contraryInstruction), true);
    assert.equal(field.xmlPrompt.placeholder, field.description);
});

test('nsfw-boost rerolls its sexual-traits guidance for each field snapshot', () => {
    const originalRandom = Math.random;
    const rolls = [4 / 6, 0.999999];
    try {
        Math.random = () => rolls.shift();
        const registry = new ModExtensionRegistry();
        mod.register({
            modDir: path.join(process.cwd(), 'mods', 'nsfw-boost'),
            registerEntityField: field => registry.registerEntityField({ ...field, modName: 'nsfw-boost' }),
            registerBaseContextContributor() {},
            registerSceneSummarizeContributor() {},
            registerPlayerActionPromptStep() {}
        });

        const firstField = registry.getEntityField('player', 'sexualTraits');
        const secondField = registry.getEntityField('player', 'sexualTraits');
        assert.equal(firstField.description.includes(interestingInstruction), true);
        assert.equal(firstField.xmlPrompt.placeholder, firstField.description);
        assert.equal(secondField.description.includes(contraryInstruction), true);
        assert.equal(secondField.xmlPrompt.placeholder, secondField.description);
        assert.equal(rolls.length, 0);
    } finally {
        Math.random = originalRandom;
    }
});
