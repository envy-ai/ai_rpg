# ComfyUIClient

## Purpose

`ComfyUIClient` is the HTTP/file client for a ComfyUI image-generation server. It queues API-format workflows, polls prompt history, downloads output images, uploads source images for img2img workflows, and writes downloaded image bytes to disk.

The class does not generate final image prompts, manage the project image-job queue, assign images to entities, or persist generated-image metadata. Those responsibilities live in `server.js`.

## Configuration

- `new ComfyUIClient(config)` reads `config.imagegen.server.host` and `config.imagegen.server.port`.
- The base URL is `http://<host>:<port>`.
- The instance timeout is `30000` ms. Server-side job processing wraps client calls in its own retry helper.
- ComfyUI is selected when `imagegen.engine` is `comfyui` or omitted. NanoGPT and OpenAI use separate client classes, even though the server stores the active image client in the `comfyUIClient` variable.
- Server startup constructs this client from `initializeImageEngine()` and performs its own `GET /queue` connectivity check. If construction succeeds but the connectivity check fails, startup logs a warning and image jobs can still use the client if ComfyUI becomes reachable later.

## Instance API

| Method | Behavior |
| --- | --- |
| `generatePromptId()` | Returns a UUID for a ComfyUI prompt id. |
| `queuePrompt(workflow, promptId = null)` | POSTs `{ prompt, client_id, prompt_id }` to `/prompt`. `client_id` is a UUID generated for the request. Returns `{ success: true, promptId, data }` or `{ success: false, error, promptId }`. |
| `getHistory(promptId)` | GETs `/history/:promptId`, reads `response.data[promptId]`, and returns `{ success: true, promptId, data, isComplete }`. Missing history or request errors return `{ success: false, error, promptId }`. |
| `waitForCompletion(promptId, maxWaitTime = 300000, pollInterval = 2000)` | Polls `getHistory()` until `history.outputs` contains at least one output node or the timeout expires. It extracts ComfyUI image records as `{ filename, subfolder, type, nodeId }`. |
| `getImage(filename, subfolder = '', folderType = 'output')` | GETs `/view` with `filename`, `subfolder`, and `type`, then returns a `Buffer`. Request failures are thrown. |
| `uploadInputImage(filePath, options = {})` | Uploads a local file to `/upload/image` for ComfyUI input workflows and returns `{ success, name, subfolder, type, imageReference, data }`. `imageReference` is the path string used by `LoadImage` nodes. |
| `saveImage(imageData, imageId, originalFilename, saveDirectory)` | Creates `saveDirectory` when needed, writes `<imageId><original extension>`, and returns `{ success, filename, filepath, size }` or `{ success: false, error }`. |
| `testConnection()` | Attempts `GET /queue` and returns a boolean. This helper references `baseTimeoutMilliseconds` instead of `this.timeout`; server startup uses its own connectivity check instead of this method. |
| `sleep(ms)` | Promise-based delay helper. |

## Upload Behavior

`uploadInputImage()` validates that the source path is a non-empty string, the file exists, and the runtime provides `FormData` and `Blob`. It chooses a MIME type from the uploaded filename extension: JPEG for `.jpg`/`.jpeg`, WebP for `.webp`, GIF for `.gif`, and PNG for everything else.

The location weather/lighting variant path in `server.js` uses this method with:

- `subfolder: "airpg-location-variants"`
- `type: "input"`
- `overwrite: true`
- a filename based on the source image id and source file extension

The returned `imageReference` is passed into ComfyUI workflow templates as `image.sourceFilename`.

## Server Integration

For ComfyUI jobs, `server.js` renders a workflow template from `imagegen/`, submits it through `queuePrompt()`, waits through `waitForCompletion()`, downloads each returned image through `getImage()`, and saves files through `saveImage()` under `public/generated-images/`.

The same job processor handles:

- Player and NPC portraits.
- Location scene images.
- Location-exit passage images.
- Item and scenery images.
- Custom `/api/generate-image` requests.
- ComfyUI-only location weather/lighting variants.

Location weather/lighting variants are img2img jobs. They require `imagegen.engine: "comfyui"`, a usable base location image, and `imagegen.location_variant_settings.api_template`. The server builds the deterministic edit prompt locally, uploads the base image with `uploadInputImage()`, renders the variant workflow, and stores the completed image as display-only variant metadata on the location without replacing `location.imageId`.

Prompt-writing, prompt retries, prompt batching, entity/job deduplication, realtime `image_job_update` events, job timeouts, generated-image metadata, and save serialization are server responsibilities rather than `ComfyUIClient` responsibilities.

## Workflow Payload Notes

`queuePrompt()` submits only the ComfyUI API prompt graph plus `client_id` and `prompt_id`. It does not send ComfyUI UI workflow metadata under `extra_data.extra_pnginfo.workflow`.

Non-edit workflow templates commonly consume `image.prompt`, `image.width`, `image.height`, and `image.seed` from the server-rendered image job context. They also receive the full runtime `config` object, so workflows can read values such as `config.imagegen.lora` directly. For example, `imagegen/test_krea_2_simplified.json.njk` renders image values into its positive prompt, latent dimensions, and sampler seed.

The bundled Krea 2 templates use VAE Utils nodes for VAE loading and tiled decoding: `VAEUtils_CustomVAELoader` and `VAEUtils_VAEDecodeTiled`. They load `Wan2.1_VAE_upscale2x_imageonly_real_v1.safetensors`, so the ComfyUI environment needs both the VAE Utils custom nodes and that VAE file available. Those templates also pass the decoded image through `ImageScaleBy` with `upscale_method: "area"` and `scale_by: 0.5` before saving, which halves the final decoded image dimensions. Their rendered prompt is stored in ComfyUI's vanilla `PrimitiveStringMultiline` (`Input Text`) node, consumed by the CLIP encoder, and printed/displayed through Crystools `Show any [Crystools]` nodes with the `Final Prompt` prefix. The old custom `Text Multiline` and `Text to Console` nodes are not required by bundled workflow templates. `imagegen/test_krea_2_simplified_anibg3.json.njk` chains two `LoraLoaderModelOnly` nodes before the sampler; the second loader currently duplicates `krea2/k2-anibg2.safetensors` so it can be swapped to another LoRA in the workflow template.

`imagegen/test_krea_2_any_lora.json.njk` loads its first Krea 2 LoRA from `config.imagegen.lora`, then chains an additional model-only LoRA loader for `krea2/realism_engine_krea2_v2.safetensors` before passing the model into the sampler. Those LoRA files must exist in ComfyUI's LoRA search path when run.

The bundled Qwen workflows use `SaveImageWithMetaData` with plain output formats such as `png`. `*_with_json` output formats from that extension require workflow metadata that this client does not send.

## Error Behavior

- `queuePrompt()` and `getHistory()` catch request errors and return `{ success: false, error, promptId }`.
- `waitForCompletion()` keeps polling when history is unavailable and returns `{ success: false, error: "Timeout waiting for completion", promptId }` on timeout.
- `getImage()` and `uploadInputImage()` throw request/validation errors.
- `saveImage()` catches write failures and returns `{ success: false, error }`.
- Server job processing converts thrown or unsuccessful client results into failed image jobs.

## Related Coverage

- `tests/imagegen_workflow_templates.test.js` checks the Flux location-edit workflow prompt wiring, Krea 2 VAE Utils node wiring, imagegen access to the full `config` object, and the Krea 2 any-LoRA chained model path.
- `tests/server.location_weather_variant_helpers.test.js` covers variant keys, prompts, source validation, size warnings, and attachment rules.
- `tests/location.image_variants.test.js` covers location variant persistence and cache behavior.
- `tests/server.image_prompt_preamble.test.js` covers ComfyUI prompt-prefix behavior and base-context preamble exclusion.
- `tests/server.image_prompt_batching.test.js` covers LLM-authored image-prompt batching and retry failure behavior.
- `tests/server.location_image_generation_race.test.js` covers location prompt-generation deduplication before image jobs are queued.
- `tests/server.thing_image_dimensions.test.js` covers item/scenery image dimension resolution.
