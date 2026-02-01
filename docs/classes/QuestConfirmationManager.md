# QuestConfirmationManager

## Purpose
Manages async quest confirmation prompts and responses per client. Emits requests through `Globals.emitToClient` and resolves or rejects pending promises.

## Construction
- `new QuestConfirmationManager({ timeoutMs })`: sets a global timeout (null or 0 disables). Initializes `pending` map.

## Instance API
- `requestConfirmation({ clientId, quest, requestId })`:
  - Validates inputs, normalizes quest payload, emits `quest_confirmation_request`.
  - Returns a Promise that resolves to `true/false` on acceptance or rejects on timeout or delivery failure.
- `resolveConfirmation({ confirmationId, clientId, accepted })`:
  - Validates the pending request and resolves it, clearing timers.
- `rejectAllForClient(clientId, reason)`: rejects all pending confirmations for a client (e.g. disconnect).

## Private Helpers
- `#normalizeQuestPayload(quest)`: sanitizes quest fields into a safe, minimal payload for the client.

## Notes
- The manager stores pending confirmations as `{ resolve, reject, timeout, clientId }` keyed by a UUID.
- Errors are explicit and descriptive to surface mismatches early.
