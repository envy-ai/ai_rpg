# RpCommand

## Purpose
Slash command `/rp` to toggle roleplay mode by disabling or restoring several config checks.

## Args
- None.

## Behavior
- Validates config sections: `event_checks`, `plausibility_checks`, `random_event_frequency`, `npc_turns`.
- On first run, caches current `enabled` flags and sets all to false.
- On second run, restores cached values.

## Notes
- Uses a module-level `savedConfig` snapshot.
