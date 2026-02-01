# Potential Redundancies and Inconsistencies

This list is based on a quick pass through existing docs plus the current codebase. Each item includes a brief suggested fix.

## Redundancies

1) Duplicate API route definition for `GET /api/attributes`.
   - Evidence: `docs/API_README.md` notes the route is defined twice and the later definition is unreachable.
   - Suggested fix: remove or merge the duplicate definition in `api.js`, then update `docs/api/attributes.md` to reflect the single source of truth.

2) Duplicate field definitions and serialization in `Quest`.
   - Evidence: `Quest.js` declares `secretNotes` twice on the class and includes `secretNotes` twice in `toJSON()`.
   - Suggested fix: keep a single `secretNotes` field and serialize it once.

3) Duplicate static and instance methods in `Player`.
   - Evidence: `Player.js` defines `static getById` twice (with slightly different input handling), and also defines `get turnsSincePartyMemoryGeneration`, `incrementTurnsSincePartyMemoryGeneration`, and `resetTurnsSincePartyMemoryGeneration` twice with different side effects.
   - Suggested fix: consolidate each duplicate into a single authoritative implementation and delete the redundant versions.

4) Unexported and apparently unused `NameCache` class.
   - Evidence: `NameCache.js` defines a class but never exports it; no code references it.
   - Suggested fix: either export and integrate it, or remove the file if it is dead code.

## Inconsistencies

1) File name typo for `SceneSummaries` implementation.
   - Evidence: class is `SceneSummaries` but the file is `SceneSummaies.js` and required with the misspelling (e.g., `server.js`). Docs use the correct spelling.
   - Suggested fix: rename the file to `SceneSummaries.js` and update all requires; keep docs aligned with the file name.

2) `Player` exposes a deprecated `isNpc` getter that throws, while `isNPC` is the correct accessor.
   - Evidence: `Player.js` includes a `get isNpc()` that throws an error directing callers elsewhere.
   - Suggested fix: remove the throwing accessor if it is no longer used, or replace it with a non-throwing alias to reduce runtime surprises.

3) `ComfyUIClient.testConnection` references an undefined timeout variable.
   - Evidence: `ComfyUIClient.js` uses `baseTimeoutMilliseconds` in `testConnection()` but it is not defined in that scope.
   - Suggested fix: use `this.timeout` or a shared helper (e.g., `LLMClient.baseTimeoutMilliseconds()`), and keep the timeout strategy consistent with other methods.

4) Inconsistent save-image behavior between image clients.
   - Evidence: `OpenAIImageClient.saveImage` ensures the output directory exists, while `NanoGPTImageClient.saveImage` does not.
   - Suggested fix: pick a consistent contract (either ensure directory creation in both, or require the caller to pre-create it) and align both implementations and docs.

5) Inconsistent `Player.getById` input normalization.
   - Evidence: one `getById` trims string ids before comparing; the later duplicate does not.
   - Suggested fix: standardize on trimming and null/empty checks in a single method.
