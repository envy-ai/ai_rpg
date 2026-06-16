# Lorebooks API

The lorebook API manages SillyTavern-compatible JSON lorebooks loaded by the singleton `LorebookManager`. The manager is initialized during server startup with `config.lorebook.directory` when that runtime config value exists, otherwise it uses `./lorebooks`.

The manager creates the lorebook directory if needed, loads every `.json` file except `lorebook-state.json`, and stores enabled-book state in `lorebook-state.json` as `{ "enabled": [filename, ...] }`. If startup cannot initialize the manager, the server keeps running and these API endpoints return `503` with `{ success: false, error: "Lorebook manager not initialized" }`.

Lorebook filenames are route parameters for the per-book endpoints. Clients should URL-encode the filename.

## Returned Shapes

Lorebook list entries contain:

```json
{
  "filename": "world-lore.json",
  "name": "World Lore",
  "entryCount": 12,
  "tokenEstimate": 850,
  "enabled": true
}
```

Detailed lorebooks contain the same top-level fields plus `entries`:

```json
{
  "filename": "world-lore.json",
  "name": "World Lore",
  "entryCount": 12,
  "tokenEstimate": 850,
  "enabled": true,
  "entries": [
    {
      "uid": 1,
      "key": ["capital", "queen"],
      "content": "Lore text",
      "comment": "Internal note",
      "enabled": true,
      "constant": false,
      "priority": 10,
      "insertion_order": 100
    }
  ]
}
```

- `entryCount` counts all normalized entries in the file, including disabled entries.
- `tokenEstimate` is estimated from entry content length at roughly four characters per token.
- `key` is always returned as an array. A string key in the source file is split on commas during normalization.
- `enabled` on a lorebook means the filename is present in `lorebook-state.json`. `enabled` on an entry means the entry participates in matching when its lorebook is enabled.
- Detail responses do not include normalized `case_sensitive` or `bookFilename`, even though the manager uses those fields internally.

## GET /api/lorebooks

Lists loaded lorebooks with metadata. Results are sorted by `name` using `localeCompare`.

Response:
- 200: `{ success: true, lorebooks }`
  - `lorebooks` entries: `{ filename, name, entryCount, tokenEstimate, enabled }`
- 503/500 with `{ success: false, error }`

## GET /api/lorebooks/:filename

Returns one loaded lorebook with normalized entries.

Response:
- 200: `{ success: true, lorebook }`
  - `lorebook` fields: `filename`, `name`, `entryCount`, `tokenEstimate`, `enabled`, `entries`
  - `entries` elements: `{ uid, key, content, comment, enabled, constant, priority, insertion_order }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/:filename/enable

Enables a loaded lorebook, rebuilds the flattened active-entry list, and persists enabled-book state.

Response:
- 200: `{ success: true, message, activeEntries }`
- 404/503/500 with `{ success: false, error }`

Notes:
- `404` is returned when the filename is not loaded.
- `activeEntries` is the count of enabled entries across all enabled lorebooks after rebuilding the active-entry list.

## POST /api/lorebooks/:filename/disable

Disables a filename, rebuilds the flattened active-entry list, and persists enabled-book state.

Response:
- 200: `{ success: true, message, activeEntries }`
- 503/500 with `{ success: false, error }`

Notes:
- Disabling an unknown filename succeeds because the manager removes the filename from the enabled set without requiring it to be loaded.
- `activeEntries` is the count of enabled entries across all enabled lorebooks after rebuilding the active-entry list.

## DELETE /api/lorebooks/:filename

Deletes a loaded lorebook JSON file from disk, removes it from the manager, removes it from the enabled set, rebuilds the active-entry list, and persists enabled-book state.

Response:
- 200: `{ success: true, message }`
- 404/503/500 with `{ success: false, error }`

Notes:
- `404` is returned when the filename is not loaded.

## POST /api/lorebooks/upload

Writes a lorebook JSON file to the lorebook directory and normalizes it into the manager's loaded lorebook map.

Request:
- Body: `{ filename: string, content: string }`

Response:
- 200: `{ success: true, message, entryCount }`
- 400/503 with `{ success: false, error }`

Validation and persistence:
- `.json` is appended to `filename` when it is missing.
- `content` must parse as JSON.
- Parsed content must contain an object-valued `entries` property.
- The upload endpoint does not enable the lorebook. Enable it with `POST /api/lorebooks/:filename/enable`.
- Uploading over an enabled filename updates the loaded lorebook map, but the flattened active-entry list is rebuilt only by enable, disable, delete, initialization, or `/reload_lorebooks`.

## Matching and Prompt Use

The API does not expose a match endpoint. Runtime prompt code calls `LorebookManager.findMatchingEntries(contextText, { maxTokens: 2000 })` directly for player actions and several generation flows, including NPC, item, inventory, location, region, and location-thing generation.

Matching uses only entries from enabled lorebooks where the entry itself is enabled:

- Constant entries are included without keyword checks.
- Keyword entries match by substring against the supplied context text.
- Entry matching is case-insensitive unless the source entry has `case_sensitive: true`.
- Results are sorted by descending `priority`, then ascending `insertion_order`.
- Results are trimmed to the token budget using the same four-characters-per-token estimate.

Matched entries are formatted for prompts by joining their `content` fields with blank lines.

## Related Surfaces

- The `/lorebooks` page is server-rendered by `server.js` and uses these API endpoints through `public/js/lorebooks.js`.
- The `/reload_lorebooks` slash command calls `Globals.reloadLorebooks()`, which reloads `lorebook-state.json` and all lorebook files from disk.
