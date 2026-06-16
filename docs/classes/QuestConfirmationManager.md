# QuestConfirmationManager

## Purpose

`QuestConfirmationManager.js` coordinates the blocking confirmation step for generated quest offers. It owns pending server-side promises keyed by a UUID `confirmationId`, sends a sanitized `quest_confirmation_request` websocket event to the active chat client's `clientId`, and resolves the event pipeline after `/api/quests/confirm` receives an accept or decline response.

The manager does not persist quests, grant rewards, or edit quest state. `Events.received_quest` generates the quest, asks this manager for a decision, and calls `player.addQuest(quest)` only after acceptance.

## Runtime Wiring

- `server.js` creates one manager instance during startup.
- `timeoutMs` is read from `config.quests.confirmationTimeoutMs`; missing, non-finite, zero, or negative values disable confirmation timeouts in the server wiring.
- `Events.initialize(...)` receives `confirmQuestWithPlayer`, which delegates to `questConfirmationManager.requestConfirmation(...)`.
- The `received_quest` event handler uses the manager only for generated quest offers that do not already match an existing player quest by name. Existing matching quests are refreshed in place by the event handler without a confirmation modal.
- A quest offer requires `context.stream.clientId`; without an active client id, the event handler throws.
- Delivery goes through `Globals.emitToClient(clientId, 'quest_confirmation_request', ...)`, so `RealtimeHub` sends the request to every open socket registered under that `clientId`.

## Construction

- `new QuestConfirmationManager({ timeoutMs = null } = {})`
  - Accepts `null`, `undefined`, or `0` as no timeout.
  - Requires finite, non-negative numeric timeout values.
  - Initializes `pending` as a `Map` of `confirmationId -> { resolve, reject, timeout, clientId }`.

## Instance API

- `requestConfirmation({ clientId, quest, requestId })`:
  - Trims and validates `clientId`.
  - Normalizes the quest into a client-safe preview payload.
  - Creates a UUID `confirmationId`.
  - Stores the pending promise before emitting to the client.
  - Emits `quest_confirmation_request` with `{ confirmationId, quest }`; `requestId` is passed through the `Globals.emitToClient` options so the websocket envelope can carry it.
  - Resolves to `true` or `false` when `resolveConfirmation(...)` runs.
  - Rejects when the quest payload is missing, the client id is invalid, the request cannot be delivered, or the optional timeout expires.

- `resolveConfirmation({ confirmationId, clientId, accepted })`:
  - Trims and validates `confirmationId` and `clientId`.
  - Requires an existing pending request for the id.
  - Requires the response `clientId` to match the original request's `clientId`.
  - Clears the timeout, resolves the stored promise with `Boolean(accepted)`, removes the pending entry, and returns `{ accepted: Boolean(accepted) }`.

- `rejectAllForClient(clientId, reason = 'Client disconnected')`:
  - Trims the client id and ignores empty values.
  - Rejects every pending request for that client with `Error(reason)`.
  - Clears each pending timeout before deleting the entry.
  - The current server wiring does not call this helper from `RealtimeHub` socket close events.

## Confirmation Payload

`#normalizeQuestPayload(quest)` returns `null` unless `quest` is an object. String fields are trimmed; non-string values become empty strings.

Emitted quest preview fields:

- `id`
- `name`
- `description`
- `summary`
- `giver`
- `objectives`: array of `{ description, optional }` entries with non-empty descriptions.
- `rewardCurrency`: finite numeric value from `quest.rewardCurrency`, otherwise `0`.
- `rewardXp`: finite numeric value from `quest.rewardXp`, otherwise `0`.
- `rewardItems`: strings become `{ name }`; object entries use `name`, `description`, or `label`; finite quantities are rounded to whole numbers, forced to at least `1`, and omitted when the value is `1`.
- `rewardNpcDispositions`: array of `{ npcName, dispositions }`, where each disposition includes `{ type, intensity, reason }`; intensity must be a non-zero integer and `reason` is `null` when omitted.

Fields not emitted by this manager include `secretNotes`, `rewardClaimed`, `paused`, `completed`, full giver objects, and `rewardFactionReputation`. The chat client can render faction reward previews if they are present in a confirmation payload, but the manager's normalized websocket payload does not include faction reputation entries.

## API And UI Flow

- `public/js/chat.js` handles `quest_confirmation_request` in `AIRPGChat.handleQuestConfirmationRequest(...)`.
- The chat client normalizes the incoming payload again, queues requests per browser tab, and presents one runtime-only modal at a time.
- The modal renders giver, summary, description, objectives, item/currency/XP rewards, faction rewards if present, and NPC disposition rewards.
- Accept and Decline buttons post to `/api/quests/confirm`; pressing `Escape` submits a decline when the modal is visible and idle.
- The POST body includes `confirmationId`, the browser's `clientId`, and a decision string of `accept` or `decline`.
- `/api/quests/confirm` also accepts `accepted` as a boolean and legacy-style `accept` strings.
- Successful API resolution closes the modal, advances the local confirmation queue, and calls `window.refreshQuestPanel?.()`.
- API errors leave the modal open and display the error text.

## Error Behavior

- Invalid constructor timeout values throw.
- Invalid request inputs throw before any websocket emission.
- A false return from `Globals.emitToClient(...)` rejects the pending promise with `Unable to deliver quest confirmation request to client.`
- Unknown, already-resolved, or mismatched confirmation responses throw from `resolveConfirmation(...)`; `/api/quests/confirm` translates those errors to `400` JSON responses.
- Timeout rejection removes the pending entry before rejecting the promise.
