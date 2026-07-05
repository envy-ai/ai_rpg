# Slash Commands

This guide covers the runtime slash-command path: registration, request parsing, interaction helpers, reply actions, UI handling, and the registered command inventory.

## Runtime Flow

- `server.js` calls `SlashCommandRegistry.initializeSlashCommands()` during startup.
- `SlashCommandRegistry.js` loads every `.js` file in `slashcommands/`, requires the module, validates a static `name` and `execute` handler, and registers the canonical command name plus any `aliases`.
- Command labels are trimmed and lowercased for lookup. Duplicate labels log a warning and keep the existing registration.
- Chat input beginning with `/` is handled by `public/js/chat.js`. The client records the slash command as a user message, splits the command name from raw `argsText`, parses `key=value` pairs into `args`, and posts to `/api/slash-command`.
- `/api/slash-command` resolves the command by name or alias, fills declared positional args from `argsText`, validates the final args object, builds an interaction context, and calls `CommandModule.execute(interaction, args)`.
- Command replies are normalized by the API and rendered by the chat client as local system messages with markdown enabled. A reply with `ephemeral: true` uses the client error style; it is not a privacy boundary.
- Commands can request a client refresh through `interaction.requestClientRefresh(...)`. When the request includes `clientId`, the server emits a targeted `chat_history_updated` event to the invoking browser tab with requested refresh flags such as `locationRefreshRequested` or `relationshipGraphRefreshRequested`.
- Commands can return typed reply actions. Supported action types are `request_file_upload`, which opens the shared chat upload modal and posts selected text file contents to `/api/slash-command/upload`, and `reload_page`, which schedules a browser page reload.
- `/api/slash-command/upload` runs the same request normalization and command lookup, requires the target command to implement `handleUpload(interaction, args, uploads)`, and passes normalized upload entries to that handler.

## Command Module Contract

- Command files live in `slashcommands/` and export a class, usually extending `SlashCommandBase`.
- Required static members:
  - `name`: canonical command label without the leading slash.
  - `description`: short text used by `/help`.
  - `args`: array of declared arguments.
  - `execute(interaction, args)`: command handler.
- Optional static members:
  - `aliases`: array of alternate labels without leading slashes.
  - `usage`: override for complex usage text. Without an override, `SlashCommandBase.usage` renders required args as `<name>` and optional args as `[name]`.
  - `showExecutionOverlay`: boolean, defaults to `true`. Set to `false` for commands that immediately open UI, such as `/import_item`.
  - `validateArgs(args)`: custom validation. The base implementation checks required fields and primitive types.
  - `handleUpload(interaction, args, uploads)`: handler for `request_file_upload` follow-up submissions.
- `args` entries use `{ name, type, required }`, where `type` is `string`, `integer`, or `boolean`.
- `/help` uses `SlashCommandBase.listCommands()`, which lists canonical commands only, sorted by name.
- Per-command docs live in `docs/slashcommands/`. The base-class doc is `docs/slashcommands/SlashCommandBase.md`.

## Argument Handling

- The chat client parses named args with `key=value` syntax before sending the request.
- Named arg keys are lowercased. Values with spaces must be double quoted.
- Client-side named arg values are converted to integers when they match an integer literal, and to booleans for `true` or `false`.
- Text not consumed as `key=value` is preserved in `args._`.
- The server receives both parsed `args` and raw `argsText`.
- When a command declares `args`, the server tokenizes `argsText` left-to-right and fills missing declared args in order. It does not overwrite values already supplied in `args`.
- Server positional parsing respects double-quoted strings. Integer and boolean declarations are coerced before validation; booleans accept only `true` and `false`.
- Commands with complex free-form syntax can leave `args` empty or override `usage` and parse `interaction.argsText` directly.
- Shared character-target parsing lives in `slashcommand_utils/characterTargeting.js`. It supports quote stripping, positional-token helpers, alias-aware target resolution, and current-location tie-breaking for ambiguous character names.

## Interaction Context

`api.js` builds the interaction object passed to command handlers. Available fields and helpers:

- `interaction.user.id`: invoking player id, or `null`.
- `interaction.clientId`: invoking websocket client id, or `null`.
- `interaction.argsText`: raw text after the slash command name.
- `interaction.chatHistory`: live server chat history array.
- `interaction.getChatHistory()`: returns the live server chat history array.
- `interaction.getHistory(query, options?)`: returns assistant prose-like history entries whose content matches all case-insensitive query terms. `query` can be a string or string array; arrays use AND semantics. `options.startIndex` is 1-based and `options.count` caps matches. Positional numeric arguments `query, startIndex, count` are also accepted.
- `interaction.performGameSave(saveName?)`: invokes the shared save helper.
- `interaction.currentPlayer`: current player object in server scope.
- `interaction.adjustWorldTimeByMinutes(minutes, { source? })`: moves world time through the shared minute-based path. Forward moves apply normal elapsed-time processing, need/status work, due vehicle arrivals, due scheduled events, and realtime world-time payloads. Rewinds set the raw world minute counter and do not undo time-based side effects already processed.
- `interaction.parseThingsXml(xml, options?)`: XML item/scenery parser for import commands.
- `interaction.findRegionByLocationId(locationId)`: region lookup helper.
- `interaction.runPlotSummaryPrompt({ parentEntryId?, locationId? })`: runs the plot-summary prompt for a resolved location.
- `interaction.runPlotExpanderPrompt({ parentEntryId?, locationId?, specificPlot? })`: runs the plot-expander prompt for a resolved location.
- `interaction.runHousekeepingPrompt({ instructions? })`: runs the parser-based housekeeping prompt with optional manual `housekeepingInstructions`. The helper requires an active `clientId` so realtime status, quest confirmation, and tool-call debug updates can target the invoking browser tab.
- `interaction.runMysteryBoxCleanupPrompt()`: runs the mystery cleanup prompt immediately, applies resolved/revealed results, persists mystery state when possible, and returns both newly applied records and prompt-candidate decision summaries with model thoughts.
- `interaction.generateSkillsByNames(options)`: shared skill metadata generation helper.
- `interaction.generatePlayerImage(player, { force?, clientId? })`: shared player/NPC portrait generation helper.
- `interaction.getActiveSettingSnapshot()`: returns the active setting snapshot.
- `interaction.describeSettingForPrompt(snapshot)`: renders setting context for prompt helpers.
- `interaction.backfillRegionExitTravelTimes({ region?, regionId?, force?, locationOverride? })`: prompt-fills exit travel times for a region; `force: true` regenerates populated values and rewrites bidirectional pairs from the prompted side. Automatic cross-region arrivals pass the destination location as `locationOverride` so the base-context prompt is grounded in the new location. Prompt failures are returned as nonfatal `promptFailed` results.
- `interaction.skillRegistry`: live `skills` map, or `null`.
- `interaction.thingRegistry`: live `things` map, or `null`.
- `interaction.requestClientRefresh({ locationRefreshRequested?, relationshipGraphRefreshRequested? })`: marks the invoking tab for a post-command refresh.
- `interaction.getRequestedClientRefresh()`: returns accumulated refresh flags.
- `interaction.reply(payload)`: appends a normalized command reply.

Helpers that can be unavailable are exposed as `null`. Commands should check required helpers explicitly and throw a clear error when a required dependency is missing.

## Replies And UI Actions

`interaction.reply(payload)` accepts:

```js
{
  content: 'Markdown-capable response text',
  ephemeral: false,
    action: {
      type: 'request_file_upload',
    title: 'Upload File',
    description: 'Choose a file to continue.',
    accept: '.xml,text/xml',
    multiple: false,
    uploadMessage: 'Uploading file...',
    submitLabel: 'Upload',
    cancelLabel: 'Cancel'
    }
}
```

- A reply must include `content` or `action`.
- `content` must be a string. Missing content is normalized to an empty string when an action is present.
- `ephemeral` must be a boolean and defaults to `false`.
- Return values from `execute(...)` and `handleUpload(...)` are ignored; use `interaction.reply(...)`.
- If a command returns no replies, the chat client renders a generic success message.
- `request_file_upload` opens `#slashUploadModal` from `views/index.njk`. `public/js/chat.js` reads selected files as text and posts `{ filename, content, mimeType, size }` entries to `/api/slash-command/upload`.
- Upload submissions require at least one file. The API requires a non-empty filename and string content for each upload entry.
- `executionOptions.showExecutionOverlay` is returned by `/api/slash-command`. The client starts a delayed `Executing command...` overlay for slash commands and cancels it before processing reply actions when the command sets `showExecutionOverlay` to `false`.
- `reload_page` actions accept optional `delayMs`, which must be a non-negative integer. When omitted, the client reloads immediately.

## Registered Commands

| Command | Aliases | Summary |
| --- | --- | --- |
| `/awardxp` | - | Grants experience points to the invoking player or named character. |
| `/calendar_info` | `/calendar` | Displays calendar and world-time details. |
| `/clear_plot_notes` | `/clear_plot_summaries`, `/clear_plot_expander` | Removes hidden plot-summary and plot-expander entries from chat history. |
| `/clear_relationships` | - | Removes every stored character relationship edge. |
| `/clear_secrets` | - | Removes hidden supplemental/offscreen NPC story info entries from chat history. |
| `/clear_tool_call_debug` | `/clear_tool_calls`, `/clear_tool_debug` | Removes tool-call debug entries from chat history and reloads the page. |
| `/exit_backtraces` | - | Lists current-location exits with captured creation backtraces. |
| `/export_history` | - | Exports full story history to text or HTML. |
| `/fill_exit_travel_times` | - | Fills missing region exit travel times, or regenerates them with `force=true`. |
| `/fix_exits` | - | Creates missing reverse exits for one-way location connections. |
| `/game_intro` | `/intro` | Generates and appends intro narration. |
| `/generate_missing_skills` | `/skills_generate_missing`, `/regen_skill_metadata` | Finds skills missing generated metadata and generates details for them. |
| `/get` | - | Reads a nested runtime config value. |
| `/heal` | `/resurrect` | Restores a character to full health and clears death state. |
| `/help` | - | Lists available slash commands and usage. |
| `/housekeeping` | `/runhousekeeping` | Runs the housekeeping prompt immediately with optional instructions. |
| `/import_item` | - | Opens XML upload and imports parsed item/scenery entries into the current location. |
| `/incapacitate` | - | Applies incapacitation to an NPC without killing them. |
| `/kill` | - | Kills a named NPC. |
| `/list_npcs` | - | Lists NPC locations and short descriptions. |
| `/locate` | - | Finds NPCs by exact name or alias. |
| `/needbars` | - | Lists or edits character need bars. |
| `/orphaned_locations` | - | Lists locations missing valid region links or usable exits. |
| `/plot_analysis` | - | Displays the latest background plot analysis. |
| `/promptstats` | - | Displays or clears prompt output-character averages. |
| `/random` | - | Triggers a configured random event type. |
| `/refill_needs` | - | Refills stored need bars for one NPC or every NPC. |
| `/regen_party_images` | - | Queues forced portrait regeneration for current party NPCs. |
| `/regex_replace` | - | Runs regex replacement across story history. |
| `/reload_config` | `/reloadconfig`, `/rcfg` | Reloads config files and definition caches. |
| `/reload_lorebooks` | `/reloadlorebooks`, `/rlb` | Reloads lorebooks from disk. |
| `/resolve_mystery_threads` | - | Runs mystery cleanup and lists resolved threads and boxes with thoughts. |
| `/respec_abilities` | - | Rebuilds a character's ability selections across a level range. |
| `/respec_skills` | - | Rebuilds an NPC's skill allocation for their current level. |
| `/rp` | - | Toggles roleplay mode and related automated checks, including plot analysis. |
| `/runplotexpander` | - | Runs the plot-expander prompt and stores the result. |
| `/runplotsummary` | - | Runs the plot-summary prompt and stores the result. |
| `/scene_summaries` | `/summary_ranges` | Lists stored scene summaries and the entry ranges they cover. |
| `/scheduled` | - | Lists pending scheduled events in readable markdown. |
| `/scrub_legacy_debug` | `/scrub_debug_history`, `/scrub_debug` | Removes diagnostic check/tool-call entries and embedded debug lines from history and stored scene summaries; `dry_run=true` reports counts without saving. |
| `/set` | - | Updates a nested runtime config value. |
| `/set_last_seen` | - | Sets last-seen time/location metadata for NPCs at a location. |
| `/setlevel` | - | Sets a player or character level while preserving XP. |
| `/short_description_check` | - | Lists regions, locations, things, and abilities missing short descriptions. |
| `/slopwords` | - | Reports slop words above configured ppm thresholds. |
| `/summarize` | `/scene_summary` | Exports or rebuilds scene summaries for a selected history range. |
| `/teleport` | - | Moves the player to a location by id or quoted name. |
| `/time` | - | Advances or rewinds world time by a signed duration. |
| `/vehicle_status` | - | Displays current vehicle route/trip status. |
| `/weather` | - | Displays current-region seasonal weather details. |
| `/world_outline` | - | Lists regions, locations, and pending stubs. |

## Creating A Command

```js
const SlashCommandBase = require('../SlashCommandBase.js');

class MyCommand extends SlashCommandBase {
  static get name() { return 'mycmd'; }
  static get aliases() { return ['mc']; }
  static get description() { return 'Do a thing.'; }
  static get args() { return [{ name: 'target', type: 'string', required: true }]; }

  static async execute(interaction, args = {}) {
    const target = (args.target || '').trim();
    if (!target) {
      throw new Error('Target is required.');
    }

    await interaction.reply({
      content: `Did the thing to ${target}.`,
      ephemeral: false
    });
  }
}

module.exports = MyCommand;
```

- Put the file in `slashcommands/`.
- Use clear exceptions for missing helpers, invalid world state, and unsupported operations.
- Normalize user-supplied strings before lookups.
- Use `slashcommand_utils/characterTargeting.js` for character-name parsing and alias-aware target resolution.
- Reuse existing helpers on `Globals`, models, and the interaction context instead of duplicating state traversal.
- Keep command side effects scoped to the requested command behavior.
- Create or update the matching per-command doc under `docs/slashcommands/`.

## Checks

- Use `/help` to confirm command registration and usage text.
- Exercise the command from chat and verify success replies, error replies, overlay behavior, and any requested client refresh.
- For upload commands, verify the initial reply action opens `#slashUploadModal`, the upload endpoint receives normalized text-file entries, and invalid upload bodies produce clear API errors.
- For code changes, run syntax checks for edited JavaScript files and focused command tests when available.
