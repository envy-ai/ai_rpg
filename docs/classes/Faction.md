# Faction

## Purpose

`Faction` models an active-game organization. It stores faction identity, goals, tags, assets, inter-faction relations, and reputation tiers. Player-specific standing values live on `Player`; `Faction` supplies the faction registry record and tier lookup for those standing values.

Active-game factions are stored in the server-level `factions` map by id and are also registered in `Faction` static indexes for lookup by id and lowercased exact name.

## Key State

- Identity: `#id`, `#name`.
- Prompt/UI descriptors: `#description`, `#shortDescription`, `#homeRegionName`.
- Lists: `#tags`, `#goals`.
- Relations: `#relations`, a `Map<factionId, { status, notes }>` where `status` is `allied`, `neutral`, `hostile`, or `rival`.
- Assets: `#assets`, an array of asset objects. The model accepts string assets as `{ name }`; HTTP routes require asset objects with names.
- Reputation tiers: `#reputationTiers`, sorted by numeric `threshold`, with `{ threshold, label, perks, penalties }`.
- Timestamps: `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction And Hydration

- `new Faction(options)` requires a non-empty string `name`.
- Missing `id` values come from `IdGenerator.next('faction')`; provided ids are registered with `IdGenerator.register('faction', id)`.
- The name `"None"` is reserved for no-faction selections. The constructor and `name` setter reject it unless `allowReservedName: true` is supplied.
- `fromJSON(data)` hydrates a saved faction through the constructor with `allowReservedName: true`, then restores string `createdAt` and `lastUpdated` values when present.
- The constructor registers the instance in both static indexes. The server also inserts active-game instances into its `factions` map.

## Normalization And Validation

- `tags`, `goals`, tier `perks`, and tier `penalties` accept arrays; the model also splits string list values on newlines.
- `description` and `shortDescription` are `null` or non-empty strings. Empty strings throw through the model setters.
- `homeRegionName` is a free-form region label, not a region id. The setter accepts `null`/`undefined` or a non-empty string; the constructor stores a trimmed string or `null`.
- Relation maps accept either a `Map` or plain object. Relation keys must be non-empty strings.
- Relation values require an allowed `status` and non-empty `notes`. Status values are trimmed and lowercased.
- The model validates relation shape but does not require target ids to exist. API routes, chat tools, settings draft validation, and load reconciliation enforce target existence where needed.
- Reputation tier thresholds must be finite numbers. Tiers are sorted ascending by threshold.
- Numeric standing values are not stored on `Faction` and are not clamped by the faction APIs.

## Accessors

- Getters: `id`, `name`, `tags`, `goals`, `description`, `shortDescription`, `homeRegionName`, `relations`, `assets`, `reputationTiers`, `createdAt`, `lastUpdated`.
- Setters: `name`, `tags`, `goals`, `description`, `shortDescription`, `homeRegionName`, `relations`, `assets`, `reputationTiers`.
- Array, asset, relation, and tier getters return cloned values or copied maps so callers do not mutate private state by reference.
- Setters refresh `lastUpdated`.

## Instance API

- `update(updates)`: applies recognized setter-backed fields, skips `id`, `createdAt`, `lastUpdated`, and `undefined` values, then returns the faction.
- `getRelation(factionId)`: returns a cloned relation or `null`.
- `setRelation(factionId, relation)`: validates and stores one relation edge.
- `removeRelation(factionId)`: removes one relation edge and returns whether anything was removed.
- `resolveReputationTier(value)`: converts `value` to a number and returns the highest tier whose threshold is less than or equal to it, or `null`.
- `toJSON()`: serializes model fields, relation maps as plain objects, and cloned arrays.

## Static API

- `fromJSON(data)`, `create(options)`.
- `getById(id)`, `getByName(name)`, `getAll()`.
- `exists(id)`, `delete(id)`, `clear()`.
- `indexById`, `indexByName`: copy getters for the static indexes.

## Runtime API Surfaces

- `GET /api/factions` returns active-game factions sorted by name plus the current player's faction standings.
- `POST /api/factions` creates an active-game `Faction`, rejects blank, reserved, or duplicate names, validates relation targets against existing factions, and runs inbound relationship generation from every existing faction toward the created faction when existing factions are present. That prompt is logged through `LLMClient.logPrompt()` with `faction_inbound_relationship_generation`.
- `POST /api/factions/fill-missing` normalizes a partial active-game faction payload and fills missing required fields with the shared faction autofill prompt. It returns a payload for creation; it does not create the faction.
- `PUT /api/factions/:id` mutates present fields only. Relation, asset, and tier fields are whole-field replacements.
- `DELETE /api/factions/:id` removes the faction, deletes relation edges pointing to it, clears matching player `factionId` and player standing entries, clears matching location/region `controllingFactionId` values, and removes the model from static indexes.
- `PUT /api/player/factions/:id/standing` writes or removes the current player's numeric standing for a valid faction id.

## Chat Tool Surface

`upsertFactionFields({ operation, faction?, fields })` is available to prompt/tool loops and scheduled-event tool execution.

- `operation` is `create` or `update`.
- `create` requires `fields.name`, rejects a non-blank top-level `faction`, rejects duplicate names, creates a real `Faction`, and inserts it into the active factions map.
- `update` resolves `faction` by id or exact name and rejects duplicate renames before mutation.
- Allowed fields are `name`, `description`, `shortDescription`, `tags`, `goals`, `homeRegionName`, `relations`, `assets`, and `reputationTiers`.
- Tool relation entries must reference existing faction ids. Self-relations are rejected on update.
- Tool relation `status` defaults to `neutral` and `notes` defaults to `No explicit relationship provided.` when omitted.
- The tool does not run inbound relationship generation; reciprocal relation edges must be supplied explicitly when desired.

## Settings And Generation

- `SettingInfo.defaultFactions` stores setting-local faction drafts. Drafts are validated by `SettingInfo`, have unique ids/names, reject `"None"`, and keep relation targets inside the draft set.
- `/api/settings/factions/generate` returns draft factions for a world profile. It does not create live factions.
- `/api/settings/factions/fill-missing` uses the same autofill machinery for one setting-local draft, with sibling drafts as valid relation targets.
- During game creation, setting drafts are loaded first with `Faction.fromJSON()`, then any remaining target count is generated by the three-stage faction generation flow: core faction data, inter-faction relations, and reputation tiers.
- Combined preconfigured and generated factions must have unique names. Their relation maps are rebuilt so every other active faction has a relation edge; missing or invalid entries become neutral with `No explicit relationship provided.`.
- Base prompt context includes active faction summaries sorted by name and excludes the reserved `"None"` name.

## Event And Quest Effects

- `faction_reputation_change` event parsing resolves factions by id or name and maps `a little` to `1` point and `a lot` to `4` points. Increase/decrease controls the sign.
- The event handler applies the standing delta only when a witness from that faction is in the scene: the player, a party member, or an NPC in the current location with that `factionId`.
- Applied event entries are emitted on `context.factionReputationChanges`.
- Quest faction reputation rewards resolve faction ids through the registry and apply deltas with the player's faction standing helpers.

## Persistence And Reconciliation

- `Utils.serializeGameState()` writes active factions to `factions.json` using `Faction.toJSON()`.
- `Utils.hydrateGameState()` clears faction indexes, hydrates saved records with `Faction.fromJSON()`, inserts them into the runtime faction map, and participates in compact id migration.
- Game-load reconciliation removes stale faction references from player membership, player standings, location/region/pending-stub controlling faction fields, and invalid/self relation edges.

## Relevant Tests

- `tests/chat_tool_upsert_faction_fields.test.js`: tool schema, create/update behavior, relation defaults, duplicate-name rejection.
- `tests/utils.counter_id_migration.test.js`: compact faction id allocation, save migration, relation id rewrites.
- `tests/events.xml_event_parser.test.js`: XML event parser coverage for faction reputation entries.
