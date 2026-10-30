// Stable structured-generation families, including the enrichment prompts used
// while populating a region/location. Keep prose and image-writing prompts out.
const WORLD_GENERATION_PROMPT_FAMILIES = Object.freeze([
    'region_generation',
    'region_stub_locations',
    'region_entrance_selection',
    'region_secrets',
    'location_generation',
    'location_things_generation',
    'location_npc_generation',
    'region_npc_generation',
    'npc_generation_single',
    'hostile_presence',
    'inventory_generation',
    'thing_generation',
    'thing_generator_contents',
    'npc_progression_assignments',
    'npc_ability_assignments',
    'npc_alias_assignments',
    'npc_name_regen',
    'thing_name_regen',
    'location_name_regen',
    'region_name_regen',
    'equip_best',
    'starting_techniques',
    'skill_generation',
    'skill_generation_by_name',
    'status_effect_generate',
    'faction_generation',
    'faction_relationship_generation',
    'faction_inbound_relationship_generation',
    'faction_reputation_generation',
    'short_description_region',
    'short_description_location',
    'short_description_npc',
    'short_description_item',
    'short_description_ability',
    'short_description_faction',
    'existing_region_exit',
    'set_travel_times',
    'random_event_seed_region',
    'random_event_seed_location'
]);

function getWorldGenerationTokenBudgetConfigurationErrors(config) {
    const generation = config?.world_generation;
    if (generation === undefined) {
        return [];
    }
    if (!generation || typeof generation !== 'object' || Array.isArray(generation)) {
        return ['world_generation must be an object when provided.'];
    }
    if (generation.max_tokens === undefined) {
        return [];
    }
    if (!Number.isInteger(generation.max_tokens) || generation.max_tokens <= 0) {
        return ['world_generation.max_tokens must be a positive integer when provided.'];
    }
    return [];
}

function resolveWorldGenerationMaxTokens(metadataLabel, config) {
    const errors = getWorldGenerationTokenBudgetConfigurationErrors(config);
    if (errors.length) {
        throw new Error(errors.join('\n'));
    }
    const maxTokens = config?.world_generation?.max_tokens;
    if (maxTokens === undefined || typeof metadataLabel !== 'string') {
        return null;
    }
    const label = metadataLabel.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const isGeneration = WORLD_GENERATION_PROMPT_FAMILIES.some(family => (
        label === family || label.startsWith(`${family}_`)
    ));
    return isGeneration ? maxTokens : null;
}

module.exports = {
    WORLD_GENERATION_PROMPT_FAMILIES,
    getWorldGenerationTokenBudgetConfigurationErrors,
    resolveWorldGenerationMaxTokens
};
