'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');
const { collectCandidates, parseRepairResponse, applyRepairs, renderStatusEffectXml, run } = require('../StatusEffectRepair.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const nunjucks = require('nunjucks');
const path = require('path');
const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');

function setupEffects(player) {
    player.setAbilities([{ id: 'ability_repair', name: 'Sturdy Frame', description: 'Improves toughness.', type: 'Passive', level: 1,
        statusEffects: [{ id: 'status_ability', name: '', description: 'Sturdy frame increases toughness.', duration: -1 }] }]);
    player.setStatusEffects([
        { id: 'status_duplicate', name: '', description: 'Sturdy frame increases toughness.', duration: -1 },
        { id: 'status_distinct', name: '', description: 'A separate fragile condition.', duration: 12 },
        { id: 'status_complete', name: 'Already complete', description: 'Existing bonus.', duration: 4, attributes: [{ attribute: 'strength', modifier: 3 }] }
    ]);
}

test('repair finds intrinsic and ability sources, folding only a proven empty duplicate', async () => {
    await withTechniqueWorld(async ({ player }) => {
        setupEffects(player);
        const candidates = collectCandidates([player]);
        assert.equal(candidates.length, 2);
        const ability = candidates.find(candidate => candidate.abilityId === 'ability_repair');
        assert.equal(ability.statusId, 'status_ability');
        assert.deepEqual(ability.duplicates, ['status_duplicate']);
        assert.equal(candidates.find(candidate => !candidate.abilityId).statusId, 'status_distinct');
        assert.equal(candidates.some(candidate => candidate.statusId === 'status_complete'), false);
        assert.deepEqual(player.getIntrinsicStatusEffects().map(effect => effect.id).sort(), ['status_complete', 'status_distinct', 'status_duplicate']);
    });
});

test('repair validates all XML before applying and removes duplicate only after accepted owner repair', async () => {
    await withTechniqueWorld(async ({ player }) => {
        setupEffects(player);
        const candidates = collectCandidates([player]);
        const before = player.toJSON();
        const entries = candidates.map(candidate => {
            const effect = { ...candidate.existingEffect, name: candidate.abilityId ? 'Sturdy Frame' : 'Fragile',
                ...(candidate.abilityId ? { maxHealthPercent: 20 } : {}) };
            return `<repair><key>${candidate.key}</key>${renderStatusEffectXml(effect)}</repair>`;
        });
        const bad = `<statusEffectRepairs>${entries[0]}${entries[1].replace('<duration>12</duration>', '<duration>nonsense</duration>')}</statusEffectRepairs>`;
        assert.throws(() => parseRepairResponse(bad, candidates), /duration/i);
        assert.deepEqual(player.toJSON(), before);
        const prepared = parseRepairResponse(`<statusEffectRepairs>${entries.join('')}</statusEffectRepairs>`, candidates);
        const result = applyRepairs(prepared);
        assert.equal(result.duplicatesRemoved, 1);
        assert.equal(result.repaired, 2);
        assert.equal(player.getIntrinsicStatusEffects().some(effect => effect.id === 'status_duplicate'), false);
        const ability = player.getAbilities().find(entry => entry.id === 'ability_repair');
        assert.equal(ability.statusEffects[0].id, 'status_ability');
        assert.equal(ability.statusEffects[0].maxHealthPercent, 20);
        assert.equal(player.getIntrinsicStatusEffects().find(effect => effect.id === 'status_complete').attributes[0].modifier, 3);
    });
});

test('repair rejects stale snapshots before any actor mutation', async () => {
    await withTechniqueWorld(async ({ player }) => {
        setupEffects(player);
        const candidate = collectCandidates([player])[0];
        const effect = { ...candidate.existingEffect, name: 'Sturdy Frame' };
        const prepared = parseRepairResponse(renderStatusEffectXml(effect), [candidate]);
        player.addStatusEffect({ id: 'status_new', name: 'New status', description: 'A newer change.', duration: 2 });
        const before = player.toJSON();
        assert.throws(() => applyRepairs(prepared), /changed.*run the command again/i);
        assert.deepEqual(player.toJSON(), before);
    });
});

test('descriptive effects may retain intentionally empty mechanics', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setStatusEffects([{ id: 'narrative_only', name: 'Marked', description: 'A visible mark.', duration: 10 }]);
        const candidate = collectCandidates([player])[0];
        const prepared = parseRepairResponse(renderStatusEffectXml(candidate.existingEffect), [candidate]);
        const result = applyRepairs(prepared);
        assert.equal(result.unchanged, 1);
        assert.equal(result.repaired, 0);
        assert.deepEqual(player.getIntrinsicStatusEffects()[0], candidate.existingEffect);
    });
});

test('ambiguous duplicate descriptions are retained and populated zero mechanics are preserved', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities(['first', 'second'].map(id => ({ id, name: id, description: 'A trait.', type: 'Passive', level: 1,
            statusEffects: [{ id: `status_${id}`, name: id, description: 'Shared description.', duration: -1 }] })));
        player.setStatusEffects([
            { id: 'ambiguous', name: '', description: 'Shared description.', duration: -1 },
            { id: 'explicit_zero', name: '', description: 'A zero modifier.', duration: 5, attributes: [{ attribute: 'strength', modifier: 0 }], maxHealthPercent: 0 }
        ]);
        const candidates = collectCandidates([player]);
        assert.ok(candidates.some(candidate => candidate.statusId === 'ambiguous' && candidate.abilityId === null));
        assert.ok(candidates.every(candidate => !candidate.duplicates.includes('ambiguous')));
        const zero = candidates.find(candidate => candidate.statusId === 'explicit_zero');
        const changed = { ...zero.existingEffect, name: 'Explicit zero', maxHealthPercent: 20 };
        assert.throws(() => parseRepairResponse(renderStatusEffectXml(changed), [zero]), /maxHealthPercent.*preserve/i);
        const same = { ...zero.existingEffect, name: 'Explicit zero' };
        const prepared = parseRepairResponse(renderStatusEffectXml(same), [zero]);
        assert.equal(prepared[0].effect.attributes[0].modifier, 0);
        assert.equal(prepared[0].effect.maxHealthPercent, 0);
    });
});

test('repair rejects unknown new modifier identities and retains unchanged legacy names', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setStatusEffects([{ id: 'legacy_names', name: '', description: 'A legacy status.', duration: 3,
            attributes: [{ attribute: 'obsolete-attribute', modifier: 1 }],
            skills: [{ skill: 'obsolete-skill', modifier: 2 }],
            needBars: [{ name: 'obsolete-need', delta: 1 }] }]);
        const candidate = collectCandidates([player])[0];
        const repaired = { ...candidate.existingEffect, name: 'Legacy status' };
        assert.doesNotThrow(() => parseRepairResponse(renderStatusEffectXml(repaired), [candidate]));
        for (const [field, entry, path] of [
            ['attributes', { attribute: 'new-unknown-attribute', modifier: 1 }, /attributes.*new-unknown-attribute.*configured identity/i],
            ['skills', { skill: 'new-unknown-skill', modifier: 1 }, /skills.*new-unknown-skill.*configured identity/i],
            ['needBars', { name: 'new-unknown-need', delta: 1 }, /needBars.*new-unknown-need.*configured identity/i]
        ]) {
            const response = renderStatusEffectXml({ ...repaired, [field]: [...repaired[field], entry] });
            assert.throws(() => parseRepairResponse(response, [candidate]), path);
        }
        assert.equal(player.getIntrinsicStatusEffects()[0].name, '');
    });
});

test('failure during ability and duplicate repair restores exact prior effects and health', async () => {
    await withTechniqueWorld(async ({ player }) => {
        setupEffects(player);
        player.setHealth(player.maxHealth - 2);
        const candidate = collectCandidates([player]).find(entry => entry.abilityId === 'ability_repair');
        const prepared = parseRepairResponse(renderStatusEffectXml({ ...candidate.existingEffect, name: 'Sturdy Frame', maxHealthPercent: 20 }), [candidate]);
        const beforeEffects = player.getIntrinsicStatusEffects(), beforeAbilities = player.getAbilities(), beforeHealth = player.health;
        const setStatus = player.setStatusEffects.bind(player);
        let calls = 0;
        player.setStatusEffects = (...args) => { if (++calls === 1) throw new Error('simulated repair storage failure'); return setStatus(...args); };
        try {
            assert.throws(() => applyRepairs(prepared), /simulated repair storage failure/);
        } finally {
            player.setStatusEffects = setStatus;
        }
        assert.deepEqual(player.getIntrinsicStatusEffects(), beforeEffects);
        assert.deepEqual(player.getAbilities(), beforeAbilities);
        assert.equal(player.health, beforeHealth);
    });
});

test('standard repair sends 21 effects in 10, 10, 1 batches and commits only after every response', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setStatusEffects(Array.from({ length: 21 }, (_, index) => ({ id: `batch_${index}`, name: `Mark ${index}`, description: `Mark ${index} description.`, duration: 5 })));
        const previousLoaded = Globals.gameLoaded, previousComplete = LLMClient.chatCompletion, previousLog = LLMClient.logPrompt;
        const before = player.toJSON(), batches = [];
        let currentBatch;
        Globals.gameLoaded = true;
        LLMClient.logPrompt = () => 'fixture.log';
        LLMClient.chatCompletion = async options => {
            assert.deepEqual(player.toJSON(), before, 'no batch may commit before the full operation succeeds');
            assert.equal(options.metadataLabel, 'status_effect_repair');
            assert.equal(options.allowToolCalls, false);
            assert.deepEqual(options.additionalPayload.tools, []);
            const xml = `<statusEffectRepairs>${currentBatch.map(candidate => `<repair><key>${candidate.key}</key>${candidate.effectXml}</repair>`).join('')}</statusEffectRepairs>`;
            options.responseValidator(xml);
            return xml;
        };
        try {
            const result = await run({ actors: [player], config: { ai: { tinybrain: false, retryAttempts: 1 } },
                promptEnv: { render: (name, context) => { assert.equal(name, 'base-context.xml.njk'); currentBatch = context.statusRepairCandidates; batches.push(currentBatch.length); return 'fixture'; } },
                parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'base context' }),
                prepareBasePromptContext: async () => ({}) });
            assert.deepEqual(batches, [10, 10, 1]);
            assert.equal(result.inspected, 21);
            assert.equal(result.unchanged, 21);
            assert.deepEqual(player.toJSON(), before);
        } finally {
            Globals.gameLoaded = previousLoaded;
            LLMClient.chatCompletion = previousComplete;
            LLMClient.logPrompt = previousLog;
        }
    });
});

test('repair skips completion for no candidates and propagates cancellation without applying changes', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const previousLoaded = Globals.gameLoaded, previousComplete = LLMClient.chatCompletion;
        let calls = 0;
        const cancelled = new Error('fixture cancellation'); cancelled.code = 'PROMPT_CANCELLED';
        Globals.gameLoaded = true;
        LLMClient.chatCompletion = async () => { calls += 1; throw cancelled; };
        const options = { actors: [player], config: { ai: { tinybrain: false } }, promptEnv: { render: () => 'fixture' },
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'base context' }), prepareBasePromptContext: async () => ({}) };
        try {
            assert.equal((await run(options)).inspected, 0);
            assert.equal(calls, 0);
            player.setStatusEffects([{ id: 'cancel_status', name: 'Review', description: 'Needs review.', duration: 3 }]);
            const before = player.toJSON();
            await assert.rejects(run(options), error => error === cancelled);
            assert.equal(calls, 1);
            assert.deepEqual(player.toJSON(), before);
        } finally {
            Globals.gameLoaded = previousLoaded;
            LLMClient.chatCompletion = previousComplete;
        }
    });
});

test('TinyBrain reviews three effects in one conversation and retries only the rejected checkpoint', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setStatusEffects(Array.from({ length: 3 }, (_, index) => ({ id: `tiny_${index}`, name: `Tiny ${index}`, description: `Status ${index}.`, duration: 5 })));
        const before = player.toJSON();
        const candidateEffects = collectCandidates([player]).map(candidate => renderStatusEffectXml(candidate.existingEffect));
        const responses = [candidateEffects[0], '<effect><maxHealthPercent>bad</maxHealthPercent></effect>', candidateEffects[1], candidateEffects[2]];
        class WrapperLoader extends nunjucks.Loader {
            getSource(name) {
                return name === 'base-context.xml.njk'
                    ? { src: 'Fixed base context. {{ __tinyBrainState.programStartMarker }}{% include tinyBrainProgramTemplate %}', path: name, noCache: true }
                    : null;
            }
        }
        const promptEnv = new nunjucks.Environment([new WrapperLoader(), new nunjucks.FileSystemLoader(path.join(__dirname, '../prompts'))], { autoescape: false });
        promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        promptEnv.addFilter('xmlText', value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        const previousLoaded = Globals.gameLoaded, previousComplete = LLMClient.chatCompletion, previousLog = LLMClient.logPrompt;
        const calls = [];
        Globals.gameLoaded = true;
        LLMClient.logPrompt = () => 'fixture.log';
        LLMClient.chatCompletion = async options => {
            assert.deepEqual(player.toJSON(), before, 'accepted checkpoints remain detached until all pass');
            calls.push(options);
            assert.equal(options.allowToolCalls, false);
            assert.deepEqual(options.additionalPayload.tools, []);
            return responses.shift();
        };
        try {
            const result = await run({ actors: [player], config: { ai: { tinybrain: true, retryAttempts: 1 } }, promptEnv,
                parseXMLTemplate: rendered => ({ systemPrompt: 'system', generationPrompt: rendered }), prepareBasePromptContext: async () => ({}) });
            assert.equal(result.inspected, 3);
            assert.equal(calls.length, 4);
            assert.ok(calls.every(call => call.metadataLabel === 'status_effect_repair'));
            assert.ok(calls[2].messages.some(message => /statusEffectRepairs|description|name/i.test(message.content)));
            assert.ok(calls[3].messages.some(message => message.content.includes('Tiny 1')));
            assert.equal(calls.filter(call => call.messages.at(-1).content.includes('Current effect 1 of 3')).length, 1);
        } finally {
            Globals.gameLoaded = previousLoaded;
            LLMClient.chatCompletion = previousComplete;
            LLMClient.logPrompt = previousLog;
        }
    });
});
