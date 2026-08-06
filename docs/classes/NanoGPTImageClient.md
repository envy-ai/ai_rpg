# NanoGPTImageClient

## Purpose

`NanoGPTImageClient` is the HTTP/file client for the NanoGPT image-generation backend. It sends one image-generation request, decodes the returned base64 image payload into a `Buffer`, and writes generated image bytes to disk.

The class does not generate final image prompts, manage the image-job queue, attach images to game entities, emit realtime job updates, or persist generated-image metadata. Those responsibilities live in `server.js`.

## Configuration

- `new NanoGPTImageClient(config)`:
  - Reads `config.imagegen.apiKey`, falling back to `NANOGPT_API_KEY`.
  - Reads `config.imagegen.endpoint`, defaulting to `https://nano-gpt.com/`.
  - Requires `config.imagegen.model`.
  - Sets an instance request timeout of `60000` ms.
- `server.js` selects this client when `imagegen.engine` is `nanogpt`.
- Startup validation reports missing NanoGPT `apiKey`/`NANOGPT_API_KEY` or missing `model` before server initialization completes.
- `config.default.yaml` documents the shared remote-backend settings: `imagegen.engine`, `imagegen.api_template`, `imagegen.model`, `imagegen.endpoint`, `imagegen.apiKey`, and `imagegen.maxConcurrentJobs`.

## Instance API

| Method | Behavior |
| --- | --- |
| `generatePromptId()` | Returns a UUID from `crypto.randomUUID()` for request/job correlation. |
| `generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024, seed = null, signal = null })` | Builds a NanoGPT request payload and POSTs it to `${baseURL}/api/generate-image` with JSON content type and `Authorization: Bearer <apiKey>`. The payload contains `model`, `prompt`, `negative_prompt`, `size: "<width>x<height>"`, and `seed` when the seed is not `null`/`undefined`. The optional signal is passed to Axios so a game load can abort the running request with `AbortError`. The method expects `response.data.data[0].b64_json`, decodes it to a `Buffer`, and returns `{ requestId, imageBuffer, mimeType }`. `mimeType` comes from `data[0].mime_type` or defaults to `image/png`. |
| `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)` | Requires `imageBuffer` to be a `Buffer` and requires `imageId`. The saved filename is `<imageId><ext>`, where `<ext>` comes from `originalFilename` or defaults to `.png`. Writes the file with `fs.writeFileSync()` and returns `{ filename, filepath, size }`. |

## Server Integration

`server.js` stores the active image backend in the `comfyUIClient` variable, including NanoGPT and OpenAI clients. For NanoGPT image jobs, `processImageGeneration()`:

- Creates `public/generated-images/` before calling the client.
- Uses the shared job payload fields for prompt, negative prompt, width, height, and seed.
- Calls `generateImage()` through the server retry helper.
- Calls `saveImage()` with the returned `imageBuffer`, a generated project image id, and `<requestId>.png` as the original filename.
- Stores generated-image metadata in the `generatedImages` map with prompt, negative prompt, dimensions, seed, request id, and saved file entries.

Prompt writing, prompt retries, prompt batching, duplicate-job joining, entity assignment, job timeouts, and realtime `image_job_update` events are server behavior. The server also prepends the active setting `baseContextPreamble` to NanoGPT and OpenAI job prompts before processing; `NanoGPTImageClient` sends the prompt string it receives.

NanoGPT uses the shared image processor for player/NPC portraits, location scene images, location-exit images, item/scenery images, and custom `/api/generate-image` requests. Location weather/lighting variants require the ComfyUI engine and do not use this client.

## Error Behavior

- Construction throws when the API key or model is missing.
- `generateImage()` throws `NanoGPT image response missing image data.` when the response has no usable `data[0].b64_json`.
- Request failures are wrapped as `NanoGPT image request failed: <message>`, preferring `error.response.data.error.message` when present.
- `saveImage()` throws when the image buffer is missing/not a `Buffer`, when `imageId` is missing, or when the filesystem write fails.
- `saveImage()` assumes `saveDirectory` exists. The server job processor creates `public/generated-images/` before saving.

## Related Coverage

- `tests/server.image_prompt_preamble.test.js` covers base-context preamble behavior for remote image backends.
- `tests/server.image_prompt_batching.test.js` covers LLM-authored image-prompt batching, retries, prompt-prefix application, and rejection of leaked prompt XML.
- `tests/server.location_image_generation_race.test.js` covers shared location image prompt-generation deduplication before image jobs are queued.
- `tests/server.thing_image_dimensions.test.js` covers item/scenery image dimension resolution used by the shared job payload.
- `docs/api/images.md` documents image-job API behavior for NanoGPT, OpenAI, and ComfyUI backends.
