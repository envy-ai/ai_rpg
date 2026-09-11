# QuestConfirmationManager

## Purpose

`QuestConfirmationManager.js` owns durable, unresolved quest offers. Quest generation records a complete private quest candidate plus a client-safe preview and immediately returns; it does not wait for a browser response. An offer remains pending until one client explicitly accepts or declines it.

The manager is game-scoped rather than connection-scoped. Disconnecting the browser that triggered an offer does not discard it, and any connected client may resolve it. The first valid decision wins.

## Lifecycle

1. `Events.received_quest` generates a plain quest candidate without constructing `Quest`; this avoids registering an unaccepted quest in global quest indexes.
2. `requestConfirmation(...)` stores the candidate and returns its public record synchronously.
3. After ordinary turn event/status rows are recorded, `api.js` appends a `type: "quest-offer"` chat entry and links its chat id with `attachChatEntry(...)`. While-you-were-away event checks do the same immediately, filtering by the exact confirmation ids returned by that event pass so an older unlinked offer cannot be parented to the new arrival entry.
4. All clients receive a global `chat_history_updated` broadcast and render the saved offer inline.
5. `/api/quests/confirm` calls `resolveConfirmation(...)`. Accepting constructs the real `Quest`, adds it to the saved player, and removes the pending record; declining only removes the pending record.
6. The API updates the same chat entry to `accepted` or `declined` and broadcasts the change globally.

Existing quests matched by name are still updated in place and do not produce a new offer.

## Stored Record

Pending records contain:

- `confirmationId`
- `playerId`
- `quest`: the complete serializable candidate, including private fields such as `secretNotes`
- `preview`: the sanitized display payload
- `requestId`, `parentId`, `locationId`, and `chatEntryId`
- `createdAt`

`getPendingConfirmation(...)` and `getPendingConfirmations()` expose only the public record, replacing the private candidate with `preview`. The preview contains quest name/description/summary/giver, objectives, item/currency/XP rewards, faction reputation, NPC disposition deltas, typed benefits, and narrative reward notes. It does not expose secret notes.

## API

- `requestConfirmation({ quest, preview?, playerId, requestId?, parentId?, locationId? })` validates the player and serializable candidate, creates a UUID, stores it, and returns the public record.
- `attachChatEntry(confirmationId, { chatEntryId, parentId?, locationId? })` links the pending record to its durable chat row.
- `hasPending()`, `getPendingConfirmation(id)`, and `getPendingConfirmations()` inspect pending state.
- `resolveConfirmation({ confirmationId, clientId, accepted })` accepts the first boolean decision from any client. A repeated/late answer throws with `code: "QUEST_CONFIRMATION_RESOLVED"`.
- `serializePending()` returns JSON-safe records for save storage.
- `hydratePending(records)` strictly validates saved records and referenced players.
- `rejectAll(reason)` clears runtime records during new-game reset or the pre-load cancellation barrier. The target save's records are hydrated after its players load.
- `rejectAllForClient()` is intentionally a no-op because offers do not belong to a connection.

The legacy `timeoutMs` constructor option is validated for configuration compatibility but does not expire offers. Pending means pending until accept or decline.

## Persistence And Recovery

`Utils.writeSerializedGameState()` writes pending records to `pendingQuestConfirmations.json`; missing files load as an empty array for older saves. After player hydration, `/api/load` hydrates the manager and reconciles every pending record with a pending inline chat entry. The authoritative `/api/chat` pending-offer gate repeats that reconciliation before returning its 409 response, which also repairs runtime records created by an earlier code path that did not append the row. A record with `chatEntryId: null` gets a new row during reconciliation when no matching row already exists. Reconciliation reuses and links an existing matching row, creates only genuinely unlinked rows, and returns the rows it created so callers can broadcast `chat_history_updated`. Duplicate rows, a non-null `chatEntryId` whose row is missing or unrelated, or a pending chat row with no corresponding saved record are treated as corruption and fail loudly.

## Turn Gate

`POST /api/chat` checks the manager before registering or mutating a new turn. Before returning the gate response, it reconciles missing inline rows, globally broadcasts when it created one, and refreshes the public records so every returned offer includes its new `chatEntryId`. If any offer remains pending it returns HTTP 409 with:

```json
{
  "error": "Accept or decline the pending quest offer before taking the next turn.",
  "code": "QUEST_CONFIRMATION_REQUIRED",
  "pendingQuestConfirmations": []
}
```

The client performs the same check from loaded chat history for immediate feedback, but the server check is authoritative across tabs and clients.
