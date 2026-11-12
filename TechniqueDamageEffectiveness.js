'use strict';

const LLMClient = require('./LLMClient.js');
const Globals = require('./Globals.js');
const Utils = require('./Utils.js');
const { parseTechniqueXmlValue } = require('./TechniqueXml.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { resolveDamageEffectivenessMultiplier } = require('./DamageEffectiveness.js');

function parseTechniqueDamageEffectiveness(response, count) {
    const xml = extractTinyBrainXmlResponse(response, 'damageEffectiveness');
    const root = Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement;
    if (root.tagName !== 'damageEffectiveness') throw new Error('Expected one damageEffectiveness root.');
    const ratings = parseTechniqueXmlValue(root, { tag: 'rating', item: 'number' }, 'damageEffectiveness');
    if (ratings.length !== count) throw new Error(`damageEffectiveness requires exactly ${count} rating elements in the supplied assessment order; received ${ratings.length}.`);
    ratings.forEach((rating, index) => {
        try { resolveDamageEffectivenessMultiplier(rating); }
        catch (cause) { throw new Error(`damageEffectiveness.rating[${index}]: ${cause.message}`, { cause }); }
    });
    return ratings;
}

async function assessTechniqueDamageEffectiveness({ actor, technique, source, weapon, assessments, promptEnv, clientId = null }) {
    if (!promptEnv || typeof promptEnv.render !== 'function') throw new Error('Technique damage assessment requires the native prompt environment.');
    const facts = {
        actor: { name: actor.name, description: actor.description, class: actor.class, race: actor.race },
        technique: { name: technique.name, description: technique.description }, source, weapon,
        assessments: assessments.map(({ target, effect, check }) => {
            const mechanics = JSON.parse(JSON.stringify(effect));
            if (mechanics.check) delete mechanics.check.damageEffectiveness;
            const effectiveCheck = { ...check };
            delete effectiveCheck.damageEffectiveness;
            return { effect: mechanics, check: effectiveCheck, target: { name: target.name, description: target.description,
                class: target.class, race: target.race, resistances: target.resistances,
                vulnerabilities: target.vulnerabilities, statusEffects: target.getStatusEffects().map(status => ({ name: status.name, description: status.description })) } };
        })
    };
    const systemPrompt = 'Assess current-target damage effectiveness using the ordinary attack rules. Return only the requested XML ratings; apply no effects and invent no rolls.';
    const generationPrompt = promptEnv.render('_includes/technique-damage-effectiveness.njk', {
        facts: JSON.stringify(facts), count: assessments.length
    });
    const label = 'technique_damage_effectiveness';
    const ai = LLMClient.resolveEffectiveAiConfiguration(label, Globals.config).aiConfig;
    let attemptMessages;
    const result = await runPromptWithParseRetries({
        metadataLabel: label, maxAttempts: resolveConfiguredPromptMaxAttempts(ai),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: generationPrompt }],
        complete: async ({ messages }) => {
            attemptMessages = messages;
            try {
                return await LLMClient.chatCompletion({ messages, metadataLabel: label, metadata: { clientId }, validateXML: false,
                    expectedXmlRootTag: 'damageEffectiveness', throwOnError: true, allowToolCalls: false,
                    additionalPayload: { tools: [], tool_choice: 'none' } });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: label, metadataLabel: label, systemPrompt, generationPrompt,
                    response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message }] });
                throw cause;
            }
        },
        parse: response => parseTechniqueDamageEffectiveness(response, assessments.length),
        buildRetryInstruction: error => `${error.message}\nReturn corrected damageEffectiveness XML with one rating per supplied assessment, preserving their order.`,
        onAttempt: ({ response, error, accepted }) => LLMClient.logPrompt({ prefix: label, metadataLabel: label,
            systemPrompt, generationPrompt, response,
            sections: [{ title: 'Validation', content: accepted ? 'accepted' : error.message },
                { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }] })
    });
    return result.value;
}

module.exports = { assessTechniqueDamageEffectiveness, parseTechniqueDamageEffectiveness };
