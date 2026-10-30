const { getChatToolDefinitions, TINY_BRAIN_LOOKUP_TOOL_NAMES } = require('./chat_tool_calls.js');

const REGULAR_PROSE_CHAT_TOOL_NAMES = new Set([
    'useTechnique',
    'moreInfo',
    'getHistory',
    'getFullScene',
    'requestUserInput',
    'listMysteryBoxes',
    'findMysteryBoxes',
    'getMysteryBox',
    'listMysteryThreads',
    'getMysteryThread',
    'listLocationEntities',
    'getTravelTime',
    'revealEntity',
    'hideEntity',
    'addTracker',
    'scheduleEvent',
    'setRelationship',
    'resolveAttack',
    'resolveAreaAttack',
    'resolveSkillCheck',
    'resolveOpposedSkillCheck',
    'resolvePlausibilityCheck',
    'resolveOpposedPlausibilityCheck',
    'locateNpcs',
    'locateThings'
]);

const LEGACY_PROMPT_CHECK_CHAT_TOOL_NAMES = new Set([
    'resolveAttack',
    'resolveAreaAttack',
    'resolveSkillCheck',
    'resolveOpposedSkillCheck',
    'resolvePlausibilityCheck',
    'resolveOpposedPlausibilityCheck'
]);

function getEnabledProseChatToolDefinitions({ config, modExtensionRegistry = null, allowWorldMutationTools = false, allowMainPlayerMechanics = false } = {}) {
    const builtInTools = getChatToolDefinitions({
        modExtensionRegistry,
        allowDirectShortDescriptionUpdates: allowWorldMutationTools,
        allowTechniqueExecution: true
    }).filter(definition => {
        const name = definition?.function?.name?.trim();
        if (!name) return false;
        if (name === 'requestUserInput' && config?.chat_tools?.request_user_input_enabled === false) return false;
        if (allowWorldMutationTools) return true;
        const record = modExtensionRegistry?.getChatToolRecord?.(name);
        if (record) return record.allowedInRegularProse === true;
        return REGULAR_PROSE_CHAT_TOOL_NAMES.has(name)
            && (allowMainPlayerMechanics || config?.use_legacy_prompt_checks !== true
                || !LEGACY_PROMPT_CHECK_CHAT_TOOL_NAMES.has(name));
    });
    const modTools = modExtensionRegistry?.getChatToolDefinitions?.(allowWorldMutationTools
        ? { genericPromptOnly: true }
        : { regularProseOnly: true }) || [];
    return [...builtInTools, ...modTools];
}

function getPlayerActionToolDefinitions({ config, modExtensionRegistry = null, tinyBrain = false } = {}) {
    const tools = getEnabledProseChatToolDefinitions({ config, modExtensionRegistry, allowMainPlayerMechanics: true });
    return tinyBrain ? tools.filter(tool => TINY_BRAIN_LOOKUP_TOOL_NAMES.has(tool.function.name)) : tools;
}

function selectPlayerActionWireTools(callerDefinitions, playerActionDefinitions) {
    if (!Array.isArray(callerDefinitions) || !Array.isArray(playerActionDefinitions)) {
        throw new TypeError('Player-action wire tool selection requires two definition arrays.');
    }
    for (const [label, definitions] of [['caller', callerDefinitions], ['player-action', playerActionDefinitions]]) {
        const names = new Set();
        for (const definition of definitions) {
            const name = definition?.function?.name;
            if (typeof name !== 'string' || !name.trim() || names.has(name)) {
                throw new Error(`${label} tools must have unique non-empty function names.`);
            }
            names.add(name);
        }
    }
    const baseline = new Map(playerActionDefinitions.map(tool => [tool.function.name, JSON.stringify(tool)]));
    const canShare = callerDefinitions.every(tool => baseline.get(tool?.function?.name) === JSON.stringify(tool));
    return { tools: canShare ? playerActionDefinitions : callerDefinitions, sharedToolsApplied: canShare };
}

module.exports = { getEnabledProseChatToolDefinitions, getPlayerActionToolDefinitions, selectPlayerActionWireTools };
