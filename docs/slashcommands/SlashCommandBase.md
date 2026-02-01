# SlashCommandBase

## Purpose
Base class for slash command modules. Defines static metadata accessors, argument validation, and command listing.

## Static API
- `get name()`: must be overridden; throws by default.
- `get aliases()`: optional aliases (default empty).
- `get description()`: must be overridden; throws by default.
- `get args()`: must be overridden; throws by default. Format: `{ name, type, required }`.
- `get usage()`: constructs `/<name> <args>` usage from `args`.
- `validateArgs(providedArgs)`: validates types/required args; returns array of error strings.
- `listCommands()`: reads registry entries and returns sorted `{ name, description, usage }` list.

## Notes
- `listCommands` skips alias entries and tolerates missing command metadata.
