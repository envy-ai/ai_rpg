# Trade and Barter System Plan

## Summary

Add a setting-agnostic trade and barter loop between the player and non-hostile NPCs. Trade can be opened from an NPC card or initiated by events. The system should combine deterministic inventory/currency mutation with LLM-authored valuation, willingness, stock generation, and haggle reactions.

The first implementation should reuse the existing container-style inventory UI as much as possible, while adding trade-specific price, willingness, currency, and haggle controls.

## Goals

- Let the player buy, sell, and barter items with non-hostile NPCs.
- Let NPCs have persistent trade stock that is separate from their normal carried inventory.
- Let NPCs optionally sell items from their normal inventory without duplicating them.
- Let the LLM decide context-sensitive willingness and prices using item standard values, NPC personality, role, disposition, faction context, location, scarcity, and setting currency notes. Making this a base-context prompt is the best way to do this.
- Let haggling use an opposed skill check and then, on success or failure, rerun valuation with the haggle context (major failures may increase prices or make the NPC unwilling to sell).
- Haggle dialogue should be recorded along with other scene dialogue and should appear in the chat history and LLM context immediately. Haggling history for the current transaction while the modal is open should be displayed in a small chat history above the haggle input.
- Let NPCs refuse trade temporarily through haggling outcomes or events.
- Refresh part of NPC trade stock daily so merchants feel active without losing all continuity.

## Non-Goals For V1

- Do not build a full economy simulation.
- Do not globally reprice every item in the world.
- Do not mutate an item's standard value just because a merchant offered a different price.
- Do not allow client-side-only inventory or currency mutation.
- Do not make trade available with hostile, dead, disabled, or missing NPCs.
- Do not make player trade inventory separate from ordinary player inventory.

## Existing Anchors

- `Player` already has inventory and currency helpers: `getInventoryItems()`, `addInventoryItem(...)`, `removeInventoryItem(...)`, `getCurrency()`, `setCurrency(...)`, `adjustCurrency(...)`.
- `Player` already tracks hostility, dispositions, factions, party membership, location, and persisted NPC state.
- `Thing` already supports stack counts, values in metadata/XML output, container contents, ownership/location placement, copying, splitting, and deletion.
- The UI already has a reusable two-column thing-container modal with filters, views, drag/drop, bulk actions, and concurrent distinct item moves.
- Base-context already exposes player inventory item values and currency.
- Event handling already supports item transfer and currency changes, but trade should use exact server-side transaction endpoints rather than relying on narrative event parsing.

## Key Gotchas

1. Inventory mutation must be atomic. A barter transaction changes two inventories plus up to two currency totals; partial success would create dupes or losses.
2. Normal NPC inventory and barter inventory must not duplicate the same item. If an NPC sells an existing carried item, it should stay in its original inventory until the transaction executes.
3. Price is not the same as standard value. The prompt may assign buy/sell prices, but standard `Thing.value` should remain unchanged unless an item generation/alteration prompt explicitly changes the item.
4. Stack handling matters. Buying or selling part of a stack should reuse the existing split/copy semantics so count, image, metadata, and equipment state stay coherent.
5. Equipped items should not silently move. The trade API should reject or require unequipping, matching existing inventory transfer behavior.
6. Currency should not go negative. If either side cannot pay the net difference, the transaction should fail before moving anything.
7. The LLM can refuse or reprice, but the server remains authoritative for IDs, counts, currency, and whether referenced items exist.
8. Daily stock refresh should only flush barter inventory stock, not normal NPC inventory, equipped gear, quest items, or items currently committed to an active transaction.

## Data Model

### Player/NPC Fields

Add persistent NPC fields to `Player`:

- `willingToTrade`: boolean, default `true` for NPCs. The player should ignore this field or always be treated as willing.
- `tradeRefusalExpiresAt`: absolute world minute or `null`. When present and current world time is earlier than this value, `willingToTrade` behaves as `false`. At or after expiry, willingness resets to `true` and the expiry clears.
- `barterInventory`: list of `Thing` ids owned by the NPC as trade stock, separate from normal inventory.
- `barterStockUpdatedAt`: absolute world minute or `null`.
- `barterProfile`: optional object for durable merchant flavor, such as preferred goods, disliked goods, merchant role, and recent haggle notes.

The save format should persist these fields. Legacy saves should hydrate NPCs as:

```yaml
willingToTrade: true
tradeRefusalExpiresAt: null
barterInventory: []
barterStockUpdatedAt: null
barterProfile: null
```

### Trade Session State

Trade sessions should be server-authoritative and short-lived. Store active sessions in memory, not in saves:

- `sessionId`
- `npcId`
- `playerId`
- `locationId`
- `createdAtWorldMinutes`
- `pricingRevision`
- `playerBuyOffers`: map of player inventory thing id to offer metadata
- `npcSellOffers`: map of NPC sellable thing id to offer metadata
- `generatedStockIds`: generated barter stock ids created for this session, if any
- `haggleHistory`: list of player haggle text plus skill-check result summaries

Offer metadata:

- `thingId`
- `source`: `playerInventory`, `npcInventory`, or `npcBarterInventory`
- `willing`: boolean
- `price`: integer currency units
- `reason`: short LLM-facing/player-facing explanation
- `maxCount`: integer stack amount available for this offer

Do not store proposed cart contents in the session as authoritative state. The client sends desired item ids/counts on commit, and the server validates against the latest session data.

## Configuration

Add config under a `barter` key:

```yaml
barter:
  generated_stock:
    min_items: 0
    max_items: 20
  daily_refresh:
    min_fraction: 0.3333333333
    max_fraction: 0.6666666667
  refusal_duration_minutes: 1440
  session_timeout_minutes: 60
```

Validation rules:

- `generated_stock.min_items` and `generated_stock.max_items` must be integers `>= 0`.
- `max_items` must be `>= min_items`.
- `daily_refresh.min_fraction` and `daily_refresh.max_fraction` must be numbers between `0` and `1`.
- `daily_refresh.max_fraction` must be `>= min_fraction`.
- `refusal_duration_minutes` and `session_timeout_minutes` must be integers `>= 0`.

Do not silently clamp invalid config values. Raise a clear validation error.

## Prompt Design

### Trade Valuation Prompt

Create a base-context prompt include such as `prompts/_includes/barter-prices.njk`.

Inputs:

- Current setting currency name, plural, and value notes.
- Current location and region context.
- NPC identity, role/class, description, faction, disposition toward player, hostility state, current currency, normal inventory, barter inventory, and barter profile.
- Player currency and player inventory.
- For every item, include id, name, count, type, rarity, level, standard value, short description, equipped state, and relevant metadata flags.
- Configured generated stock min/max.
- Previous haggle history when repricing after a haggle.

Outputs should be strict XML:

```xml
<barterPrices>
  <playerItems>
    <item>
      <id>thing-id</id>
      <price>integer</price>
      <maxCount>integer</maxCount>
      <reason>short reason</reason>
    </item>
  </playerItems>
  <npcItems>
    <item>
      <id>thing-id</id>
      <source>npcInventory|npcBarterInventory</source>
      <price>integer</price>
      <maxCount>integer</maxCount>
      <reason>short reason</reason>
    </item>
  </npcItems>
  <newStock>
    <item>
      <!-- Existing item prompt seed fields: name, shortDescription, type, rarity, value, relativeLevel, flags, etc. -->
    </item>
  </newStock>
  <profileNotes>optional durable notes about this NPC's trade preferences</profileNotes>
</barterPrices>
```

Only include existing player items the NPC is willing to buy and existing NPC/barter-stock items the NPC is willing to sell. Omitted existing items are treated as unavailable for trade.

Rules:

- The prompt may return 0 to configured max generated stock items.
- If it references an existing item id, the server must verify it belongs to the stated source.
- Generated stock should use the existing item-generation/parser path where possible, preserving image and metadata flows.
- If a price is missing, non-integer, or negative, parsing should fail loudly.
- If `maxCount` exceeds the actual stack count, parsing should fail loudly rather than silently reduce it.

### Haggle Reaction Prompt

The haggle button should first resolve an opposed skill check. On success, rerun the trade valuation prompt with the haggle text and skill result in context.

On failure or major failure, run a smaller `barter-haggle-reaction` prompt, or include reaction output in the valuation prompt, to decide whether the NPC:

- Continues trading with no price change.
- Becomes less favorable in pricing.
- Temporarily refuses trade.
- Adds a short response line for the UI/chat.

Output:

```xml
<haggleReaction>
  <message>short NPC response</message>
  <continueTrading>true|false</continueTrading>
  <refuseUntilReset>true|false</refuseUntilReset>
</haggleReaction>
```

If `refuseUntilReset` is true, set `willingToTrade = false` and `tradeRefusalExpiresAt = current world minutes + barter.refusal_duration_minutes`.

## Skill Check Design

The haggle control has a text input and `Haggle` button.

Flow:

1. Player enters an offer or argument.
2. Server resolves an opposed skill check.
3. If successful, rerun `barter-prices` with the haggle text and check result.
4. If failed, optionally run `barter-haggle-reaction` to decide whether the NPC refuses, mocks the attempt, or continues unchanged.

Open decisions for implementation:

- Which player skill should be used by default? Likely a setting-aware social skill chosen from available skills, with a config fallback such as `barter.default_player_skill`.
- Which NPC skill opposes it? Likely the best social/trade/reasoning skill available, with a fallback attribute/level formula.
- Should high success improve all prices, only selected cart prices, or prompt-reprice the whole session? The requested behavior says reassign values and willingness for both merchant and player items, so V1 should reprice the whole session.

## Transaction Math

The barter UI should let the player move item stacks between two offer columns before committing.

Define:

- `playerToNpcValue`: sum of NPC purchase prices for items the player gives.
- `npcToPlayerValue`: sum of NPC sell prices for items the NPC gives.
- `netCurrencyDue = npcToPlayerValue - playerToNpcValue`.

If `netCurrencyDue > 0`, the player pays that amount to the NPC.

If `netCurrencyDue < 0`, the NPC pays `abs(netCurrencyDue)` to the player.

If `netCurrencyDue === 0`, no currency moves.

On commit:

1. Validate session exists and has not timed out.
2. Resolve player and NPC.
3. Validate both are still in a compatible location/state.
4. Validate NPC is currently willing to trade.
5. Validate all offered thing ids exist, are in the expected source, and have enough count.
6. Validate no offered item is equipped unless existing equip-transfer rules explicitly allow it.
7. Validate payer has enough currency.
8. Split stacks as needed.
9. Move things between player inventory, NPC inventory, and NPC barter inventory.
10. Adjust currencies.
11. Record an event-summary/chat entry with item and currency changes.
12. Emit UI refreshes for player, NPC, chat, and the active barter modal.

The whole commit should be a single server-side operation. If any validation fails, no item or currency should move.

## UI Plan

### NPC Card Trade Icon

Add a trade icon in the bottom right of non-hostile NPC cards, just above need bars.

Visibility:

- Show for living, non-hostile NPCs in the current location.
- Hide or disable for the current player.
- Hide or disable for dead/disabled NPCs.
- If `willingToTrade` is false, show disabled with a tooltip explaining refusal and reset time if known.

Click behavior:

- Calls trade session endpoint.
- Opens barter modal after successful session creation.

### Barter Modal

Reuse the existing container modal layout and shared thing-list renderer.

Differences from container modal:

- Header shows player currency and NPC currency.
- Player side shows inventory items with NPC buy price/willingness.
- NPC side shows barter inventory plus sellable normal inventory items with sell price/willingness.
- Item cards/table rows include:
  - Standard value.
  - Offered buy/sell price.
  - Willing/unwilling status.
  - Max tradable count.
  - Reason tooltip.
- Cart footer shows:
  - Player offer value.
  - NPC offer value.
  - Net currency due.
  - Whether either side cannot afford the current proposal.
- Commit button performs final transaction.
- Haggle input and button live below the footer.

Drag/drop and shift-click can mirror the container interface, but should move items into a "proposed trade" state client-side until commit. Do not mutate inventories through existing container move endpoints.

## API Plan

Likely endpoints:

- `POST /api/npcs/:id/trade/session`
  - Creates or refreshes a trade session.
  - Runs daily stock refresh if needed.
  - Runs valuation prompt.
  - Returns session, offers, NPC/player currency, and serialized things.

- `POST /api/trade/:sessionId/commit`
  - Body contains item ids/counts from each side.
  - Validates and applies transaction atomically.

- `POST /api/trade/:sessionId/haggle`
  - Body contains haggle text.
  - Runs opposed skill check.
  - On success, reruns valuation prompt.
  - On failure, may run reaction prompt and update willingness.

- `POST /api/npcs/:id/trade/willing`
  - Developer/admin or event-facing route to set willingness, if needed.
  - This may be unnecessary if events call model methods directly.

## Event Integration

Add event support for:

- Initiating trade with an NPC.
- Setting `willingToTrade` true/false.
- Optional setting of a refusal duration.

XML event tags could be:

```xml
<tradeAvailable>
  <npcName>...</npcName>
  <value>true|false</value>
  <duration>optional duration</duration>
  <reason>optional reason</reason>
</tradeAvailable>
```

For direct initiation:

```xml
<startTrade>
  <npcName>...</npcName>
  <reason>optional reason</reason>
</startTrade>
```

The server should not silently open a client modal during background event processing unless there is an active client stream to target. For event-initiated trade in normal turns, V1 can append a visible summary/action chip such as "Trade available with Mira" that the client can click to open the session.

## Daily Barter Stock Refresh

When opening trade, check `npc.barterStockUpdatedAt`.

If at least one day has passed:

1. Choose a fraction between configured min/max.
2. Remove that fraction of current barter inventory stock, excluding items locked in an active session.
3. Generate replacement stock with `barter-prices` or a dedicated `barter-stock` prompt.
4. Stamp `barterStockUpdatedAt` to current world minutes.

Items sold by the player to the NPC should enter either:

- NPC normal inventory, if the NPC is buying for personal use.
- NPC barter inventory, if the NPC is buying for resale.

The valuation prompt can include a buy disposition such as `personalUse` vs `resale`, but V1 can default purchased goods into barter inventory so daily refresh naturally simulates resale.

## Persistence

Persist:

- `willingToTrade`
- `tradeRefusalExpiresAt`
- `barterInventory`
- `barterStockUpdatedAt`
- `barterProfile`
- Any generated barter `Thing` records

Do not persist:

- Active trade sessions
- Client cart proposals
- Temporary haggle check result objects, except perhaps as short `barterProfile` notes if useful

On save/load, validate:

- Every `barterInventory` id resolves to a `Thing`.
- Each barter thing's ownership metadata agrees with the NPC barter inventory.
- Missing or invalid barter thing ids are reported clearly during hydration or world validation.

## Prompt Logging

All new prompts should use `LLMClient.logPrompt()`:

- `barter_prices`
- `barter_haggle_reaction`
- optional `barter_stock`

Use metadata labels that support per-prompt model overrides.

## Implementation Phases

### Phase 1: Data and Server Transaction Core

- Add persisted NPC barter fields.
- Add save/load hydration and validation.
- Add server helpers for resolving sellable NPC items and player inventory offers.
- Add atomic barter transaction helper with stack splitting and currency transfer.
- Add API commit endpoint with no LLM yet, using deterministic test fixtures.

### Phase 2: Valuation Prompt and Session API

- Add `barter-prices` prompt.
- Add parser and strict validation.
- Add session creation endpoint.
- Generate 0 to configured max stock items.
- Persist generated stock to NPC barter inventory.
- Return structured offers to the client.

### Phase 3: Barter UI

- Add NPC card trade icon.
- Add barter modal based on the container modal.
- Add price/willingness display, currency headers, net-difference footer, and commit button.
- Wire modal refresh after successful transaction.

### Phase 4: Haggle

- Add haggle text input/button.
- Add opposed skill check integration.
- Add success repricing.
- Add failure reaction and temporary refusal.
- Add chat/check-result summaries for haggle outcomes.

### Phase 5: Events and Daily Refresh

- Add event parser/handler support for trade initiation and willingness changes.
- Add daily barter inventory refresh.
- Add clickable event summary/action chip for event-initiated trade.
- Add docs and broader regression tests.

## Test Plan

### Unit Tests

- Hydrates missing trade fields on legacy NPCs.
- Persists barter fields in saves.
- Refusal expires after configured duration.
- Trade session parser accepts valid XML and rejects missing ids, invalid prices, overlarge counts, duplicate ids, and unknown sources.
- Transaction helper moves exact stack counts and preserves metadata.
- Transaction helper rejects equipped items.
- Transaction helper rejects insufficient player/NPC currency before moving anything.
- Daily refresh only removes barter inventory, not normal inventory or equipped gear.
- Sold player items enter the intended NPC inventory bucket.

### API Tests

- Opening trade for a non-hostile NPC returns offers and currencies.
- Opening trade for hostile/dead/unwilling NPCs fails or returns disabled state as designed.
- Commit endpoint applies item and currency deltas atomically.
- Haggle endpoint runs opposed check and reprices on success.
- Haggle reaction can set temporary refusal.

### UI Tests

- Trade icon appears on non-hostile NPC cards in the correct position.
- Trade icon is absent/disabled for hostile/dead/unwilling NPCs.
- Barter modal shows both currencies.
- Price pills and net-difference footer update as items are proposed.
- Commit refreshes player inventory, NPC inventory, currencies, and chat summary.
- Haggle updates prices/refusal state without closing the modal unless refusal happens.

## Open Questions

1. Which skill names should haggle prefer in settings without an obvious `Barter`, `Persuasion`, or `Negotiation` skill?
2. Should player-sold goods default into NPC barter inventory, NPC normal inventory, or should the LLM decide per item?
3. Should the player be allowed to trade with party members through this UI, or only non-party current-location NPCs?
4. Should unwilling NPCs show a disabled trade icon with tooltip, or should the icon be hidden completely?
5. Should event-initiated trade open the modal automatically for the active client, or produce a clickable chat/event summary action?
6. Should barter stock generation use the existing item-generator prompt directly, or a dedicated stock prompt that returns item seeds for the existing parser?
