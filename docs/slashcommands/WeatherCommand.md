# WeatherCommand

## Purpose
Slash command `/weather` to display the current region's season-by-season weather definitions in human-readable markdown.

## Args
- None.

## Behavior
- Resolves the current region from player/location context.
- Reads region weather config from `Region.weather`.
- Replies with markdown including:
  - Region name
  - Dynamic weather enabled/disabled
  - Current season/weather (when available)
  - Per-season weather tables with:
    - Weather type
    - Description
    - Relative frequency
    - Typical duration range
