# Visible Weather and Lighting Location Image Variants

This is a finished/archive design note for the visible weather and lighting image-variant feature. It preserves the original v1 intent and summarizes the current implemented behavior as of the live code.

For live reference details, use:

- `docs/api/images.md` for `/api/images/location-variant/request` and image job behavior.
- `docs/config.md` for `imagegen.location_variant_settings`.
- `docs/classes/Location.md` and `docs/classes/ComfyUIClient.md` for persistence and ComfyUI integration.
- `docs/ui/chat_interface.md` for Adventure UI display behavior.

## Original design intent

- Show location art that reflects current world-time lighting and regional weather.
- Avoid an extra LLM prompt by building the edit prompt deterministically from existing game state.
- Keep the base `location.imageId` authoritative while using variants as display-only cached images.
- Limit v1 to ComfyUI image-to-image workflows.

These design constraints still match the implemented feature.

## Current implemented behavior

When the Adventure location image renders and image generation is enabled, the client requests the current weather/lighting variant for the current location if a base `location.imageId` exists. The request goes to `POST /api/images/location-variant/request`; the server resolves the authoritative source image from `location.imageId`, not from a client-submitted source image.

The visible image behavior is display-only:

- If no client-side display variant is cached, the base image renders first.
- During ordinary UI refreshes, a session display cache keyed by `locationId + sourceImageId` keeps the last valid variant visible while the server confirms the current condition key. This avoids flashing back to the base image on every refresh.
- A server cache hit returns the variant `imageId` immediately.
- A cache miss queues a ComfyUI img2img job, and realtime `image_job_update` handling swaps the visible location image and Adventure background when the job completes.
- Vehicle current-location picture-in-picture images use the same display-variant cache and request path.

Variants never replace `location.imageId`; regenerate, upload, and edit controls keep targeting the base image even when the visible image/background is a variant. Stored server-side cache keys include the current base image id, normalized lighting, and normalized weather. Changing the base image naturally misses old cache entries, and visual location edits clear the stored variants.

## Conditions and prompts

The server resolves variant conditions from `Globals.getWorldTimeContext()`, the location weather-exposure hint, and the containing region's current weather.

- Variant key parts are lowercase punctuation-stripped slugs.
- The full variant key is `sourceImageId__lightingKey__weatherKey`.
- `generationHints.hasWeather` values of `yes`, `no`, `outside`, or `null` drive exposure behavior.
- Sheltered/no-local-weather locations still receive lighting variants, but the prompt omits weather and uses the `sheltered` weather key.
- `outside` locations use regional weather while labeling it as exterior weather in the deterministic edit prompt.

The edit prompt is rendered locally from `templates/location-weather-variant-image-prompt.njk`; no LLM prompt-writing call is made for this endpoint. The current template asks for the lighting and, when applicable, weather or weather-outside change. The job also supplies a negative prompt that discourages new people, text/logos/signage, changed architecture, changed camera angle, distorted landmarks, and low quality output.

## Persistence and job flow

`Location` persists an `imageVariants` object keyed by variant key. Entries include:

- `variantKey`
- `sourceImageId`
- `imageId`
- `jobId`
- `conditions`
- `prompt`
- `createdAt`
- `updatedAt`
- `completedAt`

Missing legacy saves hydrate with an empty variant cache. `Location` exposes `getImageVariant(...)`, `setImageVariant(...)`, `removeImageVariant(...)`, and `clearImageVariants(...)` for this map.

Variant jobs are ComfyUI-only:

- Non-ComfyUI image engines skip requests with `reason: "unsupported-engine"`.
- Historical note: the original implementation selected the workflow through `imagegen.location_variant_settings.api_template`. The current implementation uses the effective `imagegen.workflow.edit` profile and removes the retired location-variant block on configuration save.
- `ComfyUIClient.uploadInputImage(...)` uploads the source image into the `airpg-location-variants` ComfyUI input subfolder for img2img workflows.
- The default workflow detects source dimensions and routes the rendered edit prompt to a ComfyUI `Text to Console` node labeled `Final Prompt`.

## Invalidation

Variant caches are cleared when location visual identity changes:

- base location image regeneration,
- location name/description/short-description edits,
- location image upload,
- local weather-exposure hint edits,
- vehicle visual metadata edits,
- location deletion,
- event-driven location image clearing.

If a pending variant job finishes after the base image changed, the job result is discarded and is not attached to the location.

Client-side display caches are also cleared when a location upload replaces the base image.

## Relevant verification

Current focused coverage lives in:

- `tests/server.location_weather_variant_helpers.test.js` for key normalization, sheltered/outside prompt behavior, invalid weather-variant sources, prompt rendering, and stale-job attachment prevention.
- `tests/location.image_variants.test.js` for `Location.imageVariants` persistence and clearing.
- `tests/imagegen_workflow_templates.test.js` for default workflow prompt wiring.
- `tests/location_variant_display_refresh.test.js` for the UI display cache behavior that preserves visible variants across refreshes.
