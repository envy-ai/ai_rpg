# SettingInfo

## Purpose
Represents a game setting/world configuration, including theme, genre, prompts, and defaults used to generate a game session. Tracks instances via static indexes and supports file persistence.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#theme`, `#genre`, `#tone`, `#difficulty`, `#startingLocationType`.
- Prompt and style fields: `#currencyName`, `#currencyNamePlural`, `#currencyValueNotes`, `#writingStyleNotes`, `#baseContextPreamble`, `#characterGenInstructions`, `#imagePromptPrefix*`, `#customSlopWords`, `#unifiedTonalScale`.
- Defaults: `#playerStartingLevel`, `#defaultStartingCurrency`, `#defaultPlayerName`, `#defaultPlayerDescription`, `#defaultStartingLocation` (generation instructions), `#defaultExistingSkills`, `#hidingAttribute`, `#hidingSkill`, `#perceptionAttribute`, `#perceptionSkill`, `#defaultFactionCount`, `#defaultFactions`, `#calendarDefinition`.
- Lists: `#availableClasses`, `#availableRaces`, `#customSlopWords`.
- Mod settings: `#modSettings` (namespaced JSON object for world-profile settings registered by mods).
- Metadata: `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexByID`, `#indexByName`.

## Construction
- `new SettingInfo(options)` validates required fields and normalizes lists, numeric defaults, and faction drafts. Adds the instance to static indexes.

## Accessors
- Getters and setters exist for all fields above. Setters normalize strings and update `#lastUpdated`.
- `modSettings` returns/clones the full namespaced mod settings object.
- `getModSettings(namespace)`, `getModSetting(namespace, key, defaultValue)`, `setModSetting(namespace, key, value)`, and `updateModSettings(namespace, updates)` provide namespaced access for mod labels, formulas, and resource identifiers.

## Instance API
- `update(updates)`: applies updates via setters, skipping id and timestamps.
- `getStatus()`: returns a full snapshot of all fields.
- `toJSON()`: alias of `getStatus()`.
- `clone(newName)`: deep-ish copy with a new id and timestamps; optionally renames.
- `getPromptVariables()`: returns a reduced object for prompt templates, including `calendarDefinition` and `unifiedTonalScale`.
- Hiding/perception mechanic selectors are persisted and exposed to prompt variables/base context. `hidingAttribute` and `perceptionAttribute` are required by the Worlds UI, while `hidingSkill` and `perceptionSkill` may be blank.
- `toString()`: returns `"name (theme/genre)"`.
- `save(saveDir)`: writes to `saves/settings` (or provided dir) as JSON.
- `deleteSavedFile(saveDir)`: deletes persisted files for this setting by id suffix match.

## Static API
- `create(options)`.
- `getById(id)` / `getByName(name)` / `getAll()` / `exists(id)` / `delete(id)` / `count()` / `clear()`.
- `fromJSON(data)`.
- `load(filepath)`: loads a single file.
- `saveAll(saveDir)` / `loadAll(saveDir)`.
- `listSavedSettings(saveDir)`: returns metadata for available settings on disk.
- `deleteSavedFilesById(id, saveDir)`: removes persisted files matching `*_<id>.json`.

## Private Helpers
- `#generateId()`: unique id generator.
- `#normalizeExistingSkills(value)` / `#normalizeStringList(value)`.
- `#updateTimestamp()`.

## Notes
- Many setters normalize line endings to `\n` for prompt fields.
- List normalization accepts string (newline-delimited) or array input.
- `unifiedTonalScale` is stored as an object keyed by `defs/unified_tonal_scale.yaml` axis key. Each populated axis stores `{ level, comment? }`; comments require a selected numeric level. Decimal half-step values are preserved so the Tone Scale UI can store generated midpoint selections such as `3.5`.
- Faction draft normalization validates ids/names, relation targets/statuses/notes, assets, and reputation tiers; invalid payloads throw explicit errors.
- `calendarDefinition` stores an optional world-profile calendar draft using the same shape as the active-game calendar (`yearName`, `months`, `weekdays`, `seasons`, `holidays`). It is normalized through `Globals.normalizeCalendarDefinition`, saved with the setting JSON, and returned as a deep clone. `null` means new-game creation should generate a calendar normally.
- Mod setting fields registered through `ModExtensionRegistry.registerSettingField(...)` are rendered on the Worlds UI and persisted under `modSettings`. Mods can group those fields into their own World Profiles tabs through `ModExtensionRegistry.registerSettingTab(...)`; ungrouped fields remain in the Prompt Guidance `Mod Settings` block.
- Registered setting fields can be select controls. Non-persisted action fields, such as the implants mod's `applyPreset` select, may update other persisted mod settings in the editor but are not saved into `modSettings`.
- `baseContextPreamble` is prepended to image-generation prompts at execution time for the OpenAI and NanoGPT backends; ComfyUI skips it.
- Legacy saved games whose current setting lacks hiding/perception attributes are backfilled on `/api/load` through the `setting_hide_perception` prompt, then written back to the loaded save.
