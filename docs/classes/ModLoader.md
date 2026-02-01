# ModLoader

## Purpose
Loads and initializes mods from the `mods/` directory. Provides per-mod scope helpers, exposes mod configs, and supports client asset discovery.

## Key State
- `baseDir`, `modsDir`.
- `loadedMods`: `Map<modName, { name, dir, mod, meta }>`.
- `modPromptEnvs`: `Map<modName, NunjucksEnvironment>` for mod prompt templates.

## Construction
- `new ModLoader(baseDir)`: sets base paths and initializes internal maps.

## Instance API
- `getModDirectories()`: returns valid mod directory names (must contain `mod.js`).
- `loadMods(scope)`: loads all mods, calls `register`, returns `{ loaded, failed, total }`.
- `loadMod(modName, scope)`: loads a single mod, validates `register` exists, stores metadata.
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
- `registerModRoute` namespaces routes under `/api/mods/<modName>/...`.
