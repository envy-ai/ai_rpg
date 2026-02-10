# Images & Jobs API

Common payloads: see `docs/api/common.md` (Job shapes).

## POST /api/images/request
Unified image generation entry point.

Request:
- Body: `{ entityType: 'player'|'npc'|'location'|'exit'|'location-exit'|'thing'|'item'|'scenery', entityId: string, force?: boolean, clientId?: string }`

Response:
- 200: `{ success, entityType, entityId, jobId?, job?, imageId?, skipped, reason, message, existingJob }`
- 202: same payload when `skipped` is true
- 409: same payload when generation failed and no existing job
- 400/404/500 with `{ success: false, error }`

Notes:
- If an existing job is found, the endpoint returns 200 with `success: false` and `existingJob: true`.
- The final image-generation prompt is automatically prepended with the active setting's `baseContextPreamble` before job execution.

## POST /api/generate-image
Legacy custom image generation endpoint.

Request:
- Body: `{ prompt: string, width?, height?, seed?, negative_prompt?, async?: boolean, clientId?: string }`

Response:
- 200 (async, default): `{ success: true, jobId, status, message, estimatedTime }`
- 200 (sync, legacy mode when `async=false`): `{ success: true, imageId, images, metadata, processingTime }`
- 400/500 with `{ success: false, error }`

Notes:
- The sync mode is explicitly marked as legacy in code.
- The submitted prompt is automatically prepended with the active setting's `baseContextPreamble` before job execution.

## GET /api/jobs/:jobId
Fetch job status.

Response:
- 200: `{ success: true, job, result?, error? }`
- 404: `{ success: false, error }`

## DELETE /api/jobs/:jobId
Cancel a job.

Response:
- 200: `{ success: true, message }`
- 400: `{ success: false, error }` (job already completed/failed)
- 404: `{ success: false, error }`

## GET /api/jobs
List all jobs.

Response:
- 200: `{ success: true, jobs: JobSummary[], queue: { pending, processing } }`

## GET /api/images/:imageId
Fetch image metadata.

Response:
- 200: `{ success: true, metadata }`
- 404: `{ success: false, error }`

## GET /api/images
List all generated images.

Response:
- 200: `{ success: true, images, count }`
