const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const StatusEffect = require('../StatusEffect.js');

test('generated status gains discard template appliedAt before actor application', async () => {
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const previousGenerator = StatusEffect.generateFromDescriptions;

    let receivedEffect = null;
    const actor = {
        name: 'Gallery Sentinel',
        addStatusEffect(effect) {
            receivedEffect = effect;
            return effect;
        },
    };

    StatusEffect.generateFromDescriptions = async () => new Map([
        ['Stabilized', new StatusEffect({
            name: 'Stabilized',
            description: 'Stable but still unable to act.',
            duration: 60,
            appliedAt: null,
        })],
    ]);

    Events.initialize({
        config: { omit_npc_generation: true },
        findActorByName: (name) => (name === 'Gallery Sentinel' ? actor : null),
        promptEnv: {},
        parseXMLTemplate() {},
        prepareBasePromptContext() {},
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                status_effect_change: [{
                    entity: 'Gallery Sentinel',
                    detail: 'Stabilized',
                    action: 'gained',
                    level: 1,
                }],
            },
            rawEntries: {
                status_effect_change: 'Gallery Sentinel -> Stabilized -> gained -> 1',
            },
        }, {});

        assert.ok(receivedEffect);
        assert.equal(receivedEffect.name, 'Stabilized');
        assert.equal(Object.hasOwn(receivedEffect, 'appliedAt'), false);
    } finally {
        StatusEffect.generateFromDescriptions = previousGenerator;
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});

test('generated status gain cannot replace the same structured effect already applied by item ingestion', async () => {
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const previousGenerator = StatusEffect.generateFromDescriptions;

    const appliedEffects = [];
    const actor = {
        name: 'Baato',
        addStatusEffect(effect, duration) {
            const applied = { ...effect, duration: effect.duration ?? duration };
            appliedEffects.push(applied);
            return applied;
        },
    };
    const item = {
        name: 'QA Focus Draught',
        count: 1,
        causeStatusEffectOnTarget: {
            name: 'QA Focused',
            description: 'A sharp, clear-headed sensation from a test draught.',
            duration: 5,
        },
    };

    StatusEffect.generateFromDescriptions = async () => new Map([
        ['Focus', new StatusEffect({
            name: 'Focus',
            description: 'A sharp, clear-headed sensation from a test draught.',
            duration: 5,
            appliedAt: null,
        })],
    ]);

    Events.initialize({
        config: { omit_npc_generation: true },
        findThingByName: (name) => name === item.name ? item : null,
        findActorByName: (name) => name === actor.name ? actor : null,
        promptEnv: {},
        parseXMLTemplate() {},
        prepareBasePromptContext() {},
    });

    const parsedEvents = {
        parsed: {
            item_ingest: [{ item: item.name, target: actor.name }],
            status_effect_change: [{
                entity: actor.name,
                detail: 'Focus',
                action: 'gained',
                level: 1,
            }],
        },
        rawEntries: {
            item_ingest: `${item.name} -> ${actor.name}`,
            status_effect_change: `${actor.name} -> Focus -> gained -> 1`,
        },
    };

    try {
        const outcomeContext = {};
        await Events.applyEventOutcomes(parsedEvents, outcomeContext);

        assert.equal(appliedEffects.length, 1);
        assert.equal(appliedEffects[0].name, 'QA Focused');
        assert.equal(parsedEvents.parsed.status_effect_change.length, 0);
        assert.deepEqual(outcomeContext.suppressedStatusEffectChanges, [{
            entity: actor.name,
            detail: 'Focus',
            description: 'Focus',
            action: 'gained',
            level: 1,
        }]);
    } finally {
        StatusEffect.generateFromDescriptions = previousGenerator;
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});

test('merged XML result drops status entries explicitly suppressed during phase application', () => {
    const structured = {
        parsed: {
            status_effect_change: [
                {
                    entity: 'Baato',
                    detail: 'Focus',
                    action: 'gained',
                    level: 1,
                },
                {
                    entity: 'Baato',
                    detail: 'Warm',
                    action: 'gained',
                    level: 1,
                },
            ],
        },
    };

    Events._removeSuppressedStatusEffectChangesFromStructured(structured, [{
        entity: 'Baato',
        detail: 'Focus',
        action: 'gained',
        level: 1,
    }]);

    assert.deepEqual(structured.parsed.status_effect_change, [{
        entity: 'Baato',
        detail: 'Warm',
        action: 'gained',
        level: 1,
    }]);
});
