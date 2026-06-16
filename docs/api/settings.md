# Settings API

Common payloads: see `docs/api/common.md`.

This API manages reusable world profiles backed by `SettingInfo`. The `/settings` World Profiles page is the primary UI client, but the routes accept JSON directly.

## SettingInfo Payload

`SettingInfo` serializes with:
- Identity and metadata: `id`, `name`, `createdAt`, `lastUpdated`.
- World description fields: `description`, `theme`, `genre`, `startingLocationType`, `magicLevel`, `techLevel`, `tone`, `difficulty`.
- Prompt and style fields: `currencyName`, `currencyNamePlural`, `currencyValueNotes`, `writingStyleNotes`, `baseContextPreamble`, `characterGenInstructions`, `imagePromptPrefixCharacter`, `imagePromptPrefixLocation`, `imagePromptPrefixItem`, `imagePromptPrefixScenery`.
- New-game defaults: `playerStartingLevel`, `defaultStartingCurrency`, `defaultPlayerName`, `defaultPlayerDescription`, `defaultStartingLocation`, `defaultExistingSkills`, `availableClasses`, `availableRaces`.
- Hide/perception mechanics: `hidingAttribute`, `hidingSkill`, `perceptionAttribute`, `perceptionSkill`.
- Setting-scoped factions: `defaultFactionCount`, `defaultFactions`.
- Prompt controls: `calendarDefinition`, `unifiedTonalScale`, `customSlopWords`, `modSettings`.

Field normalization:
- `name` is required for creation.
- String lists accept arrays in the JSON API. `SettingInfo` also normalizes newline-delimited strings for list fields.
- `playerStartingLevel` is stored as at least `1`; `defaultStartingCurrency` is stored as at least `0`.
- `defaultFactionCount` is `null` or a non-negative integer. `defaultFactions` is an array of faction drafts with unique ids/names; relation targets must reference another draft id and use `allied`, `neutral`, `hostile`, or `rival`.
- `calendarDefinition` is `null` or a calendar object normalized by `Globals.normalizeCalendarDefinition`: `yearName`, non-empty `months`, non-empty `weekdays`, optional `seasons`, and optional `holidays`.
- `unifiedTonalScale` is an object keyed by merged `defs/unified_tonal_scale.yaml` axis ids. Entries are `{ level, comment? }`; `level` must be numeric. Prompt rendering accepts defined levels and generated half-step values such as `3.5`, and requires every axis when any tonal selection is used.
- `customSlopWords` stores extra slop entries. Single-token entries are checked as words; multi-token entries are checked as ngrams.
- `modSettings` is a JSON object keyed by mod namespace. Each namespace value must be an object.

UI validation:
- The World Profiles page loads merged `defs/default_skills.yaml`, `defs/attributes.yaml`, `defs/unified_tonal_scale.yaml`, and registered mod setting metadata.
- The page requires `hidingAttribute` and `perceptionAttribute` and validates them against merged attribute keys. `hidingSkill` and `perceptionSkill` are optional and must match `defaultExistingSkills` when provided.
- Mod setting fields registered with `persist: false`, including preset-apply selectors, update other editor fields but are not stored in `modSettings`.

Route-order behavior:
- `GET /api/settings/saved` is registered after `GET /api/settings/:id`, so Express routes `GET /api/settings/saved` to the by-id handler with id `saved`.
- `DELETE /api/settings/current` is registered after `DELETE /api/settings/:id`, so Express routes `DELETE /api/settings/current` to the delete-by-id handler with id `current`.

## GET /api/settings

List in-memory settings.

Response:
- 200: `{ success: true, settings: SettingInfo[], count }`
- 500: `{ success: false, error }`

## POST /api/settings

Create a setting in memory.

Request:
- Body: `SettingInfo` fields, with non-empty string `name`.

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400: `{ success: false, error }`
- 409: `{ success: false, error }` when a setting with the same name exists.

Notes:
- The route passes the body directly to `new SettingInfo(...)`; validation comes from `SettingInfo`.
- Creation does not save to disk or apply the setting. The World Profiles UI calls `POST /api/settings/:id/save` and `POST /api/settings/:id/apply` after a successful save.

## POST /api/settings/fill-missing

Fill blank setting fields through the `fill-setting-form.xml.njk` prompt.

Request:
- Body:
  - `setting` (required object): partial world profile.
  - `instructions` (optional string): additional prompt guidance.
  - `imageDataUrl` (optional string): base64 `data:image/...;base64,...` URL used as visual context.
  - `augmentDefaultSkills` (optional boolean): merge generated setting-specific skills into the submitted `defaultExistingSkills` list.

Response:
- 200: `{ success: true, setting, raw }`
- 400: `{ success: false, error }` for missing `setting` or invalid `imageDataUrl`.
- 500: `{ success: false, error }`

Notes:
- The route normalizes form-style payloads before prompting: string fields are trimmed, number-like fields are converted to numeric strings or blank, list fields accept arrays or newline-delimited strings, `defaultFactions` accepts an array or JSON string, and `calendarDefinition` accepts an object or JSON string.
- The AI response fills only empty fields. `defaultExistingSkills` receives generated additions when `augmentDefaultSkills` is true; otherwise it is filled only when the submitted list is empty.
- The prompt includes `hidingAttribute`, `hidingSkill`, `perceptionAttribute`, and `perceptionSkill`. Attribute options come from merged `defs/attributes.yaml`; skill choices come from submitted `defaultExistingSkills`.
- `calendarDefinition`, `unifiedTonalScale`, and `defaultFactions` are accepted in the submitted setting and preserved through merge behavior. The setting autofill prompt does not synthesize those drafts.
- `customSlopWords` round-trips through XML as `<customSlopWords><word>...</word></customSlopWords>`.
- Prompts are logged with metadata label `setting_autofill`.

## GET /api/settings/current

Return the applied setting.

Response:
- 200 with no applied setting: `{ success: true, setting: null, message }`
- 200 with an applied setting: `{ success: true, setting: SettingInfo, promptVariables }`
- 500: `{ success: false, error }`

## GET /api/settings/:id

Fetch a setting by id.

Response:
- 200: `{ success: true, setting: SettingInfo }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

## PUT /api/settings/:id

Update a setting in memory.

Request:
- Body: `SettingInfo` fields.

Response:
- 200: `{ success: true, setting: SettingInfo, message }`
- 201: `{ success: true, setting: SettingInfo, created: true, message }` when no setting exists for `:id` and a new setting is created with that id.
- 201: `{ success: true, setting: SettingInfo, created: true, clonedFromId, message }` when a non-empty `name` different from the existing name is requested.
- 400: `{ success: false, error }`
- 404: `{ success: false, error }` when no setting exists and the fallback/create name conflicts.
- 409: `{ success: false, error }` when a requested new name conflicts with another setting.

Notes:
- Renaming creates a separate setting with a new id and leaves the original in memory.
- `id`, `createdAt`, and `lastUpdated` in the body are ignored.
- `calendarDefinition`, `unifiedTonalScale`, and `modSettings` validation errors propagate as `400`.
- Other setter validation errors inside `SettingInfo.update(...)` are warning-logged by the model; the old value remains and the route can still return `200`.

## DELETE /api/settings/:id

Delete a setting from memory and remove matching saved files from `saves/settings`.

Response:
- 200: `{ success: true, message, deletedSavedFiles }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Saved files are matched by filename suffix `_<id>.json`.
- If the deleted setting is applied, the applied setting is cleared from route locals, Nunjucks globals, and `global.currentSetting`.

## POST /api/settings/:id/clone

Clone a setting in memory.

Request:
- Body: `{ newName?: string }`

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 409: `{ success: false, error }` when `newName` conflicts with an existing setting.

Notes:
- If `newName` is omitted, the clone name is the source name plus ` (Copy)`.
- Cloning does not save to disk or apply the clone.

## POST /api/settings/save

Save all in-memory settings to `saves/settings`.

Response:
- 200: `{ success: true, result, message }`
  - `result`: `{ count, files, directory }`
- 500: `{ success: false, error }`

## POST /api/settings/load

Load settings from `saves/settings`.

Response:
- 200: `{ success: true, result, message }`
  - Existing directory: `result` is `{ count, settings, directory, files }`.
  - Missing directory: `result` is `{ count: 0, settings: [] }`.
- 500: `{ success: false, error }`

Notes:
- Loading clears the in-memory setting indexes before loading valid JSON files.
- Invalid files are warning-logged and skipped.

## GET /api/settings/saved

Registered saved-setting-file list handler.

Registered handler response:
- 200: `{ success: true, savedSettings, count }`
  - `savedSettings` entries include `filename`, `filepath`, `name`, `theme`, `genre`, `lastModified`, `size`, and optional `error`.
- 500: `{ success: false, error }`

Route-order behavior:
- In normal Express routing, `GET /api/settings/:id` receives this path first with id `saved`. The request returns the by-id response for a setting whose id is `saved`, or `404` when no such setting exists.

## POST /api/settings/:id/save

Save one setting to `saves/settings`.

Response:
- 200: `{ success: true, filepath, message }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Filenames are generated as sanitized setting name plus id: `<safe_name>_<id>.json`.

## POST /api/settings/:id/apply

Apply a setting as the active world profile.

Response:
- 200: `{ success: true, setting: SettingInfo, message, promptVariables }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Applying updates the route-local `currentSetting`, `app.locals.currentSetting`, `app.locals.promptVariables`, Nunjucks globals, and `global.currentSetting`.

## POST /api/settings/factions/fill-missing

Fill missing fields for one setting-local faction draft through the shared faction autofill prompt.

Request:
- Body:
  - `faction` (required object): draft faction payload.
  - `existingFactions` (optional array): sibling drafts with at least `name` and optional `id`/`shortDescription`.
  - `settingDescription` (optional string): world context. Defaults to the applied setting description when omitted.
  - `generationNotes` (optional string): additional prompt guidance.

Response:
- 200: `{ success: true, faction, raw }`
- 400: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- If the draft already has all required autofill fields, the route returns the normalized draft with `raw: null`.
- Relation targets are validated against `existingFactions` ids.
- Prompts are logged with metadata label `setting_faction_autofill`.

## POST /api/settings/factions/generate

Generate a list of setting-local faction drafts.

Request:
- Body:
  - `count` (required): parsed as a base-10 non-negative integer.
  - `settingDescription` (optional string): world context. Defaults to the applied setting description when omitted.
  - `generationNotes` (optional string): additional guidance.

Response:
- 200: `{ success: true, factions }`
- 400: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- The route returns draft faction objects for storage in `defaultFactions`; it does not create live world factions.

## GET /api/settings/calendar/default

Return the built-in Gregorian-style calendar definition for a world profile draft.

Request:
- Query:
  - `settingName` (optional string): used as the `yearName`.

Response:
- 200: `{ success: true, calendarDefinition }`
- 500: `{ success: false, error }`

## POST /api/settings/calendar/generate

Generate a world-profile calendar draft through the `calendar-generator.xml.njk` prompt.

Request:
- Body:
  - `setting` (required object): profile fields used as prompt context. Any submitted `calendarDefinition` is ignored for generation.

Response:
- 200: `{ success: true, calendarDefinition }`
- 400: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- The generated XML must parse to a valid calendar object and is normalized by `Globals.normalizeCalendarDefinition`.
- Prompt logging uses metadata label `calendar_generation`.
- This route returns an error when calendar generation fails. New-game creation has its own calendar fallback path.

## DELETE /api/settings/current

Registered clear-applied-setting handler.

Registered handler response:
- 200: `{ success: true, message, previousSetting: SettingInfo | null }`
- 500: `{ success: false, error }`

Route-order behavior:
- In normal Express routing, `DELETE /api/settings/:id` receives this path first with id `current`. The request attempts to delete a setting whose id is `current` and returns that handler's response.
