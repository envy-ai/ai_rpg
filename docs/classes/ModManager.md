# ModManager

`ModManager.js` contains filesystem-backed helpers for the Mods page, mod-enable API routes, save-load mod compatibility checks, and post-restart save loading.

## Scope

ModManager does not execute mod code or hot-toggle the running mod set. `ModLoader.loadMods()` freezes the active enabled mod manifests during process startup through `ModDiscovery.freezeEnabledModManifests()`. ModManager compares that active set with configured enablement, writes `config.yaml`, and manages the pending-load file used after a restart.

Valid mod directories are discovered by `ModDiscovery.discoverModManifests()`. A directory is valid when it contains `mod.js` or a `defs/` directory. Merged config values in `mods.<name>.enabled` take precedence over `mods/<name>/config.json`; missing enablement defaults to enabled.

## Responsibilities

- Build the `/mods` page and `/api/mods/manager` state for every discovered mod.
- Normalize enabled mod name arrays into sorted, unique lists.
- Compare save metadata enabled mods with the startup-frozen active enabled mod list.
- Write explicit `mods.<name>.enabled` flags to the root `config.yaml` for every discovered mod.
- Persist, read, and clear pending load intents in `tmp/pending-load.json`.
- Fail with explicit errors for invalid base directories, malformed config files, invalid payload shapes, unknown mod names, and invalid pending-load data.

## Manager State

`buildModManagerState(baseDir, { runtimeConfig, activeEnabledMods })` returns:

- `mods[]`: one entry per discovered mod, sorted by mod name.
- `mods[].name`: mod directory name.
- `mods[].dir`: absolute mod directory path.
- `mods[].hasModJs`: whether the mod has a runtime entry point.
- `mods[].hasDefsDir`: whether the mod has defs overlays.
- `mods[].configPath`: path to `mods/<name>/config.json`, even when the file is absent.
- `mods[].configuredEnabled`: enablement resolved from the supplied runtime config and per-mod config.
- `mods[].activeEnabled`: whether the mod is active in the running process.
- `mods[].restartRequired`: whether configured enablement differs from active enablement for this mod.
- `mods[].fileConfigEnabled`: boolean from per-mod `config.json`, or `null` when absent.
- `activeEnabledMods`: sorted active enabled mod names.
- `configuredEnabledMods`: sorted configured enabled mod names.
- `restartRequired`: true when any mod's configured and active enablement differ.

When `activeEnabledMods` is omitted, the active list comes from `ModDiscovery.getEnabledModDirectoryNames()` using the frozen startup set. Tests may pass `activeEnabledMods` to inspect drift scenarios directly.

## Exported Functions

- `normalizeEnabledModNames(value, fieldName = 'enabled mods')`: requires an array, trims string entries, drops blank and non-string entries, removes duplicates, and returns names sorted by locale comparison.
- `diffEnabledMods({ activeEnabledMods, savedEnabledMods })`: normalizes both lists and returns `hasMismatch`, normalized `activeEnabledMods`, normalized `savedEnabledMods`, `missingFromActive`, and `extraActive`.
- `buildModManagerState(baseDir, options)`: discovers mods and returns the manager state described above.
- `updateConfigYamlModEnablement(baseDir, enabledMods)`: validates requested names against discovered mods, preserves existing per-mod config subkeys, writes explicit `enabled` booleans for every discovered mod into `config.yaml`, and returns `{ enabledMods, allMods, configPath }`.
- `getPendingLoadPath(baseDir)`: returns the path to `tmp/pending-load.json`.
- `writePendingLoadIntent(baseDir, intent)`: requires a non-empty `saveName`, normalizes `saveType` to `saves` or `autosaves`, applies a reason default of `pending-load`, writes `createdAt`, and returns the persisted object.
- `readPendingLoadIntent(baseDir)`: returns `null` when no pending-load file exists; otherwise parses and validates the object and returns normalized `saveName`, `saveType`, `reason`, and `createdAt`.
- `clearPendingLoadIntent(baseDir)`: deletes the pending-load file when present and returns whether a file was cleared.

## API And UI Flow

- `GET /api/mods/manager` returns `buildModManagerState(...)` for the Mods page refresh path.
- `PUT /api/mods/enabled` normalizes the request body, calls `updateConfigYamlModEnablement(...)`, then runs the shared config/defs reload path for validation. The route returns the refreshed manager state plus `restartRequired`; runtime mod code, defs overlays, and assets still require restart to match configured enablement.
- The `/mods` page renders configured checkboxes, active-process status, mod contents, and per-mod restart drift. Saving posts to `PUT /api/mods/enabled`.
- Saves persist `metadata.enabledMods` from the startup-frozen active enabled mod list. `/api/load` compares that list with the running active list before hydration when the metadata field exists.
- A mismatch returns HTTP 409 with code `MOD_ENABLEMENT_MISMATCH` and the `diffEnabledMods(...)` payload. The load UI offers three paths: keep current mods for this load, apply the save's mod configuration, or cancel.
- `POST /api/mods/apply-save-config` reads the save metadata, writes the saved enabled mod list to `config.yaml`, reloads config/defs for validation, writes `tmp/pending-load.json`, and either requests self-restart or reports that manual restart is required.
- `GET /api/pending-load` and `DELETE /api/pending-load` expose the pending-load file. `public/js/pending-load.js` checks for an intent on page load, posts `/api/load`, clears the intent after a successful load, and navigates to the play page.

## Restart Semantics

`restartRequired` means configured mod enablement and the running active mod set differ. The config write and validation paths can run inside the current process, but runtime hooks, defs-overlay participation, public assets, and asset serving follow the startup-frozen mod set until the server restarts.

`server.allowSelfRestart` controls whether applying a save's mod configuration may spawn a replacement Node process. The pending-load intent is written before restart handling so the target save can load after either a self-restart or a manual restart.
