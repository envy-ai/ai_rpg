const Globals = require('./Globals.js');
const Player = require('./Player.js');
const Location = require('./Location.js');
const IdGenerator = require('./IdGenerator.js');

const KINDS = new Set(['teleport', 'summon', 'resurrection']);
let templates = new Map();
let active = new Map();
let actorRegistry = null;
function hasActiveLease(actorId) { return typeof actorId === 'string' && active.has(actorId); }
function cancelLeaseForActor(actorId) { return typeof actorId === 'string' ? active.delete(actorId) : false; }
function setActorRegistry(registry) {
  if (!(registry instanceof Map)) throw new TypeError('Technique utility actor registry must be the live players Map.');
  actorRegistry = registry;
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object.`);
  return value;
}
function fields(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unsupported. Use ${allowed.join(', ')}.`);
}
function id(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a nonempty ID.`);
  return value.trim();
}
function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer world-minute value.`);
  return value;
}
function positiveNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a finite positive number.`);
  return value;
}
function optionalId(value, path) { return value === undefined ? undefined : id(value, path); }
function currentActor(value, path) {
  if (!value?.id || Player.getById(value.id) !== value) throw new Error(`${path} is no longer a registered actor.`);
  return value;
}
function effectiveLocationId(actor) {
  return actor.currentLocation || (actor.isInPlayerParty ? Globals.currentPlayer?.currentLocation : null);
}
function scene(actor) {
  const location = Location.get(effectiveLocationId(actor));
  if (!location) throw new Error(`Actor ${actor.id} has no registered current location.`);
  return location;
}
function isPartyMember(actor) { return Boolean(actor.isInPlayerParty || actor.partyMembers?.size); }

function normalizeEffect(raw, label = 'effect') {
  object(raw, label);
  if (!KINDS.has(raw.kind)) throw new Error(`${label}.kind must be teleport, summon, or resurrection.`);
  const result = { id: id(raw.id, `${label}.id`), kind: raw.kind };
  if (raw.kind === 'teleport') {
    fields(raw, ['id', 'kind', 'destinationId', 'check'], label);
    if (raw.destinationId !== undefined) result.destinationId = id(raw.destinationId, `${label}.destinationId`);
  } else if (raw.kind === 'summon') {
    fields(raw, ['id', 'kind', 'summonMode', 'actorId', 'templateId', 'template', 'lifetimeMinutes', 'check'], label);
    if (!['existing', 'template'].includes(raw.summonMode)) throw new Error(`${label}.summonMode must be existing or template.`);
    result.summonMode = raw.summonMode;
    result.lifetimeMinutes = positiveInteger(raw.lifetimeMinutes, `${label}.lifetimeMinutes`);
    if (raw.summonMode === 'existing') {
      if (raw.templateId !== undefined || raw.template !== undefined) throw new Error(`${label}.templateId and template are only valid for template summoning.`);
      if (raw.actorId !== undefined) result.actorId = id(raw.actorId, `${label}.actorId`);
    } else {
      if (raw.actorId !== undefined) throw new Error(`${label}.actorId is only valid for existing-actor summoning.`);
      if (raw.templateId !== undefined && raw.template !== undefined) throw new Error(`${label}.templateId and template cannot both be supplied; choose one saved template or one inline typed template.`);
      if (raw.templateId !== undefined) result.templateId = id(raw.templateId, `${label}.templateId`);
      if (raw.template !== undefined) result.template = normalizeTemplate(raw.template, `${label}.template`, { allowMissingId: true });
    }
  } else {
    fields(raw, ['id', 'kind', 'health', 'check'], label);
    result.health = require('./Technique.js').normalizeAmount(raw.health, `${label}.health`);
    if (typeof result.health === 'number') positiveNumber(result.health, `${label}.health`);
  }
  if (raw.check !== undefined) result.check = structuredClone(raw.check);
  return result;
}

function normalizeTemplate(raw, label = 'template', { allowMissingId = false } = {}) {
  object(raw, label);
  fields(raw, ['id', 'name', 'description', 'shortDescription', 'class', 'race', 'gender', 'level', 'attributes', 'skills', 'health'], label);
  const text = (key, required = false) => {
    const value = raw[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${label}.${key} must be ${required ? 'nonempty ' : ''}text.`);
    return value.trim();
  };
  if (allowMissingId && raw.id !== undefined) throw new Error(`${label}.id is engine-owned for inline templates. Omit it.`);
  const out = { ...(allowMissingId ? {} : { id: id(raw.id, `${label}.id`) }), name: text('name', true), description: text('description', true) };
  for (const key of ['shortDescription', 'class', 'race', 'gender']) if (raw[key] !== undefined) out[key] = text(key);
  out.level = positiveInteger(raw.level, `${label}.level`);
  object(raw.attributes, `${label}.attributes`);
  for (const [name, value] of Object.entries(raw.attributes)) {
    if (!name.trim() || typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}.attributes.${name} must be a finite number under a nonempty name.`);
  }
  out.attributes = structuredClone(raw.attributes);
  object(raw.skills, `${label}.skills`);
  for (const [name, value] of Object.entries(raw.skills)) {
    if (!name.trim() || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}.skills.${name} must be a non-negative integer under a nonempty name.`);
  }
  out.skills = structuredClone(raw.skills);
  if (raw.health !== undefined) out.health = positiveNumber(raw.health, `${label}.health`);
  return out;
}

function addTemplate(raw) {
  const candidate = { ...object(raw, 'template'), id: raw.id ?? IdGenerator.next('summonTemplate', raw.name) };
  const template = normalizeTemplate(candidate);
  if (templates.has(template.id)) throw new Error(`Summon template ${template.id} already exists.`);
  templates.set(template.id, template);
  return structuredClone(template);
}
function findMatchingInlineTemplate(candidate) {
  const normalizedName = IdGenerator.normalizeName(candidate.name);
  const match = [...templates.values()].find(entry => IdGenerator.normalizeName(entry.name) === normalizedName);
  if (!match) return null;
  const { id: ignored, ...stored } = match;
  if (JSON.stringify(stored) !== JSON.stringify(candidate)) throw new Error(`Summon template name ${candidate.name} already exists with different typed fields. Choose its templateId or give this authored creature a distinct name.`);
  return match;
}
function validateTemplateForActor(template, actor) {
  const attributes = new Set(actor.getAttributeNames());
  const skills = new Set(actor.getSkills().keys());
  for (const name of Object.keys(template.attributes)) if (!attributes.has(name)) throw new Error(`summon template.attributes.${name} is not an available attribute. Use one of: ${[...attributes].join(', ')}.`);
  for (const name of Object.keys(template.skills)) if (!skills.has(name)) throw new Error(`summon template.skills.${name} is not an available skill. Use one of: ${[...skills].join(', ')}.`);
}
function getPromptContext(actor) {
  currentActor(actor, 'Technique actor');
  const actorSceneId = effectiveLocationId(actor);
  if (!actorSceneId) return { destinations: [], summonActors: [], summonTemplates: [...templates.values()].map(template => ({ id: template.id, name: template.name, description: template.description })), deadTargets: [] };
  const currentPlayer = Globals.currentPlayer;
  const destinations = Location.getAll()
    .filter(location => location.id === actorSceneId || location.visited)
    .map(location => ({ id: location.id, name: location.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const summonActors = Player.getAll()
    .filter(candidate => candidate.isNPC && !candidate.isDead && !candidate.isDisabled && !candidate.hiddenFromPlayer && !candidate.isInPlayerParty && candidate.id !== actor.id && !active.has(candidate.id) && Location.get(candidate.currentLocation) && candidate.currentLocation !== actorSceneId)
    .filter(candidate => candidate.lastSeenTime !== null || candidate.wasEverInPlayerParty || (actor !== currentPlayer && candidate.currentLocation === actorSceneId))
    .map(candidate => ({ id: candidate.id, name: candidate.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const summonTemplates = [...templates.values()].map(template => ({ id: template.id, name: template.name, description: template.description }));
  const deadTargets = Player.getAll()
    .filter(candidate => candidate.isDead && effectiveLocationId(candidate) === actorSceneId && (candidate === currentPlayer || candidate.isInPlayerParty || !candidate.isNPC || (scene(actor).npcIds.includes(candidate.id) && !candidate.hiddenFromPlayer)))
    .map(candidate => ({ id: candidate.id, name: candidate.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { destinations, summonActors, summonTemplates, deadTargets };
}

function validateEffectReferences({ actor, target, effect }) {
  currentActor(actor, 'Technique actor');
  if (effect.kind === 'teleport' || effect.kind === 'summon') {
    scene(actor);
  }
  if (effect.kind === 'teleport' && (!target || effectiveLocationId(target) !== effectiveLocationId(actor) || target.isDead)) throw new Error('Teleport requires a living target at the caster\'s scene.');
  if (effect.kind === 'summon' && target !== actor) throw new Error('Summon requires the caster as its sole target.');
  if (effect.kind === 'teleport' && effect.destinationId && !Location.get(effect.destinationId)) throw new Error(`effect.destinationId ${effect.destinationId} does not identify an existing location.`);
  if (effect.kind === 'summon') {
    if (effect.summonMode === 'existing' && effect.actorId) validateExistingSummon(actor, effect.actorId);
    if (effect.summonMode === 'template' && effect.templateId && !templates.has(effect.templateId)) throw new Error(`effect.templateId ${effect.templateId} does not identify a saved summon template.`);
    if (effect.summonMode === 'template' && effect.template) findMatchingInlineTemplate(effect.template);
  }
  if (effect.kind === 'resurrection') validateResurrection(actor, target);
}

function validateExistingSummon(actor, actorId) {
  const summoned = Player.getById(actorId);
  if (!summoned || !summoned.isNPC || summoned.isDead || summoned.isDisabled) throw new Error(`Summon actorId ${actorId} must identify an available living NPC.`);
  if (summoned === actor || isPartyMember(summoned)) throw new Error(`Summon actorId ${actorId} cannot be the caster or a party member.`);
  if (active.has(actorId)) throw new Error(`Summon actorId ${actorId} is already under an active summon lifetime.`);
  if (!Location.get(summoned.currentLocation)) throw new Error(`Summon actorId ${actorId} has no registered origin location.`);
  if (summoned.currentLocation === effectiveLocationId(actor)) throw new Error(`Summon actorId ${actorId} is already at the scene.`);
  return summoned;
}

function validateResurrection(actor, target) {
  currentActor(target, 'Resurrection target');
  if (!target.isDead) throw new Error('Resurrection requires an existing dead character target.');
  if (effectiveLocationId(target) !== effectiveLocationId(actor)) throw new Error(`Resurrection target ${target.id} is no longer at the caster's location.`);
  if (target.isNPC && !target.isInPlayerParty && !scene(actor).npcIds.includes(target.id)) throw new Error(`Resurrection target ${target.id} is absent from the scene.`);
}

function prepareEffect({ actor, target, targets = [target], effect, selection = {}, operationId, resolvedHealth }) {
  validateEffectReferences({ actor, target, effect });
  object(selection, 'utility selection');
  fields(selection, effect.kind === 'teleport' ? ['destinationId'] : effect.kind === 'summon' ? ['actorId', 'templateId'] : [], 'utility selection');
  const targetIds = targets.map(entry => id(entry?.id, 'targets[].id'));
  const common = { kind: effect.kind, effectId: effect.id, actorId: actor.id, targetId: target.id, actorLocationId: effectiveLocationId(actor), targetLocationId: effectiveLocationId(target), targetIds, operationId: id(operationId, 'operationId') };
  if (effect.kind === 'teleport') {
    const destinationId = effect.destinationId ?? id(selection.destinationId, 'utility selection.destinationId');
    if (effect.destinationId && selection.destinationId && effect.destinationId !== selection.destinationId) throw new Error('utility selection.destinationId conflicts with effect.destinationId.');
    const destination = Location.get(destinationId);
    if (!destination || destination.id === effectiveLocationId(target)) throw new Error(`Teleport destination ${destinationId} must be an existing different location.`);
    const partyOwner = Globals.currentPlayer;
    return { ...common, destinationId, travelWithPartyOwner: Boolean(target.isInPlayerParty && partyOwner && targetIds.includes(partyOwner.id)) };
  }
  if (effect.kind === 'summon') {
    const worldMinute = Globals.getTotalWorldMinutes();
    const expiresAtWorldMinute = worldMinute + effect.lifetimeMinutes;
    if (!Number.isSafeInteger(expiresAtWorldMinute)) throw new Error('Summon lifetime exceeds supported world minutes.');
    if (effect.summonMode === 'existing') {
      const actorId = effect.actorId ?? id(selection.actorId, 'utility selection.actorId');
      if (effect.actorId && selection.actorId && effect.actorId !== selection.actorId) throw new Error('utility selection.actorId conflicts with effect.actorId.');
      const summoned = validateExistingSummon(actor, actorId);
      return { ...common, summonMode: 'existing', summonedActorId: actorId, originLocationId: summoned.currentLocation, expiresAtWorldMinute, preparedWorldMinute: worldMinute };
    }
    if (effect.template) {
      if (selection.templateId !== undefined) throw new Error('utility selection.templateId is unavailable when effect.template authors the creature.');
      validateTemplateForActor(effect.template, actor);
      const matched = findMatchingInlineTemplate(effect.template);
      return { ...common, summonMode: 'template', templateId: matched?.id ?? null, template: structuredClone(matched ?? effect.template), installTemplate: !matched, expiresAtWorldMinute, preparedWorldMinute: worldMinute };
    }
    const templateId = effect.templateId ?? id(selection.templateId, 'utility selection.templateId');
    if (effect.templateId && selection.templateId && effect.templateId !== selection.templateId) throw new Error('utility selection.templateId conflicts with effect.templateId.');
    const template = templates.get(templateId);
    if (!template) throw new Error(`Summon template ${templateId} is no longer saved.`);
    validateTemplateForActor(template, actor);
    return { ...common, summonMode: 'template', templateId, template: structuredClone(template), installTemplate: false, expiresAtWorldMinute, preparedWorldMinute: worldMinute };
  }
  return { ...common, health: positiveNumber(resolvedHealth ?? effect.health, 'resurrection resolved health'), targetHealth: target.health, targetCorpseCountdown: target.corpseCountdown, targetStatuses: target.toJSON().statusEffects };
}

function assertCurrent(prepared) {
  object(prepared, 'prepared utility');
  const actor = currentActor(Player.getById(prepared.actorId), 'Technique actor');
  const target = currentActor(Player.getById(prepared.targetId), 'Technique target');
  if (effectiveLocationId(actor) !== prepared.actorLocationId) throw new Error('Technique scene changed during preparation.');
  if (prepared.kind === 'teleport') {
    if (!Location.get(prepared.destinationId) || prepared.destinationId === effectiveLocationId(target) || effectiveLocationId(target) !== prepared.targetLocationId || target.isDead) throw new Error('Teleport destination or target changed during preparation.');
    if (prepared.travelWithPartyOwner && (!target.isInPlayerParty || !prepared.targetIds.includes(Globals.currentPlayer?.id))) throw new Error('Teleport party cohort changed during preparation.');
  } else if (prepared.kind === 'summon') {
    if (actor !== target || Globals.getTotalWorldMinutes() !== prepared.preparedWorldMinute) throw new Error('Summon scene or world time changed during preparation.');
    if (prepared.summonMode === 'existing') {
      const summoned = validateExistingSummon(actor, prepared.summonedActorId);
      if (summoned.currentLocation !== prepared.originLocationId) throw new Error('Summon actor origin changed during preparation.');
    } else if (prepared.installTemplate) {
      const matched = findMatchingInlineTemplate(prepared.template);
      if (matched && ![...active.values()].some(lease => lease.operationId === prepared.operationId && lease.templateId === matched.id)) throw new Error('Summon template was installed by another operation during preparation. Prepare again using the saved template.');
    } else if (JSON.stringify(templates.get(prepared.templateId)) !== JSON.stringify(prepared.template)) throw new Error('Summon template changed during preparation.');
  } else if (prepared.kind === 'resurrection') {
    validateResurrection(actor, target);
    if (target.health !== prepared.targetHealth || target.corpseCountdown !== prepared.targetCorpseCountdown || JSON.stringify(target.toJSON().statusEffects) !== JSON.stringify(prepared.targetStatuses)) throw new Error('Resurrection target changed during preparation.');
  } else throw new Error(`Unsupported prepared utility kind ${prepared.kind}.`);
}

function captureMembership(actor, locations) {
  return { locationId: actor.currentLocation, memberships: locations.map(location => ({ id: location.id, npcIds: location.npcIds })) };
}
function restoreMembership(actor, snapshot) {
  actor.setLocation(snapshot.locationId ? Location.get(snapshot.locationId) : null);
  for (const entry of snapshot.memberships) Location.get(entry.id).setNpcIds(entry.npcIds);
}
function visitSnapshot(location) {
  const region = location.region;
  const regionJson = region?.toJSON?.();
  return { location, visited: location.visited, lastVisitedTime: location.lastVisitedTime, createdAt: location.createdAt.toISOString(), lastUpdated: location.lastUpdated.toISOString(), region, regionVisitedTime: region?.lastVisitedTime, regionCreatedAt: regionJson?.createdAt, regionLastUpdated: regionJson?.lastUpdated };
}
function restoreVisit(snapshot) {
  snapshot.location.visited = snapshot.visited;
  snapshot.location.lastVisitedTime = snapshot.lastVisitedTime;
  if (snapshot.region) {
    snapshot.region.lastVisitedTime = snapshot.regionVisitedTime;
    snapshot.region.restoreSavedTimestamps({ createdAt: snapshot.regionCreatedAt, lastUpdated: snapshot.regionLastUpdated });
  }
  snapshot.location.restoreSavedTimestamps({ createdAt: snapshot.createdAt, lastUpdated: snapshot.lastUpdated });
}

function applyEffect({ actor, target, effect, prepared, operationId }) {
  if (operationId !== prepared.operationId || actor.id !== prepared.actorId || target.id !== prepared.targetId || effect.id !== prepared.effectId || effect.kind !== prepared.kind) throw new Error('Prepared utility does not match the current operation/effect/target.');
  assertCurrent(prepared);
  if (prepared.kind === 'teleport') {
    const destination = Location.get(prepared.destinationId);
    const oldLocation = scene(target);
    if (prepared.travelWithPartyOwner) return { receipt: { kind: 'teleport', actorId: target.id, fromLocationId: oldLocation.id, destinationId: destination.id }, undo: () => {} };
    const wasPartyMember = target.isInPlayerParty;
    const oldArrival = Globals.snapshotPlayerArrivalVisitStates();
    const oldVisit = visitSnapshot(oldLocation);
    const destinationVisit = visitSnapshot(destination);
    const oldMembership = target.isNPC ? captureMembership(target, [oldLocation, destination]) : null;
    const undo = () => {
      if (target.isNPC) restoreMembership(target, oldMembership);
      else target.setLocation(oldLocation);
      if (wasPartyMember && !target.isInPlayerParty) Globals.currentPlayer.addPartyMember(target.id);
      restoreVisit(destinationVisit);
      restoreVisit(oldVisit);
      Globals.restorePlayerArrivalVisitStates(oldArrival);
    };
    try {
      if (wasPartyMember) Globals.currentPlayer.removePartyMember(target.id);
      if (target.isNPC) oldLocation.removeNpcId(target.id);
      target.setLocation(destination);
      if (target.isNPC) destination.addNpcId(target.id);
    } catch (error) {
      try { undo(); } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Teleport failed and rollback was incomplete.'); }
      throw error;
    }
    const receipt = { kind: 'teleport', actorId: target.id, fromLocationId: oldLocation.id, destinationId: destination.id };
    return { receipt, undo };
  }
  if (prepared.kind === 'summon') {
    const destination = scene(actor);
    if (prepared.summonMode === 'existing') {
      const summoned = Player.getById(prepared.summonedActorId);
      const origin = Location.get(prepared.originLocationId);
      const snapshot = captureMembership(summoned, [origin, destination]);
      const lease = { actorId: summoned.id, sourceActorId: summoned.id, originLocationId: origin.id, destinationLocationId: destination.id, expiresAtWorldMinute: prepared.expiresAtWorldMinute, operationId };
      try {
        origin.removeNpcId(summoned.id);
        summoned.setLocation(destination);
        destination.addNpcId(summoned.id);
        active.set(summoned.id, lease);
      } catch (error) {
        try { active.delete(summoned.id); restoreMembership(summoned, snapshot); } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Summon failed and rollback was incomplete.'); }
        throw error;
      }
      return { receipt: { kind: 'summon', summonMode: 'existing', actorId: summoned.id, actorName: summoned.name, fromLocationId: origin.id, destinationId: destination.id, expiresAtWorldMinute: lease.expiresAtWorldMinute }, undo: () => { active.delete(summoned.id); restoreMembership(summoned, snapshot); } };
    }
    const template = prepared.template;
    if (!(actorRegistry instanceof Map)) throw new Error('Technique utility actor registry is unavailable; bind the live players Map before template summoning.');
    const sameOperationTemplate = prepared.installTemplate ? findMatchingInlineTemplate(template) : null;
    const installTemplateNow = prepared.installTemplate && !sameOperationTemplate;
    const templateId = installTemplateNow ? IdGenerator.next('summonTemplate', template.name) : sameOperationTemplate?.id ?? prepared.templateId;
    const savedTemplate = installTemplateNow ? { id: templateId, ...template } : sameOperationTemplate ?? template;
    const summonedId = IdGenerator.next('character', template.name);
    let summoned;
    try {
      if (installTemplateNow) templates.set(templateId, savedTemplate);
      summoned = new Player({ ...savedTemplate, id: summonedId, isNPC: true, location: destination.id, inventory: [], barterInventory: [], gear: null, techniques: [], disciplineAccess: [], statusEffects: [], abilities: [], partyMembers: [], experience: 0, currency: 0 });
      actorRegistry.set(summoned.id, summoned);
      destination.addNpcId(summoned.id);
      const lease = { actorId: summoned.id, templateId, destinationLocationId: destination.id, expiresAtWorldMinute: prepared.expiresAtWorldMinute, operationId };
      active.set(summoned.id, lease);
      return { receipt: { kind: 'summon', summonMode: 'template', actorId: summoned.id, actorName: summoned.name, templateId, destinationId: destination.id, expiresAtWorldMinute: lease.expiresAtWorldMinute }, undo: () => { active.delete(summoned.id); destination.removeNpcId(summoned.id); actorRegistry.delete(summoned.id); Player.unregister(summoned); if (installTemplateNow) templates.delete(templateId); } };
    } catch (error) {
      if (summoned) { destination.removeNpcId(summoned.id); actorRegistry.delete(summoned.id); Player.unregister(summoned); }
      if (installTemplateNow) templates.delete(templateId);
      throw error;
    }
  }
  const prior = { health: target.health, dead: target.isDead, corpseCountdown: target.corpseCountdown, statuses: target.toJSON().statusEffects };
  const kept = prior.statuses.filter(status => !['deceased', 'incapacitated'].includes(String(status.name).trim().toLowerCase()));
  const undo = () => {
    target.setStatusEffects(prior.statuses);
    target.isDead = prior.dead;
    target.setHealth(prior.health);
    target.corpseCountdown = prior.corpseCountdown;
  };
  try {
    target.setStatusEffects(kept);
    target.isDead = false;
    target.setHealth(prepared.health);
    target.corpseCountdown = null;
  } catch (error) {
    try { undo(); } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Resurrection failed and rollback was incomplete.'); }
    throw error;
  }
  const receipt = { kind: 'resurrection', actorId: target.id, restoredHealth: target.health, removedStatusIds: prior.statuses.filter(status => status.name === 'Deceased' || status.name === 'Incapacitated').map(status => status.id) };
  return { receipt, undo };
}

function normalizeLease(raw, label) {
  object(raw, label);
  fields(raw, ['actorId', 'sourceActorId', 'templateId', 'originLocationId', 'destinationLocationId', 'expiresAtWorldMinute', 'operationId'], label);
  const result = { actorId: id(raw.actorId, `${label}.actorId`), destinationLocationId: id(raw.destinationLocationId, `${label}.destinationLocationId`), expiresAtWorldMinute: positiveInteger(raw.expiresAtWorldMinute, `${label}.expiresAtWorldMinute`), operationId: id(raw.operationId, `${label}.operationId`) };
  if (raw.sourceActorId === undefined && raw.templateId === undefined) throw new Error(`${label} needs sourceActorId or templateId.`);
  if (raw.sourceActorId !== undefined && raw.templateId !== undefined) throw new Error(`${label} cannot contain both sourceActorId and templateId.`);
  if (raw.sourceActorId !== undefined) {
    result.sourceActorId = id(raw.sourceActorId, `${label}.sourceActorId`);
    if (result.sourceActorId !== result.actorId) throw new Error(`${label}.sourceActorId must equal actorId for an existing-actor summon; repair the saved lease identity.`);
    result.originLocationId = id(raw.originLocationId, `${label}.originLocationId`);
  } else result.templateId = id(raw.templateId, `${label}.templateId`);
  return result;
}
function validateReceipt({ effect, receipt }) {
  object(effect, 'receipt.effect');
  object(receipt, 'receipt');
  const mutation = object(effect.mutation, 'receipt.effect.mutation');
  if (mutation.kind !== effect.kind) throw new Error('receipt.effect.mutation.kind must match receipt.effect.kind.');
  if (effect.kind === 'teleport') {
    fields(mutation, ['kind', 'actorId', 'fromLocationId', 'destinationId'], 'receipt.effect.mutation');
    if (id(mutation.actorId, 'receipt.effect.mutation.actorId') !== effect.targetId) throw new Error('receipt.effect.mutation.actorId must match the selected teleport target.');
    id(mutation.fromLocationId, 'receipt.effect.mutation.fromLocationId');
    id(mutation.destinationId, 'receipt.effect.mutation.destinationId');
  } else if (effect.kind === 'summon') {
    fields(mutation, ['kind', 'summonMode', 'actorId', 'actorName', 'templateId', 'fromLocationId', 'destinationId', 'expiresAtWorldMinute'], 'receipt.effect.mutation');
    if (effect.targetId !== receipt.actorId) throw new Error('receipt.effect.targetId for summon must be the caster.');
    id(mutation.actorId, 'receipt.effect.mutation.actorId');
    id(mutation.actorName, 'receipt.effect.mutation.actorName');
    id(mutation.destinationId, 'receipt.effect.mutation.destinationId');
    positiveInteger(mutation.expiresAtWorldMinute, 'receipt.effect.mutation.expiresAtWorldMinute');
    if (mutation.summonMode === 'template') {
      id(mutation.templateId, 'receipt.effect.mutation.templateId');
      if (mutation.fromLocationId !== undefined) throw new Error('Template summon receipt cannot have fromLocationId.');
    } else if (mutation.summonMode === 'existing') {
      id(mutation.fromLocationId, 'receipt.effect.mutation.fromLocationId');
      if (mutation.templateId !== undefined) throw new Error('Existing-actor summon receipt cannot have templateId.');
    } else throw new Error('receipt.effect.mutation.summonMode must be existing or template.');
  } else if (effect.kind === 'resurrection') {
    fields(mutation, ['kind', 'actorId', 'restoredHealth', 'removedStatusIds'], 'receipt.effect.mutation');
    if (id(mutation.actorId, 'receipt.effect.mutation.actorId') !== effect.targetId) throw new Error('receipt.effect.mutation.actorId must match the selected resurrection target.');
    positiveNumber(mutation.restoredHealth, 'receipt.effect.mutation.restoredHealth');
    if (!Array.isArray(mutation.removedStatusIds) || new Set(mutation.removedStatusIds).size !== mutation.removedStatusIds.length) throw new Error('receipt.effect.mutation.removedStatusIds must be an array of distinct status IDs.');
    mutation.removedStatusIds.forEach((value, index) => id(value, `receipt.effect.mutation.removedStatusIds[${index}]`));
  } else throw new Error('receipt.effect.kind is not a utility effect.');
}
function validateState(state, { actors = [], locations = [] } = {}) {
  if (state === undefined) return { version: 1, templates: [], active: [] };
  object(state, 'techniqueSummons');
  fields(state, ['version', 'templates', 'active'], 'techniqueSummons');
  if (state.version !== 1 || !Array.isArray(state.templates) || !Array.isArray(state.active)) throw new Error('techniqueSummons requires version 1, templates array, and active array.');
  const normalized = { version: 1, templates: state.templates.map((entry, index) => normalizeTemplate(entry, `techniqueSummons.templates[${index}]`)), active: state.active.map((entry, index) => normalizeLease(entry, `techniqueSummons.active[${index}]`)) };
  if (new Set(normalized.templates.map(entry => entry.id)).size !== normalized.templates.length) throw new Error('techniqueSummons.templates has duplicate IDs.');
  if (new Set(normalized.active.map(entry => entry.actorId)).size !== normalized.active.length) throw new Error('techniqueSummons.active has duplicate actor IDs.');
  const actorIds = new Set(actors.map(entry => entry?.id));
  const locationIds = new Set(locations.map(entry => entry?.id));
  for (const lease of normalized.active) {
    if (actors.length && !actorIds.has(lease.actorId)) throw new Error(`techniqueSummons.active actorId ${lease.actorId} does not exist.`);
    if (locations.length && !locationIds.has(lease.destinationLocationId)) throw new Error(`techniqueSummons.active destinationLocationId ${lease.destinationLocationId} does not exist.`);
    if (lease.originLocationId && locations.length && !locationIds.has(lease.originLocationId)) throw new Error(`techniqueSummons.active originLocationId ${lease.originLocationId} does not exist.`);
    if (lease.templateId && !normalized.templates.some(entry => entry.id === lease.templateId)) throw new Error(`techniqueSummons.active templateId ${lease.templateId} does not exist.`);
  }
  return normalized;
}
function hydrate(state) {
  const normalized = validateState(state);
  templates = new Map(normalized.templates.map(entry => [entry.id, entry]));
  active = new Map(normalized.active.map(entry => [entry.actorId, entry]));
}
function reset() { templates = new Map(); active = new Map(); }
function toJSON() { return { version: 1, templates: [...templates.values()].map(entry => structuredClone(entry)), active: [...active.values()].map(entry => structuredClone(entry)) }; }
function expireDue(worldMinute = Globals.getTotalWorldMinutes()) {
  if (!Number.isSafeInteger(worldMinute) || worldMinute < 0) throw new Error('Summon expiry requires a non-negative world minute.');
  const expired = [];
  for (const lease of active.values()) {
    if (lease.expiresAtWorldMinute > worldMinute) continue;
    const summoned = Player.getById(lease.actorId);
    if (!summoned) throw new Error(`Summon expiry actor ${lease.actorId} is missing.`);
    if (summoned.isInPlayerParty) {
      const player = Globals.currentPlayer;
      if (!player || !player.partyMembers.has(summoned.id)) throw new Error(`Summon expiry actor ${lease.actorId} has party membership without a registered party owner.`);
      player.removePartyMember(summoned.id);
    }
    if (lease.sourceActorId) {
      const origin = Location.get(lease.originLocationId);
      if (!origin) throw new Error(`Summon expiry origin ${lease.originLocationId} is missing.`);
      Player.removeNpcFromAllLocations(summoned.id);
      summoned.setLocation(origin);
      origin.addNpcId(summoned.id);
      active.delete(lease.actorId);
      expired.push({ actorId: lease.actorId, disposition: 'returned' });
    } else {
      const here = Location.get(summoned.currentLocation);
      if (!here) throw new Error(`Summon expiry actor ${lease.actorId} has no registered location for owned items.`);
      for (const item of summoned.getInventoryItems()) item.drop(here.id);
      for (const item of summoned.getBarterInventoryItems()) {
        if (!summoned.removeBarterInventoryItem(item)) throw new Error(`Summon expiry could not release barter item ${item.id} from actor ${summoned.id}.`);
        item.drop(here.id);
      }
      Player.removeNpcFromAllLocations(summoned.id);
      if (!(actorRegistry instanceof Map) || actorRegistry.get(summoned.id) !== summoned) throw new Error(`Summon expiry actor ${summoned.id} is not in the live players Map.`);
      actorRegistry.delete(summoned.id);
      Player.unregister(summoned);
      active.delete(lease.actorId);
      expired.push({ actorId: lease.actorId, disposition: 'removed' });
    }
  }
  return expired;
}

module.exports = { setActorRegistry, hasActiveLease, cancelLeaseForActor, normalizeEffect, normalizeTemplate, addTemplate, getPromptContext, validateEffectReferences, prepareEffect, assertCurrent, applyEffect, validateReceipt, validateState, hydrate, reset, toJSON, expireDue };
