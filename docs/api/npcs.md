# NPC API

Common payloads: see `docs/api/common.md`.

This file covers the `/api/npcs/*` character routes. NPC creation is exposed as `POST /api/locations/:id/npcs` and documented in `docs/api/locations.md`.

## POST /api/npcs/generate-aliases
Generate aliases in bulk for all current NPCs.

Request:
- Body: omitted or an empty object.

Behavior:
- Processes NPCs in prompt batches of `20` names per request to the alias generator prompt.
- Applies aliases per NPC by exact lowercased name key; NPCs with no returned aliases are set to an empty alias list.
- Marks save metadata `npcAliasesGenerated=true` and persists `metadata.json` for the currently loaded save (if one is active).

Response:
- 200: `{ success: true, message, totalNpcs, updatedNpcs, npcsWithAliases, promptsRun, batchSize, persisted, metadata }`
- 500: `{ success: false, error }`

## GET /api/npcs/:id
Fetch detailed character status by id. The route is named for NPCs, but it resolves any character in the shared `players` map.

Response:
- 200: `{ success: true, npc }` (PlayerStatus shape; may include `intrinsicStatusEffects` and registered mod `modStatusSections`)
- 400/404/500 with `{ success: false, error }`

Notes:
- The response is based on `Player.getStatus()` when available and includes expanded inventory, barter inventory, gear, disposition definitions, need bars, memories, goals, quests, and character-arc data.
- `modStatusSections` is collected from the client profile path so character detail refreshes preserve mod-owned actor status sections.

## PUT /api/npcs/:id
Update character profile and state fields by id. The route accepts player records too, but NPC-only fields such as `needBarApplicability`, hidden state, barter inventory context, and trade willingness only have full effect on NPC actors.

Request:
- Path: `id`
- Body supports: `name`, `description`, `shortDescription`, `race`, `class`, `factionId`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `currency`, `experience`, `isDead`, `hiddenFromPlayer`, `personalityType`, `personalityTraits`, `personalityNotes`, `aiNotes`, `statusEffects`, `aliases`, `resistances`, `vulnerabilities`, `needBarApplicability`, `willingToTrade` (also accepts singular aliases `resistance` and `vulnerability`)
- Rejects `unspentSkillPoints` (400) because pools are formula-derived at read time.

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Unknown skills may trigger skill generation; canonical names are normalized before assignment.
- `factionId` must reference an existing faction id or be `null` to clear membership.
- If provided, `aliases` must be an array of strings.
- If provided, `needBarApplicability` must be an object and is only accepted for NPCs; unchecked bars are removed from that actor and re-enabled bars come back at `100`.
- If provided, `willingToTrade` must be a boolean and sets whether the NPC can open barter sessions. Setting it to `false` stamps a temporary refusal expiry using `barter.refusal_duration_minutes`; setting it to `true` clears the refusal expiry.
- If provided, `hiddenFromPlayer` must be a boolean. Dead NPCs/corpses remain visible because the `Player` model normalizes hidden state to `false` while dead.
- `level`, `health`, `currency`, `experience`, attributes, and skill values are applied only when the submitted value is numeric and in the route's accepted range. Other unsupported fields in the body are ignored.

## POST /api/npcs/:id/trade/session
Start or refresh a barter session with an NPC at the current location or in the player party whose current disposition toward the player is not hostile.

Request:
- Path: `id`
- Body: omitted or an empty object.

Behavior:
- The target must be an NPC at the current player location or in the current player party, alive, not hostile according to the same disposition-threshold heuristic exposed to the client as `isHostileToPlayer`, and currently willing to trade. A stale raw `isHostile` flag alone does not block barter once current dispositions are no longer hostile.
- The route refreshes expired trade refusals, performs daily barter-stock refresh when enough world time has passed, renders the base-context `barter-prices` prompt, logs it through `LLMClient.logPrompt` with metadata label `barter_prices`, and stores a temporary quoted session.
- The pricing prompt receives player inventory, merchant normal inventory, merchant persisted barter stock, standard item values, the merchant's current currency, and the configured generated-stock count range. Installed item modules are filtered out of those inventories as standalone offers; the base item remains visible to the pricing prompt. Existing item offers are expected to return only items the merchant is willing to buy or sell, with both exact item name and item id; omitted existing items are treated as unavailable for trade. The parser matches by unique exact name first and only falls back to id when the name is blank or ambiguous. Bad ids are logged as warnings and the affected offer is skipped instead of failing the whole prompt. Unicode replacement characters in returned pricing XML are removed with a warning before strict parsing so encoding glitches in text content do not abort the whole session. Generated stock seeds with count `0` are ignored; negative or non-integer counts still fail validation. Remaining generated stock seeds are instantiated as Things through batched `inventory-generator` prompts capped by `barter.generated_stock.max_items_per_prompt`, then moved into the NPC's separate barter inventory.
- During initial or daily barter-stock generation, the prompt must return a merchant currency value; the server applies it to the NPC before returning the session.

Response:
- 200: `{ success: true, session, npc, player, currencyName, currencyNamePlural }`
- 409: `{ success: false, error, npc? }` when eligibility fails or the pricing prompt says trading should stop.
- 400/404/500 with `{ success: false, error }`

Session fields:
- `session`: `{ id, npcId, expiresAtWorldMinutes, playerOffers, merchantOffers, haggleHistory }`
- `playerOffers` and `merchantOffers` include offer metadata, available `count`, and serialized prompt item data for each item the pricing prompt made tradeable.

## POST /api/npcs/:id/trade/haggle
Make a haggle offer or argument for the active barter session.

Request:
- Body: `{ sessionId: string, offer?: string, text?: string, message?: string, clientId?: string, requestId?: string }`

Behavior:
- `offer`, `text`, or `message` may carry the haggling argument; at least one non-empty value is required.
- Resolves an opposed skill check using the player's best trade/social-style skill when available.
- Adds `barter-haggle` chat entries for the player's offer and the merchant's response text. NPC speaker labels for the trade modal are stored in session history/client rendering rather than prepended to stored response text.
- Runs `barter-prices` with haggle context and without generated stock, then replaces the quoted buy/sell prices for the session.
- If the prompt returns `<continueTrading>false</continueTrading>`, the NPC becomes unwilling to trade until `barter.refusal_duration_minutes` elapses, the session is closed, and the merchant takes a normal NPC action in response to the concluded haggling.

Response:
- 200 continuing trade: `{ success: true, session, npc, player, currencyName, currencyNamePlural, check, response, chatEntries, playerEntry, responseEntry }`
- 200 refused trade: `{ success: true, refused: true, check, response, chatEntries, playerEntry, responseEntry, npcTurns, messages, requestId, streamMeta?, player, npc }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/npcs/:id/trade/commit
Commit selected buy/sell lines from an active barter session.

Request:
- Body: `{ sessionId: string, playerItems?: Array<{ itemId, count }>, merchantItems?: Array<{ itemId, count }>, acceptMerchantCurrencyShortfall?: boolean, clientId?: string, requestId?: string }`

Behavior:
- Validates the whole transaction before moving anything.
- At least one selected player or merchant item is required. Counts must be positive integers.
- Player-sold items move from player inventory into the NPC's barter inventory; merchant-sold items move from the NPC's normal inventory or barter inventory into player inventory.
- Currency moves by the net difference between selected merchant sell prices and player item buy prices.
- If the merchant owes the player more currency than they currently have, the first commit attempt returns `409` with `reason: "merchant-insufficient-currency"` and the available/required amounts. Resubmitting with `acceptMerchantCurrencyShortfall: true` completes the item transfer but pays only the merchant's available currency.
- Successful item trades record a standalone `⚖️ Trade` `event-summary` chat entry listing player-to-merchant items, merchant-to-player items, currency exchanged, and any accepted merchant-currency shortfall.
- Successful item trades conclude the barter session, queue the merchant through the normal NPC action flow, and return as soon as the transaction has been applied. The queued NPC turn is streamed to the requesting client with the returned `requestId` when realtime is available.

Response:
- 200: `{ success: true, transaction, tradeSummary, npc, player, requestId, npcTurnPending, message }`
- 409: `{ success: false, reason: "merchant-insufficient-currency", merchantName, merchantCurrency, requiredMerchantPayment, shortfall, error }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/npcs/:id/trade/conclude
Conclude an active barter session without committing item transfers.

Request:
- Body: `{ sessionId: string, clientId?: string, requestId?: string }`

Behavior:
- Deletes the active session.
- If no haggling happened, no NPC action is triggered.
- If the session had haggle history, the merchant takes a normal NPC action with the haggling context available to the NPC planning prompt.
- This endpoint can conclude an already-started session even if trade willingness expired or was set to false; the target still must be resolvable, present with the player or in the party, alive, and not disposition-hostile.

Response:
- 200: `{ success: true, concluded: true, npcTurnTriggered: boolean, npcTurns?, messages?, requestId?, streamMeta?, player, npc }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/npcs/:id/equipment
Equip or unequip an item in a character's inventory.

Request:
- Body: `{ itemId: string, action?: 'equip'|'unequip'|false, slotName?: string, slotType?: string }`

Behavior:
- `action` defaults to `equip`. `action: false` is treated as `unequip`.
- `slotName` targets an exact gear slot. `slotType` tries the first empty matching slot type before falling back to the actor's default equip behavior.
- The item must already be in the character's normal inventory.

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/needs
Fetch active need bars for a character.

Response:
- 200: `{ success: true, needs: NeedBar[], audience: { player, party, nonParty }, npc?, player? }`
- 400/404/500 with `{ success: false, error }`

Notes:
- NPC targets return `npc`; player targets return `player`.
- `audience` identifies whether the target is the player, a party member, or a non-party NPC.

## PUT /api/npcs/:id/needs
Update active need bars for a character.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], audience: { player, party, nonParty }, npc?, player?, applied: NeedBar[] }`
- 400/404 with `{ success: false, error }`

Notes:
- Entries with no object body or no `id` are skipped. Non-numeric values fail the request.
- `applied` contains normalized need bars returned by `setNeedBarValue()`. If no entries apply, the route still returns the refreshed snapshot with an empty `applied` array.

## GET /api/npcs/:id/dispositions
Fetch disposition values toward the current player.

Response:
- 200: `{ success: true, npc, player, range, dispositions }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/dispositions
Update disposition values.

Request:
- Body: `{ dispositions?: Array<{ key?: string, type?: string, value: number }> }`

Response:
- 200: `{ success: true, message, npc, player, range, dispositions, applied }`
- 400/404/500 with `{ success: false, error }`

Notes:
- If `dispositions` is omitted, the endpoint returns the snapshot with an empty `applied` array.
- The route requires a current player. It resolves disposition definitions by `key` or `type`, skips unknown definitions, and normalizes values to the configured disposition range.

## PUT /api/npcs/:id/memories
Replace important memories.

Request:
- Body: `{ memories: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- The body must be an array. Non-string and blank entries are removed before assignment.

## PUT /api/npcs/:id/goals
Replace NPC goals.

Request:
- Body: `{ goals: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- The body must be an array. Entries are trimmed, blanks are removed, and duplicate goals are removed case-insensitively before replacing the actor's stored goals.

## POST /api/npcs/:id/teleport
Teleport a character to another location.

Request:
- Body: `{ locationId: string, accountTravelTime?: boolean, storyToolTeleport?: boolean, accompanyingCharacters?: string[], clientId?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, destination: LocationResponse, previousLocation: LocationResponse, locationIds: string[], worldTime, timeProgress, removedFromParty, arrivalProcessingError, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- `locationId` must reference an existing location. Requests to move the target to its effective origin location return 400.
- When the target character is the player and `storyToolTeleport` is `true`, this route is a story-tool teleport: it sets the player's current location to the requested existing location, returns refreshed origin/destination payloads, and skips travel-time accounting, `while-you-were-away`, hidden-NPC arrival checks, NPC sighting updates, and event-summary creation.
- Player teleports without `storyToolTeleport` keep the normal arrival-processing path. Region Map, World Map, and Favorites use that gameplay path after their preview, confirmation, and `/api/chat` fast-travel prompt.
- For those gameplay player teleports, `accompanyingCharacters` carries the prompt-selected complete canonical names or aliases. The server validates and canonicalizes them against living party members and living NPCs at the origin, then relocates selected non-party NPCs while retaining selected party membership. Story-tool teleports do not apply this gameplay companion selection.
- Normal player travel commits the location and elapsed travel time before running `while-you-were-away`, hidden-NPC arrival checks, and sighting updates. If that post-travel pipeline throws, the route still returns a successful teleport response with `arrivalProcessingError: { message, stack }`; the client refreshes the committed destination and opens the normal error popup with the backtrace.
- When the target character is an NPC in the current player's party, the route removes them from the party before applying the teleport so the old party/location state cannot leave a stale client-side presence behind.
- For NPC targets, and for non-story-tool player teleports, when `accountTravelTime` is `true`, the route resolves the shortest directed path between the origin and destination using the location graph's stored `travelTimeMinutes`, advances world time by that total, and returns the resulting `worldTime` / `timeProgress`. If no route exists, fast-travel time falls back to `0` minutes.

## DELETE /api/npcs/:id
Delete an NPC.

Behavior:
- The target must exist and have `isNPC=true`.
- The API deletion path clears and deletes the NPC's inventory items, removes the NPC from its location and region membership lists, removes the NPC from every actor's party, deletes the record from `players`, and unregisters it from the `Player` index.

Response:
- 200: `{ success: true, message, locationId, regionId }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/portrait
Trigger portrait generation for a character.

Request:
- Path: `id`
- Body: `{ clientId?: string }`

Behavior:
- Image generation and the ComfyUI client must be enabled.
- Duplicate requests while the portrait prompt or image job is already in progress join the existing work instead of starting another render.
- Generation eligibility is enforced by `generatePlayerImage`; skipped requests return 409.

Response:
- 200: `{ success: true, npc: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, npc: { ... }, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason, npc: { ... } }` (skipped)
- 503: `{ success: false, error }`
- 404/500 with `{ success: false, error }`
