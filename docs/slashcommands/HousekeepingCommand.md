# HousekeepingCommand

## Purpose

`/housekeeping` runs the same parser-based housekeeping prompt used after event checks, but on demand from the chat slash-command surface.

## Aliases

- `/runhousekeeping`

## Usage

```text
/housekeeping [instructions...]
```

Raw text after the command is passed to the prompt as `housekeepingInstructions`. Blank command text runs the normal housekeeping prompt with blank instructions.

## Behavior

- Requires `interaction.runHousekeepingPrompt` and throws `Housekeeping execution is unavailable in this command context.` when the helper is absent.
- Requires an active slash-command `clientId` and throws `Housekeeping slash command requires an active client connection.` when the command is not tied to a browser tab.
- Trims `interaction.argsText` and passes it to the shared housekeeping runner as `{ instructions }`.
- The API helper maps `instructions` to the prompt template's `housekeepingInstructions` value and creates a scoped stream emitter for request-user-input, quest confirmation, and XML-derived tool-call debug updates.
- Automatic post-event housekeeping calls do not pass instructions; the runner default keeps `housekeepingInstructions` blank.
- The manual command bypasses `housekeeping.interval` and does not advance the automatic housekeeping counter.
- Successful non-hidden tracker mutations and relationship label mutations can create visible player-only `tracker-updates` and `relationship-updates` chat entries. These rows are excluded from all LLM prompt-history paths.
- Requests both location and relationship-graph refresh flags after completion because housekeeping may update trackers, quests, or relationships.

## Replies

The command replies publicly:

```text
Housekeeping completed. Applied N housekeeping tool executions.
```

`N` counts parser-derived XML mutation executions reported by the shared housekeeping runner. Housekeeping does not expose tool-call schemas to the model.

## Registration

- `SlashCommandRegistry` auto-loads the command from `slashcommands/housekeeping.js`.
- `/help` lists canonical `/housekeeping`; `/runhousekeeping` is an alias.
