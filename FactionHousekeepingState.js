function normalizeFactionHousekeepingState(value = null) {
    if (value === null || value === undefined) {
        return { factionPlans: [], lastReviewedTurnId: null, lastReviewedTurnTimestamp: null };
    }
    if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.factionPlans)) {
        throw new TypeError('Faction housekeeping state requires a factionPlans array.');
    }
    const refs = new Set();
    const factionPlans = value.factionPlans.map(plan => {
        const result = {};
        for (const key of ['factionRef', 'role', 'plan', 'awarenessConstraints']) {
            if (typeof plan?.[key] !== 'string' || !plan[key].trim()) {
                throw new TypeError(`Saved faction plan requires nonblank ${key}.`);
            }
            result[key] = plan[key].trim();
        }
        if (result.factionRef.startsWith('draft:') || refs.has(result.factionRef)) {
            throw new Error(`Saved faction plan requires a unique actual faction ID: ${result.factionRef}`);
        }
        refs.add(result.factionRef);
        if (!Array.isArray(plan.nextSteps) || !plan.nextSteps.length
            || plan.nextSteps.some(step => typeof step !== 'string' || !step.trim())) {
            throw new TypeError('Saved faction plan requires nonblank next steps.');
        }
        result.nextSteps = plan.nextSteps.map(step => step.trim());
        return result;
    });
    const lastReviewedTurnId = value.lastReviewedTurnId ?? null;
    const lastReviewedTurnTimestamp = value.lastReviewedTurnTimestamp ?? null;
    if (lastReviewedTurnId !== null && (typeof lastReviewedTurnId !== 'string' || !lastReviewedTurnId.trim())) {
        throw new TypeError('Faction review boundary requires a nonblank turn ID or null.');
    }
    if (lastReviewedTurnTimestamp !== null && (typeof lastReviewedTurnTimestamp !== 'string'
        || !Number.isFinite(Date.parse(lastReviewedTurnTimestamp)))) {
        throw new TypeError('Faction review boundary requires a valid timestamp or null.');
    }
    return { factionPlans, lastReviewedTurnId, lastReviewedTurnTimestamp };
}

module.exports = { normalizeFactionHousekeepingState };
