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
