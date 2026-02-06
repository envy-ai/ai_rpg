# Crafting API

Common payloads: see `docs/api/common.md` (ActionResolution, Thing).

## POST /api/craft
Resolve crafting/processing/salvage/harvest actions.

Request:
- Body:
  - `slots` (required): array of `{ thingId: string, slotIndex?: number }`
  - `mode`: `craft` | `process` | `salvage` | `harvest` (default `craft`)
  - `actionType`: optional alias for `mode`
  - `craftTargetType`: `item` | `scenery` (used only for craft mode)
  - `intendedItemName`, `notes` (string)
  - Station info: `stationThingId`, `stationName`
  - Salvage info (used for salvage): `salvageItemId`, `salvageItemName`, `salvageItemDescription`, `salvageNotes`
  - Harvest info (used for harvest): `harvestItemId`, `harvestItemName`, `harvestItemDescription`, `harvestNotes`

Response:
- 200: `{ success: true, outcome, resultLevel, craftedItem, craftedItems, recoveredItems, consumedThingIds, narrative, plausibility, unmatchedConsumedNames }`
  - `outcome`: ActionResolution
  - `resultLevel`: string mapping the success degree (e.g., `success`, `failure`, `major_success`)
  - `craftedItem`: Thing | null
  - `craftedItems`: Thing[]
  - `recoveredItems`: Thing[] (salvage/harvest)
  - `consumedThingIds`: string[]
  - `narrative`: `{ description: string, otherEffect: string | null }`
  - `plausibility`: `{ type, reason }`
  - `unmatchedConsumedNames`: string[]
- 400: `{ success: false, error }` (invalid payload, implausible crafting, missing slots)
- 500: `{ success: false, error }`

Notes:
- Salvage/harvest require exactly one slot item.
- When `actionType` is supplied, it overrides `mode` in some cases.
- Crafting/harvest prompts omit prior craft/harvest/process entries from base-context history to reduce duplicate actions.
