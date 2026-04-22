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
- Inline die-roll override is supported in crafting description fields: `notes`, `salvageNotes`, and `harvestNotes`. Tokens matching `<-?\d+>` are stripped from those fields before prompt processing, and the first parsed value is used as the player d20 roll for crafting plausibility/skill-check resolution (no clamping).
- When `noProse` is true, the server skips the prose prompt and does not run craft/salvage/harvest event-summary/additional-effect mechanics for that action. Quest checks still run using a deterministic action summary line.
- Deterministic/action summary lines now include source context:
  - Harvest/salvage lines use `from <source>`.
  - Craft/process lines use `using <inputs>`.
- Prose-mode craft/process/salvage/harvest result summaries now append the same `⏳ <natural duration> passed.` line used by normal turn event-summary bundles, sourced from the action's applied `timeTakenMinutes`.
- Crafting/harvest prompts omit prior craft/harvest/process entries from base-context history to reduce duplicate actions.
- Harvest plausibility prompts now receive `lastHarvestTime` as human-readable `... ago` text plus `harvestTarget.pastHarvests` from the source node's persisted harvest history.
- Craft success-degree rerolls now require the model response to include a full outer `<response>...</response>` wrapper via `requiredRegex` before the response is accepted by `LLMClient`. When parsing the rerolled result, omitted direct `<result>` fields are filled from the standard-success outcome sent to the success-degree prompt. Explicit empty wrappers are preserved, and returned `<item>` nodes keep their model-authored fields while missing nested item fields are backfilled from the base item.
- Player-action prose generation uses `_includes/player-action-craft.njk` via `promptType=player-action-craft` and expects XML in `<result><description>...</description></result>` (with optional `<otherEffectDescription>`).
- `timeTaken` is parsed from each crafting/salvage/harvest `<result>` using the shared duration parser (`HH:MM`, minute values, or explicit day/hour/minute/round units). Unit-bearing quantities may be decimal (`2.5 hours`), and the final value is rounded to the nearest minute. If a result has an invalid `timeTaken`, the server logs a warning, skips that result entry, and continues parsing the others. A minimum of 1 minute is always advanced (including `timeTaken = 0`).
- Craft/process consumption now follows the model output literally: only input items explicitly listed under `<itemsConsumed>` are consumed. If the model names consumed inputs that do not exactly match the provided slot items, the request fails loudly instead of falling back to consuming every remaining input. Salvage still falls back to consuming the sole target item when the model omits `<itemsConsumed>`.
- Crafted item instantiation preserves `causeStatusEffectOnTarget` and `causeStatusEffectOnEquipper` as distinct effect entries when both are present, instead of collapsing the target effect onto both application paths.
- Successful harvest actions now update the harvested source node itself: harvestable `Thing` instances keep a deduped `previouslyHarvestedItems` list plus `lastHarvested` as absolute world minutes at the successful completion time.
- When a consumed input `Thing` has `count > 1`, crafting/salvage/harvest now decrements the stack by `1` instead of deleting the whole `Thing`; only stacks at `1` or `0` are fully removed.
- Parsed crafted/recovered item `<count>` values are preserved when the resulting `Thing` instances are instantiated; crafted stacks no longer collapse to the default count of `1`.
