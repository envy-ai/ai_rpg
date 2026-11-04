const { normalizeDuplicateName } = require('./DuplicateNameUtils.js');

let getPendingRegionStubs = () => [];

function configureLocationCreationNameGuard(options) {
  if (typeof options?.getPendingRegionStubs !== 'function') {
    throw new TypeError('Location name validation requires a pending-region provider.');
  }
  getPendingRegionStubs = options.getPendingRegionStubs;
}

function getLocationCreationPendingRegionStubs() {
  const pending = getPendingRegionStubs();
  collectionValues(pending);
  return pending;
}

function collectionValues(collection) {
  if (collection === null) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return collection.values();
  throw new TypeError('Location name validation regions must be an array or Map.');
}

function findLocationRegionNameConflict(name, options = {}) {
  const normalizedName = normalizeDuplicateName(name);
  if (!normalizedName) return null;
  const regions = options.regions === undefined ? require('./Region.js').getAll() : options.regions;
  const pending = options.pendingRegionStubs === undefined ? getPendingRegionStubs() : options.pendingRegionStubs;
  for (const [collection, isPending] of [[regions, false], [pending, true]]) {
    for (const region of collectionValues(collection)) {
      if (!region || typeof region !== 'object') continue;
      const names = isPending ? [region.name, region.originalName, region.targetRegionName] : [region.name];
      if (!names.some(candidate => normalizeDuplicateName(candidate) === normalizedName)) continue;
      const conflictName = names.find(candidate => typeof candidate === 'string' && candidate.trim())?.trim() || name.trim();
      const conflictId = typeof region.id === 'string' && region.id.trim() ? region.id.trim() : null;
      return {
        reason: isPending ? 'duplicate_pending_region' : 'duplicate_region',
        conflictType: isPending ? 'pending_region' : 'region',
        conflictName,
        conflictId,
        messagePart: `${isPending ? 'pending' : 'existing'} region "${conflictName}"${conflictId ? ` (id: ${conflictId})` : ''}`
      };
    }
  }
  return null;
}

function assertNewLocationNameAvailable(name, options) {
  const conflict = findLocationRegionNameConflict(name, options);
  if (!conflict) return;
  const error = new Error(`${conflict.conflictName} is already a region. Travel to that region, choose a different location, or stay here.`);
  error.code = 'location_region_name_conflict';
  error.nameRejection = conflict;
  throw error;
}

module.exports = {
  configureLocationCreationNameGuard,
  getLocationCreationPendingRegionStubs,
  findLocationRegionNameConflict,
  assertNewLocationNameAvailable
};
