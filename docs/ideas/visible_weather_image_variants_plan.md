# Visible Weather and Lighting Location Image Variants

This plan covers the implemented v1 approach for generating visible weather and lighting variants of location images.

## Goals

- Show location art that reflects current world-time lighting and regional weather.
- Avoid an extra LLM prompt by building the edit prompt deterministically from existing game state.
- Keep the base `location.imageId` authoritative while using variants as display-only cached images.
- Limit v1 to ComfyUI image-to-image workflows.

## Behavior

When the Adventure location image renders and a base location image exists, the client requests a weather/lighting variant for the current location. The base image is shown immediately. If the server already has a cached variant for the current base image and condition key, the client swaps the visible image and Adventure background to that variant. If no cached variant exists, the server queues a ComfyUI img2img job and the client swaps to the variant when the realtime image job completes.

Variants never replace `location.imageId`; regenerate/edit actions still operate on the base location image. The cache key includes the current base image id, normalized lighting, and normalized weather. Changing the base image naturally misses old cache entries, and visual location edits clear the cached variants.

Sheltered locations still receive lighting variants, but the generated prompt omits outdoor weather effects and uses the `sheltered` weather key.

## Implementation

- `Location` persists an `imageVariants` object keyed by variant key.
  - Entries include `sourceImageId`, `imageId`, `jobId`, `conditions`, `prompt`, and timestamps.
  - Missing legacy saves hydrate with an empty cache.
- The server resolves variant conditions from `Globals.getWorldTimeContext(...)` and the existing region weather resolver.
  - Keys are lowercase punctuation-stripped slugs.
  - The full variant key is `sourceImageId__lightingKey__weatherKey`.
- The server builds a deterministic edit prompt that tells ComfyUI to preserve geography, composition, camera angle, architecture, objects, and style while changing only atmosphere, lighting, sky, precipitation, fog, wetness, or similar weather cues.
- `ComfyUIClient.uploadInputImage(...)` uploads the source image to ComfyUI's input directory for img2img workflows.
- `imagegen.location_variant_settings.api_template` selects the variant workflow. The default template is `imagegen/flux2_klein_edit.json.njk`.
- `POST /api/images/location-variant/request` resolves conditions server-side and queues or returns the display variant.

## Invalidation

Variant caches are cleared when location visual identity changes:

- base location image regeneration,
- location name/description/short-description edits,
- vehicle visual metadata edits,
- location deletion,
- event-driven location image clearing.

If a pending variant job finishes after the base image changed, the job result is discarded and is not attached to the location.

## Validation

Focused coverage should include:

- variant key normalization,
- sheltered-location weather omission,
- `Location.imageVariants` save/load behavior,
- source-image mismatch/stale-job attachment prevention,
- endpoint cache-hit, queue, and skipped responses,
- client behavior showing the base image first and swapping only the visible display image.
