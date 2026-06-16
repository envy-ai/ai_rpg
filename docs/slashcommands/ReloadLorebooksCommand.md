# ReloadLorebooksCommand

## Command

- Canonical command: `/reload_lorebooks`
- Aliases: `/reloadlorebooks`, `/rlb`
- Arguments: none.
- Help description: `Reload all lorebooks from the lorebooks directory.`

## Runtime Path

- Implementation: `slashcommands/reload_lorebooks.js`.
- `execute(interaction)` requires `Globals.reloadLorebooks` to be a function.
- `server.js` defines `Globals.reloadLorebooks()` by retrieving the singleton `LorebookManager` and calling `manager.reload()`.
- `LorebookManager.reload()` loads enabled-book state from `lorebook-state.json`, loads every lorebook JSON file in the configured lorebook directory except `lorebook-state.json`, rebuilds the active-entry list for enabled books, and returns `{ count, enabledCount, totalEntries }`.

## Replies

- When `Globals.reloadLorebooks` is unavailable, the command replies ephemerally with `Lorebook reload is unavailable on this server.`
- When the reload throws, the command replies ephemerally with `Lorebook reload failed: <message>`.
- On success, the command replies non-ephemerally with `Lorebooks reloaded: ...`.
- Success details include any returned `count` as `N lorebook(s)`, `enabledCount` as `N enabled`, and `totalEntries` as `N active entries`. If no details are present, the success reply uses `done`.

## Notes

- A missing lorebook manager singleton causes `Globals.reloadLorebooks()` to throw `Lorebook manager not initialized`; the command surfaces that message in the failure reply.
- The command does not request file uploads or client refreshes.
