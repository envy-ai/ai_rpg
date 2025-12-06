const Utils = require('./Utils.js');
const LLMClient = require('./LLMClient.js');

class StatusEffect {
    constructor({ name, description, attributes, skills, duration } = {}) {
        if (!description || typeof description !== 'string') {
            throw new Error('StatusEffect description must be a non-empty string');
        }

        this.name = typeof name === 'string' ? name.trim() : '';
        this.description = description.trim();
        this.attributes = this.#normalizeModifiers(attributes, 'attribute');
        this.skills = this.#normalizeModifiers(skills, 'skill');
        this.duration = this.#normalizeDuration(duration);
    }

    #normalizeModifiers(list, keyName) {
        if (!list) {
            return [];
        }
        if (!Array.isArray(list)) {
            throw new Error(`StatusEffect ${keyName} modifiers must be an array if provided`);
        }

        return list.map((entry) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error(`StatusEffect ${keyName} modifier entries must be objects`);
            }
            const key = typeof entry[keyName] === 'string' ? entry[keyName].trim() : '';
            if (!key) {
                throw new Error(`StatusEffect ${keyName} modifier is missing a ${keyName} name`);
            }
            const modifier = Number(entry.modifier);
            if (!Number.isFinite(modifier)) {
                throw new Error(`StatusEffect ${keyName} modifier must include a numeric modifier value`);
            }
            return {
                [keyName]: key,
                modifier
            };
        });
    }

    #normalizeDuration(value) {
        if (value === null || value === undefined) {
            return null;
        }

        // If value is 'instant', treat as 1 turn
        if (typeof value === 'string' && value.toLowerCase() === 'instant') {
            return 1;
        }

        // If value is 'permanent', treat as -1 turns
        if (typeof value === 'string' && value.toLowerCase() === 'permanent') {
            return -1;
        }

        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 1;
        }
        return Math.max(0, Math.floor(numeric));
    }

    update({ name, description, attributes, skills, duration } = {}) {
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
        if (duration !== undefined) {
            this.duration = this.#normalizeDuration(duration);
        }
        return this;
    }

    toJSON() {
        return {
            name: this.name,
            description: this.description,
            attributes: this.attributes,
            skills: this.skills,
            duration: this.duration
        };
    }

    static fromJSON(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data provided to StatusEffect.fromJSON');
        }
        return new StatusEffect({
            name: data.name,
            description: data.description,
            attributes: data.attributes,
            skills: data.skills,
            duration: data.duration
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

        const response = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'status_effect_generate'
        });

        if (typeof LLMClient.logPrompt === 'function') {
            LLMClient.logPrompt({
                prefix: 'status_effect',
                metadataLabel: 'status_effect_generate',
                systemPrompt: messages[0]?.content || '',
                generationPrompt: messages[1]?.content || '',
                response
            });
        }

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
                const parsedDuration = Number(durationText);
                if (!Number.isFinite(parsedDuration)) {
                    throw new Error(`Status effect "${sourceDescription}" duration is invalid`);
                }
                duration = Math.max(0, Math.floor(parsedDuration));
            }

            const attributes = Array.from(node.getElementsByTagName('attribute')).map(attrNode => {
                const attributeName = textFromTag(attrNode, 'name')?.trim();
                const modifierValue = Number(textFromTag(attrNode, 'modifier'));
                if (!attributeName) {
                    throw new Error(`Status effect "${sourceDescription}" attribute entry missing name`);
                }
                if (!Number.isFinite(modifierValue)) {
                    throw new Error(`Status effect "${sourceDescription}" attribute "${attributeName}" has invalid modifier`);
                }
                return { attribute: attributeName, modifier: modifierValue };
            });

            const skills = Array.from(node.getElementsByTagName('skill')).map(skillNode => {
                const skillName = textFromTag(skillNode, 'name')?.trim();
                const modifierValue = Number(textFromTag(skillNode, 'modifier'));
                if (!skillName) {
                    throw new Error(`Status effect "${sourceDescription}" skill entry missing name`);
                }
                if (!Number.isFinite(modifierValue)) {
                    throw new Error(`Status effect "${sourceDescription}" skill "${skillName}" has invalid modifier`);
                }
                return { skill: skillName, modifier: modifierValue };
            });

            results.set(sourceDescription, new StatusEffect({
                name,
                description,
                duration,
                attributes,
                skills
            }));
        }

        return results;
    }
}

module.exports = StatusEffect;
