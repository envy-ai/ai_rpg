# FactionFavorService

`FactionFavorService.js` computes favor availability and runs activation. It has no runtime state; callers pass the player, location, world minute, config and dependencies (`findFavor`, `getAllFactions`, `findActorById`, `findLocationById`, `findRegionById`, `getAllLocations`, `generateItemsByNames`).

## Config

`resolveConfig(config)` reads `faction_favors` ([config.md](../config.md#faction-favors)): `enabled` (default `true`) and `rival_witness_penalty` (default `1`, whole number ≥ 0). Invalid values throw with the key and valid values.

## Status

`getFavorStatus({ player, faction, favor, location, worldMinute, deps })` returns `{ status, standing, reason, readyAtWorldMinute?, readyInMinutes?, readyIn? }`, checked in this order:

1. `locked`: the player's tier (`Faction.resolveReputationTier`, missing standing counts as 0) is below `minThreshold`.
2. `cooldown`: `worldMinute < lastUsedWorldMinute + cooldownMinutes`. The cooldown keeps running while locked.
3. `needs-presence`: `presence === 'faction-presence'` and none of: the location or its region has `controllingFactionId` equal to the faction; a living NPC with that `factionId` is in the location or the party.
4. `available`.

`listPlayerFavors(...)` returns rows for every faction (sorted by faction name, then threshold), optionally without locked favors. `buildPromptRows(...)` turns unlocked rows into `{ factionName, name, shortDescription, status }` for the base-context `<factionFavors>` block, with status `available`, `ready in <duration>` or `needs presence`.

## Activation

`activate({ request, player, location, worldMinute, config, deps })`:

1. Rejects when disabled, the favor is missing, its status is not `available` (`error.code = 'FAVOR_UNAVAILABLE'`), or a required target is blank.
2. Runs the effect's `prepare`; failures leave everything unchanged.
3. Applies the effect. A failure is rethrown with `favorStage: 'apply'` and the cooldown is not recorded.
4. Applies rival-witness penalties: every other faction whose relation toward this faction is `rival` (penalty) or `hostile` (double penalty) loses standing when one of its living members is in the location or party. No LLM call.
5. Records `player.recordFavorUse(favor.id, worldMinute)`.

It returns `actionText` (`I call in a favor from <Faction>: <Favor>. <target>`), `effectResult`, `rivalPenalties`, `grantGuard` (for [Events](Events.md) double-reward pruning), `fastTravel`, `promptContext` (for the `<favorActivation>` block) and `metadata` (stored on the user chat entry and returned to the client).

Other helpers: `normalizeActivationRequest(raw)` validates `{ favorId, target?, fastTravelLocationId? }` (target ≤ 300 characters, unknown fields rejected); `listFastTravelTargets`; `computeRivalPenalties`; `hasFactionPresence`.
