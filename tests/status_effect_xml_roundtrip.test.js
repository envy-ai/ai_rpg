const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../Utils.js');
const Events = require('../Events.js');
const Globals = require('../Globals.js');
const TechniqueService = require('../TechniqueService.js');
const LLMClient = require('../LLMClient.js');
const { withTechniqueWorld, addDefinition, mechanics } = require('./helpers/techniqueIntegrationFixtures.js');
const { parseStatusEffectXml, renderStatusEffectXml } = require('../StatusEffectXml.js');

test('full status XML round-trips mechanics, identity, timestamps and provenance', () => {
    const existing = {
        id: 'status_roundtrip_1', name: 'Arcane <Guard>', description: 'Protection & focus.',
        duration: 45, appliedAt: 123,
        attributes: [{ attribute: 'strength', modifier: 2, percentModifier: 10 }],
        skills: [{ skill: 'perception', modifier: -1, percentModifier: 5 }],
        needBars: [{ name: 'hunger', delta: -0.25 }], needBarMaximums: [], maxHealthPercent: 20,
        techniqueGrants: [],
        techniqueProvenance: {
            techniqueId: 'technique_1', effectId: 'effect_1', actorId: 'actor_1', operationId: 'operation_1', sourceId: 'source_1',
            sourceKind: 'learned', stacking: 'refresh', refreshPolicy: 'replace', definitionRevision: 1, authoredDuration: 45
        }
    };
    const xml = renderStatusEffectXml(existing);
    const node = Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement;
    const parsed = parseStatusEffectXml(node, { existing, path: 'npc.statusEffects[0]', requireComplete: true });
    assert.deepEqual(parsed, existing);
});

test('status XML rejects an invalid populated modifier with its field path and preserves zero values', () => {
    const effect = value => Utils.parseXmlDocumentStrict(`<effect><id>status_zero</id><name>Steady</name><description>No drift.</description><duration>0</duration><appliedAt>0</appliedAt><attributes><attribute><attribute>strength</attribute><modifier>${value}</modifier><percentModifier>0</percentModifier></attribute></attributes><skills/><needBars/><maxHealthPercent>0</maxHealthPercent><techniqueGrants/></effect>`, 'text/xml').documentElement;
    const parsed = parseStatusEffectXml(effect('0'), { path: 'npc.statusEffects[0]', requireComplete: true });
    assert.equal(parsed.attributes[0].modifier, 0);
    assert.equal(parsed.duration, 0);
    assert.equal(parsed.appliedAt, 0);
    assert.equal(parsed.maxHealthPercent, 0);
    assert.throws(() => parseStatusEffectXml(effect('NaN'), { path: 'npc.statusEffects[0]', requireComplete: true }), /statusEffects\[0\].*(?:modifier|strength)/i);
});

test('status XML preserves technique grant identities and source links', () => {
    const effect = {
        id: 'status_grant_owner', name: 'Technique source', description: 'Grants a technique.', duration: -1, appliedAt: 0,
        attributes: [], skills: [], needBars: [], maxHealthPercent: 0, techniqueProvenance: null,
        techniqueGrants: [{ id: 'grant_1', sourceStatusId: 'status_grant_owner', techniqueId: 'technique_1', definitionRevision: 2 }]
    };
    const validate = TechniqueService.validateStatusGrants;
    let received;
    TechniqueService.validateStatusGrants = effects => { received = effects; return true; };
    try {
        const node = Utils.parseXmlDocumentStrict(renderStatusEffectXml(effect), 'text/xml').documentElement;
        const parsed = parseStatusEffectXml(node, { existing: effect, path: 'status', requireComplete: true });
        assert.deepEqual(parsed.techniqueGrants, effect.techniqueGrants);
        assert.deepEqual(received[0].techniqueGrants, effect.techniqueGrants);
    } finally {
        TechniqueService.validateStatusGrants = validate;
    }
});

test('status XML preserves fixed and percentage rates and capacity modifiers including zero', () => {
    const effect = {
        id: 'status_need_modifiers', name: 'Rested', description: 'Sustained recovery.', duration: 7, appliedAt: 0,
        attributes: [], skills: [], techniqueGrants: [], maxHealthPercent: 0,
        needBars: [{ name: 'Health', delta: 0, percentDelta: 0.25 }, { name: 'stamina', delta: -2, percentDelta: 0 }],
        needBarMaximums: [{ name: 'stamina', percentModifier: 5 }]
    };
    const xml = renderStatusEffectXml(effect);
    const node = Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement;
    const parsed = parseStatusEffectXml(node, { existing: effect, path: 'status', requireComplete: true });
    assert.deepEqual(parsed.needBars, effect.needBars);
    assert.deepEqual(parsed.needBarMaximums, effect.needBarMaximums);
    assert.match(xml, /<percentDelta>0<\/percentDelta>/);
});

test('NPC alteration parser retains returned status names and complete mechanics', () => {
    const effect = {
        id: 'status_alter_1', name: 'Fortified', description: 'A sturdy frame.', duration: -1, appliedAt: 0,
        attributes: [{ attribute: 'strength', modifier: 2, percentModifier: 10 }],
        skills: [{ skill: 'athletics', modifier: 1 }], needBars: [{ name: 'hunger', delta: -1 }],
        maxHealthPercent: 20, needBarMaximums: [], techniqueGrants: []
    };
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    try {
        const parsed = Events._parseCharacterAlterXml(`<npc><name>Patient</name><statusEffects>${renderStatusEffectXml(effect)}</statusEffects></npc>`, { throwOnError: true });
        assert.equal(parsed.statusEffects.length, 1);
        assert.deepEqual(parsed.statusEffects[0], effect);
    } finally {
        Globals.config = previousConfig;
    }
});

test('NPC alteration preserves existing server-owned status provenance when omitted', () => {
    const existing = { id: 'status_existing', name: 'Old name', description: 'Existing effect.', duration: 9, appliedAt: 42,
        attributes: [{ attribute: 'strength', modifier: 2 }], skills: [], needBars: [], maxHealthPercent: 0, techniqueGrants: [],
        techniqueProvenance: { techniqueId: 'technique_1', effectId: 'effect_1', actorId: 'actor_1', operationId: 'operation_1', sourceId: 'source_1', sourceKind: 'learned', stacking: 'refresh', refreshPolicy: 'replace', definitionRevision: 1, authoredDuration: 9 } };
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    try {
        const xml = '<npc><name>Patient</name><statusEffects><effect><id>status_existing</id><name>New name</name><description>Existing effect.</description></effect></statusEffects></npc>';
        const parsed = Events._parseCharacterAlterXml(xml, { throwOnError: true, existingStatusEffects: [existing] });
        assert.equal(parsed.statusEffects[0].id, existing.id);
        assert.equal(parsed.statusEffects[0].name, 'New name');
        assert.equal(parsed.statusEffects[0].appliedAt, existing.appliedAt);
        assert.deepEqual(parsed.statusEffects[0].attributes, existing.attributes);
        assert.deepEqual(parsed.statusEffects[0].techniqueProvenance, existing.techniqueProvenance);
    } finally {
        Globals.config = previousConfig;
    }
});

test('NPC alteration prompt receives intrinsic effects only, never derived ability effects', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        npc.setStatusEffects([{ id: 'intrinsic_status', name: 'Wounded', description: 'A real wound.', duration: 8 }]);
        npc.setAbilities([{ id: 'ability_status_owner', name: 'Sturdy', description: 'A sturdy trait.', type: 'Passive', level: 1,
            statusEffects: [{ id: 'derived_status', name: 'Sturdy trait', description: 'A derived bonus.', duration: -1, attributes: [{ attribute: 'strength', modifier: 1 }] }] }]);
        const previousDeps = Events._deps, previousComplete = LLMClient.chatCompletion;
        let rendered;
        Events._deps = {
            config: { ai: {} }, findActorByName: () => npc,
            promptEnv: { render: (_name, payload) => { rendered = payload; return 'fixture'; } },
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'user' }),
            prepareBasePromptContext: async () => ({})
        };
        LLMClient.chatCompletion = async () => { throw new Error('stop after prompt capture'); };
        try {
            await assert.rejects(Events._handleAlterNpcEvents([{ name: npc.name, description: 'A change.' }]), /stop after prompt capture/);
            assert.deepEqual(rendered.alteredCharacter.statusEffects.map(effect => effect.id), ['intrinsic_status']);
            assert.ok(npc.getStatusEffects().some(effect => effect.id === 'derived_status'));
            assert.equal(npc.getIntrinsicStatusEffects().length, 1);
        } finally {
            Events._deps = previousDeps;
            LLMClient.chatCompletion = previousComplete;
        }
    });
});

test('NPC alteration preflight reports bad modifiers without mutating the actor', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        npc.setStatusEffects([{ id: 'preflight_status', name: 'Wounded', description: 'A real wound.', duration: 8 }]);
        const original = npc.toJSON();
        const previousDeps = Events._deps, previousComplete = LLMClient.chatCompletion;
        let message;
        Events._deps = {
            config: { ai: {} }, findActorByName: () => npc,
            promptEnv: { render: () => 'fixture' }, parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'user' }),
            prepareBasePromptContext: async () => ({})
        };
        LLMClient.chatCompletion = async options => {
            try {
                options.responseValidator('<npc><name>Patient</name><statusEffects><effect><id>preflight_status</id><name>Wounded</name><description>A real wound.</description><attributes><attribute><attribute>strength</attribute><modifier>bad</modifier></attribute></attributes></effect></statusEffects></npc>');
                assert.fail('invalid modifier must be rejected');
            } catch (error) {
                message = error.message;
            }
            assert.deepEqual(npc.toJSON(), original);
            throw new Error('stop after preflight');
        };
        try {
            await assert.rejects(Events._handleAlterNpcEvents([{ name: npc.name, description: 'A change.' }]), /stop after preflight/);
            assert.match(message, /statusEffects.*modifier/i);
            assert.deepEqual(npc.toJSON(), original);
        } finally {
            Events._deps = previousDeps;
            LLMClient.chatCompletion = previousComplete;
        }
    });
});

test('NPC alteration rejects duplicate owned status and grant IDs before any actor update', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        addDefinition('technique_duplicate_check', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }));
        const base = { name: 'A', description: 'A status.', duration: -1, appliedAt: 0, attributes: [], skills: [], needBars: [], maxHealthPercent: 0 };
        const first = { ...base, id: 'intrinsic_id', techniqueGrants: [{ id: 'same_grant', sourceStatusId: 'intrinsic_id', techniqueId: 'technique_duplicate_check', definitionRevision: 1 }] };
        const second = { ...base, id: 'ability_id', techniqueGrants: [{ id: 'same_grant', sourceStatusId: 'ability_id', techniqueId: 'technique_duplicate_check', definitionRevision: 1 }] };
        const previousConfig = Globals.config;
        Globals.config = { ...previousConfig, strictXMLParsing: true };
        const before = npc.toJSON();
        try {
            assert.throws(() => Events._parseCharacterAlterXml(`<npc><name>Changed</name><statusEffects>${renderStatusEffectXml(first)}</statusEffects></npc>`, {
                throwOnError: true, existingStatusEffects: [first], existingAbilities: [{ id: 'ability', name: 'Trait', statusEffects: [second] }]
            }), /duplicate.*grant.*same_grant/i);
            const duplicateStatus = { ...second, id: first.id, techniqueGrants: [] };
            assert.throws(() => Events._parseCharacterAlterXml(`<npc><name>Changed</name><statusEffects>${renderStatusEffectXml(first)}</statusEffects></npc>`, {
                throwOnError: true, existingStatusEffects: [first], existingAbilities: [{ id: 'ability', name: 'Trait', statusEffects: [duplicateStatus] }]
            }), /duplicate.*status.*intrinsic_id/i);
            assert.deepEqual(npc.toJSON(), before);
        } finally {
            Globals.config = previousConfig;
        }
    });
});

test('NPC alteration preserves omitted abilities and their effects, while an explicit empty list clears them', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        npc.setAbilities([{ id: 'preserved_ability', name: 'Sturdy', description: 'A trait.', type: 'Passive', level: 1,
            statusEffects: [{ id: 'preserved_effect', name: 'Sturdy', description: 'Sturdy bonus.', duration: -1, attributes: [{ attribute: 'strength', modifier: 1 }] }] }]);
        const before = npc.getAbilities();
        const previousDeps = Events._deps;
        Events._deps = {};
        try {
            const omitted = Events._parseCharacterAlterXml(`<npc><name>${npc.name}</name></npc>`, { throwOnError: true, actor: npc, existingAbilities: before });
            assert.equal(omitted.abilities, undefined);
            await Events._applyCharacterAlteration({ npc, parsedCharacter: omitted, entry: {}, findThingByName: () => null });
            assert.deepEqual(npc.getAbilities(), before);
            const empty = Events._parseCharacterAlterXml(`<npc><name>${npc.name}</name><abilities/></npc>`, { throwOnError: true, actor: npc, existingAbilities: before });
            assert.deepEqual(empty.abilities, []);
            await Events._applyCharacterAlteration({ npc, parsedCharacter: empty, entry: {}, findThingByName: () => null });
            assert.deepEqual(npc.getAbilities(), []);
        } finally {
            Events._deps = previousDeps;
        }
    });
});

test('NPC alteration rejects unknown new modifier identities but preserves unchanged legacy entries', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        npc.setStatusEffects([{ id: 'alter_legacy', name: 'Legacy', description: 'An existing condition.', duration: 3,
            attributes: [{ attribute: 'old-attribute', modifier: 1 }], skills: [{ skill: 'old-skill', modifier: 2 }], needBars: [{ name: 'old-need', delta: 1 }] }]);
        const existing = npc.getIntrinsicStatusEffects();
        const options = { throwOnError: true, actor: npc, existingStatusEffects: existing, existingAbilities: npc.getAbilities() };
        const wrap = effect => `<npc><name>${npc.name}</name><statusEffects>${renderStatusEffectXml(effect)}</statusEffects></npc>`;
        assert.doesNotThrow(() => Events._parseCharacterAlterXml(wrap(existing[0]), options));
        for (const [field, value, pattern] of [
            ['attributes', { attribute: 'bad-attribute', modifier: 1 }, /attributes.*bad-attribute.*configured identity/i],
            ['skills', { skill: 'bad-skill', modifier: 1 }, /skills.*bad-skill.*configured identity/i],
            ['needBars', { name: 'bad-need', delta: 1 }, /needBars.*bad-need.*configured identity/i]
        ]) {
            assert.throws(() => Events._parseCharacterAlterXml(wrap({ ...existing[0], [field]: [...existing[0][field], value] }), options), pattern);
        }
        assert.deepEqual(npc.getIntrinsicStatusEffects(), existing);
    });
});
