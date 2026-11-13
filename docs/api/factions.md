# Factions API

Inbound relationship mapping and faction autofill parsing, merging, normalization and final missing-field completeness run inside the completion's correction budget. Faction relations are sparse directed edges: omitted targets have no explicit relationship, while neutral entries describe concrete established ties. Exact response errors receive correction feedback before any faction construction or persistence.

This file covers active-game factions. World-profile faction draft routes live in `docs/api/settings.md`.

## Faction Payload

Serialized factions contain:

- `id`: persisted faction id.
- `name`: non-empty display name. API creation and rename paths reserve `"None"` for no-faction selections.
- `description`, `shortDescription`: strings or `null`.
- `tags`, `goals`: string arrays.
- `homeRegionName`: free-form region label, not a region id.
- `violenceLevel`: numeric integer from `1` through `5`, describing the faction's predisposition to physical violence independently of player standing. Missing legacy values default to `1`.
- `relations`: object keyed by target faction id. Each value is `{ status, notes }`, where `status` is `allied`, `neutral`, `hostile`, or `rival`, and `notes` is a non-empty string.
- `assets`: array of objects with at least `name`; `type` and `description` are optional.
- `reputationTiers`: array of `{ threshold, label, perks, penalties }`. Thresholds are numeric; tiers are sorted by threshold inside the `Faction` model.
- `favors`: array of [favor records](../classes/FactionFavor.md) (`id`, `name`, `shortDescription`, `description`, `minThreshold`, `cooldownMinutes`, `requiresTarget`, `targetPrompt`, `presence`, `effect`, `imageId`, `imagePrompt`). Missing in older saves loads as `[]`.
- `createdAt`, `lastUpdated`: ISO timestamp strings.

Faction standings are stored on each player as `Record<factionId, number>`. Standing values are finite numbers and are not clamped by the HTTP API.

## GET /api/factions

List active-game factions and the current player's faction standings.

Response:
- 200: `{ success: true, factions: Faction[], playerStandings: Record<factionId, number>, playerId: string|null }`
- 500: `{ success: false, error }`

Behavior:
- Factions are serialized through `toJSON()` when available.
- The list is sorted by faction name.
- `playerStandings` is `{}` when no current player or standing helper is available.

## POST /api/factions

Create an active-game faction.

Request:
- Body: `{ name: string, violenceLevel?: number, shortDescription?: string|null, description?: string|null, tags?: string[]|string, goals?: string[]|string, homeRegionName?: string, assets?: Array<{ name: string, type?: string, description?: string }>, relations?: Record<factionId, { status: 'allied'|'neutral'|'hostile'|'rival', notes: string }>, reputationTiers?: Array<{ threshold: number, label?: string, perks?: string[]|string, penalties?: string[]|string }>, favors?: Favor[] }`

Response:
- 201: `{ success: true, faction: Faction }`
- 400: `{ success: false, error }` for missing, reserved, or duplicate names.
- 500: `{ success: false, error }` for validation, prompt, parse, or persistence failures.

Behavior:
- `name` is required, must be unique case-insensitively, and cannot be `"None"`.
- `violenceLevel` defaults to `1`; explicit null also stores `1`. Other supplied values must be numeric integers from `1` through `5`; invalid values return `400` and are not clamped.
- `tags` and `goals` accept arrays or newline/comma-delimited strings.
- `description` and `shortDescription` may be omitted or `null`; if provided as strings, they must be non-empty after trimming.
- `assets` must be an array of objects with non-empty `name` values.
- `relations` describes edges from the created faction to existing factions and must be keyed by existing faction ids.
- `favors` is optional and validated against `reputationTiers` before any prompt runs; validation errors return `400`. Supplied favor ids are ignored and new ids are allocated.
- When existing factions are present, the route renders `prompts/faction-inbound-relationships-generator.xml.njk`, calls the LLM, logs through `LLMClient.logPrompt()`, and writes only generated meaningful relations from existing factions toward the created faction.
- Inbound relation generation accepts omitted sources and an empty `<factionRelationships/>`; included sources may omit relations or use an empty `<relations/>`. Explicit sources must be known and unique, with at most one relation toward the new faction. Malformed XML, unknown/mismatched references, duplicate sources, invalid statuses and missing notes retry before mutation; exhaustion returns `500`.

## POST /api/factions/fill-missing

Normalize a partial faction payload and fill missing fields through AI when required.

Request:
- Body: `{ faction: PartialFaction, generationNotes?: string }`
- Supported faction fields: `name`, `homeRegionName`, `violenceLevel`, `shortDescription`, `description`, `tags`, `goals`, `assets`, `relations`, `reputationTiers`.
- `relations` is an id-keyed relation object. Targets must be existing active-game faction ids.
- `generationNotes` is optional free-text guidance forwarded into the autofill prompt.

Response:
- 200: `{ success: true, faction: FactionCreatePayload, raw: string|null }`
- 400: `{ success: false, error }` when `faction` is missing or `generationNotes` is not a string.
- 500: `{ success: false, error }` for faction payload validation, prompt/render/LLM, parse, or incomplete autofill failures.

Behavior:
- Completeness requires `name`, `homeRegionName`, `shortDescription`, `description`, non-empty `tags`, non-empty `goals`, non-empty `assets`, non-empty `reputationTiers`, and no required relation coverage. An empty relation map is complete.
- If the normalized payload is complete, the route returns it with `raw: null`.
- A supplied `violenceLevel` is validated and preserved. When it is missing, autofill requires the prompt to generate an integer from `1` through `5`; missing or invalid XML follows the configured exact-error retry path.
- Autofill declares `faction` as its response root for the shared XML guard; the existing strict faction parser and field validation remain authoritative.
- If any required field is missing, the route renders `prompts/fill-faction-form.xml.njk`, calls the LLM, logs through `LLMClient.logPrompt()`, and merges only missing values.
- Generated relation entries are resolved from faction names to existing faction ids; matching is case-insensitive and quote-insensitive.
- Every generated relation requires nested `<factionName>`, `<status>` and `<notes>` fields. Omitted relations are accepted; malformed entries, unknown targets, invalid statuses and duplicate targets reject the response even if supplied faction fields would otherwise hide those generated values.
- AI reputation tier parsing accepts nested tier fields such as `<threshold>`, `<label>` and attribute-based tiers such as `<tier name="..." threshold="...">`.
- AI asset parsing accepts structured assets such as `<asset><name>...</name>...</asset>` and compact assets such as `<asset>Asset text</asset>`.
- If the final payload is incomplete, the error identifies missing required fields. Supplied relationships are preserved; generation may add meaningful missing ties without completing every possible pair.

## PUT /api/factions/:id

Update an active-game faction by id.

Request:
- Path: `id` (faction id)
- Body supports: `name`, `shortDescription`, `description`, `tags`, `goals`, `homeRegionName`, `violenceLevel`, `assets`, `relations`, `reputationTiers`, `favors`

Response:
- 200: `{ success: true, faction: Faction }`
- 400: `{ success: false, error }` for missing id, missing/invalid name, reserved name, or duplicate name.
- 404: `{ success: false, error }` when the faction id is unknown.
- 500: `{ success: false, error }` for other validation or mutation failures.

Behavior:
- Only fields present in the request body are updated.
- Arrays and relation maps are replaced as whole field values.
- `name` must be unique case-insensitively and cannot be `"None"`.
- `tags` and `goals` accept arrays or newline/comma-delimited strings.
- `description` and `shortDescription` must be non-empty strings or `null` when present.
- Blank `homeRegionName` clears the field to `null`.
- `violenceLevel` accepts null to store `1`; otherwise it must be a numeric integer from `1` through `5`. Invalid values return `400` without changing the faction.
- `relations` must be keyed by existing faction ids; entries targeting the same faction id as the path parameter are ignored.
- Relation entries require valid `status` and non-empty `notes`.
- `reputationTiers` and `favors` are validated together, so a request may move a favor to a new threshold in the same edit that changes the tiers. A tier change that would orphan an existing favor returns `400`.
- `favors` is a whole-list replacement. Entries with an `id` must be favors of this faction (other ids return `400`); entries without one are created. Omitted `imageId`/`imagePrompt` on an existing favor keep the stored icon. Favors removed by the edit also remove every player's cooldown entry for them.

## DELETE /api/factions/:id

Delete an active-game faction and clear references to it.

Response:
- 200: `{ success: true, removed: Faction }`
- 400: `{ success: false, error }` for missing id.
- 404: `{ success: false, error }` when the faction id is unknown.
- 500: `{ success: false, error }`

Behavior:
- Removes relation edges from other factions that target the deleted faction.
- Clears matching `factionId` and faction standing entries from all players.
- Clears matching `controllingFactionId` values from active locations and regions.
- Removes the faction from the active factions map and the `Faction` static index.

## PUT /api/player/factions/:id/standing

Set or clear the current player's standing with a faction.

Request:
- Path: `id` (faction id)
- Body: `{ value: number | null }`

Response:
- 200: `{ success: true, factionId, standings: Record<factionId, number> }`
- 400: `{ success: false, error }` for missing id or non-finite numeric values.
- 404: `{ success: false, error }` when the faction id is unknown or no current player is available.
- 500: `{ success: false, error }`

Behavior:
- `value: null` removes the standing entry.
- Finite numeric values are stored as supplied.

## Chat Tool: `upsertFactionFields`

Generic prompt and scheduled-event tool loops can create or update factions through `upsertFactionFields({ operation, faction?, fields })`.

Request:
- `operation`: `create` or `update`.
- `faction`: required for `update`; accepts faction id or exact faction name. Omit it for `create`.
- `fields`: object of allowed faction field/value pairs.
- Generic-admin prompts (`@`, `@@`, and `@@@`) allow `name`, `description`, `shortDescription`, `tags`, `goals`, `homeRegionName`, `relations`, `assets`, and `reputationTiers`. Other prompt schemas omit direct `shortDescription` mutation.

Behavior:
- `create` requires `fields.name`, rejects duplicate names, creates a persisted `Faction` instance, and inserts it into the active factions map.
- `create` rejects a non-blank top-level `faction`; the faction name belongs in `fields.name`.
- `update` resolves the target by id or exact name and rejects duplicate renames before mutation.
- When a non-admin call supplies `description`, the runtime generates `shortDescription` from a detached draft before creating or updating the live faction. A generation failure leaves the live faction unchanged. An admin call that supplies both values skips that extra prompt.
- The tool returns recoverable problems as `<toolError>` payloads with error codes and, where useful, candidates.
- `tags`, `goals`, and tier `perks`/`penalties` accept arrays or newline-delimited strings.
- `description`, `shortDescription`, and `homeRegionName` accept non-empty strings or `null`.
- `assets` accepts an array of strings or objects; objects require non-empty `name`.
- `relations` must be an object keyed by existing faction ids. Update relations cannot target the updated faction itself.
- Each explicit relation requires a valid `status` and non-empty `notes`; malformed edges return a tool error before mutation. Omitting an edge leaves it absent.
- `relations`, `assets`, and `reputationTiers` are whole-field replacements.
- The tool does not run inbound relation generation. Reciprocal relations from existing factions toward a created faction must be supplied explicitly when desired.

## Standing Updates From Events

The `faction_reputation_change` event mutates the current player's faction standings during event processing.

Behavior:
- Event parsing resolves factions by id or name.
- `"a little"` maps to `1` point and `"a lot"` maps to `4` points; increase/decrease controls the sign.
- The handler applies the standing update only when the faction has a witness in the current scene: the player, a party member, or an NPC in the current location with that `factionId`.
- Unknown factions and unwitnessed entries are skipped.
- Applied entries are emitted in `context.factionReputationChanges`.

## Faction Favors

Activatable services a faction performs at positive reputation tiers. Model: [FactionFavor](../classes/FactionFavor.md); availability and activation: [FactionFavorService](../classes/FactionFavorService.md); typed effects: [FactionFavorEffectRegistry](../classes/FactionFavorEffectRegistry.md). Config: [faction_favors](../config.md#faction-favors).

### GET /api/player/favors

- Query: `includeLocked=true` also returns favors the player's tier has not unlocked.
- 200: `{ success: true, enabled, worldMinute, favors: [{ faction: { id, name, imageId }, favor, tierLabel, cooldown, status, reason, readyAtWorldMinute, readyIn }] }`. `status` is `available`, `cooldown`, `needs-presence` or `locked`. `favors` is `[]` when disabled.
- 404 when no player exists.

### GET /api/factions/:id/favors/:favorId/fast-travel-targets

Visited, non-stub locations controlled by the faction (directly or through their region), excluding the player's current location: `{ success: true, targets: [{ id, name, regionName }] }`. 400 when the favor is not a `fast-travel` favor; 404 for unknown factions or favors.

### POST /api/factions/:id/favors/:favorId/regenerate

Rewrites one favor through the base-context favor prompt in regeneration mode: the prompt names the favor being replaced, lists the faction's other favors, and asks for one distinct favor at the same `minThreshold`. Optional body `{ notes }` adds player guidance. The response must contain exactly one valid favor at that threshold whose name differs from the faction's other favors, or it goes back through the correction loop. The favor keeps its id, so the player's cooldown carries over; `imageId`/`imagePrompt` are cleared so a new icon is generated. Emits `factions_updated`.

- 200: `{ success: true, factionId, favor, previousName }`
- 404 for unknown factions or favors; 500 with `stack` for prompt or validation failures, or when the game or faction changed while generating (nothing is changed).

### Using a favor

Favors are used through `/api/chat` with `favorActivation` (see [chat API](chat.md)). The Play page sends ordinary favors as an automated chat message; `fast-travel` favors send a `travel: true` fast-travel turn whose `travelMetadata.exit.destinationId` equals `favorActivation.fastTravelLocationId`, then call the normal player teleport with travel-time accounting, the same flow as map fast travel.

### Generation and backfill

All favor generation uses one base-context prompt: `base-context.xml.njk` with `promptType: 'faction-favors-generator'` (task in `prompts/_includes/faction-favors-generator.njk`), so it sees the whole story and reuses the cached base-context prefix. The include appends the factions needing favors with their descriptions, goals, assets and positive tiers (with perks), the favor guidance and the `<factionFavors>` output schema. Responses are validated per faction against its tiers through the ordinary correction loop (`faction_favors_backfill` metadata label, `faction-favors.schema.xml`).

It runs as a background job (`generateMissingFactionFavors` in `api.js`) for factions with a positive tier and no favors:
- after a new game finishes and after a save loads (queued, then started when the runtime-replacement barrier releases);
- after `POST /api/factions` creates a faction with a positive tier;
- on demand with `/faction_favors generate`.

It requires a loaded game with a current player, writes only to factions that still have no favors, and discards its result if the game changed. Success emits a `factions_updated` realtime event; failure is recorded in the prompt audit log. Reputation-tier generation (`faction-reputation-generator.xml.njk`) and faction form fill (`fill-faction-form.xml.njk`) do not generate favors; `fill-missing` only passes through and validates favors already supplied.

## Load Reconciliation

Game-load reconciliation removes stale faction references from edited or older saves.

Behavior:
- Clears player `factionId` values and standing entries that reference missing factions.
- Removes player favor-usage (cooldown) entries for favors that no longer exist.
- Clears location, region, and pending region-stub `controllingFactionId` values that reference missing factions.
- Removes faction relation edges with empty, missing, or self-target ids.
- Preserves sparse maps and existing saved edges, including neutral authored ties and older boilerplate entries; no automatic relation pruning or gap filling occurs.
