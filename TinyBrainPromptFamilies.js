const { TinyBrainPromptRunner } = require('./TinyBrainPromptRunner.js');

const TINY_BRAIN_PROMPT_FAMILIES = Object.freeze({
    player_action: '_includes/player-action.tinybrain.njk',
    event_checks: '_includes/events-xml.tinybrain.njk',
    need_bar_event_checks: '_includes/need-bars.tinybrain.njk',
    quest_reward_prose: '_includes/quest-reward-prose.tinybrain.njk',
    game_intro: '_includes/game-intro.tinybrain.njk',
    random_event: '_includes/random-event.tinybrain.njk',
    creative_mode_action: '_includes/creative-mode-action.tinybrain.njk',
    npc_action: '_includes/npc-action.tinybrain.njk',
    craft_player_action: '_includes/player-action-craft.tinybrain.njk',
    location_modify_player_action: '_includes/player-action-modify-location.tinybrain.njk',
    player_action_open_container: '_includes/player-action-open-container.tinybrain.njk',
    while_you_were_away: '_includes/while-you-were-away.tinybrain.njk',
    scheduled_event_resolution: '_includes/scheduled-event-resolution.tinybrain.njk',
    scheduled_event_interruption_rewrite: '_includes/scheduled-event-interruption-rewrite.tinybrain.njk'
});

const TINY_BRAIN_PROMPT_METADATA_LABELS = Object.freeze({
    player_action: 'player_action',
    event_checks: 'event_checks',
    need_bar_event_checks: 'need_bar_event_checks',
    quest_reward_prose: 'quest_reward_prose',
    game_intro: 'game_intro',
    random_event: 'random_event',
    creative_mode_action: 'creative_mode_action',
    npc_action: 'npc_action',
    craft_player_action: 'craft_player_action',
    location_modify_player_action: 'location_modify_player_action',
    player_action_open_container: 'player_action_open_container',
    while_you_were_away: 'while_you_were_away',
    scheduled_event_resolution: 'scheduled_event_resolution',
    scheduled_event_interruption_rewrite: 'player_action_interruption_rewrite'
});

function requireKnownTinyBrainPromptFamily(family) {
    if (typeof family !== 'string' || !Object.hasOwn(TINY_BRAIN_PROMPT_FAMILIES, family)) {
        throw new Error(`Unknown tiny-brain prompt family: ${family}`);
    }
    return family;
}

function getTinyBrainPromptConfigurationErrors(aiConfig) {
    const errors = [];
    const promptConfig = aiConfig?.tinybrain_prompts;
    if (promptConfig === undefined) {
        return errors;
    }
    if (!promptConfig || typeof promptConfig !== 'object' || Array.isArray(promptConfig)) {
        return ['ai.tinybrain_prompts must be an object when provided'];
    }
    for (const [family, enabled] of Object.entries(promptConfig)) {
        if (!Object.hasOwn(TINY_BRAIN_PROMPT_FAMILIES, family)) {
            errors.push(`ai.tinybrain_prompts contains unknown prompt family "${family}"`);
            continue;
        }
        if (typeof enabled !== 'boolean') {
            errors.push(`ai.tinybrain_prompts.${family} must be a boolean`);
        }
    }
    return errors;
}

function isTinyBrainPromptEnabled(aiConfig, family) {
    requireKnownTinyBrainPromptFamily(family);
    if (aiConfig?.tinybrain !== true) {
        return false;
    }
    const configuredValue = aiConfig?.tinybrain_prompts?.[family];
    return configuredValue === undefined ? true : configuredValue === true;
}

function configureTinyBrainPromptContext(templateContext, family) {
    if (!templateContext || typeof templateContext !== 'object' || Array.isArray(templateContext)) {
        throw new TypeError('Tiny-brain prompt context must be an object.');
    }
    const normalizedFamily = requireKnownTinyBrainPromptFamily(family);
    const renderState = TinyBrainPromptRunner.createRenderState();
    templateContext.tinyBrainProgramTemplate = TINY_BRAIN_PROMPT_FAMILIES[normalizedFamily];
    templateContext.__tinyBrainState = renderState;
    return {
        family: normalizedFamily,
        programTemplateName: templateContext.tinyBrainProgramTemplate,
        renderState
    };
}

async function runTinyBrainPromptProgram({
    initialRenderedTemplate,
    templateContext,
    tinyBrain,
    runnerOptions,
    continuationState = null,
    refreshContinuationBaseContext = false
} = {}) {
    if (!tinyBrain || typeof tinyBrain !== 'object') {
        throw new Error('runTinyBrainPromptProgram requires configured tiny-brain render state.');
    }
    const expectedTemplate = TINY_BRAIN_PROMPT_FAMILIES[requireKnownTinyBrainPromptFamily(tinyBrain.family)];
    if (tinyBrain.programTemplateName !== expectedTemplate) {
        throw new Error(`Tiny-brain prompt family "${tinyBrain.family}" has an invalid program template.`);
    }
    const runner = new TinyBrainPromptRunner(runnerOptions);
    return runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState: tinyBrain.renderState,
        programTemplateName: expectedTemplate,
        continuationState,
        refreshContinuationBaseContext
    });
}

module.exports = {
    TINY_BRAIN_PROMPT_FAMILIES,
    TINY_BRAIN_PROMPT_METADATA_LABELS,
    configureTinyBrainPromptContext,
    getTinyBrainPromptConfigurationErrors,
    isTinyBrainPromptEnabled,
    requireKnownTinyBrainPromptFamily,
    runTinyBrainPromptProgram
};
