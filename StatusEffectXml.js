'use strict';

const StatusEffect = require('./StatusEffect.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const { parseTechniqueXmlValue, writeTechniqueXmlValue } = require('./TechniqueXml.js');
const { XMLSerializer } = require('@xmldom/xmldom');
const { isDeepStrictEqual } = require('node:util');

const optional = type => ({ optionalEmptyLeaf: type });
const list = (tag, item) => ({ tag, item });
const provenance = { kind: 'text', reason: 'text', sourceId: optional('text'), private: optional('boolean'), worldMinute: optional('number'), operationId: optional('text') };
const statusProvenance = Object.fromEntries(['techniqueId', 'effectId', 'actorId', 'operationId', 'sourceId', 'sourceKind', 'itemId', 'statusId', 'abilityId', 'stacking', 'refreshPolicy'].map(key => [key, optional('text')]));
for (const key of ['definitionRevision', 'personalRevision', 'potency', 'authoredDuration']) statusProvenance[key] = optional('number');
const schema = {
    id: optional('text'), name: optional('text'), description: optional('text'), duration: optional('text'), appliedAt: optional('number'),
    attributes: list('attribute', { attribute: 'text', modifier: optional('number'), percentModifier: optional('number') }),
    skills: list('skill', { skill: 'text', modifier: optional('number'), percentModifier: optional('number') }),
    needBars: list('needBar', { name: 'text', delta: optional('number'), percentDelta: optional('number') }),
    needBarMaximums: list('needBarMaximum', { name: 'text', percentModifier: optional('number') }), maxHealthPercent: optional('number'),
    techniqueGrants: list('techniqueGrant', { id: optional('text'), sourceStatusId: optional('text'), techniqueId: 'text', definitionRevision: 'number', provenance }),
    techniqueProvenance: statusProvenance
};

function validateStatusEffectIdentities(effect, { existing = null, actor, path = 'statusEffect' }) {
    const Player = require('./Player.js');
    const choices = {
        attributes: actor.getAttributeNames(),
        skills: [...new Set([...actor.getSkills().keys(), ...Player.availableSkills.keys()])],
        needBars: ['Health', ...Object.values(Player.needBarDefinitions).flatMap(bar => [bar.id, bar.name]).filter(Boolean)],
        needBarMaximums: Object.values(Player.needBarDefinitions).flatMap(bar => [bar.id, bar.name]).filter(Boolean)
    };
    for (const [field, key] of [['attributes', 'attribute'], ['skills', 'skill'], ['needBars', 'name'], ['needBarMaximums', 'name']]) {
        const names = new Set(choices[field].map(name => name.trim().toLowerCase()));
        for (const [index, entry] of effect[field].entries()) {
            if ((existing?.[field] || []).some(previous => isDeepStrictEqual(previous, entry))) continue;
            if (!names.has(entry[key].trim().toLowerCase())) throw new Error(`${path}.${field}[${index}].${key} "${entry[key]}" is not available for ${actor.name}. Choose an actual configured identity: ${choices[field].join(', ') || 'none'}; preserve unchanged saved entries instead of inventing a new name.`);
        }
    }
}

function parseStatusEffectXml(node, { existing = null, actor = null, path = 'statusEffect', requireComplete = false } = {}) {
    const parsed = parseTechniqueXmlValue(node, schema, path);
    if (existing) {
        for (const key of ['id', 'appliedAt', 'techniqueProvenance']) {
            if (parsed[key] !== undefined && !isDeepStrictEqual(parsed[key], existing[key])) {
                throw new Error(`${path}.${key} is server-owned and cannot change. Preserve the existing value or omit this field.`);
            }
        }
        if (existing.techniqueGrants?.length && parsed.techniqueGrants !== undefined) {
            const grants = parsed.techniqueGrants.map(grant => {
                const matches = existing.techniqueGrants.filter(known => grant.id ? grant.id === known.id
                    : grant.techniqueId === known.techniqueId && grant.definitionRevision === known.definitionRevision);
                return matches.length === 1 ? { ...matches[0], ...grant } : grant;
            });
            if (!isDeepStrictEqual(grants, existing.techniqueGrants)) throw new Error(`${path}.techniqueGrants must preserve existing grant identities, source status and revision pins. Omit the field to retain them or return the complete unchanged list.`);
            parsed.techniqueGrants = grants;
        }
    }
    const candidate = { ...(existing || {}), ...parsed };
    if (requireComplete && !candidate.name?.trim()) throw new Error(`${path}.name is required.`);
    if (!candidate.description?.trim()) throw new Error(`${path}.description is required.`);
    try {
        const effect = new StatusEffect({ ...candidate, register: false }).toJSON();
        if (actor) validateStatusEffectIdentities(effect, { existing, actor, path });
        TechniqueService.validateStatusGrants([effect]);
        return effect;
    } catch (cause) {
        throw new Error(`${path}: ${cause.message}`, { cause });
    }
}

function renderStatusEffectXml(effect) {
    const document = Utils.parseXmlDocumentStrict('<effect/>', 'text/xml');
    const value = Object.fromEntries(Object.entries(effect).filter(([key, entry]) => Object.hasOwn(schema, key) && entry !== null && entry !== undefined && entry !== ''));
    if (value.duration !== undefined) value.duration = String(value.duration);
    writeTechniqueXmlValue(document.documentElement, value, schema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

module.exports = { parseStatusEffectXml, renderStatusEffectXml, validateStatusEffectIdentities, statusEffectXmlSchema: schema };
