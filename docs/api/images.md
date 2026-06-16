# Images & Jobs API

Common payloads: see `docs/api/common.md` for shared job and entity shapes.

Image generation is controlled by `config.imagegen`. The configured engine is one of `comfyui`, `nanogpt`, or `openai`. ComfyUI jobs render workflow templates from `imagegen/`; NanoGPT and OpenAI jobs call their HTTP image APIs and save the returned base64 image locally. Saved image files live in `public/generated-images/`, and generated image metadata is stored in the `generatedImages` map that is serialized with game state.

Image jobs use the statuses `queued`, `processing`, `completed`, `failed`, and `timeout`. `imagegen.maxConcurrentJobs` controls concurrent processing. When a request includes `clientId`, the server subscribes that client to `image_job_update` realtime events for the queued or joined job.

For OpenAI and NanoGPT engines, final image prompts include the active setting's `baseContextPreamble` before job execution. ComfyUI prompts do not receive that preamble. Character, location, item, and scenery prompt prefixes from the active setting are applied where the generation path supports them.

## POST /api/images/request
Queue, join, or reuse image generation for a known entity.

Request:
- Body: `{ entityType: 'player'|'npc'|'location'|'exit'|'location-exit'|'location_exit'|'thing'|'item'|'scenery', entityId: string, force?: boolean, clientId?: string }`

Response:
- 200: `{ success, entityType, entityId, jobId?, job?, imageId?, skipped, reason, message, existingJob }`
- 202: same shape when generation is skipped without queueing an image-rendering job
- 409: same shape when generation fails before a usable existing job is available
- 400/404/500 with `{ success: false, error }`

Notes:
- `entityType` is normalized. Player and NPC requests resolve through the player registry and return `entityType: 'player'` or `'npc'` from the target record. `exit`, `location-exit`, and `location_exit` all target a `LocationExit`. `thing`, `item`, and `scenery` target known `Thing` records, and the response type follows the thing's stored type when available.
- If the entity already has a usable image and `force` is false, the response is `success: true`, `skipped: true`, and includes `imageId`.
- `force: true` requests a fresh image and clears the current image reference for the target type while the new job is tracked. For locations, force generation also clears cached weather/lighting variants for the old base image.
- Duplicate requests for the same player/NPC, location, location exit, thing, or location variant join the active prompt-generation or image-rendering work when possible. A joined request returns `existingJob: true` and includes the active `jobId` when an image job exists.
- NPC portrait requests without `force` are limited to NPCs at the current player location or in the current player party.
- Thing image requests can target any known non-null `Thing`; current server eligibility does not require player inventory or current-location ownership.
- Player/NPC, location, item, and scenery image paths use an LLM prompt-writing step before the image job is queued. Prompt generation retries up to `imagegen.prompt_generation_attempts` times, default `3`; empty final prompts, prompt/context XML, and wrapper text are rejected. Exhausted retries return `skipped: true`, `reason: "image-prompt-failed"`, and no image-rendering job.
- LLM-authored image-prompt requests are debounced and batched unless `imagegen.prompt_batching.enabled` is `false`. The queue waits `imagegen.prompt_batching.delay_ms` after the last compatible request and sends up to `imagegen.prompt_batching.max_items` prompt-writing requests per batch. Image-rendering jobs are queued independently after prompt text is available.
- Base location scene prompts are rendered through `templates/location-image-prompt.njk` after the LLM prompt-writing step. The template receives `image.prompt`, the full `location`, `hasLocalWeather`, and `weatherScope`; the default template adds neutral baseline time/weather guidance for the base image.
- Thing image dimensions use `imagegen.default_settings.image`, with optional overrides from `imagegen.item_settings.image` or `imagegen.scenery_settings.image`. Character, location, and exit images use their respective configured settings or defaults.

## POST /api/images/location-variant/request
Queue, join, or reuse the current weather/lighting display variant for a location image.

Request:
- Body: `{ locationId: string, force?: boolean, clientId?: string }`

Response:
- 200: `{ success, locationId, sourceImageId, variantKey, conditions, imageId?, jobId?, job?, skipped, reason?, message?, existingJob }`
- 202: same shape when generation is skipped because the request cannot queue a variant job
- 409: same shape when generation fails before a usable existing job is available
- 400/404/500 with `{ success: false, error }`

Notes:
- The server resolves the source from the authoritative `location.imageId`; clients do not submit a source image id.
- Location variants require `imagegen.engine: 'comfyui'`. Other engines return `skipped: true` with `reason: 'unsupported-engine'`.
- A usable base image is required. Missing base image, missing image metadata/file, or a base image whose metadata source is `location_weather_variant` produces a skipped response.
- The ComfyUI workflow template comes from `imagegen.location_variant_settings.api_template`. Missing or nonexistent templates return skipped responses with template-specific reasons.
- Conditions are derived from world time, the location's weather exposure, and the containing region's weather. The response `conditions` includes `variantKey`, lighting fields, weather fields, date/time labels, season, and weather-scope flags.
- Locations with `generationHints.hasWeather="outside"` use regional weather while labeling it as exterior weather in the deterministic edit prompt.
- Cached variants require the same location, source image id, lighting key, and weather key. A cache hit returns `success: true`, `skipped: true`, and `imageId`.
- `force: true` removes the cached variant for the current conditions, queues a replacement, and leaves the base `location.imageId` unchanged.
- Variant images are display-only. They are stored on the location's image variant map and do not replace the base location image.
- The deterministic edit prompt is rendered locally from `templates/location-weather-variant-image-prompt.njk`; no LLM prompt-writing call is made for this endpoint.
- When a variant job runs, the server logs the final rendered image-edit prompt before rendering/submitting the ComfyUI workflow. The default `flux2_klein_edit.json.njk` workflow also sends the prompt through a `Text to Console` node labeled `Final Prompt`.
- After saving an edited variant image, the server compares source and edited image dimensions and logs a warning when they differ.

## POST /api/images/upload
Upload an image and replace the current image for an entity.

Request:
- Body: `{ entityType: 'location'|'thing'|'item'|'scenery'|'npc'|'player', entityId: string, imageDataUrl: string }`

Response:
- 200: `{ success: true, entityType, entityId, imageId, image, location? | thing? | npc? | player?, message }`
- 400: `{ success: false, error }`

Notes:
- Supported upload MIME types are PNG, JPEG, WebP, and GIF. JPEG accepts `image/jpeg` and `image/jpg`.
- `imageDataUrl` must be a base64 data URL. The server validates the decoded bytes against the declared PNG, JPEG, WebP, or GIF signature. SVG uploads are rejected.
- Uploaded images are stored in `public/generated-images/` with an extension matching the submitted MIME type. Metadata has `source: 'upload'` and records the target entity type/id.
- Location uploads replace the base `location.imageId`, clear pending base-image tracking for that location, and clear cached weather/lighting variants for the replaced base image.
- `thing`, `item`, and `scenery` all resolve to known `Thing` records and return `entityType: 'thing'`. `npc` and `player` resolve through the character registry and validate that NPC uploads do not target the player and player uploads do not target NPCs.

## POST /api/generate-image
Custom image generation endpoint for arbitrary prompts.

Request:
- Body: `{ prompt: string, width?, height?, seed?, negative_prompt?, async?: boolean, clientId?: string }`

Response:
- 200 (async, default): `{ success: true, jobId, status, message, estimatedTime }`
- 200 (`async=false` compatibility mode): `{ success: true, imageId, images, metadata, processingTime }`
- 400: `{ success: false, error }`
- 503: `{ success: false, error }` when image generation is disabled or no image client is initialized
- 500: `{ success: false, error }`

Notes:
- This endpoint uses the same job queue and image processor as entity image requests but does not attach the result to an entity.
- `prompt` is required, trimmed, and limited to 1000 characters.
- Width and height default to `imagegen.default_settings.image` values and must resolve within `64..4096`.
- Seed defaults to a random integer up to `1000000`; values outside `0..1000000` are rejected.
- `negative_prompt` defaults to `blurry, low quality, distorted` when omitted.
- For OpenAI and NanoGPT engines, the submitted prompt receives the active setting's `baseContextPreamble` before job execution. ComfyUI skips that preamble.
- `async: false` waits for the queued job to complete and returns the generated image data in the HTTP response.

## GET /api/jobs/:jobId
Fetch image job status.

Response:
- 200: `{ success: true, job, result?, error? }`
- 404: `{ success: false, error }`

Notes:
- `job` includes `id`, `status`, `progress`, `message`, `createdAt`, `startedAt`, and `completedAt`.
- Completed jobs include `{ imageId, images, metadata }` in `result`.
- Failed and timed-out jobs include `error`.

## DELETE /api/jobs/:jobId
Cancel an image job.

Response:
- 200: `{ success: true, message }`
- 400: `{ success: false, error }` when the job is already completed, failed, or timed out
- 404: `{ success: false, error }`

Notes:
- Queued jobs are removed from `jobQueue`.
- The endpoint marks the job as `failed`, sets `error: 'Job cancelled by user'`, and records `completedAt`. It does not call a backend-specific cancellation API.

## GET /api/jobs
List tracked image jobs.

Response:
- 200: `{ success: true, jobs: JobSummary[], queue: { pending, processing } }`

Notes:
- Jobs are sorted newest first.
- Each summary includes a prompt preview truncated to 50 characters.
- `queue.pending` is the current queue length. `queue.processing` is `1` when at least one image job is processing and `0` otherwise.

## GET /api/images/:imageId
Fetch generated image metadata.

Response:
- 200: `{ success: true, metadata }`
- 404: `{ success: false, error }`

Notes:
- Image ids containing path separators or path traversal are rejected by lookup normalization.
- If metadata is missing but a matching file exists in `public/generated-images/` with a known image extension, the server reconstructs minimal metadata from the file before responding.

## GET /api/images/:imageId/file
Serve a generated image without requiring the client to know the stored file extension.

Response:
- 200: image bytes via `res.sendFile(...)`
- 404: `{ success: false, error }`

Notes:
- The route resolves saved image metadata first, then scans `public/generated-images/` for `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`.
- Public UI image rendering uses this route for `imageId` references.

## GET /api/images
List generated image metadata currently tracked by the server.

Response:
- 200: `{ success: true, images, count }`

Notes:
- This route returns the current `generatedImages` map contents; it does not scan `public/generated-images/` for untracked files.
