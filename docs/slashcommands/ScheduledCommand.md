# ScheduledCommand

## Purpose
`/scheduled` is a read-only diagnostic slash command that lists pending scheduled events in readable Markdown.

## Command Metadata
- Source: `slashcommands/scheduled.js`.
- Class: `ScheduledCommand`, extending `SlashCommandBase`.
- Name: `scheduled`.
- Aliases: none.
- Args: none.
- Description: `List pending scheduled events in readable markdown.`

## Execution
- `execute(interaction)` requires `ScheduledEvent.getPending()` to exist; if the accessor is unavailable, it throws `ScheduledEvent pending-event accessor is unavailable.`
- Pending records come from `ScheduledEvent.getPending()`, which filters to `status === 'pending'` and sorts by `targetWorldMinute`, then id.
- The command replies once through `interaction.reply({ content, ephemeral: false })`.
- It does not inspect or accept arguments.

## Empty Output
When there are no pending records, the reply content is exactly:

```text
No pending scheduled events.
```

## Event List Output
When pending records exist, the reply content starts with:

```markdown
## Scheduled Events
```

Each record is rendered as a numbered item whose heading is the scheduled-event id in inline code. The details under each item are:

- `Due`: absolute in-world date and time. The formatter converts `targetWorldMinute` to `{ dayIndex, timeMinutes }` using `Globals.getTimeConfig().cycleLengthMinutes`, then renders it with `Globals.formatDate(...)` and `Globals.formatTime(...)`.
- `In`: relative time from `Globals.getTotalWorldMinutes()`. Future events use `Utils.formatMinutesAsNaturalDuration(...)`; overdue events render as `overdue by <duration>`.
- `Region`: region name plus region id in inline code.
- `Location`: location name plus location id in inline code.
- `Event`: the full event text, trimmed, normalized to `\n` line endings, and indented under the label. Multiline event text is preserved line by line.

Inline field values escape backslashes and backticks for Markdown display. Empty display values render as `-`, although valid `ScheduledEvent` records require non-empty event, region, and location fields.

## Side Effects
- The command does not process due scheduled events.
- It does not call `markResolved(...)`, `markSkipped(...)`, or any scheduled-event resolution prompt.
- It does not mutate world time, scheduled-event state, chat history, or save data.
- Resolved and skipped records are omitted because `ScheduledEvent.getPending()` filters them out before formatting.

## Related Code And Tests
- `ScheduledEvent.getPending()` in `ScheduledEvent.js` owns pending filtering and chronological ordering.
- `tests/scheduled_command.test.js` verifies slash-command registration, non-ephemeral replies, Markdown ordering/content, exclusion of resolved events, and the empty-list message.
