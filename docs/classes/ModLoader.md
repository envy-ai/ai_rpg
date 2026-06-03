# ModLoader

## Purpose
Loads and initializes enabled mods from the `mods/` directory. Provides per-mod scope helpers, exposes per-mod configs, supports client asset discovery, recognizes defs-only mods that contain `defs/` overlays without requiring `mod.js`, supports hybrid mods that provide both `mod.js` and `defs/`, and honors optional merged-config `mods.<name>.enabled` flags plus per-mod `config.json.enabled`.

## Key State
- `baseDir`, `modsDir`.
- `loadedMods`: `Map<modName, { name, dir, hasModJs, hasDefsDir, dataOnly, mod, meta, config? }>`.
- `modPromptEnvs`: `Map<modName, NunjucksEnvironment>` for mod prompt templates.

## Construction
- `new ModLoader(baseDir)`: sets base paths and initializes internal maps.

## Instance API
- `getModDirectories()`: returns enabled mod directory names (must contain `mod.js` or `defs/`, and default to enabled unless disabled by merged config or `config.json`).
- `loadMods(scope)`: loads all mods, calls `register`, returns `{ loaded, failed, total }`.
- `loadMod(modName, scope)`: loads a single enabled mod, validates `register` when `mod.js` is present, stores metadata, accepts defs-only mods, and preserves both capability flags for hybrid mods.
- `createModScope(modName, modDir, scope)`: builds a per-mod scope with helpers:
  - `getModPublicUrl(filePath)`
  - `getModAssetUrl(filePath)` for files under `mods/<mod>/assets`
  - `renderModPrompt(templateName, context)`
  - `registerModRoute(method, path, handler)`
  - `modConfig` (resolved config)
  - `modExtensionRegistry`
  - hook helpers: `registerChatTool`, `registerXmlEvent`, `registerBaseContextContributor`, `registerPlayerActionPromptStep`, `registerActorStatusContributor`, `registerAttributeModifierContributor`, `registerStatusEffectContributor`, `registerInventorySyncContributor`, `registerSettingTab`, `registerSettingField`, `registerEntityField`, `registerThingImageBadge`, `registerThingContextAction`, and `registerStartupValidator`
- `getModConfig(modName)`: loads `config.json` and applies `configSchema` defaults.
- `getModConfigs()`: returns list of `{ name, displayName, schema, config }`.
- `saveModConfig(modName, newConfig)`: persists config to `config.json`.
- `setupStaticServing(app, express)`: serves `/mods/<name>` public assets and `/mods/<name>/assets` mod-owned image/icon assets.
- `getModClientScripts()`: returns mod public JS file paths.
- `getModClientStyles()`: returns mod public CSS file paths.

## Notes
- `loadMod` clears the require cache to allow hot reload during development.
- Defs-only mods are loaded as data-only entries with no `register(scope)` call.
- Hybrid mods with both `mod.js` and `defs/` call `register(scope)` like regular runtime mods while their defs overlays remain available to `DefinitionLoader`.
- Merged YAML config `mods.<name>.enabled` takes precedence over per-mod `config.json.enabled`.
- Disabled mods are skipped before JS loading, defs overlay application, and static asset serving.
- The active mod set is frozen at startup; toggling `config.json.enabled` on disk requires a restart to change the running set.
- `registerModRoute` namespaces routes under `/api/mods/<modName>/...`.
- Mod prompt environments receive the shared `eval` Nunjucks filter when the server provides it in scope.
- `modConfig` is resolved before `register(scope)` runs, so mods can read schema defaults during registration.
- `getModAssetUrl(...)` rejects empty paths and `..` segments. `registerThingImageBadge(...)` expects URLs produced by this helper so client badges can render SVG masks or raster images without exposing arbitrary filesystem paths.
- `registerThingContextAction(...)` lets mods add server-backed actions to shared item/scenery context menus without registering ad hoc browser routes.
- `registerPlayerActionPromptStep(...)` lets mods append instructions to supported player-action prompt stages. The registration must specify `step: 1` or `step: 3`; labels are assigned by the server starting at `1g` for stage 1 and `3k` for stage 3.
