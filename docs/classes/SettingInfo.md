# SettingInfo

## Purpose
Represents a game setting/world configuration, including theme, genre, prompts, and defaults used to generate a game session. Tracks instances via static indexes and supports file persistence.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#theme`, `#genre`, `#tone`, `#difficulty`, `#startingLocationType`.
- Prompt and style fields: `#currencyName`, `#currencyNamePlural`, `#currencyValueNotes`, `#writingStyleNotes`, `#baseContextPreamble`, `#characterGenInstructions`, `#imagePromptPrefix*`.
- Defaults: `#playerStartingLevel`, `#defaultStartingCurrency`, `#defaultPlayerName`, `#defaultPlayerDescription`, `#defaultStartingLocation` (generation instructions), `#defaultExistingSkills`.
- Lists: `#availableClasses`, `#availableRaces`.
- Metadata: `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexByID`, `#indexByName`.

## Construction
- `new SettingInfo(options)` validates required fields and normalizes lists and numeric defaults. Adds the instance to static indexes.

## Accessors
- Getters and setters exist for all fields above. Setters normalize strings and update `#lastUpdated`.

## Instance API
- `update(updates)`: applies updates via setters, skipping id and timestamps.
- `getStatus()`: returns a full snapshot of all fields.
- `toJSON()`: alias of `getStatus()`.
- `clone(newName)`: deep-ish copy with a new id and timestamps; optionally renames.
- `getPromptVariables()`: returns a reduced object for prompt templates.
- `toString()`: returns `"name (theme/genre)"`.
- `save(saveDir)`: writes to `saves/settings` (or provided dir) as JSON.
- `deleteSavedFile(saveDir)`: deletes the file for this setting.

## Static API
- `create(options)`.
- `getById(id)` / `getByName(name)` / `getAll()` / `exists(id)` / `delete(id)` / `count()` / `clear()`.
- `fromJSON(data)`.
- `load(filepath)`: loads a single file.
- `saveAll(saveDir)` / `loadAll(saveDir)`.
- `listSavedSettings(saveDir)`: returns metadata for available settings on disk.

## Private Helpers
- `#generateId()`: unique id generator.
- `#normalizeExistingSkills(value)` / `#normalizeStringList(value)`.
- `#updateTimestamp()`.

## Notes
- Many setters normalize line endings to `\n` for prompt fields.
- List normalization accepts string (newline-delimited) or array input.
