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
- The active mod set is frozen at process startup.
- Changing `enabled` on disk requires a server restart to take effect.

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

## Example

The repository includes a defs-only sample mod in [`mods/npc-needs-demo`](../mods/npc-needs-demo) that enables the existing `food` and `rest` need bars for the player and party members by setting:

- `player: true`
- `party: true`
- `non_party: false`

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
      small: 4
      large: 50
```

Only the keys you provide are overridden; missing `small` / `medium` / `large` values still fall back to the root-level `need_values` defaults in `defs/need_bars.yaml`.

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
