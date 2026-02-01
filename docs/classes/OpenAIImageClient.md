# OpenAIImageClient

## Purpose
Calls OpenAI image generation API and saves returned base64 images to disk.

## Construction
- `new OpenAIImageClient(config)`:
  - Reads `imagegen.apiKey` or `OPENAI_API_KEY`.
  - Reads `imagegen.endpoint` (defaults to `https://api.openai.com/v1/images/generations`).
  - Requires `imagegen.model`.

## Instance API
- `generateRequestId()`: UUID for request tracking.
- `generateImage({ prompt, negativePrompt, width, height })`:
  - Sends a generation request; returns `{ requestId, imageBuffer, mimeType }`.
  - Throws on API errors or missing image payloads.
- `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)`:
  - Validates inputs, ensures directory exists, writes image, returns `{ filename, filepath, size }`.

## Notes
- Prompts are combined with a `Negative prompt:` suffix when provided.
