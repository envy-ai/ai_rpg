# Mystery Threads API

Browser-facing endpoints for persisted private `MysteryThread` continuity records.

## GET /api/mystery-threads

Lists mystery threads as lightweight summaries, alphabetized by name. Optional `query` filters by thread phrase.

Response:
- 200: `{ success: true, mysteryThreads, count, maxActive }`
- Each summary includes `id`, `name`, `status`, `keys`, `summary`, `constraints`, `boxIds`, `boxes` as lightweight box summaries, `boxCount`, `createdAt`, and `updatedAt`.

## GET /api/mystery-threads/:id

Returns one full mystery thread by exact id or key.

Response:
- 200: `{ success: true, mysteryThread }`
- 400 when `id` is blank
- 404 when no thread exists

`mysteryThread.boxes` contains full mystery-box payloads with private text and mention history.

## PUT /api/mystery-threads/:id

Updates one existing mystery thread for Story Tools editing.

Request:
- Body: `{ name: string, status: "active"|"inactive"|"concluded", keys?: string[] | string, summary?: string, constraints?: string[] | string }`
- Activating an inactive/concluded thread is rejected when `mystery_threads.max_active` is already full.

Response:
- 200: `{ success: true, mysteryThread, persisted }`
- 400 for invalid input or active-cap violations
- 404 when no thread exists

## PUT /api/mystery-threads/:id/boxes

Replaces the selected thread's contained box ids in exact order.

Request:
- Body: `{ boxIds: string[] }`
- Every box id must already exist.
- Assigned box ids are removed from other threads so a box has one visible parent thread in Story Tools.

Response:
- 200: `{ success: true, mysteryThread, persisted }`
- 400 for invalid ids
- 404 when no thread exists

`persisted` is `true` when a loaded save directory was available and the route rewrote `mysteryBoxes.json`, `mysteryThreads.json`, and `metadata.json`; otherwise runtime state is updated and the next normal save persists it.
