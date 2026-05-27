# Modding

## Defs overlays

Mods can now provide `defs/*.yaml` overlays that merge into the root `defs/*.yaml` files.

- A mod directory is considered valid if it contains either:
  - `mod.js`
  - `defs/`
- Defs-only mods are valid even without `mod.js`.
- Mods may be disabled from the merged YAML config with `mods.<name>.enabled: false`.
- Mods may also define `mods/<name>/config.json` with `enabled: false`.
- If `enabled` is omitted in both places, the mod is treated as enabled.
- Overlay filenames must match an existing root `defs/*.yaml` filename exactly.
- Unknown overlay filenames fail loudly.
- `defs/unified_tonal_scale.yaml` stores the reusable global tone-axis definitions extracted from `extra_system_instructions`. The `/settings` World Profiles `Tone Scale` tab renders this definition and persists per-story selections/comments on each `SettingInfo` as `unifiedTonalScale`; those selections are setting data rather than part of the root definition file. The UI also generates half-step midpoint choices between adjacent defined levels, so mods do not need to add `1.5`, `2.5`, etc. rows to the defs file.

## Enable and disable

- `config.json` must be a JSON object when present.
- `config.json.enabled` must be a boolean when present.
- `config.mods` must be an object when present.
- `config.mods.<name>` must be an object when present.
- `config.mods.<name>.enabled` must be a boolean when present.
- Merged YAML config takes precedence over `mods/<name>/config.json` for enable/disable.
- Disabled mods are skipped consistently:
  - `mod.js` is not loaded
  - `defs/*.yaml` overlays are ignored
  - `public/` assets are not served
  - `assets/` image/icon assets are not served
- The active mod set is frozen at process startup.
- Changing `enabled` on disk requires a server restart to take effect.
- The `/mods` page provides a top-level checkbox manager for discovered mods. Saving that page writes explicit `mods.<name>.enabled` flags to `config.yaml`, reloads merged config for validation, and reports whether the running process still differs from the configured mod set.
- Saves persist `metadata.enabledMods`, the startup-frozen active mod list used when the save was written. Loading a save with a different active mod list opens a client modal with three choices: apply the save's mod config, keep the current active config for this load, or cancel. The modal lists newly added mods (`extraActive`, enabled now but absent from the save) separately from missing mods (`missingFromActive`, required by the save but inactive now).
- Applying a save's mod config writes `config.yaml`, persists a pending-load intent in `tmp/pending-load.json`, and requires restart. If `server.allowSelfRestart` is enabled, the server starts a replacement process; otherwise the UI tells the user to restart manually and the pending save loads after startup.

## Merge rules

- Objects/maps: deep merge by key.
- Arrays/lists: append in mod load order.
- Scalars: later mod values override earlier ones.

Mod order for defs overlays is deterministic:

- Mod directories are sorted alphabetically.
- When multiple mods override the same scalar or leaf key, the alphabetically later mod wins.

## Validation and reload behavior

- Startup validates all mod defs overlays and fails loudly if any overlay YAML is invalid, unknown, or structurally incompatible with the base defs file it targets.
- `/reload_config` validates the same overlays before mutating the live runtime config/caches.
- If reload validation fails, the command reports the error and leaves the running game state untouched.
- `/reload_config` can report that mod enable/disable changes were detected on disk, but those changes still require a restart because the running process keeps its startup mod set.

## Runtime hooks

Mods with `mod.js` can register runtime hooks through their scoped helper methods:

- `registerChatTool(...)`
- `registerXmlEvent(...)`
- `registerBaseContextContributor(...)`
- `registerActorStatusContributor(...)`
- `registerAttributeModifierContributor(...)`
- `registerStatusEffectContributor(...)`
- `registerInventorySyncContributor(...)`
- `registerSettingTab(...)`
- `registerSettingField(...)`
- `registerEntityField(...)`
- `registerThingImageBadge(...)`
- `registerThingContextAction(...)`
- `registerStartupValidator(...)`

See [`modding_hooks.md`](modding_hooks.md) and [`classes/ModExtensionRegistry.md`](classes/ModExtensionRegistry.md) for the hook contract. Chat tools are combined with built-ins at request time, XML event tags are looked up live while parsing the event-check response, world-profile setting fields can be grouped into mod-owned tabs, select fields can apply confirmed preset values without persisting the action control, registered Thing fields can be exposed to live `createThing` / `updateObjectFields` schemas plus generated item XML scaffolds and the item edit modal, structured registered fields can provide a custom `createThing` `toolSchema`, registered Thing fields can clear normal equipment slots when special-system fields are present, registered Thing image badges can overlay mod-owned SVG or raster assets on item cards with optional world-profile setting overrides for asset path and label, and registered Thing context actions can add server-backed item menu entries.

The repository includes three hook-based mods:

- `mods/implants`: inventory-backed actor attachments using a first-class `Thing.implantSlot` field exposed as `<implantSlot>` in item generation prompts and the item editor, with normal `Thing.slot` clearing for implant-compatible items, context-menu install/uninstall actions, prose install/remove tools, matching XML events, an `Implants` World Profiles tab, and a configurable overlay badge for implant-compatible item images. `mods/implants/presets.yaml` defines the default `implants` preset (`Implant`, `microchip.svg`) and a `tattoo` preset (`Tattoo Design`, `image.svg`); applying a preset copies values into editable per-world settings.
- `mods/modules`: item-to-item module slots for equippable gear. It registers `moduleSlots`, `moduleType`, `installedModuleIds`, and `moduleInstalledOnItemId`, adds a Modules World Profiles tab with configurable slot-type rows and Module/Crystal/Mod/Materia presets, exposes a structured `moduleSlots` `createThing` schema requiring `type`, renders installed modules on item cards/tooltips, and contributes installed-module attribute/status/target effects through registry hooks.
- `mods/spells`: actor-owned spells with mana spending, spell generation, and a `Spells` World Profiles tab for per-world cost settings.

## Example

The repository includes a defs-only sample mod in [`mods/npc-needs-demo`](../mods/npc-needs-demo) that enables the existing `food` and `rest` need bars for the player and party members by setting:

- `player: true`
- `party: true`
- `non_party: false`

Need-bar defs may also include `while_you_were_away_prompt_notes`. Those notes are exposed to the blocking while-you-were-away reunion prompt so mods can give bar-specific guidance for offscreen time, such as how likely a character is to satisfy that need while the player is absent.

## Need-bar audience flags

Need bars now use explicit audience booleans in `defs/need_bars.yaml`:

- `player`
- `party`
- `non_party`

Examples:

- Player-only bar: `player: true`, `party: false`, `non_party: false`
- Shared bar: `player: true`, `party: true`, `non_party: true`
- Party-only NPC bar: `player: false`, `party: true`, `non_party: false`

Need bars can also override the global `need_values` magnitudes per bar:

```yaml
need_bars:
  sanity:
    need_values:
      increase:
        small: 4
      decrease:
        large: 50
```

`need_values` is directional now. Both the root-level defaults and any per-bar overrides use nested `increase` / `decrease` maps. Only the directional keys you provide are overridden; missing `small` / `medium` / `large` entries still fall back to the matching root-level `increase` or `decrease` defaults in `defs/need_bars.yaml`.

Need-bar `need_values` magnitudes may be fractional. Decimal overrides are preserved exactly rather than being rounded or forced up to `1`.

Need bars use `change_per_minute` for baseline passive drift:

```yaml
need_bars:
  hydration:
    change_per_minute: -20
```

Legacy `change_per_turn` is still accepted during definition loading, but new defs and mods should use `change_per_minute`.

Legacy `player_only` is still accepted for backward compatibility:

- `player_only: true` maps to `player: true`, `party: false`, `non_party: false`
- `player_only: false` maps to `player: true`, `party: true`, `non_party: true`
