function normalizeNpcNameForDuplicateCheck(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[^\w\s]|_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getLocationNpcIds(location) {
  if (!location || typeof location !== 'object') {
    return [];
  }

  if (Array.isArray(location.npcIds)) {
    return location.npcIds.slice();
  }

  if (typeof location.getNpcIds === 'function') {
    return Array.from(location.getNpcIds());
  }

  return [];
}

function findSameLocationNpcByName({
  name,
  location,
  playersById,
  excludeNpcIds = []
} = {}) {
  const normalizedTargetName = normalizeNpcNameForDuplicateCheck(name);
  if (!normalizedTargetName || !location) {
    return null;
  }

  if (!(playersById instanceof Map)) {
    throw new Error('findSameLocationNpcByName requires playersById to be a Map.');
  }

  const excludedIds = new Set();
  if (Array.isArray(excludeNpcIds)) {
    for (const npcId of excludeNpcIds) {
      if (typeof npcId === 'string' && npcId.trim()) {
        excludedIds.add(npcId.trim());
      }
    }
  } else if (typeof excludeNpcIds === 'string' && excludeNpcIds.trim()) {
    excludedIds.add(excludeNpcIds.trim());
  }

  for (const npcId of getLocationNpcIds(location)) {
    if (typeof npcId !== 'string' || !npcId.trim() || excludedIds.has(npcId.trim())) {
      continue;
    }

    const npc = playersById.get(npcId.trim());
    if (!npc || npc.isNPC !== true) {
      continue;
    }

    if (normalizeNpcNameForDuplicateCheck(npc.name) === normalizedTargetName) {
      return npc;
    }
  }

  return null;
}

function filterGeneratedNpcsAgainstSameLocationDuplicates({
  npcDataList,
  memoryMap = null,
  resolveTargetLocation,
  playersById,
  log = null
} = {}) {
  if (!Array.isArray(npcDataList)) {
    throw new Error('filterGeneratedNpcsAgainstSameLocationDuplicates requires npcDataList to be an array.');
  }
  if (typeof resolveTargetLocation !== 'function') {
    throw new Error('filterGeneratedNpcsAgainstSameLocationDuplicates requires resolveTargetLocation to be a function.');
  }
  if (!(playersById instanceof Map)) {
    throw new Error('filterGeneratedNpcsAgainstSameLocationDuplicates requires playersById to be a Map.');
  }

  const filteredNpcDataList = [];
  const skipped = [];

  for (const npcData of npcDataList) {
    const npcName = typeof npcData?.name === 'string' ? npcData.name.trim() : '';
    if (!npcName) {
      filteredNpcDataList.push(npcData);
      continue;
    }

    const targetLocation = resolveTargetLocation(npcData);
    if (!targetLocation) {
      filteredNpcDataList.push(npcData);
      continue;
    }

    const existingNpc = findSameLocationNpcByName({
      name: npcName,
      location: targetLocation,
      playersById
    });
    if (!existingNpc) {
      filteredNpcDataList.push(npcData);
      continue;
    }

    if (memoryMap instanceof Map) {
      memoryMap.delete(npcName.toLowerCase());
    }

    if (typeof log === 'function') {
      log({ npcData, existingNpc, targetLocation });
    }

    skipped.push({
      npcData,
      existingNpc,
      targetLocation
    });
  }

  return {
    npcDataList: filteredNpcDataList,
    memoryMap,
    skipped
  };
}

module.exports = {
  normalizeNpcNameForDuplicateCheck,
  findSameLocationNpcByName,
  filterGeneratedNpcsAgainstSameLocationDuplicates
};
