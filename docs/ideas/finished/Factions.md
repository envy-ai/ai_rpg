# Faction System (Archived Design Notes)

This is a finished/archive design document. It preserves the original faction-system intent while summarizing what the current project actually implements. For authoritative implementation details, use:

- `docs/classes/Faction.md`
- `docs/api/factions.md`
- `docs/api/settings.md`
- `docs/classes/Player.md`
- `docs/api/game.md`
- `docs/api/serialization.md`

## Current Implementation Snapshot

The faction system is implemented as persistent active-game faction records plus player-specific numeric standings.

- `Faction` stores `id`, `name`, descriptions, `tags`, `goals`, `homeRegionName`, id-keyed `relations`, `assets`, `reputationTiers`, and timestamps.
- Active factions live in the server-level `factions` map and in `Faction` static indexes by id and lowercased exact name.
- `Player` stores actor faction membership as `factionId` and faction standings as a map of `factionId -> number`.
- Standing values are finite numbers. The HTTP/API helpers do not clamp them to a fixed range.
- Reputation tiers live on each `Faction`; `Faction.resolveReputationTier(value)` resolves the highest configured tier threshold less than or equal to the standing value.
- Generated reputation tiers currently request thresholds at `-60`, `-20`, `0`, `20`, and `60`, but the model accepts any finite tier thresholds.
- Relations are directional faction-to-faction records keyed by target faction id. Valid statuses are `allied`, `neutral`, `hostile`, and `rival`, each with non-empty notes.
- `assets` are persisted faction metadata. They do not currently drive systemic trade, patrol, or economy rules by themselves.

## Current Generation And Setup

New-game faction setup uses active setting defaults before falling back to config:

- `SettingInfo.defaultFactions` can provide setting-local faction drafts.
- `SettingInfo.defaultFactionCount` sets the target faction count when present.
- `config.factions.count` is the fallback target; `0` disables faction setup.
- Preconfigured drafts are loaded first, up to the target count.
- If more factions are needed, `generateFactionsList()` runs a three-stage prompt flow: core faction data, relationship matrix, and reputation tiers.
- If faction generation returns fewer factions than requested, new-game setup fails. If it returns more, the extras are accepted.
- Combined factions must have unique names.
- Each active faction receives relation entries for every other active faction. Missing or invalid entries normalize to neutral with default notes.
- Faction generation, relationship generation, reputation generation, autofill, and inbound relationship prompts are logged through `LLMClient.logPrompt()`.

## Current API, UI, And Persistence

Implemented runtime surfaces include:

- `GET /api/factions`: lists active factions plus the current player's standings.
- `POST /api/factions`: creates an active-game faction and generates inbound relation edges from existing factions.
- `POST /api/factions/fill-missing`: fills missing active-game faction form fields through AI without creating the faction.
- `PUT /api/factions/:id`: updates present faction fields; relation, asset, and tier fields are whole-field replacements.
- `DELETE /api/factions/:id`: removes the faction, relation edges to it, player memberships/standings for it, and location/region control references to it.
- `PUT /api/player/factions/:id/standing`: sets or clears the current player's numeric standing.
- `/api/settings/factions/generate` and `/api/settings/factions/fill-missing`: manage world-profile faction drafts, not live factions.
- The chat/scheduled-event tool `upsertFactionFields` can create or update factions through allowed individual fields.
- The main UI has a Factions tab with faction fields, relation editing, reputation tiers, and player standing editing.
- Quest editing supports per-faction reputation rewards.
- Save/load persists factions in `factions.json`, player faction state in `allPlayers.json`, and location/region control fields in `gameWorld.json`.
- Load reconciliation clears stale faction ids from players, standings, location/region/pending-stub control fields, and invalid/self relation edges.

## Current Integration Points

- **Player/NPCs**: `Player.factionId` identifies membership; `Player.getFactionStandings()`, `getFactionStanding()`, `setFactionStanding()`, and `removeFactionStanding()` manage player-specific reputation.
- **Quests**: quest faction reputation rewards resolve faction ids through the registry and update player standings.
- **Events**: XML `faction_reputation_change` entries map `a little` to `1` point and `a lot` to `4` points, signed by increase/decrease.
- **Witness gating**: event reputation changes apply only when a witness from that faction is in scene: the player, a party member, or an NPC in the current location with that `factionId`.
- **NPC generation**: NPC prompts can select a faction by full faction name or `None`.
- **Locations/Regions**: `Location` and `Region` store `controllingFactionId`; there is no implemented `FactionPresence` object with influence, law level, patrol rate, or services.
- **Prompt context**: `base-context.xml.njk` includes active faction summaries for name, descriptions, tags, goals, and home region. It does not currently include the full faction relation matrix.
- **Chat tools**: `updateObjectFields` can update `faction` objects, and `upsertFactionFields` is the dedicated faction create/update tool.

## Original Design Goals

The original design aimed to:

- Create systemic, emergent conflict and cooperation across regions and NPCs.
- Make player choices matter through reputation shifts and world-state changes.
- Provide repeatable content loops such as quests, patrols, trade, and politics without fixed lore.

These goals still describe the direction of the feature, but only some of the systemic loops are implemented as mechanics today.

## Original Concept Terms And Current Status

| Concept | Current status |
| --- | --- |
| Faction | Implemented as a persistent `Faction` model and active-game registry. |
| Standing | Implemented as `Player` numeric standings by faction id. Tier and flags are not stored in the standing entry. |
| Presence | Not implemented as a standalone influence/law/patrol/services model. Current world ownership is `controllingFactionId` on regions, locations, and pending stubs. |
| Relations | Implemented as directional, id-keyed relation records with status and notes. |
| Assets | Implemented as metadata on factions. Systemic asset effects remain design space. |
| Faction events | Partially implemented through faction reputation events and quest rewards. There is no generic faction resource-shift event model. |

## Original Engagement Ideas, Reframed

The original design listed ten engagement features. Their current status is:

1. **Reputation tiers and perks**: implemented as faction tier data and UI display; automatic discounts, safe houses, or item unlocks are not broadly enforced.
2. **Territory control**: partially implemented through `controllingFactionId`; encounter tables, law enforcement, and regional rule changes are not a dedicated system.
3. **Dynamic diplomacy**: faction relations are stored and editable; automatic alliance/hostility drift is not implemented as a scheduled subsystem.
4. **Faction contracts**: quests can carry faction reputation rewards; repeatable faction contract lanes are not a dedicated mechanic.
5. **Economic pressure**: still design-only beyond narrative/tool-authored changes.
6. **Patrols and checkpoints**: still design-only as a systemic presence feature, though prompts can narrate faction-controlled areas.
7. **Leadership and succession**: can be represented in descriptions/assets/goals, but there is no leadership subsystem.
8. **Infiltration and cover**: not implemented as player standing flags or exposure mechanics.
9. **Faction warfare events**: can be narrated or manually mutated through existing tools, but no large-scale warfare subsystem exists.
10. **Recruitment and party ties**: party mechanics and faction metadata exist, but high-standing unlocks are not automatic.

## Original Implementation Sketch, Current Outcome

The original sketch proposed:

1. Add a faction-generation prompt and parse XML at new-game time.
2. Add standing changes to quest completion and combat/event outcomes.
3. Extend random events to include faction patrols and conflicts.
4. Add UI hooks for standing tiers and region control indicators.
5. Persist faction state in save files.

Current outcome:

- New-game faction generation is implemented through XML prompts, with active-setting draft support.
- Quest rewards and XML event checks can update player faction standings.
- Faction patrol/conflict random-event behavior is not a dedicated faction subsystem.
- UI support exists for faction management, player standings, quest faction rewards, NPC faction selection, and location/region controlling faction fields.
- Save/load persistence and stale-reference reconciliation are implemented.

## Design Notes To Preserve

- Prefer explicit faction ids in persisted state and relation maps; use names mainly for prompt/UI resolution.
- Do not assume standing values are clamped to `-100..100`.
- Do not model standing as `{ value, tier, lastChangedAt, flags }` unless the code is intentionally expanded; current saves store numeric values.
- Do not assume `Globals` owns faction helper methods. Current helpers are primarily on `Faction`, `Player`, API closures, and chat-tool helpers.
- Treat `FactionPresence`, automatic economy pressure, patrol rates, law levels, infiltration flags, and leadership succession as future design concepts, not current behavior.
