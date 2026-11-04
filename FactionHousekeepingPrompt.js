const { parseExactXmlRoot } = require('./TinyBrainPromptParsers.js');
const Utils = require('./Utils.js');
const { ValidationIssueCollector } = require('./ResponseValidation.js');

// Private reasoning checkpoints, followed by one compact synthesis. Not a runtime family.
const FACTION_HOUSEKEEPING_SECTIONS = Object.freeze([
    'pendingDevelopments',
    'awareness',
    'factionInvolvement',
    'roles',
    'supportAssessment',
    'existingFactionFit',
    'newFactionProposals',
    'futureActivities',
    'continuityCheck'
]);

function children(node) {
    return Array.from(node.childNodes).filter(child => child.nodeType === 1);
}

function fieldPath(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1) return node.tagName;
    const siblings = children(parent).filter(child => child.tagName === node.tagName);
    const suffix = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : '';
    return `${fieldPath(parent)}/${node.tagName}${suffix}`;
}

function requireFields(node, names, optionalNames = [], issues) {
    const elements = children(node);
    const path = fieldPath(node);
    if (node.attributes.length) {
        issues.add(new Error(`${path} has XML attributes. Replace them with the documented child fields.`));
    }
    if (Array.from(node.childNodes).some(child => (
        (child.nodeType === 3 || child.nodeType === 4) && child.nodeValue.trim()
    ))) {
        issues.add(new Error(`${path} has text outside its fields. Put that text inside the appropriate child field.`));
    }
    for (const unexpected of elements.filter(child => !names.includes(child.tagName))) {
        issues.add(new Error(`${path}/${unexpected.tagName} is unexpected. Remove it; allowed fields are ${names.map(name => `<${name}>`).join(', ')}.`));
    }
    for (const name of names) {
        const count = elements.filter(child => child.tagName === name).length;
        if (count > 1) {
            issues.add(new Error(`${path}/${name} is duplicated. Keep exactly one <${name}> field.`));
        }
        if (!optionalNames.includes(name) && count === 0) {
            issues.add(new Error(`${path}/${name} is missing. Add exactly one <${name}> field.`));
        }
    }
    return names.map(name => {
        const matching = elements.filter(child => child.tagName === name);
        return matching.length === 1 ? matching[0] : undefined;
    });
}

function requireText(node, issues) {
    if (!node) return undefined;
    if (issues) return issues.capture(() => requireText(node));
    const path = fieldPath(node);
    if (node.attributes.length || children(node).length) {
        throw new Error(`${path} must contain text only. Remove attributes and nested elements.`);
    }
    if (!node.textContent.trim()) {
        throw new Error(`${path} is empty. Supply the required text.`);
    }
    return node.textContent.trim();
}

function requireList(node, itemName, issues) {
    if (!node) return [];
    const elements = children(node);
    if (node.attributes.length || elements.some(child => child.tagName !== itemName)
        || Array.from(node.childNodes).some(child => (
            (child.nodeType === 3 || child.nodeType === 4) && child.nodeValue.trim()
        ))) {
        issues.add(new Error(`${fieldPath(node)} has invalid list content. Use only <${itemName}> children, or leave the list empty.`));
    }
    return elements.filter(child => child.tagName === itemName);
}

/** Strict syntax boundary for one qualitative worksheet section; no world effects. */
function parseFactionHousekeepingSection(response, sectionName) {
    if (!FACTION_HOUSEKEEPING_SECTIONS.includes(sectionName)) {
        throw new Error(`Unknown faction housekeeping section: ${sectionName}`);
    }
    const parsed = parseExactXmlRoot(response, sectionName);
    const root = Utils.parseXmlDocumentStrict(parsed.value, 'text/xml').documentElement;
    if (root.tagName !== sectionName) {
        throw new Error(`Faction housekeeping section requires exact root <${sectionName}>.`);
    }
    const issues = new ValidationIssueCollector();
    const [assessment, entries] = requireFields(root, ['assessment', 'entries'], ['entries'], issues);
    requireText(assessment, issues);
    for (const entry of requireList(entries, 'entry', issues)) {
        const [references, finding, recommendation] = requireFields(
            entry, ['references', 'finding', 'recommendation'], ['references'], issues
        );
        for (const reference of requireList(references, 'reference', issues)) {
            requireText(reference, issues);
        }
        requireText(finding, issues);
        requireText(recommendation, issues);
    }
    issues.throwIfAny();
    return parsed;
}

/** Parse compact, unapplied creation concepts and plans; known factions are explicit input. */
function parseFactionHousekeepingProposal(response, knownFactions = []) {
    if (!Array.isArray(knownFactions)) {
        throw new TypeError('Known factions must be an array of faction IDs or records with IDs.');
    }
    const knownIds = new Set(knownFactions.map(faction => {
        const id = typeof faction === 'string' ? faction : faction?.id;
        if (typeof id !== 'string' || !id.trim()) {
            throw new TypeError('Every known faction requires a nonblank ID.');
        }
        return id.trim();
    }));
    const parsed = parseExactXmlRoot(response, 'factionHousekeepingProposal', { allowEmptyRoot: true });
    const root = Utils.parseXmlDocumentStrict(parsed.value, 'text/xml').documentElement;
    const issues = new ValidationIssueCollector();
    const [newFactionsNode, plansNode] = requireFields(root, ['newFactions', 'factionPlans'], ['newFactions', 'factionPlans'], issues);
    const draftRefs = new Set();
    let draftIdentitiesComplete = children(root).filter(node => node.tagName === 'newFactions').length <= 1;
    const newFactions = requireList(newFactionsNode, 'faction', issues).map(node => {
        const [localRef, name, concept] = requireFields(node, ['localRef', 'name', 'concept'], [], issues).map(field => requireText(field, issues));
        if (localRef === undefined) draftIdentitiesComplete = false;
        if (localRef !== undefined && !/^draft:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(localRef)) {
            issues.add(new Error(`${fieldPath(node)}/localRef has an invalid draft reference. Use draft:label with letters, digits, hyphens or underscores, starting the label with a letter or digit.`));
        }
        if (localRef !== undefined && (draftRefs.has(localRef) || knownIds.has(localRef))) {
            issues.add(new Error(`${fieldPath(node)}/localRef "${localRef}" is duplicate or conflicts with an existing faction. Use a unique draft:label reference.`));
        }
        if (localRef !== undefined && /^draft:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(localRef)) draftRefs.add(localRef);
        return { localRef, name, concept };
    });
    const plannedRefs = new Set();
    const factionPlans = requireList(plansNode, 'factionPlan', issues).map(node => {
        const fields = requireFields(node, ['factionRef', 'role', 'plan', 'nextSteps', 'awarenessConstraints'], [], issues);
        const [factionRef, role, plan] = fields.slice(0, 3).map(field => requireText(field, issues));
        if (factionRef !== undefined && !knownIds.has(factionRef) && !draftRefs.has(factionRef) && (draftIdentitiesComplete || !factionRef.startsWith('draft:'))) {
            issues.add(new Error(`${fieldPath(node)}/factionRef "${factionRef}" is unknown. Use an exact supplied faction ID or a localRef declared in newFactions.`));
        }
        if (factionRef !== undefined && plannedRefs.has(factionRef)) {
            issues.add(new Error(`${fieldPath(node)}/factionRef "${factionRef}" is duplicated. Combine this faction's steps into one factionPlan.`));
        }
        if (factionRef !== undefined) plannedRefs.add(factionRef);
        const nextSteps = requireList(fields[3], 'step', issues).map(field => requireText(field, issues));
        if (fields[3] && !nextSteps.length) {
            issues.add(new Error(`${fieldPath(node)}/nextSteps${factionRef === undefined ? '' : ` for ${factionRef}`} is empty. Add at least one <step> describing a specific next step.`));
        }
        return { factionRef, role, plan, nextSteps, awarenessConstraints: requireText(fields[4], issues) };
    });
    for (const draftRef of children(root).filter(node => node.tagName === 'factionPlans').length <= 1 ? draftRefs : []) {
        if (!plannedRefs.has(draftRef)) {
            issues.add(new Error(`New faction ${draftRef} has no matching factionPlan. Add one plan with <factionRef>${draftRef}</factionRef>.`));
        }
    }
    issues.throwIfAny();
    return { ...parsed, proposal: { newFactions, factionPlans } };
}

/** Return only the accepted synthesis, never concatenated worksheet reasoning. */
function buildFactionHousekeepingProposal({ checkpointValues, templateContext } = {}) {
    if (!Array.isArray(checkpointValues) || checkpointValues.length !== FACTION_HOUSEKEEPING_SECTIONS.length + 1) {
        throw new Error('Faction housekeeping requires nine worksheet answers and one final synthesis.');
    }
    if (!Array.isArray(templateContext?.factionHousekeeping?.factions)) {
        throw new Error('Faction housekeeping finalization requires explicit known factions in template context.');
    }
    return parseFactionHousekeepingProposal(
        checkpointValues[FACTION_HOUSEKEEPING_SECTIONS.length].value,
        templateContext.factionHousekeeping.factions
    ).value;
}

module.exports = {
    FACTION_HOUSEKEEPING_SECTIONS,
    parseFactionHousekeepingSection,
    parseFactionHousekeepingProposal,
    buildFactionHousekeepingProposal
};
