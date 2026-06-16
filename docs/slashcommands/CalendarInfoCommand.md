# CalendarInfoCommand

## Purpose
`/calendar_info` displays the active in-game calendar and the current world-time context as a public markdown reply. `/calendar` is an alias for the same command.

## Args
- None.

## Behavior
- Extends `SlashCommandBase` with canonical name `calendar_info`, alias `calendar`, description `Show all in-game calendar and current world-time details in markdown.`, and no arguments.
- Reads a cloned active calendar definition through `Globals.getSerializedCalendarDefinition()`.
- Reads the derived world-time payload through `Globals.getWorldTimeContext()`.
- Throws clear errors when either calendar/world-time helper is unavailable or returns a non-object payload.
- Sends `interaction.reply({ content, ephemeral: false })`; the command does not edit the calendar, advance time, request a client refresh, or write save data.

## Reply Content
- Header: `## Calendar Info`.
- Current context lines:
  - Year name.
  - World day index.
  - Formatted time label plus raw `timeMinutes`.
  - Formatted calendar date.
  - Time segment.
  - Season.
  - Holiday name, or `None` when the current date is not a holiday.
- `Weekdays` section: numbered weekday names, or `_No weekdays defined._`.
- `Months` table: month name, day count, and season name.
- `Seasons` table: season name, start date, day length in minutes, and description.
- `Holidays` table: holiday date, name, and description, or `_No holidays defined._`.

## Formatting Notes
- Empty, `null`, or `undefined` display values render as `-`.
- Markdown table cells escape `|` and replace newlines with spaces.
- The command reports the normalized active calendar. Calendar editing and validation are handled by the `/api/calendar` routes and the calendar editor UI.
