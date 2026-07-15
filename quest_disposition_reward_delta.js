'use strict';

// Resolve the actual disposition change a quest reward applies, from its authored
// `intensity` and the disposition definitions' range. This is the single source of
// truth shared by the award path (Events) and the confirmation preview payload
// (QuestConfirmationManager), so the value shown when accepting a quest always
// matches the value that is applied on completion. Returns null when the delta
// cannot be resolved (missing typicalStep/typicalBigStep) so callers can skip it.
//
// Note: this deliberately does NOT apply the first-impression multiplier, which is
// contextual (whether the NPC has any existing disposition) and only known at award
// time. The preview therefore shows the base scaled delta, matching the quest list.
function resolveQuestDispositionRewardDelta(intensityValue, definitions) {
    const intensity = Number(intensityValue);
    if (!Number.isFinite(intensity) || intensity === 0) {
        return null;
    }

    const range = definitions && typeof definitions === 'object' && definitions.range
        && typeof definitions.range === 'object'
        ? definitions.range
        : {};
    const typicalStep = Number.isFinite(Number(range.typicalStep)) ? Number(range.typicalStep) : null;
    const typicalBigStep = Number.isFinite(Number(range.typicalBigStep)) ? Number(range.typicalBigStep) : null;

    const roundAwayFromZero = (scaled) => {
        const rounded = Math.round(scaled);
        return rounded !== 0
            ? rounded
            : Math.sign(intensity) * Math.max(1, Math.round(Math.abs(scaled)) || 1);
    };

    if (intensity === -10) {
        return Number.isFinite(typicalBigStep) ? -typicalBigStep : null;
    }

    if (!Number.isFinite(typicalStep)) {
        return null;
    }

    if (intensity >= -3 && intensity <= 3) {
        return roundAwayFromZero(intensity * typicalStep);
    }

    return roundAwayFromZero((intensity / 2) * typicalStep);
}

module.exports = { resolveQuestDispositionRewardDelta };
