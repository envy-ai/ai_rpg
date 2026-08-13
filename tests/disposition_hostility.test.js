const test = require('node:test');
const assert = require('node:assert/strict');

const { isActorDispositionHostile } = require('../DispositionHostility.js');

const definitions = {
    types: {
        platonic: {
            key: 'platonic',
            hostileThreshold: -31
        },
        trust: {
            key: 'trust',
            hostileThreshold: -35
        },
        respect: {
            key: 'respect',
            hostileThreshold: null
        }
    }
};

function createActor({ rawHostile = false, dispositions = {} } = {}) {
    return {
        id: 'npc_lantern',
        isHostile: rawHostile,
        getDisposition(targetId, type) {
            assert.equal(targetId, 'player_baato');
            return dispositions[type] ?? 0;
        }
    };
}

test('disposition hostility follows current threshold values rather than the raw hostile flag', () => {
    const target = { id: 'player_baato' };

    assert.equal(isActorDispositionHostile(createActor({
        rawHostile: false,
        dispositions: { platonic: -31 }
    }), target, definitions), true);

    assert.equal(isActorDispositionHostile(createActor({
        rawHostile: false,
        dispositions: { platonic: -30 }
    }), target, definitions), false);

    assert.equal(isActorDispositionHostile(createActor({
        rawHostile: true,
        dispositions: { platonic: 0, trust: 0 }
    }), target, definitions), false);
});

test('disposition hostility checks every configured threshold and ignores non-hostility types', () => {
    const target = 'player_baato';
    assert.equal(isActorDispositionHostile(createActor({
        dispositions: { trust: -35, respect: -200 }
    }), target, definitions), true);
    assert.equal(isActorDispositionHostile(createActor({
        dispositions: { trust: -34, respect: -200 }
    }), target, definitions), false);
});

test('disposition hostility rejects malformed actor contracts', () => {
    assert.throws(
        () => isActorDispositionHostile({}, 'player_baato', definitions),
        /actor\.getDisposition/
    );
    assert.throws(
        () => isActorDispositionHostile(createActor(), 'player_baato', {}),
        /dispositionDefinitions\.types/
    );
});
