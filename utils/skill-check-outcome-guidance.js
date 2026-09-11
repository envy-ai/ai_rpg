const SKILL_CHECK_OUTCOME_GUIDANCE = Object.freeze({
    automatic_success: 'Achieve the intent routinely, without adding an artificial cost or complication.',
    critical_success: 'Fully achieve the intent and add an exceptional but plausible benefit appropriate to the action.',
    major_success: 'Fully achieve the intent and add a meaningful but plausible advantage, improvement, efficiency, or extra information.',
    success: 'Achieve the intended result without turning it into a disguised failure.',
    barely_succeeded: 'Achieve the core intent, but a minor cost, limitation, reduced quality, or complication may accompany it.',
    barely_failed: 'Do not achieve the core intent, but show close progress or a limited useful result when plausible.',
    failure: 'Do not achieve the intended result; do not disguise success as failure or failure as success.',
    major_failure: 'Do not achieve the intent and add a meaningful, action-scoped setback or complication.',
    critical_failure: 'Do not achieve the intent and add a severe but plausible, action-scoped consequence rather than an arbitrary catastrophe.',
    implausible_failure: 'The attempt cannot work as stated; do not fabricate a successful version of an impossible action.'
});

const SUCCESS_DEGREES = new Set([
    'automatic_success',
    'critical_success',
    'major_success',
    'success',
    'barely_succeeded'
]);

function normalizeOutcomeDegree(actionResolution) {
    if (!actionResolution || typeof actionResolution !== 'object' || Array.isArray(actionResolution)) {
        throw new TypeError('Skill-check outcome guidance requires an action-resolution object.');
    }

    const rawDegree = typeof actionResolution.degree === 'string'
        ? actionResolution.degree.trim().toLowerCase()
        : '';
    if (rawDegree && Object.prototype.hasOwnProperty.call(SKILL_CHECK_OUTCOME_GUIDANCE, rawDegree)) {
        return rawDegree;
    }

    const rawLabel = typeof actionResolution.label === 'string'
        ? actionResolution.label.trim().toLowerCase()
        : '';
    const labelDegree = rawLabel === 'failure - implausible'
        ? 'implausible_failure'
        : rawLabel.replace(/[\s-]+/g, '_');
    if (labelDegree && Object.prototype.hasOwnProperty.call(SKILL_CHECK_OUTCOME_GUIDANCE, labelDegree)) {
        return labelDegree;
    }

    throw new Error(
        `Unsupported skill-check outcome degree "${rawDegree || rawLabel || '(missing)'}" for tool guidance.`
    );
}

function buildSkillCheckOutcomeToolContent(actionResolution, resultLabel) {
    if (typeof resultLabel !== 'string' || !resultLabel.trim()) {
        throw new TypeError('Skill-check outcome guidance requires a non-empty result label.');
    }

    const degree = normalizeOutcomeDegree(actionResolution);
    const guidance = SKILL_CHECK_OUTCOME_GUIDANCE[degree];
    const lines = [
        resultLabel.trim(),
        '',
        'Outcome guidance:',
        'Apply this result to the reasonable practical intent of the checked action, not to a narrower procedural proxy.',
        guidance
    ];

    if (SUCCESS_DEGREES.has(degree)) {
        lines.push(
            'Do not turn a successful search for a viable person, object, clue, route, or opportunity into merely learning that none exists unless established context already makes the intended result unavailable or impossible.',
            'Established canon remains authoritative. If it makes the exact intended result impossible, provide the strongest plausible actionable alternative or useful progress instead of inventing a contradiction. Otherwise, a new immediate fact needed to express the plausible successful result is allowed.'
        );
    }

    return lines.join('\n');
}

module.exports = {
    SKILL_CHECK_OUTCOME_GUIDANCE,
    buildSkillCheckOutcomeToolContent,
    normalizeOutcomeDegree
};
