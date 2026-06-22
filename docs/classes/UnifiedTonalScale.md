# UnifiedTonalScale

## Purpose
`UnifiedTonalScale.js` loads the shared tonal-axis definition from `defs/unified_tonal_scale.yaml`, normalizes per-setting tonal selections, resolves exact and half-step levels, and renders the markdown prompt block used by system prompts. It is a stateless utility module; persisted setting data lives on `SettingInfo.unifiedTonalScale`.

## Definition Data
- `loadUnifiedTonalScaleDefinition({ baseDir })` requires a non-empty `baseDir`, reads `defs/unified_tonal_scale.yaml` through `DefinitionLoader.loadMergedDefinitionFile(...)`, and validates the merged result.
- The definition must be an object with an `axes` object. Each axis key must be non-empty, and each axis must provide `title`, `abbreviation`, `framing`, and a non-empty `levels` list.
- Each level entry must provide a finite numeric `level`, non-empty `name`, and non-empty `description`.
- Validated axes expose `selectionOptions`, which contain the defined levels plus generated midpoint options between adjacent levels that differ by exactly `1`. Midpoints are not written to the YAML definition.

## Public API
- `validateUnifiedTonalScaleDefinition(definition)`: validates and normalizes a parsed tonal-scale definition object, including generated `selectionOptions` for each axis.
- `loadUnifiedTonalScaleDefinition({ baseDir })`: loads and validates the merged YAML definition from the provided project base directory.
- `normalizeUnifiedTonalScaleSelections(value)`: accepts `null`, `undefined`, an empty string, an object, or a JSON string. Empty values return `{}`. Object entries are keyed by tonal-axis id and normalize to `{ level, comment? }`.
- `resolveTonalScaleLevel(axis, level)`: resolves a finite numeric level against an axis. Exact defined levels return their definition data. Half-step midpoint levels return a generated name such as `Hopeful/Mixed` plus a combined description. Other numeric values throw.
- `buildUnifiedTonalScalePrompt({ definition, selections })`: validates the definition and selections, requires every axis when any selection is present, and renders the full markdown prompt block.
- `buildUnifiedTonalScalePromptForSetting(settingSnapshot, { baseDir })`: reads `settingSnapshot.unifiedTonalScale`, returns an empty string for no selections, otherwise loads the definition and renders the prompt.

## Selection Rules
- `normalizeUnifiedTonalScaleSelections(...)` trims axis keys, converts `level` with `Number(...)`, preserves decimal levels such as `3.5`, trims string comments, normalizes CRLF comments to LF, and omits blank comments.
- Blank entries are ignored. A comment without a selected level throws.
- Normalization checks shape and numeric values only. Axis-key membership, complete-axis coverage, and exact-level or half-step validity are enforced during prompt rendering.
- `SettingInfo` uses this normalizer in construction, setters, snapshots, and save serialization. Invalid `unifiedTonalScale` payloads propagate through `SettingInfo` structured setters and through `/api/settings` validation as `400` responses.

## Prompt Rendering
- Empty selections render as an empty string.
- Non-empty selections must contain one entry for every merged definition axis and no unknown axis keys.
- Selected levels may be exact definition levels or generated half-step midpoints. Half-step labels combine the upper and lower adjacent names, and their descriptions begin with `Between <lower> and <upper>:`.
- Rendered markdown starts with `## Unified Tonal Scale`, includes notation such as `I#-G#-S#-F#-U#`, emits a table for each axis, then emits a `### THIS STORY: ...` summary table with selected meanings and setting-specific comments.
- Markdown table cells are whitespace-normalized and pipe characters are escaped.

## Runtime Integration
- `server.js` loads the tonal-scale definition for the `/settings` page. Load errors are surfaced to the page as error text instead of hiding the problem.
- The World Profiles `Tone Scale` tab renders each merged axis, uses `selectionOptions` for dropdown choices, requires a selected level for every axis when any tone-scale value is present, and saves optional comments with the selected levels.
- `buildSettingPromptContext(...)` copies the active setting's `unifiedTonalScale` and sets `setting.unifiedTonalScalePrompt` by calling `buildUnifiedTonalScalePromptForSetting(...)`.
- `prompts/base-context.xml.njk`, `prompts/generic-prompt-nocontext.xml.njk`, `prompts/slop-remover.xml.njk`, and `prompts/_includes/slop-remover.njk` insert `setting.unifiedTonalScalePrompt` immediately before `config.extra_system_instructions`.
- `tests/unified_tonal_scale.test.js` covers prompt rendering, selection normalization, half-step dropdown options, half-step prompt rows, invalid level rejection, `SettingInfo` persistence, and prompt-template ordering.
