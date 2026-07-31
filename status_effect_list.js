'use strict';

/**
 * Shared status-effect list helpers for the entity classes (Location, Region,
 * Thing, Player). These functions operate on a passed-in effects array so the
 * owning classes keep their private fields, timestamp conventions, and hooks
 * (health reconciliation, enrichment triggers) while sharing the list logic.
 *
 * Serialized output is preserved per class: callers choose the normalization
 * options and copy/tick factories that match their stored representation
 * (StatusEffect instances vs plain objects).
 */

const StatusEffect = require('./StatusEffect.js');

/**
 * Shared input preparation used by every addStatusEffect implementation:
 * strings become { description, duration: defaultDuration } and object entries
 * without an explicit duration inherit defaultDuration.
 */
function prepareStatusEffectInputs(effectInput, defaultDuration = 1) {
    const effects = Array.isArray(effectInput) ? effectInput : [effectInput];
    return effects.map(entry => {
        if (typeof entry === 'string') {
            return { description: entry, duration: defaultDuration };
        }
        if (entry && typeof entry === 'object' && entry.description && entry.duration === undefined) {
            return { ...entry, duration: defaultDuration };
        }
        return entry;
    });
}

/**
 * Normalize raw entries into StatusEffect instances (Location/Thing/Player).
 * Options:
 * - throwOnInvalid: throw on empty/invalid entries instead of skipping them
 *   (Thing/Player throw, Location skips).
 * - skipFalsy: skip falsy entries (Location/Thing) vs throwing (Player).
 * - includeNeedBars: pass needBars through to StatusEffect (Player only).
 * - defaultAppliedAt: appliedAt fallback when an entry does not specify one
 *   (Player only; undefined for Location/Thing, which StatusEffect maps to null).
 * - fixInstanceAppliedAt: repair appliedAt on incoming StatusEffect instances
 *   (Player only).
 */
function normalizeStatusEffectInstances(effects = [], {
    throwOnInvalid = false,
    skipFalsy = true,
    includeNeedBars = false,
    defaultAppliedAt = undefined,
    fixInstanceAppliedAt = false
} = {}) {
    if (!Array.isArray(effects)) {
        return [];
    }

    const normalized = [];
    for (const entry of effects) {
        if (entry instanceof StatusEffect) {
            if (fixInstanceAppliedAt && (!Number.isFinite(entry.appliedAt) || entry.appliedAt < 0)) {
                entry.appliedAt = defaultAppliedAt;
            }
            normalized.push(entry);
            continue;
        }

        if (skipFalsy && !entry) {
            continue;
        }

        if (typeof entry === 'string') {
            const description = entry.trim();
            if (!description) {
                if (throwOnInvalid) {
                    throw new Error('Status effect description must not be empty');
                }
                continue;
            }
            normalized.push(new StatusEffect({
                description,
                duration: 1,
                appliedAt: defaultAppliedAt
            }));
            continue;
        }

        if (entry && typeof entry === 'object') {
            const descriptionValue = typeof entry.description === 'string'
                ? entry.description.trim()
                : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
            if (!descriptionValue) {
                if (throwOnInvalid) {
                    throw new Error('Status effect entry is missing a description');
                }
                continue;
            }
            const attributes = Array.isArray(entry.attributes) ? entry.attributes : undefined;
            const skills = Array.isArray(entry.skills) ? entry.skills : undefined;
            const needBars = includeNeedBars && Array.isArray(entry.needBars) ? entry.needBars : undefined;
            const duration = entry.duration === undefined ? null : entry.duration;
            const name = typeof entry.name === 'string' ? entry.name : undefined;
            const appliedAt = entry.appliedAt !== undefined ? entry.appliedAt : defaultAppliedAt;
            normalized.push(new StatusEffect({
                id: entry.id,
                name,
                description: descriptionValue,
                attributes,
                skills,
                needBars,
                duration,
                appliedAt
            }));
            continue;
        }

        if (throwOnInvalid) {
            throw new Error('Invalid status effect entry');
        }
    }

    normalized.sort((a, b) => {
        const nameA = (a.name || a.description || '').toLowerCase();
        const nameB = (b.name || b.description || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    return normalized.slice(0, 60);
}

/**
 * Upsert normalized effects into an existing list, replacing entries whose
 * description matches case-insensitively. Returns true when the list changed.
 */
function upsertStatusEffects(list, normalized) {
    let updated = false;
    for (const effect of normalized) {
        const existingIndex = list.findIndex(existing => existing.description.toLowerCase() === effect.description.toLowerCase());
        if (existingIndex >= 0) {
            list[existingIndex] = effect;
        } else {
            list.push(effect);
        }
        updated = true;
    }
    return updated;
}

/**
 * Remove effects by description. When matchName is true (Player), an effect is
 * also removed when its trimmed name matches the target case-insensitively.
 * Returns { removed, effects } with the filtered array when anything changed.
 */
function removeStatusEffectFromList(list, description, { matchName = false } = {}) {
    if (!description || typeof description !== 'string') {
        return { removed: false, effects: list };
    }
    const target = description.trim().toLowerCase();
    let filtered;
    if (matchName) {
        filtered = list.filter(effect => {
            const effectName = typeof effect?.name === 'string' ? effect.name.trim().toLowerCase() : '';
            const effectDescription = typeof effect?.description === 'string' ? effect.description.trim().toLowerCase() : '';
            return effectName !== target && effectDescription !== target;
        });
    } else {
        filtered = list.filter(effect => effect.description.toLowerCase() !== target);
    }
    return { removed: filtered.length !== list.length, effects: filtered };
}

/**
 * Advance effect durations. Returns the retained array when anything changed,
 * or null when the tick was a no-op. copyRetained/tickEffect let each class
 * preserve its stored representation (StatusEffect instances re-created via
 * toJSON, or plain objects spread by Region).
 */
function tickStatusEffectList(effects, elapsedMinutes, { copyRetained, tickEffect }) {
    if (!Array.isArray(effects) || effects.length === 0) {
        return null;
    }
    const normalizedMinutes = Number(elapsedMinutes);
    if (!Number.isFinite(normalizedMinutes) || normalizedMinutes <= 0) {
        return null;
    }
    const roundedMinutes = Math.max(1, Math.round(normalizedMinutes));
    const retained = [];
    let changed = false;
    for (const effect of effects) {
        if (!effect) {
            changed = true;
            continue;
        }
        if (!Number.isFinite(effect.duration) || effect.duration < 0 || effect.duration === 0) {
            retained.push(copyRetained(effect));
            continue;
        }
        const remainingMinutes = Math.max(0, Math.round(effect.duration));
        const nextRemainingMinutes = Math.max(0, remainingMinutes - roundedMinutes);
        retained.push(tickEffect(effect, nextRemainingMinutes));
        changed = true;
    }
    return changed ? retained : null;
}

/**
 * Tick helper for classes storing StatusEffect instances: re-create the
 * effect with a reduced duration, preserving the appliedAt fallback.
 */
function tickStatusEffectInstance(effect, nextRemainingMinutes) {
    return new StatusEffect({
        ...effect.toJSON(),
        duration: nextRemainingMinutes,
        appliedAt: Number.isFinite(effect.appliedAt) ? effect.appliedAt : null
    });
}

/**
 * Drop expired (duration === 0) effects. Returns the filtered array when
 * anything was removed, or null when nothing changed.
 */
function clearExpiredStatusEffects(effects) {
    const filtered = effects.filter(effect => !Number.isFinite(effect.duration) || effect.duration !== 0);
    return filtered.length !== effects.length ? filtered : null;
}

module.exports = {
    prepareStatusEffectInputs,
    normalizeStatusEffectInstances,
    upsertStatusEffects,
    removeStatusEffectFromList,
    tickStatusEffectList,
    tickStatusEffectInstance,
    clearExpiredStatusEffects
};
