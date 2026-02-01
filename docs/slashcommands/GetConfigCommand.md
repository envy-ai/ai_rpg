# GetConfigCommand

## Purpose
Slash command `/get` to retrieve a nested configuration value.

## Args
- `path` (string, required): dot-delimited config path.

## Behavior
- Walks the config object and returns the value.
- Renders objects as pretty JSON blocks.

## Notes
- Returns an ephemeral error for missing paths.
