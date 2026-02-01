# ReloadLorebooksCommand

## Purpose
Slash command `/reload_lorebooks` to reload lorebooks from disk.

## Args
- None.

## Behavior
- Calls `Globals.reloadLorebooks()` and reports counts.
- Supports aliases `reloadlorebooks` and `rlb`.

## Notes
- Returns an ephemeral error if reload fails.
