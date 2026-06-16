# Trade and Barter System

## Status

Implemented. This file is now an archival design note for the current NPC barter system, plus rationale for why it is shaped the way it is. The API and class reference docs are the canonical endpoint and field references:

- `docs/api/npcs.md`
- `docs/classes/Player.md`
- `docs/ui/modals_overlays.md`
- `docs/config.md`

## Current Summary

The game has a setting-agnostic trade and barter loop between the player and eligible NPCs. A trade session can be opened from an NPC card trade icon for living, non-hostile, willing NPCs at the current location or in the player's party.

The implementation keeps inventory and currency mutation deterministic and server-authoritative, while using an LLM pricing prompt for context-sensitive merchant behavior: willingness to buy or sell, unit prices, generated stock, merchant currency during stock refresh, and haggle responses.

The system deliberately does not try to simulate a global economy. Prices are quoted for a temporary session and do not mutate a `Thing`'s standard value. Player trade inventory is ordinary player inventory; NPCs additionally have a persisted barter-stock inventory separate from their normal carried inventory.

## Design Rationale

The original design goal was to make currency and item value matter without requiring every world profile to define a full economy or every NPC to carry a hand-authored shop schema. Barter is therefore split into two responsibilities:

- The server owns identity, item counts, stack splitting, inventory placement, currency totals, session expiry, and final transaction application.
- The LLM owns local flavor: what the merchant is willing to buy or sell, what stock they plausibly have, how they price items, and how they react to haggling.

That split lets the game use NPC personality, faction context, disposition, location scarcity, needs, recent conversation, and setting currency notes while still avoiding client-side or narrative-only inventory mutation.

## Eligibility

The barter resolver currently requires:

- The target is an NPC, not the current player.
- The NPC is alive.
- The NPC is at the current player location or is in the current player party.
- The NPC is not hostile according to the current disposition-based `isHostileToPlayer` heuristic.
- The NPC is currently willing to trade.

The browser renders a trade button on eligible NPC cards and party cards. Dead, player, and hostile cards do not get the button. NPCs with `willingToTrade === false` keep a disabled trade button with a "Not willing to trade right now" title.

## Persisted Actor State

`Player` persists the barter state for NPCs:

- `barterInventory`: separate NPC trade stock, stored as `Thing` ids.
- `willingToTrade`: boolean trade availability flag; players are always treated as willing.
- `tradeRefusalExpiresAt`: optional world-minute timestamp that re-enables trade after a temporary refusal.
- `barterStockUpdatedAt`: optional world-minute timestamp for daily stock refresh.
- `barterProfile`: optional JSON object for durable merchant flavor or preferences.

Barter-stock items carry `metadata.barterOwnerId` while they are in that stock. Adding an item to barter stock removes ordinary owner, location, and container placement metadata; removing it clears matching barter-owner metadata.

## Session Lifecycle

Barter sessions are in-memory quotes and are not saved. They are keyed by a generated session id and store:

- `npcId`
- `createdAtWorldMinutes`
- `expiresAtWorldMinutes`
- `playerOffers`
- `merchantOffers`
- `haggleHistory`

`POST /api/npcs/:id/trade/session` starts or refreshes a session. The route refreshes expired trade refusals, optionally refreshes NPC stock, runs the pricing prompt, and returns the quoted offers with serialized player/NPC payloads and currency labels.

`POST /api/npcs/:id/trade/conclude` closes a session without item transfer. If haggling happened, the merchant gets a normal NPC follow-up turn with recent haggle context.

## Pricing Prompt

The implemented valuation prompt is `promptType: "barter-prices"` through `base-context.xml.njk`, with the task include at `prompts/_includes/barter-prices.njk`. Prompts are logged through `LLMClient.logPrompt()` with metadata label `barter_prices`; haggle passes use the `barter_haggle` log prefix.

The prompt receives:

- Setting currency name, plural, and value notes through base context.
- Current location/region and normal base-context history.
- Player state, currency, and standalone non-scenery inventory items.
- NPC state, currency, normal inventory, persisted barter inventory, and barter fields.
- Standard item values, counts, short descriptions, ids, names, and source labels.
- Generated-stock min/max, and whether merchant currency is being refreshed.
- Current haggle offer, opposed-check result, and session haggle history on haggle passes.

The current XML shape uses `unitPrice` for existing offers and `price` for generated stock:

```xml
<barterPrices>
  <generalReasoning>...</generalReasoning>
  <merchantCurrency>0</merchantCurrency>
  <haggleResponse>...</haggleResponse>
  <continueTrading>true</continueTrading>
  <playerItems>
    <item>
      <name>Exact existing player item name</name>
      <id>Existing player item id</id>
      <unitPrice>Non-negative integer amount the merchant pays per unit</unitPrice>
      <reason>Short reason</reason>
    </item>
  </playerItems>
  <merchantItems>
    <item>
      <name>Exact existing merchant item name</name>
      <id>Existing merchant item id</id>
      <source>inventory|barterInventory</source>
      <unitPrice>Non-negative integer amount the player pays per unit</unitPrice>
      <reason>Short reason</reason>
    </item>
  </merchantItems>
  <newStock>
    <item>
      <name>Generated item name</name>
      <count>Positive integer</count>
      <value>Standard value as a non-negative integer</value>
      <price>Merchant sell price per unit as a non-negative integer</price>
      <description>Brief item description</description>
      <type>Item type</type>
      <rarity>Rarity label</rarity>
      <reason>Short reason this merchant has it</reason>
    </item>
  </newStock>
</barterPrices>
```

Omitted existing items are unavailable for that session. Existing item references are resolved by unique exact name first, with id fallback when the name is blank or ambiguous. Unknown existing ids are warning-skipped rather than failing the whole quote; malformed pricing XML, invalid numeric fields, invalid booleans, and invalid generated stock fields fail the prompt path.

## Generated And Refreshed Stock

NPC barter stock is persistent, but part of it can refresh when opening trade after at least one in-world day has elapsed. The implementation removes a configured fraction of current barter stock, deletes those generated `Thing` records, stamps `barterStockUpdatedAt`, and lets the pricing prompt request replacement stock.

Generated stock is not created directly by the pricing prompt. The pricing prompt returns item seeds, and the server instantiates them through the shared `inventory-generator` flow in `barterStock` mode. Batches are capped by `barter.generated_stock.max_items_per_prompt`.

Player-sold items currently move into the NPC's barter inventory, which makes resale and later refresh behavior straightforward.

## Haggling

`POST /api/npcs/:id/trade/haggle` accepts free text on an active session. The server resolves an opposed check with a d20 roll plus the best available trade/social-style skill for each actor. Preferred skill-name fragments include barter, haggle, mercantile, merchant, trade, negotiation, persuasion, diplomacy, deception, charm, and intimidation; if none match, the best numeric skill is used.

The haggle offer is recorded as a visible `barter-haggle` user chat entry. The pricing prompt reruns with haggle context and returns repriced offers plus a merchant response. The response is recorded as a visible `barter-haggle` assistant entry and is also shown in the modal's haggle history.

If the prompt returns `<continueTrading>false</continueTrading>`, the NPC becomes temporarily unwilling to trade, the session closes, and the merchant takes a normal NPC action in response to the concluded haggling.

## Transaction Model

`POST /api/npcs/:id/trade/commit` commits selected item/count lines from an active session:

- `playerItems`: items the player gives to the merchant.
- `merchantItems`: items the merchant gives to the player.

The server validates the entire transaction before applying it. It checks that the session exists and belongs to the NPC, the NPC is still eligible and willing, at least one item is selected, counts are positive integers, selected offers are still quoted and willing, source items still exist in the expected inventory bucket, counts are available, and currency settlement is possible.

Trade math is:

- `playerSellTotal`: sum of merchant buy `unitPrice * count`.
- `merchantSellTotal`: sum of merchant sell `unitPrice * count`.
- `netPlayerPays = merchantSellTotal - playerSellTotal`.

If `netPlayerPays > 0`, the player pays the merchant. If it is negative, the merchant pays the player. If the player cannot cover the payment, the commit fails. If the merchant cannot cover payment to the player, the first commit fails with `reason: "merchant-insufficient-currency"`; the client can resubmit with `acceptMerchantCurrencyShortfall: true` to accept only the merchant's available currency.

Successful commits split stacks as needed, move player-sold items into NPC barter inventory, move merchant-sold normal or barter-stock items into player inventory, adjust currency totals, delete the session, record a visible trade event summary, refresh the client, and queue a merchant follow-up NPC turn.

## UI

The barter modal reuses the shared thing-list renderer and container-style two-column interaction model, but stages proposed trades client-side until commit. It shows:

- Player sell offers and merchant sell offers.
- Both actors' currency.
- Persistent item price badges across view modes.
- Hidden-by-default unavailable offers behind per-column toggles.
- Pending source and pending-copy visual states.
- Click, drag/drop, shift-click, shift-drag, and mobile stack quantity handling.
- Net trade/currency summary and merchant shortfall confirmation.
- Haggle input, check/result feedback, and chat-like haggle history.

The modal starts only after a lightweight confirmation so an accidental NPC-card click does not immediately launch pricing and stock-generation prompts.

## Event Integration

The implemented XML event integration is trade availability, not automatic modal opening. The event tag is:

```xml
<tradeAvailability>
  <npcName>Exact NPC name</npcName>
  <willingToTrade>true|false</willingToTrade>
  <reason>One sentence reason</reason>
</tradeAvailability>
```

The `trade_availability` handler resolves the NPC and calls `setWillingToTrade(...)`. Setting an NPC unwilling stamps `tradeRefusalExpiresAt` using `barter.refusal_duration_minutes`; setting them willing clears the expiry.

An older idea for a direct `startTrade` event was not implemented. Normal event processing does not silently open a client modal from background work.

## Configuration

Current default config:

```yaml
barter:
  generated_stock:
    min_items: 0
    max_items: 16
    max_items_per_prompt: 8
  daily_refresh:
    min_fraction: 0.3333333333
    max_fraction: 0.6666666667
  refusal_duration_minutes: 1440
  session_timeout_minutes: 60
```

Validation fails loudly when configured item counts are not non-negative integers, `generated_stock.max_items_per_prompt` or duration fields are not positive integers, fractions are outside `0..1`, or min values exceed max values.

## Boundaries And Non-Goals

The current system still intentionally avoids:

- A global or simulated economy.
- Repricing every item in the world.
- Mutating item standard value because a merchant quoted a different price.
- Client-side-only inventory or currency mutation.
- A separate player trade inventory.
- Automatic event-driven modal opening from background event checks.

## Extension Ideas

These remain proposals rather than current behavior:

- Location-owned markets, vending machines, or trade posts that are not tied to one NPC inventory.
- Richer use of `barterProfile` for merchant specialties, recurring preferences, dislikes, reputation, or supply chains.
- Rumor/opportunity cards that point the player toward known traders.
- More explicit admin tools for inspecting and repairing NPC barter stock.
- Optional merchant role presets for world profiles that want more consistent shop behavior without a full economy model.
