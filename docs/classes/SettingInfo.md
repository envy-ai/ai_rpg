# SettingInfo

## Purpose
`SettingInfo` is the world-profile model. It stores reusable setting identity, prompt guidance, new-game defaults, faction drafts, calendar drafts, tonal guidance, custom slop entries, and namespaced mod settings. Instances are tracked in process by id and lowercased name indexes, can be applied as the active world profile, can be saved under `saves/settings`, and are serialized into game saves as `setting.json`.

## Key State
- Identity and timestamps: `#id`, `#name`, `#createdAt`, `#lastUpdated`.
- World profile fields: `#description`, `#theme`, `#genre`, `#startingLocationType`, `#magicLevel`, `#techLevel`, `#tone`, `#difficulty`.
- Currency and prompt fields: `#currencyName`, `#currencyNamePlural`, `#currencyValueNotes`, `#writingStyleNotes`, `#baseContextPreamble`, `#characterGenInstructions`, `#npcNamingGuidance`.
- Image prompt fields: final-prompt prefixes (`#imagePromptPrefixCharacter`, `#imagePromptPrefixLocation`, `#imagePromptPrefixItem`, `#imagePromptPrefixScenery`, `#imagePromptPrefixFaction`) and per-world prompt-writer instructions (`#imagePromptInstructionsCharacter`, `#imagePromptInstructionsLocation`, `#imagePromptInstructionsItem`, `#imagePromptInstructionsScenery`, `#imagePromptInstructionsFaction`).
- New-game defaults: `#playerStartingLevel`, `#defaultStartingCurrency`, `#defaultPlayerName`, `#defaultPlayerDescription`, `#defaultStartingLocation`, `#defaultStartMonth`, `#defaultStartDay`, `#defaultStartTime`, `#defaultExistingSkills`, `#availableClasses`, `#availableRaces`.
- Mechanics selectors: `#hidingAttribute`, `#hidingSkill`, `#perceptionAttribute`, `#perceptionSkill`.
- World setup drafts: `#defaultFactionCount`, `#defaultFactions`, `#calendarDefinition`.
- Prompt controls: `#unifiedTonalScale`, `#customSlopWords`.
- Mod settings: `#modSettings`, keyed by mod namespace.
- Static indexes: `#indexByID`, `#indexByName`.

## Construction
- `new SettingInfo(options)` requires a non-empty string `name`. It generates an id when `options.id` is absent, assigns fresh timestamps, normalizes supported fields, and registers the instance in both static indexes.
- `fromJSON(data)` and `load(filepath)` construct a new instance from serialized data. Constructor timestamps are used for the hydrated instance.
- `writingStyleNotes` accepts `styleNotes` as an input alias.
- `playerStartingLevel` is stored as at least `1`; `defaultStartingCurrency` is stored as at least `0`.
- `defaultStartMonth` and `defaultStartDay` are positive integers. `defaultStartTime` is an integer hour from `0` through `23`. Profiles saved before these fields existed hydrate with month `1`, day `1`, and hour `9`.
- Line-ending normalization converts `\r\n` to `\n` for multiline prompt and image-prefix fields.
- `npcNamingGuidance` is optional and defaults to an empty string in old profiles. It preserves authored text and outer whitespace apart from that line-ending normalization; escaping happens only during prompt rendering.
- List fields accept arrays or newline-delimited strings, trim string entries, and drop blanks.
- Selector fields trim strings and store blank for non-strings.

## Normalized Structured Fields
- `defaultFactionCount` is `null` or a non-negative integer.
- `defaultFactions` is an array of setting-local faction drafts. Drafts require unique ids and names, reject the name `"None"`, normalize string-list fields, require named assets, sort reputation tiers by numeric threshold, and require relation targets to reference another draft id with status `allied`, `neutral`, `hostile`, or `rival` plus notes. Relation maps are sparse: absent edges have no explicit relationship, and empty maps are valid. Each draft persists a numeric integer `violenceLevel` from `1` through `5`; missing legacy values default to `1`, and invalid values are rejected without clamping.
- `calendarDefinition` is `null` or a normalized calendar object from `Globals.normalizeCalendarDefinition`. Its seasons persist separate `vegetationDescription` and `interiorDescription` image-edit guidance. Strings are parsed as JSON before normalization. Getters and snapshots return deep clones.
- `unifiedTonalScale` is a JSON object keyed by tonal axis. Each populated entry is `{ level, comment? }`; `level` must be numeric, comments require a level, and decimal half-step values are preserved. Full axis-key and level validation happens when tonal prompt text is rendered from `defs/unified_tonal_scale.yaml`.
- `modSettings` must be a JSON-serializable object keyed by non-empty namespace. Each namespace value must be an object.

## Instance API
- Getters return scalar fields directly and clone arrays/structured objects.
- Setters update `#lastUpdated`. Structured setters (`calendarDefinition`, `unifiedTonalScale`, `modSettings`, `defaultFactions`, `defaultFactionCount`) validate and throw on invalid payloads.
- `update(updates)`: applies defined keys through setters, skips `id`, `createdAt`, `lastUpdated`, and `undefined` values. Validation errors for `calendarDefinition`, `unifiedTonalScale`, and `modSettings` propagate; most other setter errors are warning-logged and leave the old value in place.
- `getStatus()`: returns a full snapshot of all fields.
- `toJSON()`: alias of `getStatus()`.
- `restoreSavedTimestamps({createdAt,lastUpdated})`: validates both timestamp strings before restoring their exact saved values. Explicit current-game ID migration invokes it after reconstructing the profile; ordinary construction and load retain their existing fresh-timestamp behavior.
- `clone(newName)`: deep-ish copy with a new id and timestamps; optionally renames.
- `getPromptVariables()`: returns prompt-facing setting values, including world traits, currency, prompt guidance, image prefixes, new-game numeric defaults, hide/perception selectors, `calendarDefinition`, `unifiedTonalScale`, `availableClasses`, `availableRaces`, `customSlopWords`, `modSettings`, `settingName`, and `settingDescription`.
- `getModSettings(namespace)`: returns a clone of one namespace.
- `getModSetting(namespace, key, defaultValue)`: returns a single value or `defaultValue`.
- `setModSetting(namespace, key, value, { suppressTimestamp })`: sets one namespaced key and returns the stored value.
- `updateModSettings(namespace, updates, options)`: shallow-merges a namespace and returns a clone of the namespace.
- `toString()`: returns `"name (theme/genre)"`.
- `save(saveDir)`: writes to `saves/settings` (or provided dir) as JSON.
- `deleteSavedFile(saveDir)`: deletes persisted files for this setting by id suffix match.

## Static API
- `create(options)`: wrapper for `new SettingInfo(options)`.
- `getById(id)`, `getByName(name)`, `getAll()`, `exists(id)`, `delete(id)`, `count()`, `clear()`: operate on the in-memory indexes.
- `fromJSON(data)`: constructs and indexes an instance from serialized fields.
- `load(filepath)`: reads one JSON file and constructs a setting.
- `saveAll(saveDir)`: saves all indexed settings to individual files.
- `loadAll(saveDir)`: clears the in-memory indexes, loads JSON files from the settings directory, warning-logs invalid files, and returns loaded settings plus file metadata.
- `listSavedSettings(saveDir)`: reads saved-file metadata (`filename`, `filepath`, `name`, `theme`, `genre`, `lastModified`, `size`, optional `error`) without indexing the files.
- `deleteSavedFilesById(id, saveDir)`: removes saved files whose names end in `_<id>.json`.

## Settings API and UI
- `/api/settings` creates and lists in-memory world profiles. `POST /api/settings` passes request bodies directly to the constructor after checking name presence and duplicate names.
- `PUT /api/settings/:id` updates an existing profile. A rename request creates a separate profile with a new id and leaves the source profile in memory. A missing id can create a profile with that id when the fallback name is available.
- The Worlds editor loads saved settings into memory on page load, edits the fields stored by this class, persists successful creates/updates through `/api/settings/:id/save`, and applies the saved profile through `/api/settings/:id/apply`.
- Prompt Guidance exposes **NPC Naming Guidance** as a multiline field. It participates in form create/edit/load, cloning, application, profile/game snapshots, prompt variables, and XML autofill like other prompt guidance.
- The editor requires `hidingAttribute` and `perceptionAttribute` from merged attribute definitions. `hidingSkill` and `perceptionSkill` are optional and are selected from `defaultExistingSkills`.
- Registered mod setting fields overwrite a deep-cloned loaded `modSettings` baseline, preserving unknown namespaces and unrendered keys because the API replaces the entire map. Switching profiles replaces that baseline; clearing the form resets it. Fields registered with `persist: false` are editor controls only and are removed from the submitted map, including stale saved selector keys. Explicit zero/false/null and empty structured values in untouched settings remain intact.
- Settings calendar controls build structured `calendarDefinition` data through the profile form. The calendar generation route returns a draft; saving the world profile persists it.

## Runtime Integration
- New-game setup requires an active setting. It derives player name, description, class, race, level, starting location, starting currency, starting month/day/time, existing skills, available class/race lists, faction count, faction drafts, and calendar behavior from the active setting.
- Faction setup loads `defaultFactions` first, including their `violenceLevel`, up to the resolved target count. `defaultFactionCount` controls the target when set; draft count and config count are fallbacks. A target of `0` disables faction setup. The World Profiles faction editor exposes the same 1–5 field. One relationship generation stage considers the complete initial roster, including entirely preconfigured rosters, adds only meaningful explicit missing ties and preserves authored edges.
- Calendar setup uses `calendarDefinition` when present. Without a stored calendar draft, the server runs the `calendar_generation` prompt and uses the built-in Gregorian-style calendar if generation fails.
- Game saves serialize the active setting into `setting.json` and save setting id/name in metadata. Loading a save reconstructs `currentSetting` with `SettingInfo.fromJSON()`.
- Load compatibility behavior fills missing hide/perception selectors through the `setting_hide_perception` prompt and persists the hydrated save when a backfill is applied.
- Load compatibility behavior fills missing saved `calendarDefinition` data from the loaded setting when available; otherwise it uses calendar generation with Gregorian fallback.
- Prompt rendering uses setting snapshots for base context, setting includes, generic prompts, slop-remover prompts, region/location/NPC generation, and name prompts. `baseContextPreamble` is inserted into base-context generation prompts.
- Nonblank `npcNamingGuidance` is added only to the shared NPC scaffold's unseeded `<name>` description, across region, location, and single-NPC generation. Explicit single-NPC names remain fixed. The description remains an XML comment: render-only XML/comment encoding protects markup and hyphens without changing saved guidance. Blank or whitespace-only guidance contributes nothing.
- Image prompt prefixes apply by target type, including faction emblems. Per-world image-prompt-writer instructions override the corresponding global `imagegen.image_prompt_instructions` value only when nonblank; blank fields preserve the global default. `baseContextPreamble` is prepended to image-generation prompts for non-ComfyUI engines; ComfyUI receives type-specific prefixes without the base preamble.
- `customSlopWords` extends active slop filtering. Single-token entries are treated as words; multi-token entries are normalized as ngrams. Invalid custom entries raise errors during slop collection.

### Ability and technique image guidance

`imagePromptPrefixAbility`, `imagePromptPrefixTechnique`, `imagePromptInstructionsAbility`, and `imagePromptInstructionsTechnique` follow the existing image-field getter/setter, newline normalization, cloning, prompt-variable, profile serialization, and active-setting save contracts. World Profiles exposes both final-prefix and prompt-writer fields. The separate global Image Prompts controls edit `imagegen.image_prompt_instructions.ability` and `.technique`; blank per-world instructions use these defaults. The two icon prompt writers and two final prefixes remain independent.

Discipline category emblems additionally use `imagePromptPrefixDiscipline` and `imagePromptInstructionsDiscipline`, with the same persistence, cloning, prompt-variable, newline normalization, editor, and nonblank per-world override contracts. The global instruction field is `imagegen.image_prompt_instructions.discipline`.
