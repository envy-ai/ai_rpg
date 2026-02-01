# Lorebooks API

## GET /api/lorebooks
List all lorebooks with metadata.

Response:
- 200: `{ success: true, lorebooks }`
  - `lorebooks` entries: `{ filename, name, entryCount, tokenEstimate, enabled }`
- 503/500 with `{ success: false, error }`

## GET /api/lorebooks/:filename
Fetch a lorebook with entries.

Response:
- 200: `{ success: true, lorebook }`
  - `lorebook` fields: `filename`, `name`, `entryCount`, `tokenEstimate`, `enabled`, `entries`
  - `entries` elements: `{ uid, key, content, comment, enabled, constant, priority, insertion_order }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/:filename/enable
Enable a lorebook.

Response:
- 200: `{ success: true, message, activeEntries }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/:filename/disable
Disable a lorebook.

Response:
- 200: `{ success: true, message, activeEntries }`
- 503/500 with `{ success: false, error }`

## DELETE /api/lorebooks/:filename
Delete a lorebook.

Response:
- 200: `{ success: true, message }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/upload
Upload a new lorebook.

Request:
- Body: `{ filename: string, content: string }`

Response:
- 200: `{ success: true, message, entryCount }`
- 400/503 with `{ success: false, error }`
