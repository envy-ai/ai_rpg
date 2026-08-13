# ModLoader

## Purpose

`ModLoader` discovers enabled mod directories, initializes runtime mods, records loaded mod metadata, creates per-mod helper scopes, and exposes mod-owned prompts, public files, asset files, scripts, styles, and configuration schemas.

Mod directories live under `mods/`. A valid mod directory contains `mod.js`, `defs/`, or both:

- `mod.js` exports `register(scope)` for runtime hooks and optional `meta` / `configSchema` metadata.
- `defs/` contains YAML definitions consumed by `DefinitionLoader`. Files may overlay matching root `defs/*.yaml` files or introduce mod-owned definitions without requiring root placeholders.
- `prompts/` contains mod-owned Nunjucks templates rendered through `scope.renderModPrompt(...)`.
- `public/` contains browser-facing files served under `/mods/<mod>/...`.
- `assets/` contains mod-owned image/icon files served under `/mods/<mod>/assets/...`.

## Construction

- `new ModLoader(baseDir, { config } = {})`
  - `baseDir`: project root used to locate `mods/`.
  - `config`: merged runtime config used for mod enablement checks.
  - Initializes `loadedMods` and `modPromptEnvs`.

## Discovery And Enablement

Discovery is delegated to `ModDiscovery`:

- Hidden directories and `mods/node_modules` are ignored.
- Directory symlinks are followed and use the symlink basename as the mod name. Broken or unresolvable mod-directory symlinks fail discovery with an explicit error.
- Valid mod manifests are sorted alphabetically by directory name.
- `config.mods.<name>.enabled` takes precedence over `mods/<name>/config.json` `enabled`.
- Missing enabled flags are treated as enabled.
- `config.mods`, each `config.mods.<name>`, and all `enabled` flags must have the expected types; invalid values raise errors during discovery.
- `loadMods(...)` and `setupStaticServing(...)` freeze the enabled manifest set for the process through `freezeEnabledModManifests(...)`.

Disabled mods are excluded from runtime loading, defs overlays, static serving, client script/style injection, and loaded config schema listing. Changing enablement on disk requires a process restart to change the active frozen set.

## Key State

- `baseDir`: project root passed to the constructor.
- `modsDir`: `path.join(baseDir, "mods")`.
- `config`: merged config snapshot passed to the constructor.
- `loadedMods`: `Map<modName, modInfo>` populated by `loadMod(...)`.
- `modPromptEnvs`: `Map<modName, NunjucksEnvironment>` for mods with `prompts/` and a Nunjucks scope.

`loadedMods` entries have:

```js
{
  name,
  dir,
  hasModJs,
  hasDefsDir,
  dataOnly,
  mod,
  meta,
  config
}
```

Defs-only mods are stored with `dataOnly: true`, `mod: {}`, and no `config`. Runtime mods are stored with the required module export, resolved `meta`, and config loaded from `config.json` plus `configSchema` defaults.

## Loading API

- `getModDirectories()`: returns enabled mod directory names from the frozen active set when it exists, otherwise from current discovery.
- `loadMods(scope)`: freezes enabled manifests, loads each enabled mod, catches per-mod load failures, logs results, and returns `{ loaded, failed, total }`.
- `loadMod(modName, scope)`: loads one enabled manifest.
  - Throws if the manifest is disabled, missing, or lacks both `mod.js` and `defs/`.
  - Stores defs-only mods without calling `register(...)`.
  - Clears the Node require cache before requiring `mod.js`.
  - Requires `mod.js` to export `register(scope)`.
  - Resolves `modConfig` before registration, so schema defaults are available during `register(scope)`.
  - Calls `register(...)` with a per-mod scope created by `createModScope(...)`.
- `createModScope(modName, modDir, scope, { mod = {}, modConfig = null } = {})`: returns an object inheriting from the server `scope` and adding mod-specific helpers.

`server.js` constructs the loader early, calls `setupStaticServing(app, express)`, passes `modLoader` and `modExtensionRegistry` through `apiScope`, registers API routes, then calls `loadMods(apiScope)`. After loading, the server validates defs overlays, reloads definition caches, and runs startup validators registered through the mod extension registry.

## Mod Scope

Each runtime mod receives a scope that inherits all fields from the server `apiScope` and adds:

- `modName`, `modDir`, `modPromptsDir`, `modPromptEnv`, `modPublicDir`, `modAssetsDir`.
- `modLoader`: the active `ModLoader` instance.
- `modConfig`: config loaded from `mods/<mod>/config.json` with `configSchema` defaults applied.
- `modExtensionRegistry`: the registry from the parent scope, or `null`.
- `getModPublicUrl(filePath = "")`: returns `/mods/<mod>/<filePath>`.
- `getModAssetUrl(filePath)`: returns `/mods/<mod>/assets/<filePath>` and rejects empty paths or `..` path segments.
- `renderModPrompt(templateName, context = {})`: renders a template from `mods/<mod>/prompts/`; throws if the mod has no prompt environment.
- `registerModRoute(method, path, handler)`: registers an Express route under `/api/mods/<mod>/...` for `GET`, `POST`, `PUT`, `DELETE`, or `PATCH`.

When `mods/<mod>/prompts/` exists and the parent scope provides Nunjucks, `createModScope(...)` creates a separate prompt environment for that directory. If the parent scope provides `addEvalFilter`, the mod prompt environment receives the shared `eval` filter.

## Registry Helpers

Scope registry helpers fail with explicit errors when no compatible `ModExtensionRegistry` is available. When available, they forward registrations with the current `modName` attached:

- `registerChatTool(options)`
- `registerXmlEvent(options)`
- `registerBaseContextContributor(contributor)`
- `registerPlayerActionPromptStep(options)`
- `registerGenerationPromptInstruction(options)`
- `registerActorStatusContributor(contributor)`
- `registerAttributeModifierContributor(contributor)`
- `registerStatusEffectContributor(contributor)`
- `registerThingTargetStatusEffectContributor(contributor)`
- `registerInventorySyncContributor(contributor)`
- `registerSettingTab(options)`
- `registerSettingField(options)`
- `registerEntityField(options)`
- `registerThingImageBadge(options)`
- `registerThingContextAction(options)`
- `registerStartupValidator(validator)`

The detailed hook contracts live in [`ModExtensionRegistry.md`](ModExtensionRegistry.md) and [`../modding_hooks.md`](../modding_hooks.md).

## Config API

- `getModConfig(modName)`: returns `{}` for unloaded mods; otherwise reads `mods/<mod>/config.json` and applies defaults from the loaded module's `configSchema`.
- `getModConfigs()`: returns loaded runtime mods that expose `configSchema` as `{ name, displayName, schema, config }`.
- `saveModConfig(modName, newConfig)`: writes `newConfig` to `mods/<mod>/config.json`; throws when the mod is not loaded.

`getModConfig(...)` catches JSON read/parse failures, logs a warning, and continues with schema defaults. Discovery is stricter for enablement: malformed `config.json` or invalid `enabled` values raise during manifest discovery before loading or serving.

## Static Files And Client Assets

- `setupStaticServing(app, express)`: freezes enabled manifests and serves:
  - `mods/<mod>/public` at `/mods/<mod>`.
  - `mods/<mod>/assets` at `/mods/<mod>/assets`.
- `getModClientScripts()`: returns `{ modName, scripts }` entries for loaded mods with files ending in `.js` under `public/js/`.
- `getModClientStyles()`: returns `{ modName, styles }` entries for loaded mods with files ending in `.css` under `public/css/`.

The play route calls `getModClientScripts()` and `getModClientStyles()` and injects those files into `views/index.njk`. Static serving is based on the frozen enabled manifest set, while script/style discovery is based on `loadedMods`.

## Runtime Notes

- Defs-only mods participate in the active mod list but do not receive a registration scope.
- Hybrid mods with both `mod.js` and `defs/` register runtime hooks and also provide defs overlays for `DefinitionLoader`.
- `registerModRoute(...)` is intended for mod-owned server endpoints. Shared client actions such as item/scenery context-menu actions use registry helpers and the core `/api/mod-thing-context-actions/:actionId` route.
- `getModAssetUrl(...)` is the supported way for mods to reference assets used by registry-backed UI features such as Thing image badges.
- Mods with config schemas appear on the `/config` page through `getModConfigs()`. The top-level `/mods` page uses `ModManager` and `ModDiscovery` instead of `getModConfigs()`.
