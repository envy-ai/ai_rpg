const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildHousekeepingUpdateLogEntries
} = require('../housekeeping_update_log.js');

test('housekeeping update log builds prompt-excluded tracker and relationship entries', () => {
    const entries = buildHousekeepingUpdateLogEntries([
        {
            name: 'addTracker',
            metadata: {
                status: 'partial_success',
                items: [
                    {
                        status: 'success',
                        name: 'Gate Stability',
                        value: '60%',
                        hiddenFromPlayer: false
                    },
                    {
                        status: 'success',
                        name: 'Secret Doom',
                        value: '3',
                        hiddenFromPlayer: true
                    }
                ]
            }
        },
        {
            name: 'updateTracker',
            metadata: {
                status: 'success',
                name: 'Keys Found',
                value: '2/3',
                hiddenFromPlayer: false
            }
        },
        {
            name: 'removeTracker',
            metadata: {
                status: 'success',
                name: 'Alarm State',
                hiddenFromPlayer: false
            }
        },
        {
            name: 'setRelationship',
            metadata: {
                status: 'success',
                characterA: { id: 'npc-1', name: 'Mira' },
                characterB: { id: 'npc-2', name: 'Neka' },
                relationship: 'trusted ally',
                relationshipAction: 'added',
                reciprocalRelationship: 'guarded patron',
                reciprocalRelationshipAction: 'updated'
            }
        },
        {
            name: 'setRelationship',
            metadata: {
                status: 'success',
                characterA: { id: 'npc-3', name: 'Toma' },
                characterB: { id: 'npc-1', name: 'Mira' },
                previousRelationship: 'quiet informant',
                relationship: null,
                relationshipAction: 'deleted',
                reciprocalRelationship: null
            }
        }
    ], {
        locationId: 'loc-1',
        requestId: 'request-1'
    });

    assert.equal(entries.length, 2);

    const trackerEntry = entries[0];
    assert.equal(trackerEntry.type, 'tracker-updates');
    assert.equal(trackerEntry.role, 'assistant');
    assert.equal(trackerEntry.locationId, 'loc-1');
    assert.equal(trackerEntry.metadata.excludeFromBaseContextHistory, true);
    assert.equal(trackerEntry.metadata.housekeepingUpdates, true);
    assert.equal(trackerEntry.metadata.requestId, 'request-1');
    assert.deepEqual(trackerEntry.metadata.trackerUpdates.map(update => update.action), [
        'added',
        'updated',
        'deleted'
    ]);
    assert.doesNotMatch(trackerEntry.content, /^## Tracker Updates/m);
    assert.match(trackerEntry.content, /^- Added \*\*Gate Stability\*\*: 60%/);
    assert.doesNotMatch(trackerEntry.content, /Secret Doom/);
    assert.match(trackerEntry.content, /- Updated \*\*Keys Found\*\*: 2\/3/);
    assert.match(trackerEntry.content, /- Deleted \*\*Alarm State\*\*/);

    const relationshipEntry = entries[1];
    assert.equal(relationshipEntry.type, 'relationship-updates');
    assert.equal(relationshipEntry.role, 'assistant');
    assert.equal(relationshipEntry.metadata.excludeFromBaseContextHistory, true);
    assert.equal(relationshipEntry.metadata.housekeepingUpdates, true);
    assert.deepEqual(relationshipEntry.metadata.relationshipUpdates.map(update => update.action), [
        'added',
        'updated',
        'deleted'
    ]);
    assert.doesNotMatch(relationshipEntry.content, /^## Relationship Updates/m);
    assert.match(relationshipEntry.content, /^- Added \*\*Mira\*\* -> \*\*Neka\*\*: trusted ally/);
    assert.match(relationshipEntry.content, /- Updated \*\*Neka\*\* -> \*\*Mira\*\*: guarded patron/);
    assert.match(relationshipEntry.content, /- Deleted \*\*Toma\*\* -> \*\*Mira\*\*/);
});

test('housekeeping update log omits empty or errored mutation summaries', () => {
    const entries = buildHousekeepingUpdateLogEntries([
        {
            name: 'addTracker',
            metadata: {
                status: 'failed',
                error: true,
                name: 'Broken Tracker',
                hiddenFromPlayer: false
            }
        },
        {
            name: 'removeTracker',
            metadata: {
                status: 'success',
                name: 'Hidden Alarm',
                hiddenFromPlayer: true
            }
        },
        {
            name: 'setRelationship',
            metadata: {
                status: 'partial_success',
                items: [
                    {
                        status: 'error',
                        characterA: { name: 'Mira' },
                        characterB: { name: 'Neka' },
                        relationship: 'trusted ally'
                    }
                ]
            }
        }
    ]);

    assert.deepEqual(entries, []);
});
