# ReloadConfigCommand

## Purpose
Reloads the active runtime configuration and definition caches without restarting the server.

## Args
- `override_file` (optional string): YAML file to select as the process-local session override. Relative paths resolve from the project root; double-quote paths containing spaces.

## Behavior
- Invocation: `/reload_config [override_file]`, `/reloadconfig [override_file]`, or `/rcfg [override_file]`.
- Calls `Globals.reloadConfigAndDefs(...)` with the default warning-mode need-bar sentence validation.
- Reloads `config.default.yaml`, `config.yaml`, the startup CLI config override, the loaded game's YAML override, and any active process-local session override.
- When `override_file` is supplied, it becomes the active session override at the highest merge precedence. It can therefore supersede settings stored in a loaded save without editing that save.
- A bare invocation reuses the active session override, if one has been selected.
- Validates difficulty DC, outcome margin, and critical-threshold formulas before applying the merged config.
- Validates mod definition overlays before applying the merged config.
- Invalidates the server-side Nunjucks view, prompt, and image-prompt caches.
- Reloads `Thing` rarity definitions and `Player` definition caches; loaded `Player` instances refresh their definitions and need bars.
- Replies with the reload timestamp, need-bar validation warnings, and mod enablement drift details when present.

## Notes
- Throws `Config reload is unavailable on this server.` if `Globals.reloadConfigAndDefs` is not installed.
- If reload validation throws, the command replies ephemerally with `Reload failed: ...`.
- Validation happens before the live `Globals.config` object is mutated, so failed reloads keep the previous live runtime state.
- A failed session-override selection also leaves the previously selected session override active.
- The selected session override is not persisted. Restarting the game server clears it and returns to the startup and save override layers.
- Missing `effect_thresholds.*.sentence` entries in need-bar defs are warning-mode issues for `/reload_config`; new-game creation and save loading run the same validation in strict mode.
- When mod enablement on disk differs from the active startup mod set, the command reports that a restart is required. It does not hot-load or hot-unload mods mid-run.
