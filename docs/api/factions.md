# Factions API

This file covers active-game factions. World-profile faction draft routes live in `docs/api/settings.md`.

## Faction Payload

Serialized factions contain:

- `id`: persisted faction id.
- `name`: non-empty display name. API creation and rename paths reserve `"None"` for no-faction selections.
- `description`, `shortDescription`: strings or `null`.
- `tags`, `goals`: string arrays.
- `homeRegionName`: free-form region label, not a region id.
- `relations`: object keyed by target faction id. Each value is `{ status, notes }`, where `status` is `allied`, `neutral`, `hostile`, or `rival`, and `notes` is a non-empty string.
- `assets`: array of objects with at least `name`; `type` and `description` are optional.
- `reputationTiers`: array of `{ threshold, label, perks, penalties }`. Thresholds are numeric; tiers are sorted by threshold inside the `Faction` model.
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
- Body: `{ name: string, shortDescription?: string|null, description?: string|null, tags?: string[]|string, goals?: string[]|string, homeRegionName?: string, assets?: Array<{ name: string, type?: string, description?: string }>, relations?: Record<factionId, { status: 'allied'|'neutral'|'hostile'|'rival', notes: string }>, reputationTiers?: Array<{ threshold: number, label?: string, perks?: string[]|string, penalties?: string[]|string }> }`

Response:
- 201: `{ success: true, faction: Faction }`
- 400: `{ success: false, error }` for missing, reserved, or duplicate names.
- 500: `{ success: false, error }` for validation, prompt, parse, or persistence failures.

Behavior:
- `name` is required, must be unique case-insensitively, and cannot be `"None"`.
- `tags` and `goals` accept arrays or newline/comma-delimited strings.
- `description` and `shortDescription` may be omitted or `null`; if provided as strings, they must be non-empty after trimming.
- `assets` must be an array of objects with non-empty `name` values.
- `relations` describes edges from the created faction to existing factions and must be keyed by existing faction ids.
- When existing factions are present, the route renders `prompts/faction-inbound-relationships-generator.xml.njk`, calls the LLM, logs through `LLMClient.logPrompt()`, and writes one generated relation from each existing faction toward the created faction.
- Inbound relation generation is strict: render, LLM, XML parse, source match, target match, status, notes, and per-existing-faction coverage failures return `500`.

## POST /api/factions/fill-missing

Normalize a partial faction payload and fill missing fields through AI when required.

Request:
- Body: `{ faction: PartialFaction, generationNotes?: string }`
- Supported faction fields: `name`, `homeRegionName`, `shortDescription`, `description`, `tags`, `goals`, `assets`, `relations`, `reputationTiers`.
- `relations` is an id-keyed relation object. Targets must be existing active-game faction ids.
- `generationNotes` is optional free-text guidance forwarded into the autofill prompt.

Response:
- 200: `{ success: true, faction: FactionCreatePayload, raw: string|null }`
- 400: `{ success: false, error }` when `faction` is missing or `generationNotes` is not a string.
- 500: `{ success: false, error }` for faction payload validation, prompt/render/LLM, parse, or incomplete autofill failures.

Behavior:
- Completeness requires `name`, `homeRegionName`, `shortDescription`, `description`, non-empty `tags`, non-empty `goals`, non-empty `assets`, non-empty `reputationTiers`, and a relation with status and notes for each existing faction.
- If the normalized payload is complete, the route returns it with `raw: null`.
- If any required field or relation is missing, the route renders `prompts/fill-faction-form.xml.njk`, calls the LLM, logs through `LLMClient.logPrompt()`, and merges only missing values.
- Generated relation entries are resolved from faction names to existing faction ids; matching is case-insensitive and quote-insensitive.
- AI relation parsing accepts nested relation nodes such as `<factionName>`, `<status>`, `<notes>` and attribute-based relations such as `<relation faction="..." status="...">notes</relation>`.
- AI reputation tier parsing accepts nested tier fields such as `<threshold>`, `<label>` and attribute-based tiers such as `<tier name="..." threshold="...">`.
- AI asset parsing accepts structured assets such as `<asset><name>...</name>...</asset>` and compact assets such as `<asset>Asset text</asset>`.
- If the final payload is incomplete, the error identifies missing fields and/or missing relation targets.

## PUT /api/factions/:id

Update an active-game faction by id.

Request:
- Path: `id` (faction id)
- Body supports: `name`, `shortDescription`, `description`, `tags`, `goals`, `homeRegionName`, `assets`, `relations`, `reputationTiers`

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
- `relations` must be keyed by existing faction ids; entries targeting the same faction id as the path parameter are ignored.
- Relation entries require valid `status` and non-empty `notes`.

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
- Relation `status` defaults to `neutral` when omitted, and `notes` defaults to `No explicit relationship provided.` when omitted.
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

## Load Reconciliation

Game-load reconciliation removes stale faction references from edited or older saves.

Behavior:
- Clears player `factionId` values and standing entries that reference missing factions.
- Clears location, region, and pending region-stub `controllingFactionId` values that reference missing factions.
- Removes faction relation edges with empty, missing, or self-target ids.
