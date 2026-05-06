# UnifiedTonalScale

## Purpose
Utility module for loading `defs/unified_tonal_scale.yaml`, validating its axis/level shape, normalizing per-setting tonal selections, and rendering the markdown system-prompt section used by LLM prompts.

## Public API
- `loadUnifiedTonalScaleDefinition({ baseDir })`: loads the root definition file through the merged defs loader and validates axes, abbreviations, framing text, and levels. Normalized axes also expose generated `selectionOptions` that include half-step midpoint values between adjacent defined integer levels.
- `normalizeUnifiedTonalScaleSelections(value)`: accepts an object or JSON string keyed by tonal-axis id and returns normalized `{ level, comment? }` entries. Comments require a selected numeric level; decimal half-step values such as `3.5` are preserved.
- `buildUnifiedTonalScalePrompt({ definition, selections })`: renders the full `## Unified Tonal Scale` prompt block, including scale tables and a `THIS STORY` notation/summary table. Selected levels may be exact definition levels or generated half-steps between adjacent defined levels.
- `buildUnifiedTonalScalePromptForSetting(settingSnapshot, { baseDir })`: convenience wrapper used by prompt context assembly. Empty selections return an empty string; partial or invalid selections throw explicit errors.
- `validateUnifiedTonalScaleDefinition(definition)`: validates and normalizes a parsed tonal-scale definition object.
- `resolveTonalScaleLevel(axis, level)`: resolves an exact defined level or generated half-step. Half-step names combine adjacent names in high/low order, e.g. `3.5` between `Mixed` and `Hopeful` renders as `Hopeful/Mixed`.

## Prompt Behavior
When a setting has complete `unifiedTonalScale` selections, `buildSettingPromptContext(...)` places the rendered text on `setting.unifiedTonalScalePrompt`. Base-context, no-context generic, and slop-remover system prompts insert it immediately before `config.extra_system_instructions`.

Half-step selections are UI options, not extra rows in `defs/unified_tonal_scale.yaml`. Prompt rendering blends the adjacent level descriptions and appends any setting-specific comment.
