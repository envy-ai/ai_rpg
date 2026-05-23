# NPC API

Common payloads: see `docs/api/common.md`.

## POST /api/npcs/generate-aliases
Generate aliases in bulk for all current NPCs.

Request:
- Body: none

Behavior:
- Processes NPCs in prompt batches of `20` names per request to the alias generator prompt.
- Applies aliases per NPC by exact lowercased name key; NPCs with no returned aliases are set to an empty alias list.
- Marks save metadata `npcAliasesGenerated=true` and persists `metadata.json` for the currently loaded save (if one is active).

Response:
- 200: `{ success: true, message, totalNpcs, updatedNpcs, npcsWithAliases, promptsRun, batchSize, persisted, metadata }`
- 500: `{ success: false, error }`

## GET /api/npcs/:id
Fetch full NPC status (uses `Player.getStatus()`).

Response:
- 200: `{ success: true, npc }` (PlayerStatus shape; may include `intrinsicStatusEffects`)
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id
Update an NPC's core data.

Request:
- Path: `id`
- Body supports: `name`, `description`, `shortDescription`, `race`, `class`, `factionId`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `currency`, `experience`, `isDead`, `hiddenFromPlayer`, `personalityType`, `personalityTraits`, `personalityNotes`, `aiNotes`, `statusEffects`, `aliases`, `resistances`, `vulnerabilities`, `needBarApplicability` (also accepts singular aliases `resistance` and `vulnerability`)
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

## POST /api/npcs/:id/trade/session
Start or refresh a barter session with a non-hostile NPC at the current location or in the player party.

Request:
- Path: `id`

Behavior:
- The target must be an NPC at the current player location or in the current player party, alive, not hostile, and currently willing to trade.
- The route refreshes expired trade refusals, performs daily barter-stock refresh when enough world time has passed, renders the base-context `barter-prices` prompt, logs it through `LLMClient.logPrompt` with metadata label `barter_prices`, and stores a temporary quoted session.
- The pricing prompt receives player inventory, merchant normal inventory, merchant persisted barter stock, standard item values, the merchant's current currency, and the configured generated-stock count range. Existing item offers are expected to return only items the merchant is willing to buy or sell, with both exact item name and item id; omitted existing items are treated as unavailable for trade. The parser matches by unique exact name first and only falls back to id when the name is blank or ambiguous. Bad ids are logged as warnings and the affected offer is skipped instead of failing the whole prompt. Unicode replacement characters in returned pricing XML are removed with a warning before strict parsing so encoding glitches in text content do not abort the whole session. Generated stock seeds are instantiated as Things through batched `inventory-generator` prompts capped by `barter.generated_stock.max_items_per_prompt`, then moved into the NPC's separate barter inventory.
- When the route is doing initial or daily barter-stock generation, the prompt must also return a refreshed merchant currency value; the server applies it to the NPC before returning the session.

Response:
- 200: `{ success: true, session, npc, player, currencyName, currencyNamePlural }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/trade/haggle
Make a haggle offer or argument for the active barter session.

Request:
- Body: `{ sessionId: string, offer: string }`

Behavior:
- Resolves an opposed skill check using the player's best trade/social-style skill when available.
- Adds prompt-excluded chat entries for the player's offer and the merchant's raw response text; NPC speaker labels for the trade modal are kept in session history/client rendering rather than prepended to stored response text.
- Runs `barter-prices` again with haggle context and no generated new stock, then replaces the quoted buy/sell prices for the session.
- If the prompt returns `<continueTrading>false</continueTrading>`, the NPC becomes unwilling to trade until `barter.refusal_duration_minutes` elapses, the session is closed, and the merchant immediately takes a normal NPC action in response to the concluded haggling.

Response:
- 200: `{ success: true, session?, closed?, refusalExpiresAt?, check, haggleResponse, chatEntries, npc, player }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/trade/commit
Commit selected buy/sell lines from an active barter session.

Request:
- Body: `{ sessionId: string, playerItems?: Array<{ itemId, count }>, merchantItems?: Array<{ itemId, count }>, acceptMerchantCurrencyShortfall?: boolean }`

Behavior:
- Validates the whole transaction before moving anything.
- Player-sold items move from player inventory into the NPC's barter inventory; merchant-sold items move from the NPC's normal inventory or barter inventory into player inventory.
- Currency moves by the net difference between selected merchant sell prices and player item buy prices.
- If the merchant owes the player more currency than they currently have, the first commit attempt returns `409` with `reason: "merchant-insufficient-currency"` and the available/required amounts. Resubmitting with `acceptMerchantCurrencyShortfall: true` completes the item transfer but pays only the merchant's available currency.
- Successful item trades record a standalone `⚖️ Trade` `event-summary` chat entry listing player-to-merchant items, merchant-to-player items, currency exchanged, and any accepted merchant-currency shortfall.
- Successful item trades conclude the barter session, queue the merchant through the normal NPC action flow, and return as soon as the transaction has been applied. The queued NPC turn is streamed to the requesting client with the returned `requestId` when realtime is available.

Response:
- 200: `{ success: true, transaction, tradeSummary, npc, player, requestId, npcTurnPending, message }`
- 409: `{ success: false, reason: "merchant-insufficient-currency", merchantCurrency, requiredMerchantPayment, shortfall, error }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/trade/conclude
Conclude an active barter session without committing item transfers.

Request:
- Body: `{ sessionId: string, clientId?: string, requestId?: string }`

Behavior:
- Deletes the active session.
- If no haggling happened, no NPC action is triggered.
- If the session had haggle history, the merchant takes a normal NPC action with the haggling context available to the NPC planning prompt.

Response:
- 200: `{ success: true, concluded: true, npcTurnTriggered: boolean, npcTurns?, messages?, player, npc }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/npcs/:id/equipment
Equip or unequip an item in an NPC's inventory.

Request:
- Body: `{ itemId: string, action?: 'equip'|'unequip'|false, slotName?: string, slotType?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/needs
Fetch need bars for an NPC.

Response:
- 200: `{ success: true, needs: NeedBar[], audience: { player, party, nonParty }, npc, player? }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/needs
Update need bars for an NPC.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], audience: { player, party, nonParty }, npc, applied: NeedBar[] }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/dispositions
Fetch disposition values toward the current player.

Response:
- 200: `{ success: true, npc, player, range, dispositions }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/dispositions
Update disposition values.

Request:
- Body: `{ dispositions?: Array<{ key, value }> }`

Response:
- 200: `{ success: true, message, npc, player, range, dispositions, applied }`
- 400/404/500 with `{ success: false, error }`

Notes:
- If `dispositions` is omitted, the endpoint returns the snapshot with an empty `applied` array.

## PUT /api/npcs/:id/memories
Replace important memories.

Request:
- Body: `{ memories: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/goals
Replace NPC goals.

Request:
- Body: `{ goals: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/teleport
Teleport an NPC to another location.

Request:
- Body: `{ locationId: string, accountTravelTime?: boolean, clientId?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, destination: LocationResponse, previousLocation: LocationResponse, locationIds: string[], worldTime, timeProgress, removedFromParty, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- When the target character is an NPC in the current player's party, the route removes them from the party before applying the teleport so the old party/location state cannot leave a stale client-side presence behind.
- When `accountTravelTime` is `true`, the route resolves the shortest directed path between the origin and destination using the location graph's stored `travelTimeMinutes`, advances world time by that total, and returns the resulting `worldTime` / `timeProgress`.
- When the teleported character is the player and travel time advances, the route also records travel and elapsed-time event-summary rows, parent-linked to visible arrival prose when one is generated, and emits `chat_history_updated` when `clientId` is provided.
- If no route exists, fast-travel time falls back to `0` minutes.

## DELETE /api/npcs/:id
Delete an NPC.

Response:
- 200: `{ success: true, message, locationId, regionId }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/portrait
Trigger portrait generation for an NPC.

Request:
- Path: `id`
- Body: `{ clientId?: string }`

Duplicate requests while the portrait prompt or image job is already in progress join the existing work instead of starting another render.

Response:
- 200: `{ success: true, npc: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, npc: { ... }, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason, npc: { ... } }` (skipped)
- 503: `{ success: false, error }`
- 404/500 with `{ success: false, error }`
