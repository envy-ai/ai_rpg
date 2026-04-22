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
- When the active image backend is OpenAI or NanoGPT, the final image-generation prompt is automatically prepended with the active setting's `baseContextPreamble` before job execution. ComfyUI skips that preamble.
- Item and scenery jobs use `imagegen.default_settings.image` by default, with optional per-type width/height overrides from `imagegen.item_settings.image` and `imagegen.scenery_settings.image`.
- Thing/item image generation remains visibility-gated: non-forced requests run only when the item is in the player inventory, at the player's current location, or at the outside location of the player's current vehicle.
- Concurrent base location-image requests for the same location are coalesced while the server is still generating the LLM image prompt and before the image job id exists. Later callers receive the same job id and are subscribed to the same realtime image job.
- Base location scene prompts are post-processed through `templates/location-image-prompt.njk` after the LLM image-prompt pass and before job queueing. The template receives `image.prompt`, the whole `location` object, `hasLocalWeather`, and `weatherScope`; the default template appends a neutral baseline `Time: noon` line and appends `Weather: clear` or `Weather outside: clear` only when weather should be visible for that location.

## POST /api/images/location-variant/request
Request the current weather/lighting display variant for a location image.

Request:
- Body: `{ locationId: string, force?: boolean, clientId?: string }`

Response:
- 200: `{ success, locationId, sourceImageId, variantKey, conditions, imageId?, jobId?, job?, skipped, reason?, message?, existingJob }`
- 202: same payload when the request was skipped because generation is disabled, unavailable, or there is no usable source image
- 409: same payload when generation could not proceed and no existing job is available
- 400/404/500 with `{ success: false, error }`

Notes:
- The server resolves lighting and weather from world time, location weather exposure, and the current region; clients do not submit arbitrary condition text.
- Locations with `generationHints.hasWeather="outside"` still resolve regional weather, but the deterministic edit prompt labels it as `Weather outside:` so the edit should show exterior conditions without implying direct indoor precipitation.
- V1 is ComfyUI-only. Other image engines return a skipped response with `reason: 'unsupported-engine'`.
- Missing or nonexistent `imagegen.location_variant_settings.api_template` returns a skipped response with an explicit template-related `reason`.
- Variants are display-only generated images. They do not replace `location.imageId`.
- Cached variants require the same location, current source image id, and normalized lighting/weather key.
- The server always resolves the edit source from the authoritative base `location.imageId`; clients do not submit a source image id. If `location.imageId` ever points at an existing weather/lighting variant, the request is skipped with `reason: 'source-image-is-weather-variant'` rather than using an already-edited image as the new source.
- `force: true` regenerates the current variant and leaves the base location image unchanged.
- The deterministic edit prompt is rendered locally from `templates/location-weather-variant-image-prompt.njk`; no LLM call is made for this prompt.
- When a variant generation job actually runs, the server logs the final rendered image-edit prompt to the app console before rendering/submitting the ComfyUI workflow. The default `flux2_klein_edit.json.njk` workflow also sends that same rendered prompt through a `Text to Console` node labeled `Final Prompt`, so it appears in the ComfyUI console during execution.
- After an edited variant image is saved, the server inspects the source and edited image files and prints a console warning if the edited dimensions differ from the source dimensions.

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
- When the active image backend is OpenAI or NanoGPT, the submitted prompt is automatically prepended with the active setting's `baseContextPreamble` before job execution. ComfyUI skips that preamble.

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

Notes:
- If metadata is missing but a matching file exists in `public/generated-images/` with a known image extension, the server reconstructs minimal metadata from the file before responding.

## GET /api/images/:imageId/file
Serve a generated image without requiring the client to know the stored file extension.

Response:
- 200: image bytes via `res.sendFile(...)`
- 404: `{ success: false, error }`

Notes:
- The route resolves saved image metadata first, then scans `public/generated-images/` for known extensions (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`).
- Client image rendering uses this route for existing `imageId` references so WebP images continue to display after reload.

## GET /api/images
List all generated images.

Response:
- 200: `{ success: true, images, count }`
