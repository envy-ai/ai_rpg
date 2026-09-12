'use strict';

const { randomUUID } = require('crypto');
const Faction = require('./Faction.js');
const Player = require('./Player.js');
const { isActorDispositionHostile } = require('./DispositionHostility.js');
const {
  calculateArrivalProbability,
  loadLocationDangerDefinition,
  resolveEffectiveLocationDanger,
  resolveFactionDangerRating,
  selectDangerSource
} = require('./LocationDanger.js');

class HostileArrivalInvalidatedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostileArrivalInvalidatedError';
    this.code = 'HOSTILE_ARRIVAL_INVALIDATED';
  }
}

function normalizeCapacity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error('Location generationHints.numHostiles must be a non-negative integer or null.');
  }
  return value;
}

function assertHostileDraftCapacity({ destination, currentHostileCount, draftCount } = {}) {
  const currentCapacity = normalizeCapacity(destination?.generationHints?.numHostiles);
  if (currentCapacity === null) {
    throw new HostileArrivalInvalidatedError('Hostile arrival capacity was removed before commit.');
  }
  if (!Number.isInteger(currentHostileCount) || currentHostileCount < 0) {
    throw new TypeError('Current hostile count must be a non-negative integer.');
  }
  if (!Number.isInteger(draftCount) || draftCount < 1) {
    throw new TypeError('Hostile draft count must be a positive integer.');
  }
  if ((currentCapacity - currentHostileCount) < draftCount) {
    throw new HostileArrivalInvalidatedError('Hostile arrival capacity or occupancy changed before commit.');
  }
  return currentCapacity;
}

function countLivingHostiles({ location, player, players, dispositionDefinitions = Player.dispositionDefinitions } = {}) {
  if (!location || !player || !(players instanceof Map)) {
    throw new Error('Hostile occupancy requires a location, player, and players Map.');
  }
  const locationId = location.id;
  let count = 0;
  for (const npcId of location.npcIds || []) {
    const npc = players.get(npcId);
    if (!npc || npc.isNPC !== true || npc.isDead === true || npc.deleted === true || npc.isDeleted === true) continue;
    const npcLocationId = npc.currentLocation || npc.locationId || null;
    if (npcLocationId !== locationId) continue;
    if (isActorDispositionHostile(npc, player, dispositionDefinitions)) count += 1;
  }
  return count;
}

function buildArrivalPlan({
  arrivalId,
  destination,
  wasVisitedBeforeArrival,
  priorLastVisitedTime,
  currentWorldMinute,
  player,
  players,
  factions = null,
  definition = null,
  random = Math.random
} = {}) {
  const id = typeof arrivalId === 'string' && arrivalId.trim() ? arrivalId.trim() : randomUUID();
  const diagnostic = {
    arrivalId: id,
    destinationId: destination?.id || null,
    wasVisitedBeforeArrival,
    skipReason: null
  };
  if (!destination || typeof destination !== 'object' || !destination.id) {
    throw new Error('Hostile arrival planning requires a destination with an id.');
  }
  if (wasVisitedBeforeArrival !== true) {
    diagnostic.skipReason = 'first_or_unconfirmed_visit';
    return { eligible: false, shouldGenerate: false, diagnostic };
  }

  const capacity = normalizeCapacity(destination.generationHints?.numHostiles);
  diagnostic.hostileCapacity = capacity;
  if (capacity === null || capacity === 0) {
    diagnostic.skipReason = 'no_hostile_capacity';
    return { eligible: false, shouldGenerate: false, diagnostic };
  }
  const livingHostileCount = countLivingHostiles({ location: destination, player, players });
  const deficit = capacity - livingHostileCount;
  Object.assign(diagnostic, { livingHostileCount, hostileDeficit: deficit });
  if (deficit <= 0) {
    diagnostic.skipReason = 'at_capacity';
    return { eligible: false, shouldGenerate: false, diagnostic };
  }

  const resolvedDefinition = definition || loadLocationDangerDefinition();
  const wild = resolveEffectiveLocationDanger(destination);
  Object.assign(diagnostic, wild);

  const factionMap = factions instanceof Map ? factions : new Map(Faction.getAll().map(entry => [entry.id, entry]));
  const controllingFactionId = typeof destination.controllingFactionId === 'string' && destination.controllingFactionId.trim()
    ? destination.controllingFactionId.trim()
    : null;
  const controllingFaction = controllingFactionId ? factionMap.get(controllingFactionId) || Faction.get(controllingFactionId) : null;
  let faction = { antagonismBand: 0, violenceLevel: null, factionRating: 1, factionContribution: 0 };
  if (controllingFaction) {
    const standing = player.getFactionStanding(controllingFaction.id);
    faction = resolveFactionDangerRating({
      standing,
      violenceLevel: controllingFaction.violenceLevel,
      thresholds: resolvedDefinition.factionStandingThresholds
    });
  }
  Object.assign(diagnostic, {
    controllingFactionId: controllingFaction?.id || null,
    antagonismBand: faction.antagonismBand,
    violenceLevel: faction.violenceLevel,
    factionRating: faction.factionRating,
    factionContribution: faction.factionContribution
  });
  if (wild.wildContribution === 0 && faction.factionContribution === 0) {
    diagnostic.skipReason = 'no_danger_contribution';
    return { eligible: false, shouldGenerate: false, diagnostic };
  }
  if (priorLastVisitedTime === null || priorLastVisitedTime === undefined) {
    diagnostic.skipReason = 'missing_prior_visit_time';
    diagnostic.arrivalProbability = 0;
    return { eligible: false, shouldGenerate: false, diagnostic };
  }
  if (typeof currentWorldMinute !== 'number' || !Number.isFinite(currentWorldMinute)) {
    throw new Error('Current world minute must be finite for hostile arrival planning.');
  }
  if (typeof priorLastVisitedTime !== 'number' || !Number.isFinite(priorLastVisitedTime)) {
    throw new Error('Prior last-visited minute must be finite or null.');
  }
  const elapsedMinutes = currentWorldMinute - priorLastVisitedTime;
  if (elapsedMinutes < 0) {
    throw new Error(`Destination prior visit time is ${Math.abs(elapsedMinutes)} minute(s) in the future.`);
  }
  const effectiveRating = Math.max(wild.effectiveDangerLevel, faction.factionRating);
  const curve = resolvedDefinition.arrivalProbabilityByRating[effectiveRating];
  const arrivalProbability = calculateArrivalProbability(
    effectiveRating,
    elapsedMinutes,
    resolvedDefinition.arrivalProbabilityByRating
  );
  const presenceRoll = random();
  if (typeof presenceRoll !== 'number' || !Number.isFinite(presenceRoll) || presenceRoll < 0 || presenceRoll >= 1) {
    throw new Error('Hostile presence random value must be in [0, 1).');
  }
  Object.assign(diagnostic, {
    elapsedMinutes,
    effectiveRating,
    halfLifeMinutes: curve.halfLifeMinutes,
    probabilityCap: curve.cap,
    arrivalProbability,
    presenceRoll
  });
  if (presenceRoll >= arrivalProbability) {
    diagnostic.skipReason = 'presence_roll_failed';
    return { eligible: true, shouldGenerate: false, diagnostic };
  }
  let sourceRoll = null;
  const source = selectDangerSource({
    wildRating: wild.effectiveDangerLevel,
    factionRating: faction.factionRating,
    random: () => {
      sourceRoll = random();
      return sourceRoll;
    }
  });
  const pendingAttempt = {
    id: `hostile_arrival_${id}`,
    arrivalId: id,
    destinationId: destination.id,
    source,
    factionId: source === 'faction' ? controllingFaction.id : null,
    maximumCount: deficit,
    status: 'pending'
  };
  Object.assign(diagnostic, {
    selectedSource: source,
    sourceRoll,
    pendingAttemptId: pendingAttempt.id
  });
  pendingAttempt.diagnostic = { ...diagnostic };
  return { eligible: true, shouldGenerate: true, deficit, source, pendingAttempt, diagnostic };
}

class LocationHostileArrivalService {
  constructor({ definition = null, random = Math.random, diagnosticLogger = console.info } = {}) {
    this.definition = definition || loadLocationDangerDefinition();
    this.random = random;
    this.diagnosticLogger = diagnosticLogger;
    this.pendingAttempts = new Map();
    this.completedArrivalIds = new Set();
    this.destinationLocks = new Map();
  }

  hydrate({ pendingAttempts = [], completedArrivalIds = [] } = {}) {
    this.pendingAttempts = new Map((pendingAttempts || []).map(entry => [entry.arrivalId, { ...entry }]));
    this.completedArrivalIds = new Set(completedArrivalIds || []);
  }

  toJSON() {
    return {
      pendingAttempts: Array.from(this.pendingAttempts.values()).map(entry => ({ ...entry })),
      completedArrivalIds: Array.from(this.completedArrivalIds)
    };
  }

  plan(options) {
    const requestedArrivalId = options?.arrivalId;
    let arrivalId = requestedArrivalId;
    if (this.completedArrivalIds.has(arrivalId)) {
      return { eligible: false, shouldGenerate: false, diagnostic: { arrivalId, skipReason: 'arrival_already_completed' } };
    }
    let existing = this.pendingAttempts.get(arrivalId);
    if (!existing && options?.destination?.id) {
      const destinationPending = Array.from(this.pendingAttempts.values()).filter(entry => (
        entry?.destinationId === options.destination.id
      ));
      if (destinationPending.length > 1) {
        throw new Error(`Multiple hostile arrival attempts are pending for destination "${options.destination.id}".`);
      }
      if (destinationPending.length === 1) {
        existing = destinationPending[0];
        arrivalId = existing.arrivalId;
      }
    }
    if (existing) {
      return {
        eligible: true,
        shouldGenerate: true,
        deficit: existing.maximumCount,
        source: existing.source,
        pendingAttempt: existing,
        diagnostic: {
          ...(existing.diagnostic || {}),
          arrivalId,
          requestedArrivalId: requestedArrivalId || null,
          destinationId: existing.destinationId,
          selectedSource: existing.source,
          resumed: true
        }
      };
    }
    const plan = buildArrivalPlan({ ...options, definition: this.definition, random: this.random });
    if (plan.pendingAttempt) this.pendingAttempts.set(plan.pendingAttempt.arrivalId, plan.pendingAttempt);
    if (!plan.shouldGenerate) this.completedArrivalIds.add(plan.diagnostic.arrivalId);
    this.diagnosticLogger('[location-hostile-arrival]', plan.diagnostic);
    return plan;
  }

  async run(options, { generateBatch, revalidate, commitBatch, persistPending = null } = {}) {
    const destinationId = options?.destination?.id;
    if (this.destinationLocks.has(destinationId)) return this.destinationLocks.get(destinationId);
    let activeArrivalId = options?.arrivalId || null;
    const promise = (async () => {
      const plan = this.plan(options);
      activeArrivalId = plan.pendingAttempt?.arrivalId || plan.diagnostic?.arrivalId || activeArrivalId;
      if (!plan.shouldGenerate) return { ...plan, generated: [] };
      if (typeof generateBatch !== 'function' || typeof revalidate !== 'function' || typeof commitBatch !== 'function') {
        throw new Error('Hostile arrival generation requires generateBatch, revalidate, and commitBatch functions.');
      }
      if (persistPending !== null && typeof persistPending !== 'function') {
        throw new TypeError('Hostile arrival persistPending must be a function or null.');
      }
      if (persistPending) await persistPending(plan.pendingAttempt);
      const drafts = await generateBatch(plan);
      if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > plan.deficit) {
        throw new Error(`Hostile presence generator must return 1 through ${plan.deficit} NPC drafts.`);
      }
      await revalidate(plan, drafts);
      const generated = await commitBatch(plan, drafts);
      plan.pendingAttempt.status = 'complete';
      plan.pendingAttempt.generatedNpcIds = (generated || []).map(npc => npc?.id).filter(Boolean);
      this.pendingAttempts.delete(plan.pendingAttempt.arrivalId);
      this.completedArrivalIds.add(plan.pendingAttempt.arrivalId);
      if (plan.diagnostic?.requestedArrivalId) {
        this.completedArrivalIds.add(plan.diagnostic.requestedArrivalId);
      }
      this.diagnosticLogger('[location-hostile-arrival]', {
        ...plan.diagnostic,
        generatedNpcIds: plan.pendingAttempt.generatedNpcIds
      });
      return { ...plan, generated };
    })().catch(error => {
      if (error?.code === 'HOSTILE_ARRIVAL_INVALIDATED' && activeArrivalId) {
        this.pendingAttempts.delete(activeArrivalId);
        this.completedArrivalIds.add(activeArrivalId);
        if (options?.arrivalId) {
          this.completedArrivalIds.add(options.arrivalId);
        }
      }
      this.diagnosticLogger('[location-hostile-arrival]', {
        arrivalId: activeArrivalId,
        destinationId: destinationId || null,
        failureReason: error?.message || String(error),
        invalidated: error?.code === 'HOSTILE_ARRIVAL_INVALIDATED'
      });
      throw error;
    }).finally(() => this.destinationLocks.delete(destinationId));
    this.destinationLocks.set(destinationId, promise);
    return promise;
  }
}

module.exports = {
  HostileArrivalInvalidatedError,
  LocationHostileArrivalService,
  assertHostileDraftCapacity,
  buildArrivalPlan,
  countLivingHostiles,
  normalizeCapacity
};
