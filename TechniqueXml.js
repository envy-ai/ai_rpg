'use strict';

const { ValidationIssueCollector, withValidationContext } = require('./ResponseValidation.js');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const childElements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);

// XML only describes the existing DTO. Domain validation below remains shared
// with ordinary technique authoring and the detached attachment transaction.
const list = (tag, item) => ({ tag, item });
const map = (tag, key, fields) => ({ tag, key, item: { [key]: 'text', ...fields } });
const optionalEmptyLeaf = value => ({ optionalEmptyLeaf: value });
const requirement = { kind: 'text', id: optionalEmptyLeaf('text'), name: optionalEmptyLeaf('text'), minimum: optionalEmptyLeaf('number'), present: optionalEmptyLeaf('boolean') };
const requirements = list('requirement', requirement);
const check = Object.fromEntries(['kind', 'skill', 'attribute', 'difficulty', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'toughnessAttribute', 'description'].map(key => [key, key === 'kind' ? 'text' : optionalEmptyLeaf('text')]));
check.damageEffectiveness = optionalEmptyLeaf('number');
const amount = { formula: 'text', bindings: map('binding', 'variable', { kind: 'text', name: optionalEmptyLeaf('text') }) };
const modifier = (identity, magnitude) => ({ [identity]: 'text', modifier: optionalEmptyLeaf(magnitude), percentModifier: optionalEmptyLeaf(magnitude) });
const cost = { resource: 'text', needId: optionalEmptyLeaf('text'), direction: optionalEmptyLeaf('text'), binding: optionalEmptyLeaf('text'), itemId: optionalEmptyLeaf('text'), amount: 'amount', perTarget: optionalEmptyLeaf('boolean') };
const techniqueStatus = {
    name: 'text', description: 'text', duration: 'number',
    attributes: list('attribute', modifier('attribute', 'amount')),
    skills: list('skill', modifier('skill', 'amount')),
    needBars: list('needBar', { name: 'text', delta: 'amount' }), maxHealthPercent: optionalEmptyLeaf('amount'),
    techniqueGrants: list('techniqueGrant', { id: optionalEmptyLeaf('text'), techniqueId: 'text', definitionRevision: 'number' })
};
const summonTemplate = {
    name: 'text', description: 'text', shortDescription: optionalEmptyLeaf('text'), class: optionalEmptyLeaf('text'), race: optionalEmptyLeaf('text'), gender: optionalEmptyLeaf('text'), level: 'number',
    attributes: map('attribute', 'name', { value: 'number' }), skills: map('skill', 'name', { value: 'number' }), health: optionalEmptyLeaf('number')
};
const effect = {
    id: 'text', kind: 'text', amount: optionalEmptyLeaf('amount'), damageMode: optionalEmptyLeaf('text'), bonus: optionalEmptyLeaf('amount'), multiplier: optionalEmptyLeaf('amount'), status: techniqueStatus,
    destinationId: optionalEmptyLeaf('text'), summonMode: optionalEmptyLeaf('text'), actorId: optionalEmptyLeaf('text'), templateId: optionalEmptyLeaf('text'), template: summonTemplate, lifetimeMinutes: optionalEmptyLeaf('number'), health: optionalEmptyLeaf('amount'),
    stacking: optionalEmptyLeaf('text'), refreshPolicy: optionalEmptyLeaf('text'), potency: optionalEmptyLeaf('number'), check
};
const recipeComponent = Object.fromEntries(['kind', 'skillName', 'attributeName', 'resourceProfileId', 'effectId', 'statusStatKind', 'statusStatName', 'statusModifierKind', 'statusName', 'statusDescription'].map(key => [key, optionalEmptyLeaf('text')]));
const recipe = { ...Object.fromEntries(['kind', 'recipeId', 'skillName', 'attributeName', 'resourceProfileId', 'effectId', 'statusStatKind', 'statusStatName', 'statusModifierKind', 'statusName', 'statusDescription'].map(key => [key, optionalEmptyLeaf('text')])), components: list('component', recipeComponent) };
const healingPolicy = { referenceSource: 'text', referenceMultiplier: 'number', levelCoefficient: 'number', skillCoefficient: 'number', attributeCoefficient: 'number' };
const resourceProfile = { needId: 'text', direction: 'text', referenceCapacity: 'number', baseCost: 'number', denominatorConstant: 'number', skillEfficiency: 'number', levelEfficiency: 'number' };
const balance = {
    schemaVersion: 'number', recipeId: 'text',
    policy: {
        version: 'number', digest: 'text', snapshot: {
            version: 'number', healing: healingPolicy, damage: healingPolicy, referenceBaseWeaponDamage: 'number', resourceProfile,
            components: list('component', { kind: 'text', coefficients: healingPolicy, status: { fixedMagnitude: 'number', percentMagnitude: 'number', durationMinutes: 'number' }, resourceProfile }),
            improvementSteps: map('improvementStep', 'id', { kind: 'text', multiplier: 'number', amount: 'number' }),
            statusImprovementSteps: map('improvementStep', 'id', { kind: 'text', multiplier: 'number', amount: 'number' })
        }
    },
    selections: { skillName: 'text', attributeName: 'text', resourceProfileId: 'text', needId: 'text', effectId: 'text', components: list('component', { ...recipeComponent, needId: 'text' }) },
    parameters: { baseCost: 'number', healingBonus: 'number', damageBonus: 'number', appliedImprovementIds: list('improvementId', 'text'), baseCosts: list('baseCost', 'number'), bonuses: list('bonus', 'number'), appliedSteps: list('step', { stepId: 'text', effectId: 'text' }) }
};
const provenance = { kind: 'text', reason: 'text', sourceId: optionalEmptyLeaf('text'), private: optionalEmptyLeaf('boolean'), worldMinute: optionalEmptyLeaf('number'), operationId: optionalEmptyLeaf('text') };
const candidate = {
    id: optionalEmptyLeaf('text'), provenance, disciplineId: optionalEmptyLeaf('text'), name: 'text', description: 'text', semanticKey: 'text', aliases: list('alias', 'text'), unique: optionalEmptyLeaf('boolean'),
    revisions: list('revision', {
        revision: optionalEmptyLeaf('number'), acquisitionRequirements: requirements, useRequirements: requirements,
        target: { kind: 'text', allowDead: optionalEmptyLeaf('boolean') }, check, recipe,
        costs: list('cost', cost), failureCosts: list('cost', cost), effects: list('effect', effect), balance
    })
};
const candidateDiscipline = { id: optionalEmptyLeaf('text'), provenance, name: 'text', description: 'text', accessRequirements: requirements, publicAccess: optionalEmptyLeaf('boolean') };
const authoredCandidate = Object.fromEntries(Object.entries(candidate).filter(([key]) => !['id', 'provenance', 'disciplineId'].includes(key)));
const techniqueEntry = { techniqueId: optionalEmptyLeaf('text'), definitionRevision: optionalEmptyLeaf('number'), candidate: authoredCandidate };
const disciplineHeader = { disciplineId: optionalEmptyLeaf('text'), name: optionalEmptyLeaf('text'), description: optionalEmptyLeaf('text'), accessRequirements: requirements, publicAccess: optionalEmptyLeaf('boolean') };
const disciplineGroup = { ...disciplineHeader, techniques: list('technique', techniqueEntry) };
const disciplineGroups = list('discipline', disciplineGroup);
const techniqueChangeSchema = {
    kind: 'text', actorId: 'text', techniqueId: optionalEmptyLeaf('text'), definitionRevision: optionalEmptyLeaf('number'),
    provenance, discipline: disciplineGroup, mechanics: candidate.revisions.item,
    improvement: { stepId: 'text', reason: optionalEmptyLeaf('text') }, evidenceIds: list('evidenceId', 'text'),
    evidence: { kind: 'text', description: 'text' }
};
const attachmentSchema = {
    statusEffects: list('statusEffect', {
        name: optionalEmptyLeaf('text'), description: 'text', duration: 'number',
        attributes: list('attribute', modifier('attribute', 'number')),
        skills: list('skill', modifier('skill', 'number')), maxHealthPercent: optionalEmptyLeaf('number'),
        // Empty needBars was previously allowed; nonempty lists still reject below.
        needBars: list('needBar', { name: 'text', delta: 'number' }),
        disciplines: disciplineGroups
    })
};

function unsupportedFieldGuidance(schema, key) {
    const outerStatus = attachmentSchema.statusEffects.item;
    const outerEntry = techniqueEntry;
    if (schema === outerStatus && key === 'techniqueGrants') return 'Use disciplines/discipline/techniques/technique for references or new candidates; the server assigns outer techniqueGrants.';
    if (schema === outerStatus && ['id', 'appliedAt', 'provenance'].includes(key)) return 'Omit server-owned attachment identity, timing and provenance fields.';
    if (schema === outerEntry && ['id', 'provenance'].includes(key)) return 'Omit server-owned technique entry identity and provenance fields.';
    if ([candidate, authoredCandidate, techniqueEntry].includes(schema) && ['candidateDiscipline', 'disciplineId'].includes(key)) return 'Put the discipline ID or new discipline metadata on the enclosing discipline, outside techniques; omit child disciplineId and candidateDiscipline.';
    return `Remove or move that field; allowed children here are ${Object.keys(schema).join(', ')}.`;
}

function parseTechniqueXmlValue(node, schema, path) {
    if (node.attributes.length) throw new Error(`${path} (<${node.tagName}>) cannot have attributes; use child elements.`);
    const children = childElements(node);
    const text = Array.from(node.childNodes || []).filter(child => [3, 4].includes(child.nodeType))
        .map(child => child.nodeValue || '').join('').trim();
    if (schema.optionalEmptyLeaf) {
        if (!children.length && !text) return undefined;
        schema = schema.optionalEmptyLeaf;
    }
    const formulaCapable = schema === 'amount';
    if (formulaCapable) schema = children.length ? amount : 'number';
    if (typeof schema === 'string') {
        if (children.length || !text) throw new Error(`${path} (<${node.tagName}>) requires nonempty text only. Supply a value without nested elements.`);
        if (schema === 'text') return text;
        if (schema === 'boolean') {
            if (!['true', 'false'].includes(text)) throw new Error(`${path} must be true or false. Use the unquoted lowercase boolean text.`);
            return text === 'true';
        }
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
            throw new Error(`${path} must be a finite decimal number. Use numeric text without units.${formulaCapable ? ' An amount may instead contain a formula child.' : ''}`);
        }
        return Number(text);
    }
    if (text) throw new Error(`${path} (<${node.tagName}>) cannot contain text outside child fields; use XML elements, not JSON.`);
    const issues = new ValidationIssueCollector();
    if (schema.tag) {
        const entries = children.map((child, index) => issues.capture(() => {
            if (child.tagName !== schema.tag) throw new Error(`${path} requires <${schema.tag}> children; found <${child.tagName}>. Put each list entry inside <${schema.tag}>.`);
            return parseTechniqueXmlValue(child, schema.item, `${path}[${index}]`);
        }));
        issues.throwIfAny();
        if (!schema.key) return entries;
        const mapped = {};
        for (const entry of entries) issues.capture(() => {
            const { [schema.key]: key, ...value } = entry;
            if (!key || hasOwn(mapped, key)) throw new Error(`${path} requires distinct nonempty ${schema.key} values. Give each entry its own ${schema.key}, and merge repeated entries for the same key.`);
            Object.defineProperty(mapped, key, { value, enumerable: true, configurable: true, writable: true });
        });
        issues.throwIfAny();
        return mapped;
    }
    const result = {};
    const seen = new Set();
    for (const child of children) {
        issues.capture(() => {
            if (!hasOwn(schema, child.tagName)) throw new Error(`${path}.${child.tagName} is unsupported. ${unsupportedFieldGuidance(schema, child.tagName)}`);
            if (seen.has(child.tagName)) throw new Error(`${path}.${child.tagName} must occur at most once. Keep one occurrence, combining list entries inside its container when applicable.`);
            seen.add(child.tagName);
            const value = parseTechniqueXmlValue(child, schema[child.tagName], `${path}.${child.tagName}`);
            if (value !== undefined) result[child.tagName] = value;
        });
    }
    issues.throwIfAny();
    if ([candidate, authoredCandidate].includes(schema) && result.revisions?.length === 1 && result.revisions[0].revision === undefined) result.revisions[0].revision = 1;
    if (schema === summonTemplate) for (const field of ['attributes', 'skills']) if (result[field]) result[field] = Object.fromEntries(Object.entries(result[field]).map(([name, entry]) => [name, entry.value]));
    return result;
}


function writeTechniqueXmlValue(node, value, schema) {
    if (schema.optionalEmptyLeaf) schema = schema.optionalEmptyLeaf;
    if (schema === 'amount') schema = typeof value === 'number' ? 'number' : amount;
    if (schema === summonTemplate && value && typeof value === 'object') value = { ...value, ...Object.fromEntries(['attributes', 'skills'].filter(field => value[field]).map(field => [field, Object.fromEntries(Object.entries(value[field]).map(([name, scalar]) => [name, { value: scalar }]))])) };
    node.textContent = '';
    if (typeof schema === 'string') {
        if (schema === 'text' && typeof value !== 'string'
            || schema === 'number' && (typeof value !== 'number' || !Number.isFinite(value))
            || schema === 'boolean' && typeof value !== 'boolean') throw new TypeError(`<${node.tagName}> has an invalid ${schema} value.`);
        node.appendChild(node.ownerDocument.createTextNode(String(value)));
        return;
    }
    const add = (tag, entry, declaration) => {
        const child = node.ownerDocument.createElement(tag);
        writeTechniqueXmlValue(child, entry, declaration); node.appendChild(child);
    };
    if (schema.tag) {
        if (schema.key) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`<${node.tagName}> requires an object map.`);
            for (const [key, entry] of Object.entries(value)) add(schema.tag, { [schema.key]: key, ...entry }, schema.item);
        } else {
            if (!Array.isArray(value)) throw new TypeError(`<${node.tagName}> requires a list.`);
            for (const entry of value) add(schema.tag, entry, schema.item);
        }
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`<${node.tagName}> requires an object.`);
    for (const [key, entry] of Object.entries(value)) {
        if (!hasOwn(schema, key)) throw new Error(`<${node.tagName}>.${key} is unsupported.`);
        if (entry !== undefined) add(key, entry, schema[key]);
    }
}
function parseTechniqueCandidateXml(node) { return parseTechniqueXmlValue(node, candidate, 'candidate'); }

/** Resolve the enclosing parent before decoding children; return existing internal DTOs. */
function parseTechniqueDisciplineGroupXml(node, { disciplines, resolveParent, maxTechniques } = {}) {
    if (node?.tagName !== 'discipline') throw new Error('Expected one discipline root with parent fields and techniques children.');
    const headerNode = node.cloneNode(true);
    const techniqueNodes = childElements(headerNode).filter(child => child.tagName === 'techniques');
    if (techniqueNodes.length > 1) throw new Error('discipline.techniques must occur at most once. Combine its technique children in one container.');
    for (const child of techniqueNodes) headerNode.removeChild(child);
    const header = parseTechniqueXmlValue(headerNode, disciplineHeader, 'discipline');
    const parent = resolveTechniqueDisciplineHeader(header, { disciplines, resolveParent });
    const techniques = techniqueNodes.length ? parseTechniqueXmlValue(techniqueNodes[0], disciplineGroup.techniques, 'discipline.techniques') : [];
    return normalizeTechniqueDisciplineEntries(parent, techniques, { maxTechniques });
}
function resolveTechniqueDisciplineHeader(header, { disciplines, resolveParent } = {}) {
    const service = require('./TechniqueService.js');
    disciplines ??= service.getDisciplines();
    let discipline;
    let candidateDiscipline;
    if (header.disciplineId) {
        if (Object.keys(header).some(key => key !== 'disciplineId')) throw new Error('discipline: an existing disciplineId cannot accompany new name, description, accessRequirements or publicAccess. Reference the existing ID alone, or omit it and define a new parent.');
        discipline = disciplines.find(value => value.id === header.disciplineId);
        if (discipline && !service.getDisciplines().some(value => value.id === discipline.id)) candidateDiscipline = discipline;
        if (!discipline) throw new Error(`Unknown discipline ${header.disciplineId}. ${service.availableDisciplineIds(disciplines)} Use one listed ID, or omit disciplineId and define a new parent.`);
    } else {
        const { disciplineId, ...raw } = header;
        if (!raw.name) throw new Error('discipline requires disciplineId or name. Reference an existing disciplineId, or omit it and provide a new name and description with any accessRequirements/publicAccess.');
        const nameKey = require('./IdGenerator.js').normalizeName(raw.name);
        const matches = disciplines.filter(value => require('./IdGenerator.js').normalizeName(value.name) === nameKey);
        if (matches.length > 1) throw new Error(`discipline.name ${raw.name} matches multiple canonical parents: ${matches.map(value => value.id).join(', ')}. Reference one existing disciplineId.`);
        const complete = matches.length ? { ...matches[0], ...raw, id: matches[0].id } : raw;
        candidateDiscipline = resolveParent ? resolveParent(complete) : require('./TechniquePrompt.js').parseAutomaticTechniqueDiscipline(complete, { resolve: true, disciplines });
        discipline = candidateDiscipline;
    }
    return { disciplineId: discipline.id, ...(candidateDiscipline ? { candidateDiscipline } : {}) };
}
function normalizeTechniqueDisciplineEntries(parent, entries, { maxTechniques, path = 'discipline.techniques' } = {}) {
    if (!entries.length || (maxTechniques !== undefined && entries.length > maxTechniques)) throw new Error(`${path} requires ${maxTechniques === 1 ? 'exactly one technique for this operation' : 'at least one technique'}. Put each reference or candidate in one technique child.`);
    const service = require('./TechniqueService.js');
    const issues = new ValidationIssueCollector();
    const techniques = entries.map((entry, index) => issues.capture(() => {
        const at = `${path}[${index}]`;
        if (Boolean(entry.techniqueId) === Boolean(entry.candidate)) throw new Error(`${at}: provide exactly one techniqueId or candidate. Reference known mechanics by ID, or define a new candidate.`);
        if (entry.techniqueId) {
            const definition = service.getDefinition(entry.techniqueId);
            if (!definition) throw new Error(`${at}.techniqueId: unknown technique ${entry.techniqueId}. Available technique IDs: ${service.getDefinitions().map(value => value.id).join(', ') || 'none'}. Reference an existing ID or provide a candidate.`);
            if (definition.disciplineId !== parent.disciplineId) throw new Error(`${at}.techniqueId ${entry.techniqueId} belongs to discipline ${definition.disciplineId}, not ${parent.disciplineId}. Move it under its canonical discipline.`);
            return { techniqueId: entry.techniqueId, ...(entry.definitionRevision !== undefined ? { definitionRevision: entry.definitionRevision } : {}) };
        }
        if (entry.candidate.revisions !== undefined && (entry.candidate.revisions.length !== 1 || entry.candidate.revisions[0].revision !== 1)) throw new Error(`${at}.candidate.revisions requires only fresh revision 1. Provide one revision and omit its inner number or use 1.`);
        if (entry.definitionRevision !== undefined) throw new Error(`${at}.definitionRevision only pins a catalogue reference. Omit it for a fresh candidate.`);
        return { candidate: { ...entry.candidate, ...(parent.candidateDiscipline ? {} : { disciplineId: parent.disciplineId }) }, ...(parent.candidateDiscipline ? { candidateDiscipline: parent.candidateDiscipline } : {}) };
    }));
    issues.throwIfAny();
    return { ...parent, techniques };
}
function flattenTechniqueDisciplineGroups(groups, options = {}) {
    const disciplines = options.disciplines ?? require('./TechniqueService.js').getDisciplines();
    const issues = new ValidationIssueCollector();
    const entries = groups.map(({ techniques = [], ...header }, index) => issues.capture(() => {
        const path = `${options.path || 'disciplines'}[${index}]`;
        let parent;
        try {
            parent = resolveTechniqueDisciplineHeader(header, { ...options, disciplines });
        } catch (error) {
            throw withValidationContext(error, path);
        }
        const normalized = normalizeTechniqueDisciplineEntries(parent, techniques, { ...options, path: `${path}.techniques` }).techniques;
        if (parent.candidateDiscipline && !disciplines.some(value => value.id === parent.disciplineId)) disciplines.push(parent.candidateDiscipline);
        return normalized;
    }));
    issues.throwIfAny();
    return entries.flat();
}

function getTechniqueXmlInstructions() {
    return `Use nested XML objects/lists, never JSON leaves. Group techniques by an enclosing discipline: <disciplines><discipline><disciplineId>EXISTING_DISCIPLINE_ID</disciplineId><techniques><technique><techniqueId>EXISTING_TECHNIQUE_ID</techniqueId></technique></techniques></discipline></disciplines>. Ability statuses and starting actors contain disciplines; a first-use operation contains one discipline directly with exactly one child technique. Known use/discovery may simply reference its techniqueId without repeating mechanics. Native useTechnique keeps JSON arguments and supplies the identical XML discipline group in disciplineXml.
An existing parent supplies disciplineId alone. A new parent supplies name, description, accessRequirements and optional publicAccess instead of disciplineId. Every child technique contains either techniqueId with optional definitionRevision (attachment reference only), or a complete candidate with name, description, semanticKey, optional aliases/alias and unique, and revisions/revision. Never repeat disciplineId inside a candidate and never emit sibling candidateDiscipline. Omit all new IDs/provenance. The engine supplies revision 1; its inner number may be omitted. Repeated discipline blocks with the same canonical ID or normalized title append children in encounter order; the first canonical metadata and access rules remain authoritative. A later block may reference the title-derived ID of a parent defined earlier in the response.
A discipline is a reusable tradition, practice or field. Prefer an appropriate existing parent and an actual skill's name where it names the practice (for example Spellcasting). Do not name a discipline after one technique or its immediate effect or generic qualification language such as Established Practice. publicAccess true is only for universally available practiced mundane actions; different names alone do not justify unique true.
The following complete group is structural: replace every placeholder with established setting/actor facts. Empty requirements do not imply unrestricted access; there is no default skill rank 2 or mandatory level gate.
<discipline><name>DISCIPLINE_NAME</name><description>DISCIPLINE_DESCRIPTION</description><accessRequirements/><publicAccess>false</publicAccess><techniques><technique><candidate><name>TECHNIQUE_NAME</name><description>TECHNIQUE_DESCRIPTION</description><semanticKey>TECHNIQUE_SEMANTIC_KEY</semanticKey><revisions><revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind></target><check><kind>automatic</kind></check><recipe><kind>healing</kind></recipe></revision></revisions></candidate></technique></techniques></discipline>
For optional standard damage use recipe/kind damage with explicit target and nonautomatic check. For deliberate custom damage keep full costs/effects and formulas, for example <effects><effect><id>strike</id><kind>damage</kind><amount><formula>max(1, level)</formula></amount><damageMode>technique</damageMode></effect></effects>.
Requirements: acquisitionRequirements, useRequirements and discipline accessRequirements contain requirement children. Each requirement has kind and optional boolean present (false negates it). For level include numeric minimum; for skill or attribute include name and numeric minimum (attribute compares its modifier). For ability, status, class, race or equipmentType include name; class/race must match actual identity. For discipline, technique, equippedItem or evidence include id. For alive include no other fields beyond optional present. Do not add fields irrelevant to the chosen kind. Example: <acquisitionRequirements><requirement><kind>skill</kind><name>ACTUAL_RELEVANT_SKILL</name><minimum>1</minimum></requirement></acquisitionRequirements>. Baseline initialized skills alone do not establish access; use actual training, ability or other established qualification.
Revision target has kind self, single or area. Set allowDead true only when every effect is resurrection; other techniques use false or omit it. Its check and optional per-effect check use kind automatic, attack, skill or opposed. All nonautomatic checks require skill and may include attribute; skill checks require difficulty Trivial, Easy, Medium, Hard, Very Hard or Legendary. Opposed checks require opposedSkill and optionally opposedAttribute; attack checks may include attackType, damageType and defense. Weapon damage attack checks additionally require toughnessAttribute naming an actual selected target attribute and damageEffectiveness as an integer 1 through 5; these authored fields keep ordinary toughness/effectiveness processing rather than assuming zero defense or neutral effectiveness. A player-and-party cohort selected by one area teleport shares one automatic or skill check; use separate single-target attempts for attack/opposed outcomes. Every check may include description. Omit fields irrelevant to its kind. Example: <check><kind>opposed</kind><skill>ACTUAL_RELEVANT_SKILL</skill><opposedSkill>ACTUAL_OPPOSING_SKILL</opposedSkill></check>.
For standard damage use the same semantic selection with <kind>damage</kind> and an explicit nonautomatic check. Standard damage is optional: deliberately authored custom damage formulas remain supported even when a standard recipe is available, including free/health/other-need costs, area and mixed effects. Selecting a resource-backed standard recipe does not imply every physical technique pays Mana. The engine supplies the recipe ID, stable effect ID, revision 1, numeric amounts and costs. Only select actual skill/attribute/resource identities where multiple eligible options exist; omit singleton selections the engine can determine. Zero eligible options cannot compile that selected recipe. Existing canonical recipeId/effectId fields may be supplied consistently but are not requested.
New standard healing, damage and status effects use recipe choices from balanceAuthoring. Use <recipe><components><component><kind>healing</kind></component><component><kind>buff</kind><statusStatKind>attribute</statusStatKind><statusModifierKind>fixed</statusModifierKind><statusName>NAME</statusName><statusDescription>DESCRIPTION</statusDescription></component></components></recipe> for mixed effects; the engine fills unambiguous actual skill, attribute, stat and resource selectors. Components keep full individual strength. A recipe may target self, single or area; every selected target multiplies each component cost. Status recipes use the configured three-world-minute baseline. Omit costs, failureCosts, effects and balance from recipe revisions: the engine computes canonical mechanics and saved policy. Do not invent numeric values or repeat known ranks/levels. Do not relabel healing to bypass the recipe boundary.
Deliberately custom nonhealing revisions contain acquisitionRequirements, useRequirements, target, check, costs, optional failureCosts and nonempty effects. costs and failureCosts contain cost children. Each cost contains resource health and amount, OR resource need, needId, optional direction increase/decrease consistent with the pool, and amount. Or use resource charge, binding grantingItem (the exact selected equipped technique-granting item), or binding ownedItem with the concrete owned itemId from chargeItems, plus amount. Charge costs omit needId/direction. grantingItem omits itemId; it cannot use a learned/status source. Never substitute an empty item or invent a resource pool. Discrete item costs must be whole numbers; continuous pools permit finite decimals. Health omits needId/direction. Never invent a resource pool. Omitted failureCosts uses normal costs; <failureCosts/> explicitly means free failure. Example: <costs><cost><resource>need</resource><needId>EXACT_ACTIVE_POOL_ID</needId><direction>decrease</direction><amount>1</amount></cost></costs>.
effects contains effect children with distinct stable id and kind. Custom fixed/formula damage uses kind damage, amount and damageMode technique. Weapon damage instead uses damageMode weapon with bonus and multiplier amounts, no amount; an attack check and exact equipped weaponItemId (when multiple weapons are equipped) are required at use. The engine applies multiplier and bonus to ordinary pre-defense weapon damage, then applies defenses once. Charged weapons pay their native shot cost once; explicit same-item charge costs represent the total payment and must meet that native minimum on both success and failure. Healing uses kind healing and amount, but new ordinary healing must use a recipe. Buff/debuff effects use kind buff/debuff and a status child, optional stacking refresh/stack, refreshPolicy stronger/replace/reject and nonnegative numeric potency. Damage and debuffs require a nonautomatic common or per-effect check. Status effects omit amount/damageMode. Effect status has name, description and duration (positive integer world minutes or -1), optional attributes, skills, needBars, maxHealthPercent and techniqueGrants, with at least one mechanical modifier or grant. Its attribute/skill lists use the same nested identity shape as attachment modifiers, but their modifier/percentModifier and maxHealthPercent may also be formulas. needBars contains needBar children with name and delta (numeric or formula). techniqueGrants contains techniqueGrant children with an existing techniqueId, positive integer definitionRevision and optional stable id. These nested effect statuses may have need deltas; the containing permanent ability status may not.
Utility effects are teleport, summon and resurrection. Teleport may fix destinationId or choose an existing destinationId at use; it moves the selected local self/single/area targets through native movement. Summon targets the caster and uses summonMode existing with a fixed/selected actual actorId, or summonMode template with a saved templateId or inline <template> for a new creature. A template contains name, description, level, <attributes><attribute><name>ACTUAL_ATTRIBUTE</name><value>NUMBER</value></attribute></attributes>, and <skills><skill><name>ACTUAL_SKILL</name><value>RANK</value></skill></skills>; optional class/race/gender/shortDescription/health, no inventory. Summon requires positive lifetimeMinutes. Resurrection targets an existing dead local character, sets allowDead true and supplies positive health as number/formula; it clears Deceased/Incapacitated but preserves other state. Select only IDs listed in utilityContext; do not invent locations, characters or templates. Per-use selectors are <utilitySelections><selection><effectId>EFFECT_ID</effectId><destinationId>EXISTING_LOCATION_ID</destinationId></selection></utilitySelections> or actorId/templateId for the matching summon effect.
Complete buff effect shape: <effect><id>focus</id><kind>buff</kind><status><name>STATUS_NAME</name><description>STATUS_DESCRIPTION</description><duration>5</duration><attributes/><skills><skill><skill>ACTUAL_RELEVANT_SKILL</skill><modifier><formula>level</formula></modifier><percentModifier>10</percentModifier></skill></skills><needBars/></status><stacking>refresh</stacking><refreshPolicy>stronger</refreshPolicy><potency>1</potency></effect>.
Amounts use numeric text (for example <amount>2</amount>) or a formula child (for example <amount><formula>max(1, level)</formula></amount>). Nested status modifier amounts may be signed. Use only available canonical formulaVariables keys: level, skill_&lt;normalized_name&gt; and attribute_&lt;normalized_name&gt;_modifier. Compact contexts supply each actor's key-to-value map and shared schema; derive actual relevant skill/attribute names only from schema keys present for that actor. Attribute variables are modifiers, never raw scores. Do not repeat known values or binding maps. Resource names such as mana are not formula variables. Allowed arithmetic functions are abs, round, floor, ceil, min, max; other functions and property access reject. No arbitrary progression currencies or invented qualification.`;
}

module.exports = { techniqueChangeSchema, parseTechniqueDisciplineGroupXml, flattenTechniqueDisciplineGroups, resolveTechniqueDisciplineHeader, normalizeTechniqueDisciplineEntries, disciplineGroupSchema: disciplineGroup, disciplineGroupsSchema: disciplineGroups, disciplineHeaderSchema: disciplineHeader, techniqueEntrySchema: techniqueEntry, getTechniqueXmlInstructions, parseTechniqueXmlValue, parseTechniqueCandidateXml, writeTechniqueXmlValue, parseTechniqueDisciplineXml: node => parseTechniqueXmlValue(node, candidateDiscipline, 'candidateDiscipline'), attachmentSchema, candidateSchema: candidate, disciplineSchema: candidateDiscipline };
