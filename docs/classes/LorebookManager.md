# LorebookManager

## Purpose

`lorebook.js` exports `LorebookManager` and singleton helpers for SillyTavern-compatible JSON lorebooks. The manager loads lorebook files from disk, tracks which books are enabled, normalizes entries into the shape used by the server, matches entries against prompt context text, and formats matched entry content for prompt injection.

## Files and State

- `new LorebookManager(lorebooksPath = './lorebooks')` stores the lorebook directory path and sets `stateFile` to `path.join(lorebooksPath, 'lorebook-state.json')`.
- Server startup initializes the singleton with `config.lorebook?.directory || './lorebooks'`.
- `lorebooks` is a `Map<filename, normalizedLorebook>`.
- `enabledBooks` is a `Set<filename>` loaded from `lorebook-state.json`.
- `allEntries` is a flattened array of enabled entries from enabled lorebooks. Matching reads this array rather than scanning every loaded book.
- Enabled-book state is persisted as `{ "enabled": [filename, ...] }`.

## Initialization and Loading

- `initialize()` runs `ensureDirectory()`, `loadState()`, and `loadAllLorebooks()`, then returns the manager instance.
- `ensureDirectory()` creates the lorebook directory recursively. Directory creation failures other than `EEXIST` are logged.
- `loadState()` reads `lorebook-state.json`; a missing state file produces an empty enabled set. Parse or read failures are logged and also produce an empty enabled set.
- `loadAllLorebooks()` clears `lorebooks` and `allEntries`, reads every `.json` file in the lorebook directory except `lorebook-state.json`, normalizes each parseable file, skips files that fail to parse, then rebuilds `allEntries`.
- `reload()` reruns state and file loading and returns `{ count, enabledCount, totalEntries }`.

Server startup treats singleton initialization failure as non-fatal. If the singleton is unavailable, `/api/lorebooks` endpoints return `503` with `Lorebook manager not initialized`, and `Globals.reloadLorebooks()` throws the same condition.

## Normalized Lorebook Shape

`normalizeLorebook(lorebook, filename)` supports the SillyTavern `entries` object shape. Each object-valued entry becomes:

```js
{
  uid,
  key,
  content,
  comment,
  enabled,
  constant,
  insertion_order,
  case_sensitive,
  priority,
  bookFilename
}
```

Normalization rules:

- `uid` uses `entry.uid` when present; otherwise it uses `parseInt(uid, 10)` on the object key.
- `key` is always an array of non-empty trimmed strings. String keys are split on commas.
- `content` and `comment` default to empty strings.
- `enabled` defaults to `true` unless the source value is exactly `false`.
- `constant` and `case_sensitive` are true only when the source value is exactly `true`.
- `insertion_order` defaults to `100`.
- `priority` defaults to `10`.
- `bookFilename` stores the source filename.
- The normalized lorebook name is `lorebook.name` or the filename without `.json`.
- `entryCount` counts all normalized entries, including disabled entries.
- `tokenEstimate` is `Math.ceil(totalEntryContentCharacters / 4)`.

`getLorebookDetails(filename)` returns entry fields used by the UI and API: `uid`, `key`, `content`, `comment`, `enabled`, `constant`, `priority`, and `insertion_order`. It does not expose `case_sensitive` or `bookFilename`.

## Enablement and Persistence

- `rebuildEntriesList()` includes entries only when both the lorebook filename is enabled and the entry has `enabled: true`.
- `enableLorebook(filename)` requires the lorebook to be loaded, adds the filename to `enabledBooks`, rebuilds `allEntries`, and saves state.
- `disableLorebook(filename)` removes the filename from `enabledBooks`, rebuilds `allEntries`, and saves state. Disabling an unknown filename succeeds because the set deletion is unconditional.
- `deleteLorebook(filename)` requires the lorebook to be loaded, unlinks the JSON file, removes it from `lorebooks` and `enabledBooks`, rebuilds `allEntries`, and saves state.
- `saveLorebook(filename, content)` appends `.json` when needed, parses `content`, requires an object-valued `entries` property, writes the file, normalizes it into `lorebooks`, and returns `{ filename, entryCount }`. It does not enable the book or rebuild `allEntries`; enabling, disabling, deleting, initializing, or reloading rebuilds the flattened active-entry list.
- `saveState()` logs write failures instead of throwing.

## Matching

`findMatchingEntries(contextText, { maxTokens = 2000 } = {})` returns entries from `allEntries`:

- Empty or non-string context returns constant entries only.
- Constant entries are included without keyword checks.
- Non-constant entries match when any normalized key is a substring of the context.
- Matching is case-insensitive unless the entry has `case_sensitive: true`.
- Results are sorted by descending `priority`, then ascending `insertion_order`.
- `trimToTokenBudget(entries, maxTokens)` estimates each entry as `Math.ceil(content.length / 4)`. It appends entries in sorted order until the next entry would exceed the budget, then stops.

`formatEntriesForPrompt(entries)` maps entries to their `content`, drops empty or whitespace-only content, and joins the remaining blocks with blank lines. It does not add XML tags, source filenames, comments, keys, or match metadata.

## API and UI Surface

The API layer calls the singleton manager directly:

- `GET /api/lorebooks` returns `getLorebookList()`, sorted by lorebook name.
- `GET /api/lorebooks/:filename` returns `getLorebookDetails(filename)` or `404`.
- `POST /api/lorebooks/:filename/enable` and `/disable` update enablement and return `activeEntries`.
- `DELETE /api/lorebooks/:filename` deletes the loaded file.
- `POST /api/lorebooks/upload` calls `saveLorebook(filename, content)`.

The API does not expose a lorebook matching endpoint. The `/lorebooks` page is rendered by `server.js` and uses `public/js/lorebooks.js` to call the API endpoints for list, detail, enable, disable, delete, and upload actions.

## Prompt Callers

Runtime prompt paths call `findMatchingEntries(..., { maxTokens: 2000 })` directly. The context text is assembled from fields relevant to the prompt being rendered:

- `/api/chat` player actions use action text plus current location, current region, and visible NPC names, then append formatted lore to `additionalLore`.
- Character inventory generation uses location, region, character name, description, class, or role, then passes `lorebookEntries` into the inventory prompt include.
- Item generation and location-generation paths use location, region, setting theme, and generation hints, then pass formatted lore as `additionalLore`.
- Location NPC, region NPC, and location-thing generation pass `lorebookEntries` into prompt templates that render `<worldLore><loreEntry>...</loreEntry></worldLore>`.
- Single NPC and region generation pass formatted lore as `additionalLore`.

Prompt callers catch lorebook lookup errors and log warnings, allowing the prompt generation flow to continue without injected lore.

## Module Helpers

- `getLorebookManager()` returns the singleton manager instance or `null`.
- `initializeLorebookManager(lorebooksPath = './lorebooks')` creates a `LorebookManager`, initializes it, stores it as the singleton, and returns it.
