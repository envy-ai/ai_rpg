# Modding

## Mod Directory Model

`ModDiscovery` treats each non-hidden subdirectory of `mods/` as a valid mod when it contains `mod.js`, `defs/`, or both. `mods/node_modules` is ignored.

- Runtime mods export `register(scope)` from `mod.js`.
- Defs-only mods provide `defs/*.yaml` overlays and do not receive a registration scope.
- Hybrid mods use both paths: runtime hooks register through `mod.js`, and defs overlays merge through `DefinitionLoader`.
- `prompts/` contains mod-owned Nunjucks templates for `scope.renderModPrompt(...)`.
- `public/` is served at `/mods/<mod>/...`.
- `assets/` is served at `/mods/<mod>/assets/...` for mod-owned icons and images.
- `config.json` may hold per-mod runtime config and may include `enabled`.

`ModLoader.loadMods(...)` stores defs-only mods in `loadedMods` with `dataOnly: true`. Runtime mods are loaded with schema defaults applied to `scope.modConfig` before `register(scope)` runs.

## Enablement

Mod enablement is resolved from merged runtime config and per-mod config:

- `config.mods.<name>.enabled` takes precedence over `mods/<name>/config.json` `enabled`.
- Missing enablement flags are treated as enabled.
- `config.json`, `config.mods`, each `config.mods.<name>`, and all `enabled` fields must have the expected object/boolean types.
- Disabled mods are excluded from runtime loading, defs overlays, static file serving, client script/style injection, and loaded config-schema listing.

The enabled mod manifest set is frozen for the process by `freezeEnabledModManifests(...)` when static serving or mod loading initializes. Editing enablement on disk does not hot-toggle runtime hooks, defs overlays, public files, or asset files; the process must restart to use a different active set.

The `/mods` page and its APIs use `ModManager`:

- `GET /api/mods/manager` returns discovered mods, configured flags, active flags, contents, and restart drift.
- `PUT /api/mods/enabled` writes explicit `mods.<name>.enabled` entries to `config.yaml`, reloads config/defs for validation, and reports whether restart is required.
- `POST /api/mods/apply-save-config` applies the enabled mod list stored in a save, writes `tmp/pending-load.json`, and either requests a self-restart when `server.allowSelfRestart` is true or reports that manual restart is required.
- `GET /api/pending-load` and `DELETE /api/pending-load` expose the pending-load intent consumed by `public/js/pending-load.js`.

## Save Compatibility

Game saves persist the startup-frozen active mod list in `metadata.enabledMods`. Loading compares that list with the active process list before hydrating save data.

- If metadata is absent, the load proceeds without a mod-list compatibility check.
- If the lists differ, `/api/load` returns HTTP 409 with code `MOD_ENABLEMENT_MISMATCH`.
- The load modal can apply the save's mod config, keep the active config for this load, or cancel.
- The mismatch payload separates `missingFromActive` from `extraActive`, where `extraActive` means active-process mods absent from the save metadata.

`Utils.serializeGameState(...)` sorts and deduplicates `metadata.enabledMods`. Save files also persist `gameConfigOverrideYaml`, so per-game config overrides can include mod enablement data.

## Defs Overlays

Mods can provide `defs/*.yaml` files that overlay matching root files or introduce mod-owned definition files. A mod-only filename is treated as if an empty root `defs/<filename>` existed; no placeholder file is created in the root `defs/` directory. `DefinitionLoader.validateDefinitionOverlays(...)` rejects invalid YAML and structurally incompatible merges.

Merge behavior is deterministic:

- Enabled overlay mods are sorted alphabetically by directory name.
- Objects/maps deep-merge by key.
- Arrays/lists append in mod order.
- Scalars are replaced by the later overlay value; when multiple mods set the same scalar leaf, the alphabetically later mod wins.

Startup validates overlays after mods load, then reloads definition caches and runs startup validators. The config/defs reload path uses the same overlay validation before mutating live config/caches; if validation fails, the error is reported and the running state is left intact. Reload can report enablement drift, but the frozen active mod set remains in force until restart.

`defs/unified_tonal_scale.yaml` is a normal root definition file. Mods may overlay it like any other known defs file. The World Profiles Tone Scale UI stores per-story selections/comments on `SettingInfo.unifiedTonalScale`; those selections are setting data, not root definition data. The UI generates half-step midpoint choices between adjacent defined levels, so overlays do not need `1.5`, `2.5`, and similar rows.

## Runtime Scope

Each `mod.js` receives a scoped object that inherits the server API scope and includes:

- `modName`, `modDir`, `modPromptsDir`, `modPromptEnv`, `modPublicDir`, `modAssetsDir`.
- `modLoader`, `modConfig`, and `modExtensionRegistry`.
- `getModPublicUrl(filePath = "")`.
- `getModAssetUrl(filePath)`, which rejects empty paths and `..` segments.
- `renderModPrompt(templateName, context = {})`.
- `registerModRoute(method, path, handler)`, which registers `/api/mods/<mod>/...` routes for `GET`, `POST`, `PUT`, `DELETE`, or `PATCH`.

Mods with `configSchema` appear on the `/config` page through `ModLoader.getModConfigs()`. Play-page routes inject loaded mod client scripts from `public/js/*.js` and styles from `public/css/*.css`.

## Runtime Hooks

`ModExtensionRegistry` is the shared registry for hook-based mod behavior. Scoped helper methods attach the registering mod name automatically:

- `registerChatTool(...)`
- `registerXmlEvent(...)`
- `registerBaseContextContributor(...)`
- `registerPlayerActionPromptStep(...)`
- `registerGenerationPromptInstruction(...)`
- `registerActorStatusContributor(...)`
- `registerAttributeModifierContributor(...)`
- `registerStatusEffectContributor(...)`
- `registerThingTargetStatusEffectContributor(...)`
- `registerInventorySyncContributor(...)`
- `registerSettingTab(...)`
- `registerSettingField(...)`
- `registerEntityField(...)`
- `registerThingImageBadge(...)`
- `registerThingContextAction(...)`
- `registerStartupValidator(...)`

See [`modding_hooks.md`](modding_hooks.md) and [`classes/ModExtensionRegistry.md`](classes/ModExtensionRegistry.md) for the detailed contracts. Key runtime behavior:

- Chat tools are combined with built-ins at request time and can be enabled separately for regular prose and generic prompts.
- XML event tags are looked up case-insensitively while parsing event-check responses, then routed to mod parsers and handlers.
- XML event prompt schemas render through `prompts/_includes/events-xml.njk`.
- Base-context contributors populate `modContext`; actor status contributors populate prompt/client `modStatusSections`.
- Player-action prompt steps support stages `1` and `3` and receive automatic numbering such as `1g` and `3l`.
- Generation prompt instructions are collected dynamically for item, location, and region generators.
- Setting tabs and fields render in World Profiles; fields without a tab stay in the Prompt Guidance Mod Settings block.
- Non-persisted select fields with `action: "applyPreset"` can copy confirmed option values into editable mod setting fields without saving the selector itself.
- First-class `thing` fields persist at top level on `Thing` JSON, install direct accessors when possible, and can expose themselves to `createThing`, `updateObjectFields`, generated item XML, XML parsing, and the item edit modal.
- First-class `player` fields persist at top level on `Player` JSON, install direct accessors when possible, and can expose themselves to `createNpc`, `updateCharacterFields`, `updateObjectFields` for `character`, generated NPC XML, and character-alter XML parsing.
- Structured `thing` fields can provide a custom `createThing` `toolSchema`.
- `clearThingSlotWhenPresent` clears normal `Thing.slot` when a registered special-system field has a meaningful value.
- Thing image badges render mod-owned SVG or raster assets on item/scenery cards, with optional world-profile overrides for asset path and label.
- Thing context actions expose client metadata and execute server handlers through `POST /api/mod-thing-context-actions/:actionId`.
- Duplicate chat tool names, XML tags/keys, setting tabs/fields, entity fields, image badges, context actions, prompt-step ids, and generation-instruction ids fail with explicit errors.

## Bundled Mods

Current bundled mods under `mods/`:

- `mods/implants`: runtime mod for inventory-backed actor attachments. It registers the first-class `Thing.implantSlot` field, generated `<implantSlot>` XML, item edit controls, `Install implant` / `Uninstall implant` context actions, `equipImplant` / `unequipImplant` chat tools, `<implantEquipped>` / `<implantUnequipped>` XML events, actor status/base-context/attribute/status/inventory-sync contributors, an `Implants` World Profiles tab, and a configurable top-left image badge. Presets in `mods/implants/presets.yaml` include `implants` (`Implant`, `microchip.svg`) and `tattoo` (`Tattoo Design`, `image.svg`).
- `mods/modules`: runtime mod for item-to-item module slots on equippable gear. It registers `moduleSlots`, `moduleType`, `installedModuleIds`, and `moduleInstalledOnItemId`; exposes structured `createThing` schema for module slots; registers install/remove chat tools, XML events, item context actions, top-left module badges, inventory-sync/status/attribute/target-effect contributors, item-generation balance guidance, and a `Modules` World Profiles tab. Presets include Module, Crystal, Mod, and Materia terminology.
- `mods/spells`: runtime mod for actor-owned spells that spend the `mana` need bar. It registers `generateSpell` / `castSpell`, `<spellLearned>` / `<spellCast>`, a startup validator requiring a `mana` need bar, actor status/base-context contributors, a spell generator prompt, and a `Spells` World Profiles tab with per-world cost settings.
- `mods/need-bar-lust`: hybrid mod that contributes the `sex` / `Sexual Satisfaction` need bar, slopword/regex entries, and stage-1 player-action prompt guidance for lust-driven NPC initiative.
- `mods/nsfw-boost`: runtime/defs mod that registers the first-class `Player.sexualTraits` field, contributes a `<sexualTraits>` reference list from its mod-owned `defs/sexual_traits.yaml`, exposes the field to NPC generation and alteration XML, and adds player-action prompt guidance for sexually proactive NPC behavior.
- `mods/need-bar-social`: defs-only mod that contributes the `social` need bar for players and party NPCs.
- `mods/need-bar-sanity`: defs-only mod that contributes the `sanity` need bar for players and party NPCs.
- `mods/need-bar-hydration`: defs-only mod that contributes the `hydration` need bar for players and party NPCs.
- `mods/party-needs`: defs-only mod that makes the root `food` and `rest` need bars apply to players and party NPCs while excluding non-party NPCs.
- `mods/scene-illustration`: runtime mod with a config schema and public client assets. It registers `/api/mods/scene-illustration/generate`, `/jobs`, and job deletion routes, renders a mod prompt for image-prompt generation, queues image jobs, persists gallery metadata in `mods/scene-illustration/data/sceneIllustrations.json`, adds an illustration action while preserving core chat-log action options, and requires `imagegen.enabled` for generation.

## Need-Bar Definitions

Need-bar definitions use audience booleans:

- `player`
- `party`
- `non_party`

Examples:

- Player-only bar: `player: true`, `party: false`, `non_party: false`
- Player plus party NPCs: `player: true`, `party: true`, `non_party: false`
- Shared bar: `player: true`, `party: true`, `non_party: true`

Need bars can include `while_you_were_away_prompt_notes`; those notes are exposed to the blocking while-you-were-away reunion prompt for bar-specific offscreen guidance.

Need bars can override root `need_values` magnitudes per bar:

```yaml
need_bars:
  sanity:
    need_values:
      increase:
        small: 4
      decrease:
        large: 50
```

Root-level defaults and per-bar overrides use directional `increase` / `decrease` maps. Missing `small`, `medium`, or `large` entries fall back to the matching root-level directional default in `defs/need_bars.yaml`. Fractional magnitudes are preserved.

Passive drift uses `change_per_minute`:

```yaml
need_bars:
  hydration:
    change_per_minute: -20
```

Compatibility fields accepted during definition loading:

- `change_per_turn` is accepted, but defs and mods should use `change_per_minute`.
- `player_only: true` maps to `player: true`, `party: false`, `non_party: false`.
- `player_only: false` maps to `player: true`, `party: true`, `non_party: true`.

## Regression Coverage

Focused tests cover the modding surface:

- Definition overlays and discovery: `tests/definition_overlays.test.js`.
- Registry hooks and bundled implant/spell surfaces: `tests/mod_extension_hooks.test.js`.
- Module registration, schema, UI, and mechanics: `tests/modules_mod_registration.test.js`, `tests/modules_prompt_schema.test.js`, `tests/modules_ui_source.test.js`, `tests/item_module_system.test.js`.
- Mod settings tabs, entity fields, badges, and context actions: `tests/settings_mod_tabs.test.js`, `tests/mod_entity_field_xml_prompt.test.js`, `tests/mod_thing_image_badges_ui.test.js`.
- Mod manager API/UI and save compatibility: `tests/mod_manager.test.js`, `tests/mod_manager_api_static.test.js`, `tests/mod_manager_ui.test.js`, `tests/save_enabled_mod_manifest.test.js`.
- Need-bar overlays and config override persistence: `tests/mod_npc_needs_overlay.test.js`, `tests/config_loader.game_override.test.js`, `tests/utils.game_config_override_persistence.test.js`.
