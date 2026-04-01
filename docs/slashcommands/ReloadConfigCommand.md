# ReloadConfigCommand

## Purpose
Slash command `/reload_config` to reload configuration files and definition caches.

## Args
- None.

## Behavior
- Calls `Globals.reloadConfigAndDefs()` and reports the timestamp.
- Supports aliases `reloadconfig` and `rcfg`.

## Notes
- Throws if reload is unavailable.
- Reload validates mod defs overlays before mutating the live runtime config/definition caches.
- Invalid mod defs overlays do not crash the running game during reload; the command reports the error and keeps the previous live state.
- If mod enablement changed on disk (either merged YAML config or per-mod `config.json`), the command reports that a restart is required; it does not hot-load or hot-unload mods mid-run.
