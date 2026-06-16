# ReloadConfigCommand

## Purpose
Reloads the active runtime configuration and definition caches without restarting the server.

## Args
- None.

## Behavior
- Invocation: `/reload_config`, `/reloadconfig`, or `/rcfg`.
- Calls `Globals.reloadConfigAndDefs()` with the default warning-mode need-bar sentence validation.
- Reloads `config.default.yaml`, `config.yaml`, the startup CLI config override, and the loaded game's YAML override.
- Validates difficulty DC, outcome margin, and critical-threshold formulas before applying the merged config.
- Validates mod definition overlays before applying the merged config.
- Invalidates the server-side Nunjucks view, prompt, and image-prompt caches.
- Reloads `Thing` rarity definitions and `Player` definition caches; loaded `Player` instances refresh their definitions and need bars.
- Replies with the reload timestamp, need-bar validation warnings, and mod enablement drift details when present.

## Notes
- Throws `Config reload is unavailable on this server.` if `Globals.reloadConfigAndDefs` is not installed.
- If reload validation throws, the command replies ephemerally with `Reload failed: ...`.
- Validation happens before the live `Globals.config` object is mutated, so failed reloads keep the previous live runtime state.
- Missing `effect_thresholds.*.sentence` entries in need-bar defs are warning-mode issues for `/reload_config`; new-game creation and save loading run the same validation in strict mode.
- When mod enablement on disk differs from the active startup mod set, the command reports that a restart is required. It does not hot-load or hot-unload mods mid-run.
