const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findSameLocationNpcByName,
  filterGeneratedNpcsAgainstSameLocationDuplicates
} = require('../NpcGenerationNameUtils.js');

test('findSameLocationNpcByName only matches NPCs in the provided location', () => {
  const locationA = {
    id: 'loc-a',
    npcIds: ['npc-a']
  };
  const locationB = {
    id: 'loc-b',
    npcIds: ['npc-b']
  };
  const playersById = new Map([
    ['npc-a', { id: 'npc-a', name: 'Mara Voss', isNPC: true }],
    ['npc-b', { id: 'npc-b', name: 'Mara Voss', isNPC: true }]
  ]);

  const matchInA = findSameLocationNpcByName({
    name: 'Mara Voss',
    location: locationA,
    playersById
  });
  const matchInB = findSameLocationNpcByName({
    name: 'Mara Voss',
    location: locationB,
    playersById
  });

  assert.equal(matchInA?.id, 'npc-a');
  assert.equal(matchInB?.id, 'npc-b');
});

test('filterGeneratedNpcsAgainstSameLocationDuplicates skips only same-location duplicates', () => {
  const locationA = {
    id: 'loc-a',
    npcIds: ['npc-a']
  };
  const locationB = {
    id: 'loc-b',
    npcIds: ['npc-b']
  };
  const playersById = new Map([
    ['npc-a', { id: 'npc-a', name: 'Mara Voss', isNPC: true }],
    ['npc-b', { id: 'npc-b', name: 'Iven Holt', isNPC: true }]
  ]);

  const memoryMap = new Map([
    ['mara voss', ['Existing memory']],
    ['iven holt', ['Different location memory']],
    ['talia reed', ['Fresh npc memory']]
  ]);

  const result = filterGeneratedNpcsAgainstSameLocationDuplicates({
    npcDataList: [
      { name: 'Mara Voss', locationId: 'loc-a' },
      { name: 'Iven Holt', locationId: 'loc-a' },
      { name: 'Talia Reed', locationId: 'loc-a' }
    ],
    memoryMap,
    resolveTargetLocation: npcData => (npcData.locationId === 'loc-a' ? locationA : locationB),
    playersById
  });

  assert.deepEqual(
    result.npcDataList.map(npc => npc.name),
    ['Iven Holt', 'Talia Reed']
  );
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].existingNpc.id, 'npc-a');
  assert.equal(result.memoryMap.has('mara voss'), false);
  assert.equal(result.memoryMap.has('iven holt'), true);
});
