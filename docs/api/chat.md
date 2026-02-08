# Chat API

Entries are sorted by path. Common payloads (ChatEntry, ActionResolution, etc.) are defined in `docs/api/common.md`.

## POST /api/chat
Primary turn-resolution endpoint.

Request:
- Body:
  - `messages` (required): array of chat messages; at minimum the last entry should be `{ role, content }`.
  - `clientId` (optional string): enables realtime streaming events.
  - `requestId` (optional string): echoed back in `streamMeta` and chat metadata.
  - `travel` (optional boolean): marks the user message as a travel action.
  - `travelMetadata` (optional object): required for event-driven travel; normalized to:
    - `mode` (string | null)
    - `eventDriven` (boolean)
    - `exit` object:
      - `originLocationId` (string, required)
      - `destinationId` (string, required)
      - `exitId` (string | null)
      - `direction` (string | null)
      - `destinationRegionId` (string | null)
      - `destinationIsStub` (boolean)
      - `destinationIsRegionEntryStub` (boolean)
      - `isVehicle` (boolean)
      - `vehicleType` (string | null)
      - `destinationName` (string | null)
      - `regionName` (string | null)

Response (200):
- Base fields:
  - `response`: string (final prose)
  - `messages`: ChatEntry[] (new entries appended this request)
- Optional fields (present when relevant):
  - `summary`: string
  - `aiUsage`: object (token usage metrics)
  - `slopRemoval`: `{ slopWords: string[], slopNgrams: string[] }`
  - `debug`: object (debug payload, when enabled)
  - `actionResolution`: ActionResolution
  - `attackCheck`: object (attack roll details)
  - `attackSummary`: string
  - `attackDamage`: object
  - `plausibility`: `{ type, reason }`
  - `eventChecks`: string (HTML summary)
  - `eventChecksOrigin`, `eventChecksDestination`: string (HTML summaries when travel prose is split)
  - `events`: object | array
  - `eventsOrigin`, `eventsDestination`: object | array (structured events when travel prose is split)
  - `experienceAwards`, `currencyChanges`, `environmentalDamageEvents`, `needBarChanges`: arrays
  - `questsAwarded`, `questRewards`, `questObjectivesCompleted`, `followupEventChecks`: arrays
  - `npcTurns`: array (NPC turn payloads)
  - `npcUpdates`: `{ added: string[], departed: string[], movedLocations: string[] }`
  - `locationRefreshRequested`: boolean
  - `corpseRemovals`, `corpseCountdownUpdates`: arrays
  - `worldTime`: object
    - `dayIndex`: number
    - `timeHours`: number (decimal hours, internal canonical value)
    - `timeLabel`: string (`HH:MM`)
    - `dateLabel`: string
    - `segment`: string
    - `season`: string
    - `seasonDescription`: string | null
    - `holiday`: object | null
      - `name`: string
      - `description`: string | null
      - `month`: string
      - `day`: number
    - `holidayName`: string | null
    - `holidayDescription`: string | null
    - `lighting`: string
    - `transitions`: array (optional; `segment`/`season` changes for the resolved turn)
  - `timeProgress`: object (optional; raw advancement result from `time_passed` handling)
  - `requestId`: string (when supplied)
  - `streamMeta`: object (streaming metadata when realtime is enabled)
  - `commentLogged`: boolean (comment-only actions)

Variants:
- Comment-only action: if the user message begins with `#`, the response is `{ response: '', commentLogged: true, messages: [...] }` (no turn resolution).
- Forced-event action: user message begins with `!!`; creative action begins with `!`. These alter processing but do not change the base response shape.
- When realtime streaming is enabled, the final response may omit `eventChecks`, `events`, and other event artifacts (they are stripped for streaming clients).
- When travel prose is returned, event checks are split into origin/destination; the response includes `eventChecksOrigin`/`eventsOrigin` and `eventChecksDestination`/`eventsDestination`.
- For `<travelProse>` turns, origin/destination event-check passes allow `item_appear` and `scenery_appear` outcomes to be applied even after movement is marked processed.
- If the travel prose destination does not match a known location, the server creates a stub destination (and exit) using the event-driven location creation flow.
- Supplemental story info prompts append `supplemental-story-info` entries linked to the main turn entry; these are stored server-side for base-context prompts and are not sent to clients. They run asynchronously after turn resolution and do not block the response. Frequency is controlled by `supplemental_story_info_prompt_frequency` (`0` disables, `>0` runs every X turns) and prompts also run on turns where new NPCs or things were generated. Only one supplemental story info prompt runs at a time; additional requests are skipped while one is in flight.
- Offscreen NPC activity prompts also append hidden server-side entries (`offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`) linked to the main turn entry:
  - Twice daily when world time crosses `07:00` or `19:00`, requesting `offscreen_npc_activity_prompt_count` non-present NPC updates since last mention.
  - Weekly when world time crosses the weekly checkpoint (`dayIndex % 7 == 0` at `07:00`), requesting 15 non-present NPC updates over the past week, excluding names already surfaced by twice-daily prompts during that week.
  - If elapsed time crosses multiple offscreen checkpoints in one turn, only one offscreen NPC activity prompt runs for that turn.
  - When an offscreen entry marks an NPC as moved (`<moved>true</moved>`), the server attempts to update that NPC's `currentLocation` and location NPC lists using the reported region/location, and logs the result server-side only (no client-facing movement notification).

Errors:
- 400: `{ error: string, requestId?, streamMeta? }` (missing `messages`, invalid `travelMetadata`, etc.)
- 408: `{ error: string, requestId?, streamMeta? }` (timeout)
- 503: `{ error: string, requestId?, streamMeta? }` (connection issues)
- 500: `{ error: string, requestId?, streamMeta? }`

## GET /api/chat/history
Returns pruned chat history (system entries and some summaries filtered).

Response (200):
- `{ history: ChatEntry[], count: number, worldTime: object }` (no `success` flag)

## DELETE /api/chat/history
Clears chat history.

Response (200):
- `{ message: 'Chat history cleared', count: 0 }` (no `success` flag)

## PUT /api/chat/message
Edits a single chat entry by id or timestamp.

Request:
- Body: `{ content: string, id?: string, timestamp?: string }` (must include `content` and either `id` or `timestamp`)

Response:
- 200: `{ success: true, entry }`
- 400: `{ success: false, error }` (missing content/id)
- 404: `{ success: false, error: 'Message not found' }`

Notes:
- Editing an `event-summary` entry clears `summaryItems` and normalizes `summaryTitle`.

## DELETE /api/chat/message
Deletes a chat entry by id or timestamp and removes orphaned children.

Request:
- Body: `{ id?: string, timestamp?: string }`

Response:
- 200: `{ success: true, removed: ChatEntry, orphaned: ChatEntry[] }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error: 'Message not found' }`
