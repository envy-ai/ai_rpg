'use strict';

const { XMLSerializer } = require('@xmldom/xmldom');
const Utils = require('./Utils.js');
const { loadXmlGenerationSchema } = require('./XmlGenerationSchema.js');
const { parseLocationNpcXmlPlan, parseLocationNpcCheckpoint } = require('./LocationNpcGenerationPlan.js');

const PLAN_SCHEMA = 'location-npc-plan.schema.xml';
const CHECKPOINT_SCHEMA = 'location-npc-checkpoint.schema.xml';

function assembleLocationNpcResponse(acceptedEntries, plan) {
    if (!Array.isArray(plan) || !plan.length || !Array.isArray(acceptedEntries)
        || acceptedEntries.length !== plan.length || !plan.every((_, index) => acceptedEntries[index])) {
        throw new Error('Location NPC result requires every approved roster entry to be validated before assembly.');
    }
    const serializer = new XMLSerializer();
    const npcs = [];
    const hostiles = [];
    const memories = [];
    for (const [index, accepted] of acceptedEntries.entries()) {
        const doc = Utils.parseXmlDocumentStrict(accepted.xml, 'text/xml');
        const kind = plan[index].kind;
        const container = Array.from(doc.documentElement.childNodes || [])
            .find(node => node.nodeType === 1 && node.tagName === (kind === 'hostile' ? 'hostiles' : 'npcs'));
        const npcNode = Array.from(container?.childNodes || []).find(node => node.nodeType === 1);
        if (!npcNode) throw new Error(`Location NPC result is missing accepted roster entry ${index + 1}.`);
        (kind === 'hostile' ? hostiles : npcs).push(serializer.serializeToString(npcNode));
        const memoryContainer = Array.from(doc.documentElement.childNodes || [])
            .find(node => node.nodeType === 1 && node.tagName === 'memories');
        for (const node of Array.from(memoryContainer?.childNodes || []).filter(node => node.nodeType === 1)) {
            memories.push(serializer.serializeToString(node));
        }
    }
    return `<response><npcs>${npcs.join('')}</npcs><hostiles>${hostiles.join('')}</hostiles><memories>${memories.join('')}</memories></response>`;
}

async function runLocationNpcGenerationProgram({
    promptEnv,
    parseXMLTemplate,
    initialRenderedTemplate,
    templateContext,
    tinyBrain,
    maxAttempts,
    maxQuantity,
    schemaExtensions,
    parseNpcXml,
    validateCandidates,
    completeStage,
    runProgram
} = {}) {
    if (typeof runProgram !== 'function' || typeof completeStage !== 'function') {
        throw new TypeError('Location NPC TinyBrain generation requires the native runner and completion adapter.');
    }
    const planSchema = loadXmlGenerationSchema(PLAN_SCHEMA);
    const checkpointSchema = loadXmlGenerationSchema(CHECKPOINT_SCHEMA, { extensions: schemaExtensions });
    let plan = null;
    const acceptedEntries = [];
    const result = await runProgram({
        initialRenderedTemplate,
        templateContext,
        tinyBrain,
        runnerOptions: {
            promptEnv,
            parseXMLTemplate,
            metadataLabel: 'location_npc_generation',
            logPrefix: 'location_npc_generation_tinybrain',
            retryAttempts: maxAttempts - 1,
            toolDefinitions: [],
            parserOutputContracts: {
                location_npc_plan: { xmlOutput: true, expectedXmlRootTag: 'npcsPlan' },
                location_npc_entry: { xmlOutput: true, expectedXmlRootTag: 'response' }
            },
            parsers: {
                location_npc_plan: response => {
                    plan = parseLocationNpcXmlPlan(response, { maxQuantity, schema: planSchema });
                    return { value: plan };
                },
                location_npc_entry: (response, index) => {
                    if (!plan || !Number.isInteger(index) || !plan[index]) {
                        throw new Error(`Location NPC checkpoint ${index} requires an approved roster entry.`);
                    }
                    const accepted = parseLocationNpcCheckpoint(response, plan[index], {
                        schema: checkpointSchema, parseNpcXml, validateCandidates
                    });
                    acceptedEntries[index] = accepted;
                    return { value: accepted.npc };
                }
            },
            resultBuilders: {
                location_npc_result: () => assembleLocationNpcResponse(acceptedEntries, plan)
            },
            complete: stage => completeStage(stage, stage.checkpoint?.parserName === 'location_npc_plan'
                ? PLAN_SCHEMA : CHECKPOINT_SCHEMA)
        }
    });
    if (!plan || acceptedEntries.length !== plan.length || !plan.every((_, index) => acceptedEntries[index])) {
        throw new Error('Location NPC TinyBrain generation ended without all approved entries.');
    }
    const memories = new Map();
    for (const accepted of acceptedEntries) {
        for (const [name, entries] of accepted.memories) memories.set(name, entries);
    }
    return {
        response: result.aiResponse,
        value: { npcs: acceptedEntries.map(entry => entry.npc), memories }
    };
}

module.exports = { PLAN_SCHEMA, CHECKPOINT_SCHEMA, assembleLocationNpcResponse, runLocationNpcGenerationProgram };
