'use strict';

const { createHash } = require('crypto');
const TechniqueService = require('./TechniqueService.js');

// Narrative setup candidates must become stale when the available mechanics
// change, even if no visible history entry has been added yet. Receipts belong
// to execution history; they are deliberately excluded from this projection.
function getTechniqueRuntimeFingerprint({ actors = new Map(), things = new Map() } = {}) {
    const { receipts, ...catalogue } = TechniqueService.toJSON({ includePresentation: false });
    const values = collection => collection instanceof Map ? [...collection.values()] : [...collection];
    const characters = values(actors).map(actor => ({
        id: actor.id,
        techniques: actor.techniques || [],
        disciplineAccess: actor.disciplineAccess || [],
        abilityStatuses: actor.getAbilities().map(ability => ({ id: ability.id, statusEffects: ability.statusEffects ?? [] })).filter(ability => ability.statusEffects.length),
        intrinsicStatuses: actor.getIntrinsicStatusEffects()
    })).filter(actor => actor.techniques.length || actor.disciplineAccess.length || actor.abilityStatuses.length || actor.intrinsicStatuses.length)
        .sort((a, b) => a.id.localeCompare(b.id));
    const equipment = values(things).filter(thing => thing.techniqueGrants?.length || thing.causeStatusEffectsOnEquipper?.length).map(thing => ({
        id: thing.id,
        techniqueGrants: thing.techniqueGrants,
        causeStatusEffectsOnEquipper: thing.causeStatusEffectsOnEquipper,
        equippedBy: thing.equippedBy?.id || null,
        equippedSlot: thing.equippedSlot
    })).sort((a, b) => a.id.localeCompare(b.id));
    return createHash('sha256').update(JSON.stringify({ catalogue, characters, equipment })).digest('hex');
}

module.exports = { getTechniqueRuntimeFingerprint };
