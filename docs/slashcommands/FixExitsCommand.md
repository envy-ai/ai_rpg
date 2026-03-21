# FixExitsCommand

## Purpose
Slash command `/fix_exits` to repair one-way location exits by creating missing reverse links.

## Args
- None.

## Behavior
- Scans all locations and exits.
- Detects exits whose destination location has no return exit back to the source.
- Repairs those links with `ensureExitConnection(..., bidirectional: true)` so each one-way connection becomes two-way.
- Preserves vehicle metadata (`isVehicle`, `vehicleType`) when creating reverse links.
- Reports counts for scanned exits, repaired connections, and skipped invalid/self-referential exits.

## Notes
- Exits with missing destination locations are skipped and counted (not auto-removed).
- Reply output includes up to 20 repaired connection samples.
