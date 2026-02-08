# CalendarInfoCommand

## Purpose
Slash command `/calendar_info` (alias `/calendar`) to display in-game calendar data and current world-time details in markdown.

## Args
- None.

## Behavior
- Reads the calendar via `Globals.getSerializedCalendarDefinition()`.
- Reads current time context via `Globals.getWorldTimeContext()`.
- Replies with markdown including:
  - Current date/time/segment/season/holiday
  - Weekday list
  - Month table
  - Season table
  - Holiday table

