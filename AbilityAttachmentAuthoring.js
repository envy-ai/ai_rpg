'use strict';

const LLMClient = require('./LLMClient.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const {
    parseAutomaticTechniqueCandidate,
    parseAutomaticTechniqueDiscipline
} = require('./TechniquePrompt.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { compactTechniqueCatalogue } = require('./TechniquePromptContext.js');

const LABEL = 'ability_attachments';
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const childElements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);

// XML only describes the existing DTO. Domain validation below remains shared
// with ordinary technique authoring and the detached attachment transaction.
const list = (tag, item) => ({ tag, item });
const map = (tag, key, fields) => ({ tag, key, item: { [key]: 'text', ...fields } });
const requirement = { kind: 'text', id: 'text', name: 'text', minimum: 'number', present: 'boolean' };
const requirements = list('requirement', requirement);
const check = Object.fromEntries(['kind', 'skill', 'attribute', 'difficulty', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'description'].map(key => [key, 'text']));
const amount = { formula: 'text', bindings: map('binding', 'variable', { kind: 'text', name: 'text' }) };
const modifier = (identity, magnitude) => ({ [identity]: 'text', modifier: magnitude, percentModifier: magnitude });
const cost = { resource: 'text', needId: 'text', direction: 'text', amount: 'amount' };
const techniqueStatus = {
    name: 'text', description: 'text', duration: 'number',
    attributes: list('attribute', modifier('attribute', 'amount')),
    skills: list('skill', modifier('skill', 'amount')),
    needBars: list('needBar', { name: 'text', delta: 'amount' }), maxHealthPercent: 'amount',
    techniqueGrants: list('techniqueGrant', { id: 'text', techniqueId: 'text', definitionRevision: 'number' })
};
const effect = {
    id: 'text', kind: 'text', amount: 'amount', damageMode: 'text', status: techniqueStatus,
    stacking: 'text', refreshPolicy: 'text', potency: 'number', check
};
const recipe = Object.fromEntries(['recipeId', 'skillName', 'attributeName', 'resourceProfileId', 'effectId'].map(key => [key, 'text']));
const healingPolicy = { referenceSource: 'text', referenceMultiplier: 'number', levelCoefficient: 'number', skillCoefficient: 'number', attributeCoefficient: 'number' };
const resourceProfile = { needId: 'text', direction: 'text', referenceCapacity: 'number', baseCost: 'number', denominatorConstant: 'number', skillEfficiency: 'number', levelEfficiency: 'number' };
const balance = {
    schemaVersion: 'number', recipeId: 'text',
    policy: {
        version: 'number', digest: 'text', snapshot: {
            version: 'number', healing: healingPolicy, referenceBaseWeaponDamage: 'number', resourceProfile,
            improvementSteps: map('improvementStep', 'id', { kind: 'text', multiplier: 'number', amount: 'number' })
        }
    },
    selections: { skillName: 'text', attributeName: 'text', resourceProfileId: 'text', needId: 'text', effectId: 'text' },
    parameters: { baseCost: 'number', healingBonus: 'number', appliedImprovementIds: list('improvementId', 'text') }
};
const candidate = {
    disciplineId: 'text', name: 'text', description: 'text', semanticKey: 'text', aliases: list('alias', 'text'), unique: 'boolean',
    revisions: list('revision', {
        revision: 'number', acquisitionRequirements: requirements, useRequirements: requirements,
        target: { kind: 'text', allowDead: 'boolean' }, check, recipe,
        costs: list('cost', cost), failureCosts: list('cost', cost), effects: list('effect', effect), balance
    })
};
const candidateDiscipline = { name: 'text', description: 'text', accessRequirements: requirements, publicAccess: 'boolean' };
const attachmentSchema = {
    statusEffects: list('statusEffect', {
        name: 'text', description: 'text', duration: 'number',
        attributes: list('attribute', modifier('attribute', 'number')),
        skills: list('skill', modifier('skill', 'number')), maxHealthPercent: 'number',
        // Empty needBars was previously allowed; nonempty lists still reject below.
        needBars: list('needBar', { name: 'text', delta: 'number' }),
        techniqueEntries: list('techniqueEntry', { techniqueId: 'text', definitionRevision: 'number', candidate, candidateDiscipline })
    })
};

function parseAttachmentXmlValue(node, schema, path) {
    if (node.attributes.length) throw new Error(`${path} (<${node.tagName}>) cannot have attributes; use child elements.`);
    const children = childElements(node);
    const text = Array.from(node.childNodes || []).filter(child => [3, 4].includes(child.nodeType))
        .map(child => child.nodeValue || '').join('').trim();
    if (schema === 'amount') schema = children.length ? amount : 'number';
    if (typeof schema === 'string') {
        if (children.length || !text) throw new Error(`${path} (<${node.tagName}>) requires nonempty text only.`);
        if (schema === 'text') return text;
        if (schema === 'boolean') {
            if (!['true', 'false'].includes(text)) throw new Error(`${path} must be true or false.`);
            return text === 'true';
        }
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
            throw new Error(`${path} must be a finite decimal number.`);
        }
        return Number(text);
    }
    if (text) throw new Error(`${path} (<${node.tagName}>) cannot contain text outside child fields; use XML elements, not JSON.`);
    if (schema.tag) {
        const entries = children.map((child, index) => {
            if (child.tagName !== schema.tag) throw new Error(`${path} requires <${schema.tag}> children; found <${child.tagName}>.`);
            return parseAttachmentXmlValue(child, schema.item, `${path}[${index}]`);
        });
        if (!schema.key) return entries;
        const mapped = {};
        for (const entry of entries) {
            const { [schema.key]: key, ...value } = entry;
            if (!key || hasOwn(mapped, key)) throw new Error(`${path} requires distinct nonempty ${schema.key} values.`);
            Object.defineProperty(mapped, key, { value, enumerable: true, configurable: true, writable: true });
        }
        return mapped;
    }
    const result = {};
    for (const child of children) {
        if (!hasOwn(schema, child.tagName)) throw new Error(`${path}.${child.tagName} is unsupported.`);
        if (hasOwn(result, child.tagName)) throw new Error(`${path}.${child.tagName} must occur at most once.`);
        result[child.tagName] = parseAttachmentXmlValue(child, schema[child.tagName], `${path}.${child.tagName}`);
    }
    return result;
}

function requireOwnedAbility(actor, abilityId) {
    if (!actor || typeof actor.getAbilities !== 'function' || typeof actor.id !== 'string') {
        throw new TypeError('Ability attachment authoring requires an actor with abilities.');
    }
    if (typeof abilityId !== 'string' || !abilityId.trim()) throw new TypeError('Ability attachment authoring requires an ability ID.');
    const ability = actor.getAbilities().find(entry => entry.id === abilityId);
    if (!ability) throw new Error(`Actor ${actor.id} does not own ability ${abilityId}.`);
    return ability;
}

function parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility = null }) {
    const xml = extractTinyBrainXmlResponse(response, 'abilityAttachments');
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    const root = document.documentElement;
    if (root?.tagName !== 'abilityAttachments' || root.attributes.length) {
        throw new Error('Ability attachment response requires a plain <abilityAttachments> root.');
    }
    const { statusEffects } = parseAttachmentXmlValue(root, attachmentSchema, 'abilityAttachments');
    if (!statusEffects) throw new Error('<abilityAttachments> requires exactly one <statusEffects> list.');
    for (const [index, effect] of statusEffects.entries()) {
        if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
            throw new TypeError(`statusEffects[${index}] must be an object.`);
        }
        if (effect.duration !== -1) throw new Error(`statusEffects[${index}].duration must be -1 for an owned ability.`);
        if (hasOwn(effect, 'id') || hasOwn(effect, 'appliedAt')) {
            throw new Error(`statusEffects[${index}] must omit server-owned id and appliedAt.`);
        }
        if (hasOwn(effect, 'needBars') && (!Array.isArray(effect.needBars) || effect.needBars.length)) {
            throw new Error(`statusEffects[${index}].needBars is unsupported for an ability attachment.`);
        }
        if (hasOwn(effect, 'techniqueGrants')) {
            throw new Error(`statusEffects[${index}] must propose techniqueEntries; techniqueGrants are assigned by the server.`);
        }
        if (effect.techniqueEntries !== undefined) {
            if (!Array.isArray(effect.techniqueEntries)) throw new TypeError(`statusEffects[${index}].techniqueEntries must be an array.`);
            for (const [entryIndex, entry] of effect.techniqueEntries.entries()) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new TypeError(`statusEffects[${index}].techniqueEntries[${entryIndex}] must be an object.`);
                }
                if (hasOwn(entry, 'id') || hasOwn(entry, 'provenance')) {
                    throw new Error(`statusEffects[${index}].techniqueEntries[${entryIndex}] must omit server-owned id and provenance.`);
                }
                if (Boolean(entry.candidate) === Boolean(entry.techniqueId)) {
                    throw new Error(`statusEffects[${index}].techniqueEntries[${entryIndex}] requires candidate or techniqueId.`);
                }
                if (entry.candidate) {
                    if (hasOwn(entry.candidate, 'id') || hasOwn(entry.candidate, 'provenance')) {
                        throw new Error(`statusEffects[${index}].techniqueEntries[${entryIndex}].candidate must omit id and provenance.`);
                    }
                    if (!Array.isArray(entry.candidate.revisions) || entry.candidate.revisions.length !== 1) {
                        throw new Error(`statusEffects[${index}].techniqueEntries[${entryIndex}].candidate requires only revision 1.`);
                    }
                }
                if (entry.candidateDiscipline) {
                    if (!entry.candidate || hasOwn(entry.candidateDiscipline, 'id') || hasOwn(entry.candidateDiscipline, 'provenance')
                        || hasOwn(entry.candidate, 'disciplineId')) {
                        throw new Error(`statusEffects[${index}].techniqueEntries[${entryIndex}] must omit new discipline and candidate IDs/provenance.`);
                    }
                    parseAutomaticTechniqueDiscipline({
                        ...entry.candidateDiscipline,
                        id: 'preview_ability_discipline'
                    });
                }
                if (entry.candidate) parseAutomaticTechniqueCandidate({
                    ...entry.candidate,
                    id: 'preview_ability_technique',
                    disciplineId: entry.candidate.disciplineId || 'preview_ability_discipline',
                    provenance: { kind: 'generation', reason: 'Preview ability attachment' }
                });
            }
        }
    }
    // This is a detached preflight. It must not install catalogue definitions or actor state.
    TechniqueService.previewAbilityAttachmentBatch({ actor, entries: [{ abilityId, statusEffects }], pendingAbility });
    return { statusEffects };
}

function actorFacts(actor) {
    const abilities = actor.getAbilities().map(entry => ({
        id: entry.id, name: entry.name, description: entry.description,
        type: entry.type, level: entry.level
    }));
    return {
        id: actor.id, name: actor.name, description: actor.description,
        class: actor.class, race: actor.race, level: actor.level,
        health: actor.health, maxHealth: actor.maxHealth,
        attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])),
        skills: Object.fromEntries(actor.getSkills()),
        abilities,
        needBars: actor.getNeedBars({ scope: 'active' }).map(bar => ({
            id: bar.id, name: bar.name, description: bar.description,
            value: bar.value, min: bar.min, max: bar.max, paymentDirection: bar.paymentDirection
        }))
    };
}

function getAttachmentXmlInstructions() {
    return `Return only XML using child elements, no attributes and no embedded JSON. Escape & and < in text as &amp; and &lt;. Each object field occurs at most once. Numbers are finite decimal or scientific-notation text, never quoted values, units, NaN, Infinity or null. Booleans are exactly true or false. Optional fields may be omitted; an empty list is a self-closing container. Never put [] or {} in an element.
The response contains exactly one <abilityAttachments> root and one <statusEffects> list with zero or more <statusEffect> children. Use an empty <statusEffects/> only when no supported mechanics can honestly represent the ability. Each statusEffect has name, description, duration -1, and optional attributes, skills, maxHealthPercent and techniqueEntries. Attachment attribute and skill modifier values and maxHealthPercent are numbers. Both fixed modifier and percentModifier may coexist. Do not author attachment needBars or techniqueGrants. Never author attachment status id/appliedAt or techniqueEntry id/provenance.
Choose the mechanical location by who receives the effect and when. An outer ability status is continuously active on its owner and represents an explicitly permanent, unconditional trait with attribute, skill or health modifiers. That trait may be a benefit or a drawback. An activated action, including a temporary self buff, is a techniqueEntry granted by an outer permanent status. A status containing only techniqueEntries is a complete grant container. In the technique revision, target kind self, single or area identifies the recipient. Direct harm is a damage effect. A buff or debuff applied on successful use is an effect with a nested status on that recipient; its duration is an integer number of world minutes or -1 for a permanent effect. Combine outer modifiers and a technique when the ability explicitly has both ongoing and activated components. Represent the supported components that follow from the ability description; use <statusEffects/> when there are none.
Passive-only attachment example (replace all example text, identities and values with actual supported mechanics; omit irrelevant fields):
<abilityAttachments><statusEffects><statusEffect><name>PASSIVE_STATUS_NAME</name><description>EXPLICIT_ONGOING_TRAIT</description><duration>-1</duration><attributes><attribute><attribute>ACTUAL_RELEVANT_ATTRIBUTE</attribute><modifier>1</modifier><percentModifier>20</percentModifier></attribute></attributes><skills><skill><skill>ACTUAL_RELEVANT_SKILL</skill><modifier>1</modifier><percentModifier>10</percentModifier></skill></skills><maxHealthPercent>10</maxHealthPercent></statusEffect></statusEffects></abilityAttachments>
Activated-only attachment example (the outer status grants a technique and has no numeric modifiers):
<abilityAttachments><statusEffects><statusEffect><name>TECHNIQUE_GRANT_STATUS_NAME</name><description>EXPLICIT_ABILITY_TO_USE_TECHNIQUE</description><duration>-1</duration><techniqueEntries><techniqueEntry><techniqueId>EXISTING_TECHNIQUE_ID</techniqueId><definitionRevision>1</definitionRevision></techniqueEntry></techniqueEntries></statusEffect></statusEffects></abilityAttachments>
Every techniqueEntry contains either a catalogue techniqueId with optional definitionRevision, or a complete candidate with optional candidateDiscipline. Refer to existing catalogue identities without repeating mechanics. A novel candidate has name, description, semanticKey, optional aliases with alias children, optional boolean unique, an existing disciplineId OR a sibling candidateDiscipline, and revisions with exactly one revision child. That revision object contains its numeric revision field equal to 1. Omit candidate.id/provenance and candidateDiscipline.id/provenance; omit candidate.disciplineId when supplying a new candidateDiscipline. The engine assigns identities and provenance after acceptance, and pins the chosen catalogue revision.
A discipline groups techniques into a reusable named tradition, practice or field. Prefer an appropriate existing discipline. If an actual skill already names the practice, prefer its name (for example Spellcasting). Do not name a discipline after one technique, its immediate effect or generic qualification language such as Established Practice. A new candidateDiscipline contains name, description, accessRequirements and optional publicAccess. Use true publicAccess only for genuinely universal practiced mundane actions. Different names alone do not justify unique true.
These complete new-entry examples illustrate structure only. Replace every placeholder name, description, semantic key, skill, attribute, profile and mechanic with setting-grounded qualifying facts. Unresolved placeholders reject. Example empty requirement lists do not establish unrestricted access. There is no default minimum skill rank of 2, and no mandatory level gate. Do not invent qualifications or choose requirements solely to match the actor's present rank.
Ordinary healing recipe entry:
<techniqueEntry><candidate><name>TECHNIQUE_NAME</name><description>TECHNIQUE_DESCRIPTION</description><semanticKey>TECHNIQUE_SEMANTIC_KEY</semanticKey><aliases/><unique>false</unique><revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check><recipe><recipeId>standard-healing</recipeId><skillName>ACTUAL_RELEVANT_SKILL</skillName><attributeName>ACTUAL_RELEVANT_ATTRIBUTE</attributeName><resourceProfileId>EXACT_APPLICABLE_PROFILE_ID</resourceProfileId><effectId>restore</effectId></recipe></revision></revisions></candidate><candidateDiscipline><name>DISCIPLINE_NAME</name><description>DISCIPLINE_DESCRIPTION</description><accessRequirements/><publicAccess>false</publicAccess></candidateDiscipline></techniqueEntry>
Nonhealing custom entry (replace the unpriced example with appropriate costs and mechanics):
<techniqueEntry><candidate><disciplineId>EXISTING_DISCIPLINE_ID</disciplineId><name>TECHNIQUE_NAME</name><description>TECHNIQUE_DESCRIPTION</description><semanticKey>TECHNIQUE_SEMANTIC_KEY</semanticKey><aliases/><unique>false</unique><revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>single</kind><allowDead>false</allowDead></target><check><kind>skill</kind><skill>ACTUAL_RELEVANT_SKILL</skill><difficulty>Medium</difficulty></check><costs/><effects><effect><id>strike</id><kind>damage</kind><amount><formula>max(1, level)</formula></amount><damageMode>technique</damageMode></effect></effects></revision></revisions></candidate></techniqueEntry>
Requirements: acquisitionRequirements, useRequirements and discipline accessRequirements contain requirement children. Each requirement has kind and optional boolean present (false negates it). For level include numeric minimum; for skill or attribute include name and numeric minimum (attribute compares its modifier). For ability, status, class, race or equipmentType include name; class/race must match actual identity. For discipline, technique, equippedItem or evidence include id. For alive include no other fields beyond optional present. Do not add fields irrelevant to the chosen kind. Example: <acquisitionRequirements><requirement><kind>skill</kind><name>ACTUAL_RELEVANT_SKILL</name><minimum>1</minimum></requirement></acquisitionRequirements>. Baseline initialized skills alone do not establish access; use actual training, ability or other established qualification.
Revision target has kind self, single or area, and allowDead false. Its check and optional per-effect check use kind automatic, attack, skill or opposed. All nonautomatic checks require skill and may include attribute; skill checks require difficulty Trivial, Easy, Medium, Hard, Very Hard or Legendary. Opposed checks require opposedSkill and optionally opposedAttribute; attack checks may include attackType, damageType and defense. Every check may include description. Omit fields irrelevant to its kind. Example: <check><kind>opposed</kind><skill>ACTUAL_RELEVANT_SKILL</skill><opposedSkill>ACTUAL_OPPOSING_SKILL</opposedSkill></check>.
New ordinary healing uses the recipe shown above with an actual relevant skill, attribute and applicable resource profile from balanceAuthoring context. It supports only self or single targets. Omit costs, failureCosts, effects and balance from recipe revisions: the engine computes canonical healing, costs and saved policy. Do not invent numeric healing/costs or repeat known levels, ranks, modifiers or computed values. Area healing, healing mixed with damage/statuses, additional resources/effects and free failure require a supported recipe and reject when unavailable. Do not relabel healing to bypass this rule.
Nonhealing revisions contain acquisitionRequirements, useRequirements, target, check, costs, optional failureCosts and nonempty effects. costs and failureCosts contain cost children. Each cost contains resource health and amount, OR resource need, needId, optional direction increase/decrease consistent with the pool, and amount. Health omits needId/direction. Never invent a resource pool. Omitted failureCosts uses normal costs; <failureCosts/> explicitly means free failure. Example: <costs><cost><resource>need</resource><needId>EXACT_ACTIVE_POOL_ID</needId><direction>decrease</direction><amount>1</amount></cost></costs>.
effects contains effect children with distinct stable id and kind. Damage uses kind damage, amount and damageMode technique. Never add ordinary weapon damage or weapon-derived mechanics. Healing uses kind healing and amount, but new healing must use the recipe. Buff/debuff effects use kind buff/debuff and a status child, optional stacking refresh/stack, refreshPolicy stronger/replace/reject and nonnegative numeric potency. Damage and debuffs require a nonautomatic common or per-effect check. Status effects omit amount/damageMode. Effect status has name, description and duration (positive integer world minutes or -1), optional attributes, skills, needBars, maxHealthPercent and techniqueGrants, with at least one mechanical modifier or grant. Its attribute/skill lists use the same nested identity shape as attachment modifiers, but their modifier/percentModifier and maxHealthPercent may also be formulas. needBars contains needBar children with name and delta (numeric or formula). techniqueGrants contains techniqueGrant children with an existing techniqueId, positive integer definitionRevision and optional stable id. These nested effect statuses may have need deltas; the containing permanent ability status may not.
Complete buff effect shape: <effect><id>focus</id><kind>buff</kind><status><name>STATUS_NAME</name><description>STATUS_DESCRIPTION</description><duration>5</duration><attributes/><skills><skill><skill>ACTUAL_RELEVANT_SKILL</skill><modifier><formula>level</formula></modifier><percentModifier>10</percentModifier></skill></skills><needBars/></status><stacking>refresh</stacking><refreshPolicy>stronger</refreshPolicy><potency>1</potency></effect>.
Amounts use numeric text (for example <amount>2</amount>) or a formula child (for example <amount><formula>max(1, level)</formula></amount>). Nested status modifier amounts may be signed. Use only available canonical formulaVariables keys: level, skill_&lt;normalized_name&gt; and attribute_&lt;normalized_name&gt;_modifier. Compact contexts supply each actor's key-to-value map and shared schema; derive actual relevant skill/attribute names only from schema keys present for that actor. Attribute variables are modifiers, never raw scores. Do not repeat known values or binding maps. Resource names such as mana are not formula variables. Allowed arithmetic functions are abs, round, floor, ceil, min, max; other functions and property access reject. No arbitrary progression currencies, unsupported utility effects, resurrection or invented qualification.`;
}

function buildAbilityAttachmentPrompt({ actor, ability, setting = {}, pendingAbility = false }) {
    const facts = actorFacts(actor);
    const catalogue = compactTechniqueCatalogue(TechniqueService.getDefinitions());
    const disciplines = TechniqueService.getDisciplines();
    const techniqueContext = TechniqueService.getCompactPromptContext([actor]);
    const mechanicalAbility = { ...ability };
    delete mechanicalAbility.imageId;
    delete mechanicalAbility.imagePrompt;
    const systemPrompt = `Author executable, setting-grounded mechanics for exactly one ${pendingAbility ? 'offered, unselected' : 'already-owned'} RPG ability. The ability itself is the source of permanent status effects if selected. Each status may grant one or more techniques while that status remains active. Use the existing status-effect and technique systems only. An outer ability status always affects its owner; a technique's effects affect its selected target only after use. Follow the mechanical placement guide below and select mechanics that follow directly from the ability's description. Direct percentage changes to maximum health use maxHealthPercent on a status. Attribute and skill entries may include signed fixed modifier and/or signed percentModifier; 20 means +20%. An ability status must have duration -1. Use exact existing attribute, skill, resource, discipline and technique identities from context; do not invent an actor fact. Reuse an equivalent existing catalogue technique before proposing a new one. No user action is cast, no cost is paid, and no time advances. No prose outside XML.\n${getAttachmentXmlInstructions()}`;
    const stableContextPrompt = `Actor facts:\n${JSON.stringify(facts)}\nSetting:\n${JSON.stringify(setting)}\nExisting disciplines:\n${JSON.stringify(disciplines)}\nExisting technique catalogue:\n${JSON.stringify(catalogue)}\nActor technique authoring context:\n${JSON.stringify(techniqueContext)}`;
    const abilityTaskPrompt = `Ability to author:\n${JSON.stringify(mechanicalAbility)}\nReturn the complete <abilityAttachments> XML for this one ability, with nested <statusEffects>, <statusEffect> and optional <techniqueEntries>/<techniqueEntry> children. Use XML children all the way through candidates, disciplines, requirements, costs, effects and formulas. Fixed and percentage modifiers may coexist. Do not include needBars or techniqueGrants on ability statuses. No JSON inside response elements.`;
    return { systemPrompt, generationPrompt: `${stableContextPrompt}\n${abilityTaskPrompt}`, stableContextPrompt, abilityTaskPrompt };
}

async function generateAbilityAttachmentDraft({ actor, abilityId, pendingAbility = null, config = {}, setting = {}, clientId = null }) {
    const ability = pendingAbility || requireOwnedAbility(actor, abilityId);
    if (pendingAbility && pendingAbility.id !== abilityId) throw new Error('Pending attachment ability ID does not match the requested ID.');
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, [abilityId], { pendingAbility });
    const { systemPrompt, generationPrompt, stableContextPrompt, abilityTaskPrompt } = buildAbilityAttachmentPrompt({ actor, ability, setting, pendingAbility: Boolean(pendingAbility) });
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: stableContextPrompt }, { role: 'user', content: abilityTaskPrompt }];
    let attemptMessages = messages;
    const aiConfig = LLMClient.resolveEffectiveAiConfiguration(LABEL, config).aiConfig;
    const result = await runPromptWithParseRetries({
        metadataLabel: LABEL,
        messages,
        maxAttempts: resolveConfiguredPromptMaxAttempts(aiConfig),
        complete: async ({ messages: current }) => {
            attemptMessages = current;
            try {
                return await LLMClient.chatCompletion({
                    messages: current, metadataLabel: LABEL, metadata: { clientId },
                    validateXML: false, throwOnError: true, allowToolCalls: false,
                    additionalPayload: { tools: [], tool_choice: 'none' }
                });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: LABEL, metadataLabel: LABEL, systemPrompt, generationPrompt,
                    response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message },
                        { title: 'Complete attempt conversation', content: JSON.stringify(current) }] });
                throw cause;
            }
        },
        parse: response => parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility }),
        buildRetryInstruction: error => `Ability attachment validation failed: ${error.message}\nReturn a corrected complete <abilityAttachments> response. No catalogue or actor changes were applied.`,
        onAttempt: ({ response, error, accepted, attempt }) => LLMClient.logPrompt({
            prefix: LABEL, metadataLabel: LABEL, systemPrompt, generationPrompt, response,
            sections: [{ title: 'Validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` },
                { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }]
        })
    });
    // Reject a draft if the actor or world changed while the model was running.
    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor,
        entries: [{ abilityId, statusEffects: result.value.statusEffects }], expected, pendingAbility });
    return { draft: pendingAbility ? { statusEffects: preview.entries[0].statusEffects } : result.value, expected };
}

async function authorNewAbilityAttachments({ actor, abilityIds, draftsByAbilityId = null, config = {}, setting = {}, clientId = null }) {
    if (!Array.isArray(abilityIds) || new Set(abilityIds).size !== abilityIds.length) {
        throw new TypeError('New ability attachment authoring requires distinct ability IDs.');
    }
    if (!abilityIds.length) return [];
    for (const abilityId of abilityIds) requireOwnedAbility(actor, abilityId);
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, abilityIds);
    const entries = [];
    for (const abilityId of abilityIds) {
        const { draft } = draftsByAbilityId
            ? { draft: draftsByAbilityId[abilityId] }
            : await generateAbilityAttachmentDraft({ actor, abilityId, config, setting, clientId });
        if (!draft || !Array.isArray(draft.statusEffects)) throw new Error(`Missing prepared attachment draft for ability ${abilityId}.`);
        entries.push({ abilityId, statusEffects: draft.statusEffects });
    }
    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor, entries, expected });
    TechniqueService.applyAbilityAttachmentBatch({ actor, entries: preview.entries, expected });
    return [...abilityIds];
}

module.exports = {
    authorNewAbilityAttachments,
    buildAbilityAttachmentPrompt,
    generateAbilityAttachmentDraft,
    parseAbilityAttachmentDraft,
    requireOwnedAbility
};
