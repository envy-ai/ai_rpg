# WeatherCommand

## Purpose
Slash command `/weather` displays the current region's weather definition as a public markdown reply. It is a read-only diagnostic view of seasonal weather configuration and the world-time context available to the command.

## Registration
- Module: `slashcommands/weather.js`.
- Canonical name: `weather`.
- Description: `Show seasonal weather details for the current region in markdown.`
- Aliases: none.

## Args
- None.

## Region Resolution
The command resolves the current region in this order:

1. `Globals.region`.
2. `Globals.currentPlayer.location.region`.
3. `Globals.currentPlayer.location.regionId` via `Region.get()`.
4. `Globals.currentPlayer.currentLocation` via `Location.get()`, then that location's region object or `regionId`.

If no region is available, the command throws `Current region is unavailable; cannot display weather details.`

## Behavior
- Reads `region.weather`. `Region` normalizes weather definitions to an object with `hasDynamicWeather` and `seasonWeather`; if the command receives a missing or non-object weather value, it throws `Region "<name>" has no readable weather configuration.`
- Reads `Globals.getWorldTimeContext()` and includes the current season and current weather name when those fields are non-empty strings.
- Replies with `ephemeral: false`.
- Uses the region's trimmed `name`, then trimmed `id`, then `Unknown Region` for the heading label.
- Escapes markdown table cell pipes and line breaks in displayed values.

The reply starts with:

```markdown
## Weather: <region name>

- Dynamic weather: **Yes|No**
- Current season: **<season>**
- Current weather: **<weather name>**
```

The current season and current weather lines are omitted when their values are unavailable.

If `weather.seasonWeather` is empty, the reply contains:

```markdown
_No season-specific weather details are defined for this region._
```

For each season entry, the command emits a `### <seasonName>` heading and a markdown table with these columns:

| Column | Source |
| --- | --- |
| `Weather Type` | `weatherTypes[].name` |
| `Description` | `weatherTypes[].description` |
| `Relative Frequency` | numeric `weatherTypes[].relativeFrequency` |
| `Typical Duration` | `weatherTypes[].durationRange` |

## Duration Display
- Duration ranges prefer `durationRange.minMinutes` and `durationRange.maxMinutes`.
- Display also understands `minHours` and `maxHours` by converting them to minutes, matching the command's compatibility helper.
- Values under one hour render as `<minutes>m`.
- Whole-hour values render as `<hours>h`.
- Mixed values render as `<hours>h <minutes>m`.
- Equal min/max values render as a single duration; ranges render as `<min>-<max>`.
- Invalid or missing duration values render as `-`.

## Related Coverage
- `tests/region.weather_inheritance.test.js` covers weather inheritance and `Region.resolveCurrentWeather()` behavior for regions without dynamic weather.
- `tests/api.region_weather_payload_helpers.test.js` covers API payload exposure of `weather` and `weatherState`.
- There is no dedicated command-output test for `/weather`.
