'use strict';

// Check totals include native modifiers; stored ranks remain authoritative for
// advancement, prerequisites and formula bindings that explicitly request ranks.
function fromBase(actor, key, baseValue) {
    if (!Number.isFinite(baseValue)) throw new TypeError(`Skill ${key}: base rank must be finite.`);
    const modifiers = key && typeof actor?.getSkillModifiers === 'function'
        ? actor.getSkillModifiers(key)
        : [];
    if (!Array.isArray(modifiers)) throw new TypeError(`Skill ${key}: modifiers must be an array.`);
    let value = baseValue;
    for (const [index, entry] of modifiers.entries()) {
        if (!Number.isFinite(entry?.modifier)) {
            throw new TypeError(`Skill ${key}.modifiers[${index}].modifier must be finite. Correct the owning effect's modifier.`);
        }
        value += entry.modifier;
    }
    if (!Number.isFinite(value)) throw new RangeError(`Skill ${key}: combined check value must be finite. Correct the contributing modifiers.`);
    return { key, baseValue, value, modifiers };
}

function resolve(actor, skillName) {
    const key = typeof skillName === 'string' ? skillName.trim() : '';
    if (!actor || !key) return fromBase(null, null, 0);
    const direct = actor.getSkillValue?.(key);
    if (Number.isFinite(direct)) return fromBase(actor, key, direct);
    const skills = actor.getSkills?.();
    if (skills && typeof skills.entries === 'function') {
        for (const [name, value] of skills.entries()) {
            if (typeof name === 'string' && name.toLowerCase() === key.toLowerCase() && Number.isFinite(value)) {
                return fromBase(actor, name, value);
            }
        }
    }
    return fromBase(actor, key, 0);
}

module.exports = { fromBase, resolve };
