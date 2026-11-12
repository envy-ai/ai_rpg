'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const { assessTechniqueDamageEffectiveness, parseTechniqueDamageEffectiveness } = require('../TechniqueDamageEffectiveness.js');

test('technique damage assessment XML validates exact ordered integer ratings', () => {
    assert.deepEqual(parseTechniqueDamageEffectiveness('<damageEffectiveness><rating>1</rating><rating>5</rating></damageEffectiveness>', 2), [1, 5]);
    for (const xml of [
        '<damageEffectiveness><rating>3</rating></damageEffectiveness>',
        '<damageEffectiveness><rating>3</rating><rating>4</rating><rating>5</rating></damageEffectiveness>',
        '<damageEffectiveness><rating>0</rating><rating>3</rating></damageEffectiveness>',
        '<damageEffectiveness><rating>3.5</rating><rating>3</rating></damageEffectiveness>',
        '<damageEffectiveness><rating>6</rating><rating>3</rating></damageEffectiveness>',
        '<damageEffectiveness><rating>3</rating><rating>3</damageEffectiveness>'
    ]) assert.throws(() => parseTechniqueDamageEffectiveness(xml, 2), /rating|integer|strict|XML|effectiveness/i);
});

test('assessment reuses ordinary attack guidance, exact target facts, effective checks and local XML retry', async () => {
    const old = { config: Globals.config, completion: LLMClient.chatCompletion, log: LLMClient.logPrompt };
    const completions = [], logs = [];
    const promptEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });
    Globals.config = { ai: { retryAttempts: 1 } };
    LLMClient.chatCompletion = async options => {
        completions.push(options);
        return completions.length === 1 ? '<damageEffectiveness><rating>3</rating></damageEffectiveness>' : '<damageEffectiveness><rating>2</rating><rating>5</rating></damageEffectiveness>';
    };
    LLMClient.logPrompt = async entry => { logs.push(entry); };
    const target = { name: 'Fixture Target', description: 'A target.', class: 'Fighter', race: 'Human', resistances: 'None', vulnerabilities: '', getStatusEffects: () => [] };
    try {
        const ratings = await assessTechniqueDamageEffectiveness({
            actor: { name: 'Caster', description: 'A caster.', class: 'Mage', race: 'Human' }, technique: { name: 'Elements', description: 'Two effects.' }, source: { sourceId: 'learned:elements' }, weapon: null, promptEnv,
            assessments: [
                { target, effect: { id: 'flame', kind: 'damage' }, check: { kind: 'attack', damageType: 'fire' } },
                { target, effect: { id: 'frost', kind: 'damage', check: { damageType: 'ice' } }, check: { kind: 'attack', damageType: 'ice' } }
            ]
        });
        assert.deepEqual(ratings, [2, 5]);
        assert.equal(completions.length, 2); assert.equal(logs.length, 2);
        assert.equal(completions[0].metadataLabel, 'technique_damage_effectiveness');
        assert.match(completions[1].messages.at(-1).content, /exactly 2 rating/i);
        const prompt = completions[0].messages.map(message => message.content).join('\n');
        const ordinaryGuidance = fs.readFileSync(path.join(__dirname, '../prompts/_includes/damage-effectiveness.njk'), 'utf8').trim();
        assert.ok(prompt.includes(ordinaryGuidance));
        assert.match(prompt, /"damageType":"fire"/); assert.match(prompt, /"damageType":"ice"/);
        assert.match(prompt, /"resistances":"None"/); assert.match(prompt, /"vulnerabilities":""/);
        assert.ok(logs.every(log => log.metadataLabel === 'technique_damage_effectiveness'));
    } finally { Globals.config = old.config; LLMClient.chatCompletion = old.completion; LLMClient.logPrompt = old.log; }
});
