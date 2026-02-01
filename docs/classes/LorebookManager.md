# LorebookManager

## Purpose
Manages SillyTavern-compatible lorebooks stored as JSON files. Handles loading, enabling/disabling, keyword matching, and prompt injection formatting.

## Key State
- `lorebooksPath`, `stateFile`.
- `lorebooks`: `Map<filename, normalizedLorebook>`.
- `enabledBooks`: `Set<filename>`.
- `allEntries`: flattened list of entries from enabled books.

## Construction
- `new LorebookManager(lorebooksPath = './lorebooks')`.

## Instance API
- `initialize()`: ensures directory, loads state, loads all lorebooks.
- `ensureDirectory()`: creates lorebook directory if missing.
- `loadState()` / `saveState()`: read/write `lorebook-state.json` for enabled books.
- `loadAllLorebooks()`: loads all `.json` files, normalizes, rebuilds flattened entries.
- `normalizeLorebook(lorebook, filename)`: converts to internal shape and calculates token estimate.
- `normalizeKeys(keys)`: coerces key list to array of strings.
- `rebuildEntriesList()`: rebuilds `allEntries` from enabled books.
- `enableLorebook(filename)` / `disableLorebook(filename)`.
- `isEnabled(filename)`.
- `getLorebookList()`: metadata list for all lorebooks.
- `getLorebookDetails(filename)`: full details including entries.
- `findMatchingEntries(contextText, { maxTokens })`: returns constant + keyword-matched entries, sorted and trimmed.
- `getConstantEntries(maxTokens)`.
- `trimToTokenBudget(entries, maxTokens)`.
- `formatEntriesForPrompt(entries)`: joins content blocks for prompt injection.
- `deleteLorebook(filename)` / `saveLorebook(filename, content)`.
- `reload()`: re-reads state and lorebooks.

## Module Helpers
- `getLorebookManager()`: returns the singleton instance (or null).
- `initializeLorebookManager(lorebooksPath)`: creates and initializes the singleton.

## Notes
- Normalization uses an estimated 4 chars per token to manage token budgets.
- All matching is simple substring match with optional case sensitivity per entry.
