# SetConfigCommand

## Purpose
Slash command `/set` to update a nested configuration value at runtime.

## Args
- `path` (string, required): dot-delimited config path.
- `value` (string, required): value to assign ("true"/"false" coerced to booleans).

## Behavior
- Parses and strips quotes from inputs.
- Walks/creates the nested object path and assigns the value.
- Replies with confirmation or validation errors.

## Notes
- Does not persist changes to disk; modifies in-memory config only.
