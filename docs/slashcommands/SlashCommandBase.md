# SlashCommandBase

## Purpose
Base class for slash command modules. Defines static metadata accessors, argument validation, and command listing.

## Static API
- `get name()`: must be overridden; throws by default.
- `get aliases()`: optional aliases (default empty).
- `get description()`: must be overridden; throws by default.
- `get showExecutionOverlay()`: optional boolean getter; defaults to `true`. Return `false` for commands that immediately open modal UI and should skip the transient `Executing command...` overlay.
- `get args()`: must be overridden; throws by default. Format: `{ name, type, required }`.
- `get usage()`: constructs `/<name> <args>` usage from `args`.
- `handleUpload(interaction, args, uploads)`: optional secondary entry point for commands that accept file uploads via the shared slash-command upload modal.
- `validateArgs(providedArgs)`: validates types/required args; returns array of error strings.
- `listCommands()`: reads registry entries and returns sorted `{ name, description, usage }` list.

## Notes
- `listCommands` skips alias entries and tolerates missing command metadata.
- Slash-command replies may be action-only; the current shared action contract is `request_file_upload`.
