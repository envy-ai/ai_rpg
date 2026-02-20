# Quest API

Common payloads: see `docs/api/common.md`.

## POST /api/quests/confirm
Resolve a quest confirmation prompt.

Request:
- Body:
  - `confirmationId` (string, required)
  - `clientId` (string, required)
  - decision (one of):
    - `accepted` (boolean)
    - `decision` (string: accept/decline, yes/no, true/false)
    - `accept` (string: true/false/yes/no)

Response:
- 200: `{ success: true, accepted: boolean }`
- 400: `{ success: false, error }`
- 503: `{ success: false, error }` (confirmation service unavailable)

## POST /api/quest/edit
Edit a quest on the current player.

Request:
- Body:
  - `questId` (required)
  - Optional: `name`, `description`, `secretNotes`, `rewardCurrency`, `rewardXp`, `rewardItems`, `rewardFactionReputation`, `objectives`, `rewardClaimed`, `paused`, `giverName`
  - `rewardFactionReputation` accepts:
    - object map (`{ factionIdOrName: integerDelta }`)
    - array entries (`{ factionId|faction|name, amount|delta|points|value }`)
    - formatted string lines (`Faction Name or ID: +/-points`)
  - reputation deltas must be integers and may be negative.
  - `objectives` entries must include `{ description }` and may include `id`, `completed`, `optional`

Response:
- 200: `{ success: true, quest: Quest, player: NpcProfile }`
- 400/404 with `{ success: false, error }`

## DELETE /api/player/quests/:questId
Remove a quest from the current player.

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404 with `{ success: false, error }`
