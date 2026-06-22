# RpCommand

## Purpose
`/rp` toggles a runtime roleplay mode that suppresses several automated post-action systems. It disables event checks, plausibility checks, random events, ordinary NPC turns, and background plot analysis until the command is run again.

The command is registered from `slashcommands/rp.js` under the canonical name `rp`. It has no aliases.

## Args
None.

## Behavior
- Reads `Globals.config` and requires these config sections to exist as objects with an `enabled` flag:
  - `event_checks`
  - `plausibility_checks`
  - `random_event_frequency`
  - `npc_turns`
  - `plot_analysis`
- Throws a clear error if global config is unavailable, a required section is missing, a required section is not an object, or a section lacks `enabled`.
- When roleplay mode is inactive, stores a module-level snapshot of the five `enabled` flags and sets each flag to `false`.
- When roleplay mode is active, restores the five flags from the stored snapshot and clears the snapshot.
- Replies with a non-ephemeral chat message for both enable and restore operations.

## Notes
- The snapshot stores boolean coercions of the five `enabled` values. Truthy values restore as `true`; falsy values restore as `false`.
- The toggle mutates in-memory `Globals.config`. It does not write config files or persist the snapshot across a process restart.
- `npc_turns.enabled` controls ordinary post-player NPC turns. `/rp` does not toggle `combat_npc_turns.enabled`, which is a separate combat-turn gate.
- `plot_analysis.enabled` controls normal player-action background plot-analysis scheduling. The runner also checks the same gate before executing background work, before tool execution, and before storing a response, so queued analysis skips or is ignored after `/rp` enables roleplay mode.
- The shared slash-command API handles command lookup, argument validation, execution, and reply normalization before the client renders the reply as a local system message.

## Related Code And Tests
- Implementation: `slashcommands/rp.js`
- Registration/runtime plumbing: `SlashCommandRegistry.js`, `SlashCommandBase.js`, `/api/slash-command` in `api.js`
- Config defaults and related gates: `config.default.yaml`, `api.js`, `Events.js`
- Shared slash-command behavior tests: `tests/api.slash_command_upload_helpers.test.js`, `tests/scheduled_command.test.js`
- Dedicated `/rp` behavior test: `tests/rp_command.test.js`
