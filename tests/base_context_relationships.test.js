const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildActorRelationshipPromptContext
} = require('../base_context_relationships.js');

function actor({ id, name, relationships = {} }) {
    return {
        id,
        name,
        getRelationships() {
            return { ...relationships };
        }
    };
}

test('relationship prompt context resolves outgoing names and filters listed reciprocal actors', () => {
    const alice = actor({
        id: 'char-alice',
        name: 'Alice',
        relationships: {
            'char-bob': 'bitter rival',
            'char-missing': 'old ghost'
        }
    });
    const bob = actor({
        id: 'char-bob',
        name: 'Bob',
        relationships: {
            'char-alice': 'daughter'
        }
    });
    const carol = actor({
        id: 'char-carol',
        name: 'Carol',
        relationships: {
            'char-alice': 'sister'
        }
    });
    const dave = actor({
        id: 'char-dave',
        name: 'Dave',
        relationships: {
            'char-alice': 'mentor'
        }
    });
    const playersById = new Map([
        [alice.id, alice],
        [bob.id, bob],
        [carol.id, carol],
        [dave.id, dave]
    ]);

    const context = buildActorRelationshipPromptContext({
        actor: alice,
        playersById,
        listedCharacterIds: ['char-alice', 'char-bob', 'char-carol']
    });

    assert.deepEqual(context.relationships, [
        {
            targetId: 'char-bob',
            name: 'Bob',
            label: 'bitter rival'
        },
        {
            targetId: 'char-missing',
            name: 'char-missing',
            label: 'old ghost'
        }
    ]);
    assert.deepEqual(context.reciprocalRelationships, [
        {
            sourceId: 'char-dave',
            name: 'Dave',
            label: 'mentor'
        }
    ]);
});
