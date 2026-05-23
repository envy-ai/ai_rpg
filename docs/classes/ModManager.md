# ModManager

`ModManager.js` contains filesystem-backed helpers for the top-level Mods page, save/load mod manifests, and pending post-restart save loading.

## Responsibilities

- Discover valid mods through `ModDiscovery.discoverModManifests`.
- Report both configured enablement and startup-frozen active enablement through `buildModManagerState`.
- Normalize enabled mod names into sorted unique arrays.
- Diff a save's `metadata.enabledMods` against the running active mod list.
- Write explicit `mods.<name>.enabled` flags to `config.yaml`.
- Persist pending load intents under `tmp/pending-load.json`.

## Important functions

- `normalizeEnabledModNames(value, fieldName)`: validates an array and returns trimmed, sorted, unique names.
- `diffEnabledMods({ activeEnabledMods, savedEnabledMods })`: returns `missingFromActive`, `extraActive`, and `hasMismatch`.
- `buildModManagerState(baseDir, options)`: builds the `/mods` page/API payload, including per-mod `restartRequired`.
- `updateConfigYamlModEnablement(baseDir, enabledMods)`: rewrites `config.yaml` with explicit enabled flags for every discovered mod and fails on unknown mod names.
- `writePendingLoadIntent(baseDir, intent)`, `readPendingLoadIntent(baseDir)`, `clearPendingLoadIntent(baseDir)`: manage the post-restart load intent consumed by `public/js/pending-load.js`.

## Runtime behavior

The manager does not hot-load or unload mods. It updates configuration, then reports whether restart is required by comparing configured enablement against the active frozen mod set. The active set is frozen by `ModLoader.loadMods()` at process startup.

When a save's enabled mod list differs from the active list, `/api/load` returns `MOD_ENABLEMENT_MISMATCH` before hydration. Accepting the save configuration writes `config.yaml`, writes a pending-load intent, and either starts a self-restart when allowed or instructs the user to restart manually.
