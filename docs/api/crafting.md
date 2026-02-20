# Crafting API

Common payloads: see `docs/api/common.md` (ActionResolution, Thing).

## POST /api/craft
Resolve crafting/processing/salvage/harvest actions.

Request:
- Body:
  - `slots` (required): array of `{ thingId: string, slotIndex?: number }`
  - `mode`: `craft` | `process` | `salvage` | `harvest` (default `craft`)
  - `actionType`: optional alias for `mode`
  - `noProse` (optional boolean): when true, skips the player-action prose generation path
  - `craftTargetType`: `item` | `scenery` (used only for craft mode)
  - `intendedItemName`, `notes` (string)
  - Station info: `stationThingId`, `stationName`
  - Salvage info (used for salvage): `salvageItemId`, `salvageItemName`, `salvageItemDescription`, `salvageNotes`
  - Harvest info (used for harvest): `harvestItemId`, `harvestItemName`, `harvestItemDescription`, `harvestNotes`

Response:
- 200: `{ success: true, outcome, resultLevel, craftedItem, craftedItems, recoveredItems, consumedThingIds, narrative, plausibility, unmatchedConsumedNames, timeTakenMinutes, timeProgress, worldTime }`
  - `outcome`: ActionResolution
  - `resultLevel`: string mapping the success degree (e.g., `success`, `failure`, `major_success`)
  - `craftedItem`: Thing | null
  - `craftedItems`: Thing[]
  - `recoveredItems`: Thing[] (salvage/harvest)
  - `consumedThingIds`: string[]
  - `narrative`: `{ description: string, otherEffect: string | null }`
  - `plausibility`: `{ type, reason }`
  - `unmatchedConsumedNames`: string[]
  - `timeTakenMinutes`: number (minutes applied to world-time advancement for this craft action)
  - `timeProgress`: object (world-time advancement result; shape mirrors chat/event time progression)
  - `worldTime`: object (updated serialized world-time payload)
- 400: `{ success: false, error }` (invalid payload, implausible crafting, missing slots)
- 500: `{ success: false, error }`

Notes:
- Salvage/harvest require exactly one slot item.
- When `actionType` is supplied, it overrides `mode` in some cases.
- When `noProse` is true, the server skips the prose prompt and does not run craft/salvage/harvest event-summary/additional-effect mechanics for that action. Quest checks still run using a deterministic action summary line.
- Deterministic/action summary lines now include source context:
  - Harvest/salvage lines use `from <source>`.
  - Craft/process lines use `using <inputs>`.
- Crafting/harvest prompts omit prior craft/harvest/process entries from base-context history to reduce duplicate actions.
- Player-action prose generation uses `_includes/player-action-craft.njk` via `promptType=player-action-craft` and expects XML in `<result><description>...</description></result>` (with optional `<otherEffectDescription>`).
- `timeTaken` is parsed from each crafting/salvage/harvest `<result>` using the shared duration parser (`HH:MM`, integer minutes, or explicit day/hour/minute units). If a result has an invalid `timeTaken`, the server logs a warning, skips that result entry, and continues parsing the others. A minimum of 1 minute is always advanced (including `timeTaken = 0`).
