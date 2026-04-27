const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test('death_incapacitation dead outcome marks actor dead with a finite health delta', async () => {
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

    const appliedEffects = [];
    const actor = {
        name: 'Gallery Sentinel',
        isNPC: true,
        isDead: false,
        health: 12,
        modifyHealth(amount, reason) {
            assert.equal(Number.isFinite(amount), true);
            const oldHealth = this.health;
            this.health = Math.max(0, this.health + amount);
            return {
                oldHealth,
                newHealth: this.health,
                change: this.health - oldHealth,
                reason
            };
        },
        addStatusEffect(effect) {
            appliedEffects.push(effect);
            return effect;
        }
    };

    Events.initialize({
        config: { omit_npc_generation: true },
        findActorByName: (name) => (name === 'Gallery Sentinel' ? actor : null),
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                death_incapacitation: [
                    { name: 'Gallery Sentinel', status: 'dead' },
                ],
            },
            rawEntries: {
                death_incapacitation: 'Gallery Sentinel → dead',
            },
        }, {});

        assert.equal(actor.health, 0);
        assert.equal(actor.isDead, true);
        assert.equal(appliedEffects.length, 1);
        assert.equal(appliedEffects[0].description, 'Deceased');
    } finally {
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});
