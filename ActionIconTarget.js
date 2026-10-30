'use strict';

const Player = require('./Player.js');
const TechniqueService = require('./TechniqueService.js');

/** Presentation adapter: icon writes never rewrite an ability or technique's mechanics. */
function resolveActionIconTarget(entityType, entityId, { players } = {}) {
    if (!['ability', 'technique', 'discipline'].includes(entityType)) throw new Error(`Unsupported action icon type '${entityType}'.`);
    if (typeof entityId !== 'string' || !entityId.trim()) throw new TypeError('Action icon entityId is required.');
    const id = entityId.trim();
    let read, update;
    if (entityType === 'ability') {
        const parts = id.split(':');
        if (parts.length !== 2 || parts.some(part => !part)) throw new Error('Ability image entityId must be actorId:abilityId.');
        const [actorId, abilityId] = parts;
        const actor = players ? players.get(actorId) : Player.getById(actorId);
        if (!actor) throw new Error(`Ability icon actor '${actorId}' was not found.`);
        read = () => {
            const current = players ? players.get(actorId) : Player.getById(actorId);
            if (current !== actor) throw new Error(`Ability icon actor '${actorId}' changed during image generation.`);
            const ability = actor.getAbilityById(abilityId);
            if (!ability) throw new Error(`Ability '${abilityId}' was not found on '${actorId}'.`);
            return ability;
        };
        update = values => { read(); actor.updateAbilityImage(abilityId, values); };
    } else {
        const epoch = TechniqueService.getRuntimeEpoch();
        const discipline = entityType === 'discipline';
        const label = discipline ? 'Discipline' : 'Technique';
        read = () => {
            if (TechniqueService.getRuntimeEpoch() !== epoch) throw new Error(`${label} icon target changed because the game runtime was reset or loaded.`);
            const definition = discipline ? TechniqueService.getDiscipline(id) : TechniqueService.getDefinition(id);
            if (!definition) throw new Error(`${label} '${id}' was not found.`);
            return { ...definition, ...(discipline ? TechniqueService.getDisciplineIcon(id) : TechniqueService.getIcon(id)) };
        };
        update = values => {
            read();
            if (discipline) TechniqueService.setDisciplineIcon(id, values);
            else TechniqueService.setIcon(id, values);
        };
    }
    read();
    return {
        id,
        entityType,
        get name() { return read().name; },
        get description() { return read().description; },
        get shortDescription() { return read().shortDescription || ''; },
        get imageId() { return read().imageId; },
        set imageId(value) { update({ imageId: value }); },
        get imagePrompt() { return read().imagePrompt; },
        set imagePrompt(value) { update({ imagePrompt: value }); },
        toJSON: () => read()
    };
}

module.exports = { resolveActionIconTarget };
