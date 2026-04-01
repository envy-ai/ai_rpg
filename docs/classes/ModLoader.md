# ModLoader

## Purpose
Loads and initializes enabled mods from the `mods/` directory. Provides per-mod scope helpers, exposes per-mod configs, supports client asset discovery, recognizes defs-only mods that contain `defs/` overlays without requiring `mod.js`, and honors optional merged-config `mods.<name>.enabled` flags plus per-mod `config.json.enabled`.

## Key State
- `baseDir`, `modsDir`.
- `loadedMods`: `Map<modName, { name, dir, mod, meta }>`.
- `modPromptEnvs`: `Map<modName, NunjucksEnvironment>` for mod prompt templates.

## Construction
- `new ModLoader(baseDir)`: sets base paths and initializes internal maps.

## Instance API
- `getModDirectories()`: returns enabled mod directory names (must contain `mod.js` or `defs/`, and default to enabled unless disabled by merged config or `config.json`).
- `loadMods(scope)`: loads all mods, calls `register`, returns `{ loaded, failed, total }`.
- `loadMod(modName, scope)`: loads a single enabled mod, validates `register` when `mod.js` is present, stores metadata, and accepts defs-only mods.
- `createModScope(modName, modDir, scope)`: builds a per-mod scope with helpers:
  - `getModPublicUrl(filePath)`
  - `renderModPrompt(templateName, context)`
  - `registerModRoute(method, path, handler)`
  - `modConfig` (resolved config)
- `getModConfig(modName)`: loads `config.json` and applies `configSchema` defaults.
- `getModConfigs()`: returns list of `{ name, displayName, schema, config }`.
- `saveModConfig(modName, newConfig)`: persists config to `config.json`.
- `setupStaticServing(app, express)`: serves `/mods/<name>` public assets.
- `getModClientScripts()`: returns mod public JS file paths.
- `getModClientStyles()`: returns mod public CSS file paths.

## Notes
- `loadMod` clears the require cache to allow hot reload during development.
- Defs-only mods are loaded as data-only entries with no `register(scope)` call.
- Merged YAML config `mods.<name>.enabled` takes precedence over per-mod `config.json.enabled`.
- Disabled mods are skipped before JS loading, defs overlay application, and static asset serving.
- The active mod set is frozen at startup; toggling `config.json.enabled` on disk requires a restart to change the running set.
- `registerModRoute` namespaces routes under `/api/mods/<modName>/...`.
