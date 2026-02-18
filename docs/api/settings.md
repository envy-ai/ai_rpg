# Settings API

Common payloads: see `docs/api/common.md`.

## GET /api/settings
List all settings.

Response:
- 200: `{ success: true, settings: SettingInfo[], count }`
- 500: `{ success: false, error }`

## POST /api/settings
Create a new setting.

Request:
- Body: SettingInfo fields (at minimum `name`)

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400/409 with `{ success: false, error }`

## POST /api/settings/fill-missing
Fill missing setting fields via AI.

Request:
- Body:
  - `setting` (required object)
  - `instructions` (optional string)
  - `imageDataUrl` (optional base64 data URL)

Notes:
- When autofilling `defaultStartingLocation`, the AI is guided to use the multiline template shown on the form (region name, summary, rooms/locations, region exits with blank lines).
- When autofilling `baseContextPreamble`, the AI is guided to use a single-line bracketed format (e.g., `[Title: ...; Tags: ...; Genre: ...]`).
- When autofilling `defaultExistingSkills` (and the list is empty or baseline-only), the AI is asked to add up to ~10 setting-specific skills to complement the baseline list.
- `customSlopWords` is accepted as a list (or newline-delimited string) and round-trips through autofill as `<customSlopWords><word>...</word></customSlopWords>`.

Response:
- 200: `{ success: true, setting, raw }` (merged setting values and raw AI XML)
- 400/500 with `{ success: false, error }`

## GET /api/settings/current
Return the current applied setting.

Response:
- 200: `{ success: true, setting: SettingInfo | null, promptVariables?, message? }`
- 500: `{ success: false, error }`

## GET /api/settings/:id
Fetch a setting by id.

Response:
- 200: `{ success: true, setting: SettingInfo }`
- 404/500 with `{ success: false, error }`

## PUT /api/settings/:id
Update a setting.

Request:
- Body: SettingInfo fields

Response:
- 200: `{ success: true, setting: SettingInfo, message }`
- 201: `{ success: true, setting: SettingInfo, created: true, message }` (if not found; new setting created)
- 201: `{ success: true, setting: SettingInfo, created: true, clonedFromId, message }` (when `name` changes; creates a new setting with a new id while keeping the original)
- 400/404/409 with `{ success: false, error }`

## DELETE /api/settings/:id
Delete a setting.

Response:
- 200: `{ success: true, message, deletedSavedFiles }`
- 404/500 with `{ success: false, error }`

Notes:
- Deletion removes the setting from memory and also removes persisted setting files that match the deleted id.
- If the deleted setting was currently applied, the current setting is cleared.

## POST /api/settings/:id/clone
Clone a setting.

Request:
- Body: `{ newName?: string }`

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400/404/409 with `{ success: false, error }`

## POST /api/settings/save
Save all settings to disk.

Response:
- 200: `{ success: true, result, message }`
  - `result`: `{ count, files, directory }`
- 500: `{ success: false, error }`

## POST /api/settings/load
Load all settings from disk.

Response:
- 200: `{ success: true, result, message }`
  - `result`: `{ count, settings, directory, files }`
- 500: `{ success: false, error }`

## GET /api/settings/saved
List saved setting files.

Response:
- 200: `{ success: true, savedSettings, count }`
  - `savedSettings` entries include: `filename`, `filepath`, `name`, `theme`, `genre`, `lastModified`, `size`, `error?`
- 500: `{ success: false, error }`

## POST /api/settings/:id/save
Save a single setting to disk.

Response:
- 200: `{ success: true, filepath, message }`
- 404/500 with `{ success: false, error }`

## POST /api/settings/:id/apply
Apply a setting as current.

Response:
- 200: `{ success: true, setting: SettingInfo, message, promptVariables }`
- 404/500 with `{ success: false, error }`

## DELETE /api/settings/current
Clear the current setting.

Response:
- 200: `{ success: true, message, previousSetting: SettingInfo | null }`
- 500: `{ success: false, error }`
