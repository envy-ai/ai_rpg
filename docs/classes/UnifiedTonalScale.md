# UnifiedTonalScale

## Purpose
Utility module for loading `defs/unified_tonal_scale.yaml`, validating its axis/level shape, normalizing per-setting tonal selections, and rendering the markdown system-prompt section used by LLM prompts.

## Public API
- `loadUnifiedTonalScaleDefinition({ baseDir })`: loads the root definition file through the merged defs loader and validates axes, abbreviations, framing text, and levels.
- `normalizeUnifiedTonalScaleSelections(value)`: accepts an object or JSON string keyed by tonal-axis id and returns normalized `{ level, comment? }` entries. Comments require a selected numeric level.
- `buildUnifiedTonalScalePrompt({ definition, selections })`: renders the full `## Unified Tonal Scale` prompt block, including scale tables and a `THIS STORY` notation/summary table.
- `buildUnifiedTonalScalePromptForSetting(settingSnapshot, { baseDir })`: convenience wrapper used by prompt context assembly. Empty selections return an empty string; partial or invalid selections throw explicit errors.
- `validateUnifiedTonalScaleDefinition(definition)`: validates and normalizes a parsed tonal-scale definition object.

## Prompt Behavior
When a setting has complete `unifiedTonalScale` selections, `buildSettingPromptContext(...)` places the rendered text on `setting.unifiedTonalScalePrompt`. Base-context, no-context generic, and slop-remover system prompts insert it immediately before `config.extra_system_instructions`.
