# FactionFavorEffectRegistry

Typed, engine-guaranteed effects that a [faction favor](FactionFavor.md) may carry. Each handler has `description` (used in generation prompts), `normalize(params)`, `prepare(effect, context)` (validates activation-time state and must not mutate) and `apply(effect, plan, context)` (mutates and returns `{ summary, details, grantGuard? }`).

| Type | Params | Prepare / apply |
|---|---|---|
| `reveal-route` | none | Picks one hidden exit leaving a non-stub location the faction controls (directly or through its region), preferring the player's current region, then reveals it with `HiddenDiscovery.revealHiddenExit`. No candidate throws before anything changes. |
| `grant-item` | `name`, `description` | Generates exactly one item into the player's inventory through `generateItemsByNames` with `mergeStacks: false` and `creationMetadata.factionFavorId`. Returns a grant guard with the requested and canonical names. |
| `grant-currency` | `amount` (positive whole number) | `player.adjustCurrency(amount)`. Returns a grant guard with the amount. |
| `fast-travel` | none | Validates that `fastTravelLocationId` is a visited, non-stub location controlled by the faction (excluding the current one). Movement itself runs through the ordinary map fast-travel turn and teleport flow; see [faction favors API](../api/factions.md#faction-favors). |
| `restore-needs` | `bars: [{ needBar, percentage 0-100 }]` | Resolves each bar by id or name among the player's active need bars (unknown bars list the active ones), then `player.setNeedBarPercentages`. |

Static API: `types`, `has(type)`, `get(type)`, `describeAll()`, `normalize(effect, label)`.
