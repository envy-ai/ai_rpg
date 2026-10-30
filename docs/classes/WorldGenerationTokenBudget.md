# WorldGenerationTokenBudget

`WorldGenerationTokenBudget.js` identifies structured region/location generation
and the entity-population prompts they invoke. The complete allowlist is
`WORLD_GENERATION_PROMPT_FAMILIES` in the module. Normalized labels match the
family itself or an underscore-delimited suffix, including generated names,
colon-delimited NPC names, TinyBrain stages and correction labels.

`getWorldGenerationTokenBudgetConfigurationErrors(config)` validates the optional
root `world_generation` object and its optional positive-integer `max_tokens`.
Startup/reload validation reports these errors; request resolution also throws on
invalid configuration. `resolveWorldGenerationMaxTokens(metadataLabel, config)`
returns the configured budget for matching labels, or `null` when the setting is
absent or the label is outside the allowlist.

The merged project default is `world_generation.max_tokens: 20000`. `LLMClient`
applies this value after model-profile, caller and additional-payload token
settings. Matching requests set `max_tokens` and remove any conflicting
`max_completion_tokens`. The budget applies to each standard completion, retry,
tool continuation and TinyBrain stage independently. Token-chunked processing
retains its smaller transport windows while honoring the configured logical
completion budget.

Coverage includes region generation and expansion; location generation, item and
scenery rosters/expansion; NPC generation and hostile population; NPC inventories,
container contents, progression, abilities, aliases, equipment and starting
techniques; generated names, short descriptions, skills and status effects;
faction generation, relationships (including inbound relations for a newly
created faction) and reputation tiers;
region entrance/exit construction, travel times, secrets and random-event seeds.
Existing-region arrival selection, image/audio work, player-action narration,
crafting narration and location-modification narration retain their existing
budgets.

OpenAI-compatible transports enforce this through their output-token payload.
The existing Codex, Cline and Kimi CLI bridges do not expose an output-token cap
and ignore this payload field, just as they ignore `ai.maxTokens`.
