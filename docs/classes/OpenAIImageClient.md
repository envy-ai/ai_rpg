# OpenAIImageClient

## Purpose
`OpenAIImageClient.js` is the HTTP client used when `config.imagegen.engine` is `openai`. It calls an OpenAI Images-compatible generation endpoint, decodes the returned base64 image payload, and writes the generated image file into the server's generated-images directory.

## Construction
- `new OpenAIImageClient(config)`:
  - Reads settings from `config.imagegen`.
  - Uses `imagegen.apiKey`, or `OPENAI_API_KEY` when the config value is absent.
  - Uses `imagegen.endpoint`, or `https://api.openai.com/v1/images/generations` when the config value is absent.
  - Requires `imagegen.model`.
  - Uses a fixed request timeout of 60 seconds.
  - Throws a clear initialization error when the API key or model is missing.

Server configuration validation also requires the shared image-generation settings used before this client is called, including `imagegen.default_settings.image`.

## Instance API
- `generateRequestId()`: UUID for request tracking.
- `generateImage({ prompt, negativePrompt, width, height, signal })`:
  - Defaults `negativePrompt` to an empty string and `width`/`height` to `1024`.
  - Builds an OpenAI `size` string as `${width}x${height}`.
  - Appends `negativePrompt` to the main prompt as a `Negative prompt:` paragraph when a negative prompt is provided.
  - Sends `POST { model, prompt, size, n: 1 }` to the configured endpoint with a bearer token.
  - Passes the optional abort signal to Axios and throws `AbortError` when a game load cancels the image job.
  - Expects `response.data.data[0].b64_json`, decodes it into a `Buffer`, and returns `{ requestId, imageBuffer, mimeType }`.
  - Uses `response.data.data[0].mime_type` when present and otherwise reports `image/png`.
  - Wraps transport, API, and missing-payload failures as `OpenAI image request failed: ...`.
- `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)`:
  - Requires `imageBuffer` to be a `Buffer`.
  - Requires a non-empty `imageId`.
  - Uses the extension from `originalFilename`, or `.png` when no extension is available.
  - Ensures `saveDirectory` exists.
  - Writes `${imageId}${extension}` and returns `{ filename, filepath, size }`.

## Server Integration
- `server.js` constructs this client during image-engine initialization when `imagegen.engine` is `openai`.
- Image jobs for OpenAI share the remote-image branch used by NanoGPT: the server passes the final prompt, negative prompt, width, height, and seed into `generateImage`, then calls `saveImage` with `${requestId}.png` as the source filename.
- The OpenAI client does not include `seed` in the HTTP payload; any seed stored in job metadata comes from the server job payload.
- `createImageJob` prepends the active setting's `baseContextPreamble` to job prompts for non-ComfyUI engines, so OpenAI jobs receive that preamble before this client sends the image request.
- Character, location, item, and scenery generation paths run the shared LLM prompt-writing step before queueing an image job. That step logs prompts through `LLMClient.logPrompt()`, retries invalid image-prompt responses, and applies setting image-prompt prefixes by target type.
- Location weather/lighting variants require the ComfyUI engine and are not generated through `OpenAIImageClient`.
