# Minute-Based Time Migration Plan

This document defines the migration from decimal-hour canonical time to minute-based canonical time across runtime state, prompts, parsing, APIs, saves, and docs.

## Decisions

1. Canonical time unit is **minutes**.
2. `startTime` for new game remains **hour-only** (`0`-`23`).
3. Duration inputs accepted from LLM/user-facing time fields:
   - `HH:MM` duration format
   - `Z days, X hours, Y minutes` (any subset/combination of units)
   - Single-unit forms like `X hours`, `Y minutes`, `Z days`

## Current-State Summary

- Canonical world time is currently decimal hours via `worldTime.timeHours`.
- Many systems convert between minutes and decimal hours at boundaries.
- Status effect durations are currently normalized to decimal hours.
- Craft/salvage/harvest prompts and parsers currently request/consume decimal hours.
- Weather duration ranges are currently hour-based (`minHours`/`maxHours`).
- Offscreen NPC schedule snapshots and arithmetic currently use hour fields.

## Target Canonical Model

All internal elapsed/absolute time values become minute-based.

- World time:
  - `worldTime.dayIndex` (unchanged)
  - `worldTime.timeMinutes` (replaces `worldTime.timeHours`)
- Advancement results:
  - `advancedMinutes` (replaces `advancedHours`)
  - transition markers use `atTimeMinutes` (replaces `atTimeHours`)
- Actor/location elapsed timestamps:
  - `Player.elapsedTime`, `Location.lastVisitedTime`, `Region.lastVisitedTime` become minute-based.
- Status effects:
  - `duration` and `appliedAt` stored/processed in minutes.

`timeLabel` remains `HH:MM` for display.

## Parsing Contract

Create one shared parser for duration-like inputs (recommended location: `Utils.js`) and use it in all time-related parse paths.

Accepted examples:

- `0`
- `15`
- `00:15`
- `1:30`
- `2 hours`
- `45 minutes`
- `1 day`
- `1 day, 2 hours`
- `2 days 15 minutes`
- `3 hours, 5 minutes`

Parser behavior:

1. `HH:MM` is interpreted as a **duration**, not clock-of-day.
2. Mixed units may appear in any order.
3. Duplicate units are summed.
4. Unknown units, malformed separators, or ambiguous text throw explicit errors.
5. No silent fallback conversions.

## Workstreams

## 1) Core World Time (Globals)

Files:

- `Globals.js`

Changes:

1. Replace `timeHours` normalization and arithmetic with `timeMinutes`.
2. Replace `getTotalWorldHours()` with minute-based equivalent (new name should reflect minutes).
3. Replace `advanceTime(hours)` with minute-based API (new name/signature should reflect minutes).
4. Update transition payload fields from `atTimeHours` to `atTimeMinutes`.
5. Keep `formatTime()` output as `HH:MM`, but compute from minute canonical values directly.

## 2) Event Time Parsing and Advancement

Files:

- `Events.js`

Changes:

1. Update `time_passed` prompt wording to request minute/day/hour formats instead of decimal hours.
2. Replace decimal-only parser in `time_passed` parsing with shared duration parser.
3. Preserve minimum advancement behavior as 1 minute when parsed value is zero.
4. Update any event result metadata fields to minute naming.

## 3) Craft/Salvage/Harvest Time

Files:

- `api.js`
- `prompts/_includes/plausibility-check-craft.njk`
- `prompts/_includes/plausibility-check-salvage.njk`
- `prompts/_includes/plausibility-check-harvest.njk`

Changes:

1. Replace `timeTakenHours` parsing/storage/response with `timeTakenMinutes`.
2. Parse `<timeTaken>` through shared duration parser.
3. Update advancement call site to minute API.
4. Remove unit-stripping fallback parse behavior and fail explicitly on invalid values.
5. Update prompt comments/examples to include `HH:MM` and mixed-unit examples.

## 4) Status Effect Durations

Files:

- `StatusEffect.js`
- `Player.js`
- `Thing.js`
- `Location.js`
- `Region.js`
- `server.js`

Changes:

1. Convert duration normalization/storage from decimal hours to minutes.
2. Convert `appliedAt` semantics from world-hour stamp to world-minute stamp.
3. Remove all `* 60` / `/ 60` bridge logic currently used for ticking/decrementing.
4. Keep `-1` semantic for permanent/infinite durations.
5. Keep explicit throw behavior for invalid duration inputs.

## 5) Weather Duration Model

Files:

- `Region.js`
- `slashcommands/weather.js`
- `prompts/_includes/region-generator.njk`

Changes:

1. Replace weather duration structures:
   - `minHours`/`maxHours` -> `minMinutes`/`maxMinutes`
   - `durationHours` -> `durationMinutes`
   - `nextChangeHours` -> `nextChangeMinutes`
2. Update parser/normalizer/schema checks accordingly.
3. Update slash-command weather formatting to render minute-based duration ranges.
4. Update region generator prompt schema examples away from decimal-hour ranges.

## 6) Offscreen NPC Activity Scheduling

Files:

- `api.js`

Changes:

1. Migrate schedule snapshots and normalization from `timeHours` to `timeMinutes`.
2. Migrate absolute-time arithmetic to minutes.
3. Keep schedule checkpoints at 07:00/19:00 and weekly 07:00, but compare in minutes.
4. Update human-readable “elapsed since last run” formatting logic as needed.

## 7) API and Payload Contract Updates

Files:

- `api.js`
- `docs/api/chat.md`
- `docs/api/crafting.md`
- `docs/api/common.md`
- `slashcommands/calendar_info.js`

Changes:

1. `worldTime.timeHours` -> `worldTime.timeMinutes` in payloads.
2. `timeTakenHours` -> `timeTakenMinutes` in craft response.
3. Transition payload fields `atTimeHours` -> `atTimeMinutes`.
4. Slash-command calendar output should report minutes-based canonical field.

Compatibility note:

- During migration window, reading both old and new field names is recommended.
- Writing should use only new minute-based fields after migration completes.

## 8) New Game Start-Time Behavior

Files:

- `views/new-game.njk`
- `public/js/new-game.js`
- `api.js`
- `docs/api/game.md`

Changes:

1. Keep `startTime` input and validation as integer hour.
2. Convert chosen start hour to canonical minute value at initialization.
3. Keep UI label semantics “24h hour”.

## 9) Prompt Contract Changes (LLM-facing)

Primary files:

- `Events.js` (`time_passed` prompt text)
- `prompts/_includes/plausibility-check-craft.njk`
- `prompts/_includes/plausibility-check-salvage.njk`
- `prompts/_includes/plausibility-check-harvest.njk`
- `prompts/_includes/status-effect-generate.njk`
- `prompts/_includes/region-generator.njk`
- `prompts/_includes/item.njk`
- `prompts/_includes/character-alter.njk`

Required prompt language updates:

1. Remove decimal-hour instruction language.
2. Explicitly allow:
   - `HH:MM`
   - day/hour/minute combinations
3. Align duration wording that still says “turns” to minute/hour/day durations (for status durations).
4. Ensure all prompts continue to produce parseable, explicit durations.

## 10) Save Migration

Files:

- `Utils.js`
- `Globals.js`
- any load/hydration paths in `api.js`/`server.js` that read old shapes

Changes:

1. On load, detect legacy hour-based fields and convert to minute equivalents.
2. Convert persisted structures:
   - `worldTime.timeHours`
   - status effect `duration` / `appliedAt` hour semantics
   - weather state duration/change-hour fields
   - offscreen scheduler snapshots
   - elapsed/last-visited time fields
3. Bump save metadata/version after migration.
4. Keep load-path compatibility for older saves.

## 11) UI Behavior

Files:

- `public/js/chat.js`
- `views/index.njk`
- `public/js/player-stats.js`

Changes:

1. Keep user-facing display in human-readable forms (`HH:MM`, `Xh Ym`, `N minutes`, etc).
2. Ensure UI readers/writers no longer assume numeric durations are decimal hours.
3. Ensure any status-effect duration editors/tooltips are consistent with minute-based canonical storage and parser.

## 12) Docs To Update After Implementation

- `docs/config.md`
- `docs/api/chat.md`
- `docs/api/crafting.md`
- `docs/api/common.md`
- `docs/api/game.md`
- `docs/classes/Globals.md`
- `docs/classes/StatusEffect.md`
- `docs/classes/Events.md`
- `docs/classes/Player.md`
- `docs/classes/Location.md`
- `docs/classes/Region.md`
- `docs/classes/Utils.md`
- `docs/server_llm_notes.md`

## Validation Checklist

1. Unit tests for duration parser:
   - `HH:MM`, mixed-unit strings, invalid forms, zero/minimum semantics.
2. World-time advancement tests:
   - day rollover, segment changes, season changes, transition payload fields.
3. Crafting time tests:
   - `timeTaken` parsing and minimum advancement.
4. Status-effect ticking tests:
   - finite, permanent, and zero-expiry behavior.
5. Save migration tests:
   - load old hour-based save data and verify converted minute state.
6. API contract tests:
   - verify renamed fields are present and old fields are absent after cutover.
