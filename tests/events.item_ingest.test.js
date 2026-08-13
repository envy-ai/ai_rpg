const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test('item_ingest parser captures item and target without requiring a status field', () => {
    const parser = Events._buildParsers().item_ingest;

    const parsed = parser('Healing Potion -> Baato | Bitter Draught -> Mira');

    assert.deepEqual(parsed, [
        {
            item: 'Healing Potion',
            target: 'Baato',
        },
        {
            item: 'Bitter Draught',
            target: 'Mira',
        },
    ]);
});

test('item_ingest applies the item target effect and suppresses same-pair item_inflict', async () => {
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

    const appliedEffects = [];
    const healingPotion = {
        name: 'Healing Potion',
        causeStatusEffectOnTarget: {
            name: 'Restored',
            description: 'Restored moderate health.',
            duration: 2,
            appliedAt: null,
        },
    };
    const baato = {
        name: 'Baato',
        addStatusEffect(effect, duration) {
            const applied = { ...effect, duration };
            appliedEffects.push({ target: 'Baato', applied });
            return applied;
        },
    };
    const mira = {
        name: 'Mira',
        addStatusEffect(effect, duration) {
            const applied = { ...effect, duration };
            appliedEffects.push({ target: 'Mira', applied });
            return applied;
        },
    };

    Events.initialize({
        config: { omit_npc_generation: true },
        findThingByName: (name) => {
            if (name === 'Healing Potion') {
                return healingPotion;
            }
            return null;
        },
        findActorByName: (name) => {
            if (name === 'Baato') {
                return baato;
            }
            if (name === 'Mira') {
                return mira;
            }
            return null;
        },
    });

    try {
        const parsedEvents = {
            parsed: {
                item_inflict: [
                    { item: 'Healing Potion', target: 'Baato', status: 'Ignored Prompt Text' },
                    { item: 'Healing Potion', target: 'Mira', status: 'Ignored Prompt Text' },
                ],
                item_ingest: [
                    { item: 'Healing Potion', target: 'Baato' },
                ],
            },
            rawEntries: {
                item_inflict: 'Healing Potion -> Baato -> Ignored Prompt Text | Healing Potion -> Mira -> Ignored Prompt Text',
                item_ingest: 'Healing Potion -> Baato',
            },
        };
        const context = {};

        await Events.applyEventOutcomes(parsedEvents, context);

        assert.equal(parsedEvents.parsed.item_inflict.length, 1);
        assert.deepEqual(parsedEvents.parsed.item_inflict[0], {
            item: 'Healing Potion',
            target: 'Mira',
            status: 'Ignored Prompt Text',
        });

        assert.equal(appliedEffects.length, 2);
        assert.deepEqual(
            appliedEffects
                .map((entry) => ({
                    target: entry.target,
                    applied: entry.applied,
                }))
                .sort((a, b) => a.target.localeCompare(b.target)),
            [
                {
                    target: 'Baato',
                    applied: {
                        name: 'Restored',
                        description: 'Restored moderate health.',
                        duration: 2,
                    },
                },
                {
                    target: 'Mira',
                    applied: {
                        name: 'Restored',
                        description: 'Restored moderate health.',
                        duration: 2,
                    },
                },
            ],
        );

        assert.equal(context.itemTriggeredStatusChanges.length, 2);
        assert.deepEqual(
            context.itemTriggeredStatusChanges
                .map((entry) => entry.source)
                .sort(),
            ['item_inflict', 'item_ingest'],
        );
    } finally {
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});

test('consumed target-effect item derives its canonical effect from one structured attack target', async () => {
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

    const appliedEffects = [];
    const fireBomb = {
        name: 'QA Fire Bomb',
        causeStatusEffectOnTarget: {
            name: 'Burn',
            description: 'Canonical lingering burn.',
            duration: 1,
        },
    };
    const beetle = {
        name: 'QA Ash Beetle',
        isDead: false,
        hiddenFromPlayer: false,
        addStatusEffect(effect, duration) {
            const applied = { ...effect, duration };
            appliedEffects.push(applied);
            return applied;
        },
    };

    Events.initialize({
        config: { omit_npc_generation: true },
        findThingByName: (name) => name === fireBomb.name ? fireBomb : null,
        findActorByName: (name) => name === beetle.name ? beetle : null,
    });
    Events._handlers.consume_item = () => {};

    try {
        const parsedEvents = {
            parsed: {
                consume_item: [{ item: fireBomb.name, quantity: 1 }],
                attack_damage: [{ attacker: 'Baato', target: beetle.name }],
                status_effect_change: [{
                    entity: beetle.name,
                    detail: 'Burn from the thrown bomb',
                    action: 'gained',
                    level: 1,
                }],
            },
        };
        const context = {};

        await Events.applyEventOutcomes(parsedEvents, context);

        assert.deepEqual(parsedEvents.parsed.item_inflict, [{
            item: fireBomb.name,
            target: beetle.name,
            status: "Use the item's configured target effect.",
            derivedFromConsumedItem: true,
        }]);
        assert.equal(appliedEffects.length, 1);
        assert.equal(appliedEffects[0].name, 'Burn');
        assert.equal(parsedEvents.parsed.status_effect_change.length, 0);
        assert.equal(context.suppressedStatusEffectChanges.length, 1);

        const noStatusSignal = {
            parsed: {
                consume_item: [{ item: fireBomb.name, quantity: 1 }],
                attack_damage: [{ attacker: 'Baato', target: beetle.name }],
            },
        };
        await Events.applyEventOutcomes(noStatusSignal, {});
        assert.equal(noStatusSignal.parsed.item_inflict, undefined);
        assert.equal(appliedEffects.length, 1);

        const ambiguousConsumption = {
            parsed: {
                consume_item: [
                    { item: fireBomb.name, quantity: 1 },
                    { item: 'Unrelated Snack', quantity: 1 },
                ],
                attack_damage: [{ attacker: 'Baato', target: beetle.name }],
                status_effect_change: [{
                    entity: beetle.name,
                    detail: 'Burn from the thrown bomb',
                    action: 'gained',
                    source: 'item_inflict',
                    item: fireBomb.name,
                }],
            },
        };
        await Events.applyEventOutcomes(ambiguousConsumption, {});
        assert.equal(ambiguousConsumption.parsed.item_inflict, undefined);
    } finally {
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});
