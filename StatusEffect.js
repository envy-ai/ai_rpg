const Utils = require('./Utils.js');
const LLMClient = require('./LLMClient.js');
const IdGenerator = require('./IdGenerator.js');

class StatusEffect {
    constructor({ id = null, name, description, attributes, skills, needBars, maxHealthPercent, techniqueGrants, duration, appliedAt, techniqueProvenance, register = true } = {}) {
        if (!description || typeof description !== 'string') {
            throw new Error('StatusEffect description must be a non-empty string');
        }

        if (typeof register !== 'boolean') throw new TypeError('StatusEffect register option must be boolean.');
        this.id = typeof id === 'string' && id.trim() ? id.trim() : (register ? IdGenerator.next('status', typeof name === 'string' && name.trim() ? name : description) : null);
        if (register) IdGenerator.register('status', this.id);
        this.name = typeof name === 'string' ? name.trim() : '';
        this.description = description.trim();
        this.attributes = this.#normalizeModifiers(attributes, 'attribute');
        this.skills = this.#normalizeModifiers(skills, 'skill');
        this.needBars = this.#normalizeNeedBars(needBars);
        if (maxHealthPercent !== undefined && (typeof maxHealthPercent !== 'number' || !Number.isFinite(maxHealthPercent))) {
            throw new TypeError('StatusEffect maxHealthPercent must be a finite number.');
        }
        this.maxHealthPercent = maxHealthPercent ?? 0;
        this.techniqueGrants = require('./Technique.js').normalizeStatusGrants(techniqueGrants ?? [], this.id);
        this.duration = this.#normalizeDuration(duration);
        this.appliedAt = this.#normalizeAppliedAt(appliedAt);
        this.techniqueProvenance = StatusEffect.normalizeTechniqueProvenance(techniqueProvenance);
    }

    static normalizeTechniqueProvenance(value) {
        if (value === undefined || value === null) return null;
        const Technique = require('./Technique.js');
        Technique.assertKeys(value, ['techniqueId', 'effectId', 'actorId', 'operationId', 'sourceId', 'sourceKind', 'itemId', 'statusId', 'abilityId', 'definitionRevision', 'personalRevision', 'stacking', 'refreshPolicy', 'potency', 'authoredDuration'], 'status techniqueProvenance');
        const result = {};
        for (const key of ['techniqueId', 'effectId', 'actorId', 'operationId', 'sourceId']) result[key] = Technique.text(value[key], `status techniqueProvenance.${key}`);
        if (!['learned', 'equipment', 'status'].includes(value.sourceKind)) throw new Error('Invalid status technique source kind.');
        if (!['refresh', 'stack'].includes(value.stacking)) throw new Error('Invalid status technique stacking policy.');
        if (!['stronger', 'replace', 'reject'].includes(value.refreshPolicy)) throw new Error('Invalid status technique refresh policy.');
        Object.assign(result, { sourceKind: value.sourceKind, stacking: value.stacking, refreshPolicy: value.refreshPolicy, definitionRevision: Technique.number(value.definitionRevision, 'status definitionRevision', { integer: true, minimum: 1 }) });
        if (value.itemId !== undefined) result.itemId = Technique.text(value.itemId, 'status itemId');
        if (value.sourceKind === 'equipment' && !result.itemId) throw new Error('Equipment status provenance requires itemId.');
        if (value.statusId !== undefined) result.statusId = Technique.text(value.statusId, 'status statusId');
        if (value.sourceKind === 'status' && !result.statusId) throw new Error('Status source provenance requires statusId.');
        if (value.sourceKind !== 'status' && result.statusId) throw new Error('Only status source provenance may name statusId.');
        if (value.abilityId !== undefined) result.abilityId = Technique.text(value.abilityId, 'status abilityId');
        if (value.sourceKind !== 'status' && result.abilityId) throw new Error('Only status source provenance may name abilityId.');
        if (value.sourceKind !== 'equipment' && result.itemId) throw new Error('Only equipment status provenance may name itemId.');
        if (value.personalRevision !== undefined) result.personalRevision = Technique.number(value.personalRevision, 'status personalRevision', { integer: true, minimum: 1 });
        if (value.potency !== undefined) result.potency = Technique.number(value.potency, 'status potency', { minimum: 0 });
        result.authoredDuration = Technique.number(value.authoredDuration, 'status authoredDuration', { integer: true, minimum: -1 });
        if (result.authoredDuration === 0) throw new Error('Technique status authoredDuration must be positive or permanent.');
        return result;
    }

    #normalizeModifiers(list, keyName) {
        if (!list) {
            return [];
        }
        if (!Array.isArray(list)) {
            throw new Error(`StatusEffect ${keyName} modifiers must be an array if provided`);
        }

        return list.map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error(`StatusEffect ${keyName} modifier[${index}] entries must be objects. Supply an identity and its numeric modifiers.`);
            }
            const key = typeof entry[keyName] === 'string' ? entry[keyName].trim() : '';
            if (!key) {
                throw new Error(`StatusEffect ${keyName} modifier[${index}] is missing a ${keyName} name. Supply the actual ${keyName} identity.`);
            }
            if (entry.modifier === undefined && entry.percentModifier === undefined) throw new Error(`StatusEffect ${keyName} modifier[${index}] requires modifier or percentModifier. Supply a fixed numeric modifier, a numeric percentage, or both on the same entry.`);
            const modifier = entry.modifier === undefined ? 0 : Number(entry.modifier);
            const percentModifier = entry.percentModifier === undefined ? 0 : Number(entry.percentModifier);
            if (!Number.isFinite(modifier) || !Number.isFinite(percentModifier)) {
                throw new Error(`StatusEffect ${keyName} modifier[${index}] and percentModifier must be finite numbers. Use signed numeric values; formulas belong in technique effect status modifiers.`);
            }
            return {
                [keyName]: key,
                modifier,
                ...(entry.percentModifier === undefined ? {} : { percentModifier })
            };
        });
    }

    #normalizeNeedBars(list) {
        if (list === undefined || list === null) {
            return [];
        }
        if (!Array.isArray(list)) {
            throw new Error('StatusEffect need bar modifiers must be an array if provided');
        }

        return list.map(entry => {
            if (!entry || typeof entry !== 'object') {
                throw new Error('StatusEffect need bar modifier entries must be objects');
            }
            const name = typeof entry.name === 'string' ? entry.name.trim() : '';
            if (!name) {
                throw new Error('StatusEffect need bar modifier is missing a name');
            }
            const delta = Number(entry.delta);
            if (!Number.isFinite(delta)) {
                throw new Error(`StatusEffect need bar "${name}" has invalid delta`);
            }
            return { name, delta };
        });
    }

    static normalizeDuration(value) {
        if (value === null || value === undefined) {
            return null;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            if (/^[+-]?\d+$/.test(trimmed)) {
                const parsed = Number.parseInt(trimmed, 10);
                if (!Number.isFinite(parsed)) {
                    throw new Error(`StatusEffect duration "${value}" is invalid`);
                }
                return parsed < 0 ? -1 : parsed;
            }
            const lower = trimmed.toLowerCase();
            if (lower === 'instant') {
                return 1;
            }
            if (lower === 'permanent' || lower === 'continuous') {
                return -1;
            }
            if (lower === 'n/a' || lower === 'na' || lower === 'none') {
                return null;
            }
            return Utils.parseDurationToMinutes(trimmed, { fieldName: 'StatusEffect duration' });
        }

        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            throw new Error(`StatusEffect duration "${value}" is invalid`);
        }
        if (numeric < 0) {
            return -1;
        }
        if (!Number.isInteger(numeric)) {
            throw new Error(`StatusEffect duration "${value}" is invalid`);
        }
        return numeric;
    }

    #normalizeAppliedAt(value) {
        if (value === null || value === undefined) {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            throw new Error(`StatusEffect appliedAt "${value}" is invalid`);
        }
        return numeric;
    }

    #normalizeDuration(value) {
        return StatusEffect.normalizeDuration(value);
    }

    update({ name, description, attributes, skills, needBars, maxHealthPercent, techniqueGrants, duration, appliedAt } = {}) {
        if (typeof name === 'string' && name.trim()) {
            this.name = name.trim();
        }
        if (typeof description === 'string' && description.trim()) {
            this.description = description.trim();
        }
        if (attributes !== undefined) {
            this.attributes = this.#normalizeModifiers(attributes, 'attribute');
        }
        if (skills !== undefined) {
            this.skills = this.#normalizeModifiers(skills, 'skill');
        }
        if (needBars !== undefined) {
            this.needBars = this.#normalizeNeedBars(needBars);
        }
        if (maxHealthPercent !== undefined) {
            if (typeof maxHealthPercent !== 'number' || !Number.isFinite(maxHealthPercent)) throw new TypeError('StatusEffect maxHealthPercent must be a finite number.');
            this.maxHealthPercent = maxHealthPercent;
        }
        if (techniqueGrants !== undefined) this.techniqueGrants = require('./Technique.js').normalizeStatusGrants(techniqueGrants, this.id);
        if (duration !== undefined) {
            this.duration = this.#normalizeDuration(duration);
        }
        if (appliedAt !== undefined) {
            this.appliedAt = this.#normalizeAppliedAt(appliedAt);
        }
        return this;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            attributes: structuredClone(this.attributes),
            skills: structuredClone(this.skills),
            needBars: structuredClone(this.needBars),
            maxHealthPercent: this.maxHealthPercent,
            techniqueGrants: structuredClone(this.techniqueGrants),
            duration: this.duration,
            appliedAt: this.appliedAt,
            ...(this.techniqueProvenance ? { techniqueProvenance: JSON.parse(JSON.stringify(this.techniqueProvenance)) } : {})
        };
    }

    static fromJSON(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data provided to StatusEffect.fromJSON');
        }
        return new StatusEffect({
            id: data.id,
            name: data.name,
            description: data.description,
            attributes: data.attributes,
            skills: data.skills,
            needBars: data.needBars,
            maxHealthPercent: data.maxHealthPercent,
            techniqueGrants: data.techniqueGrants,
            duration: data.duration,
            appliedAt: data.appliedAt,
            techniqueProvenance: data.techniqueProvenance
        });
    }

    static async generateFromDescriptions(descriptions, {
        promptEnv,
        parseXMLTemplate,
        prepareBasePromptContext
    } = {}) {
        if (!Array.isArray(descriptions) || !descriptions.length) {
            throw new Error('generateFromDescriptions requires a non-empty array of descriptions');
        }
        const seeds = descriptions.map((entry, index) => {
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (!trimmed) {
                    throw new Error(`Status effect description at index ${index} is empty`);
                }
                return { description: trimmed, name: null, level: null };
            }
            if (entry && typeof entry === 'object') {
                const description = typeof entry.description === 'string' ? entry.description.trim() : '';
                const name = typeof entry.name === 'string' ? entry.name.trim() : null;
                const level = Number.isFinite(entry.level) ? entry.level : null;
                if (!description) {
                    throw new Error(`Status effect description at index ${index} is empty`);
                }
                return { description, name: name || null, level };
            }
            throw new Error(`Status effect description at index ${index} is not valid`);
        });

        if (!promptEnv || typeof promptEnv.render !== 'function') {
            throw new Error('generateFromDescriptions requires a promptEnv with a render function');
        }
        if (typeof parseXMLTemplate !== 'function') {
            throw new Error('generateFromDescriptions requires a parseXMLTemplate function');
        }
        if (typeof prepareBasePromptContext !== 'function') {
            throw new Error('generateFromDescriptions requires a prepareBasePromptContext function');
        }

        const baseContext = await prepareBasePromptContext({});
        const renderedTemplate = promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'status-effect-generate',
            statusEffectSeeds: seeds
        });
        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error('Status effect prompt template did not include required prompts');
        }

        const messages = [
            { role: 'system', content: parsedTemplate.systemPrompt.trim() },
            { role: 'user', content: parsedTemplate.generationPrompt.trim() }
        ];

        const expectedDescriptions = new Set(seeds.map(seed => seed.description));
        const parseResponse = response => {
            const doc = Utils.parseXmlDocument(response, 'text/xml');
            const errorNode = doc.getElementsByTagName('parsererror')[0];
            if (errorNode) {
                throw new Error(`Failed to parse status effect XML: ${errorNode.textContent}`);
            }

            const textFromTag = (parent, tagName) => {
                const node = parent.getElementsByTagName(tagName)?.[0];
                return node ? node.textContent : null;
            };

            const effectNodes = Array.from(doc.getElementsByTagName('effect'));
            if (!effectNodes.length) {
                throw new Error('Status effect generation returned no effects');
            }

            const results = new Map();
            for (const node of effectNodes) {
                const sourceDescription = textFromTag(node, 'sourceDescription')?.trim();
                if (!sourceDescription) {
                    throw new Error('Generated status effect is missing sourceDescription');
                }
                if (!expectedDescriptions.has(sourceDescription)) {
                    throw new Error(`Generated status effect refers to unknown sourceDescription "${sourceDescription}"`);
                }
                if (results.has(sourceDescription)) {
                    throw new Error(`Duplicate status effect generated for "${sourceDescription}"`);
                }

                const name = textFromTag(node, 'name')?.trim() || null;
                const description = textFromTag(node, 'description')?.trim();
                if (!description) {
                    throw new Error(`Generated status effect for "${sourceDescription}" is missing description`);
                }

                const durationText = textFromTag(node, 'duration');
                let duration = null;
                if (durationText !== null && durationText !== undefined && durationText.trim() !== '') {
                    duration = durationText.trim();
                }

                const attributes = Array.from(node.getElementsByTagName('attribute'))
                    .map(attrNode => {
                        const attributeName = textFromTag(attrNode, 'name')?.trim();
                        const modifierText = textFromTag(attrNode, 'modifier');
                        const percentText = textFromTag(attrNode, 'percentModifier');
                        const modifierValue = modifierText === null ? 0 : Number(modifierText);
                        const percentModifier = percentText === null ? 0 : Number(percentText);
                        if (!attributeName) {
                            throw new Error(`Status effect "${sourceDescription}" attribute entry missing name`);
                        }
                        if (!Number.isFinite(modifierValue) || !Number.isFinite(percentModifier) || (modifierText === null && percentText === null)) {
                            throw new Error(`Status effect "${sourceDescription}" attribute "${attributeName}" has invalid modifier/percentModifier`);
                        }
                        if (modifierValue === 0 && percentModifier === 0) {
                            return null;
                        }
                        return { attribute: attributeName, modifier: modifierValue, ...(percentText === null ? {} : { percentModifier }) };
                    })
                    .filter(Boolean);

                const skills = Array.from(node.getElementsByTagName('skill'))
                    .map(skillNode => {
                        const skillName = textFromTag(skillNode, 'name')?.trim();
                        const modifierText = textFromTag(skillNode, 'modifier');
                        const percentText = textFromTag(skillNode, 'percentModifier');
                        const modifierValue = modifierText === null ? 0 : Number(modifierText);
                        const percentModifier = percentText === null ? 0 : Number(percentText);
                        if (!skillName) {
                            throw new Error(`Status effect "${sourceDescription}" skill entry missing name`);
                        }
                        if (!Number.isFinite(modifierValue) || !Number.isFinite(percentModifier) || (modifierText === null && percentText === null)) {
                            throw new Error(`Status effect "${sourceDescription}" skill "${skillName}" has invalid modifier/percentModifier`);
                        }
                        if (modifierValue === 0 && percentModifier === 0) {
                            return null;
                        }
                        return { skill: skillName, modifier: modifierValue, ...(percentText === null ? {} : { percentModifier }) };
                    })
                    .filter(Boolean);

                const needBars = Array.from(node.getElementsByTagName('needBar'))
                    .map(needNode => {
                        const barName = textFromTag(needNode, 'name')?.trim();
                        const deltaValue = Number(textFromTag(needNode, 'delta'));
                        if (!barName) {
                            throw new Error(`Status effect "${sourceDescription}" need bar entry missing name`);
                        }
                        if (!Number.isFinite(deltaValue)) {
                            throw new Error(`Status effect "${sourceDescription}" need bar "${barName}" has invalid delta`);
                        }
                        if (deltaValue === 0) {
                            return null;
                        }
                        return { name: barName, delta: deltaValue };
                    })
                    .filter(Boolean);

                const maxHealthPercentText = textFromTag(node, 'maxHealthPercent');
                const maxHealthPercent = maxHealthPercentText === null ? undefined : Number(maxHealthPercentText);
                if (maxHealthPercent !== undefined && !Number.isFinite(maxHealthPercent)) throw new Error(`Status effect "${sourceDescription}" has invalid maxHealthPercent`);

                results.set(sourceDescription, new StatusEffect({
                    name,
                    description,
                    duration,
                    attributes,
                    skills,
                    needBars,
                    maxHealthPercent,
                    register: false
                }));
            }

            for (const description of expectedDescriptions) {
                if (!results.has(description)) throw new Error(`Status effect generation omitted "${description}"`);
            }
            return results;
        };
        let validatedEffects = null;
        await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'status_effect_generate',
            expectedXmlRootTag: 'statusEffects',
            validateXMLStrict: true,
            responseValidationRetryFeedback: true,
            throwOnError: true,
            responseValidator: response => {
                validatedEffects = null;
                LLMClient.logPrompt({
                    prefix: 'status_effect',
                    metadataLabel: 'status_effect_generate',
                    systemPrompt: messages[0]?.content || '',
                    generationPrompt: messages[1]?.content || '',
                    response
                });
                validatedEffects = parseResponse(response);
            }
        });
        if (!validatedEffects) throw new Error('Status effect completion did not validate its response.');
        return new Map(Array.from(validatedEffects, ([sourceDescription, candidate]) => [
            sourceDescription, new StatusEffect(candidate.toJSON())
        ]));
    }
}

module.exports = StatusEffect;
