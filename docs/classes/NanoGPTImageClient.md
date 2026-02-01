# NanoGPTImageClient

## Purpose
Calls the NanoGPT image generation API and saves returned base64 images to disk.

## Construction
- `new NanoGPTImageClient(config)`:
  - Reads `imagegen.apiKey` or `NANOGPT_API_KEY`.
  - Reads `imagegen.endpoint` (defaults to `https://nano-gpt.com/`).
  - Requires `imagegen.model`.

## Instance API
- `generatePromptId()`: UUID for request tracking.
- `generateImage({ prompt, negativePrompt, width, height, seed })`:
  - POSTs to `/api/generate-image` with model, prompts, size, and optional seed.
  - Returns `{ requestId, imageBuffer, mimeType }` or throws on errors.
- `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)`:
  - Validates inputs and writes image to disk, returning `{ filename, filepath, size }`.

## Notes
- Unlike OpenAI, `saveImage` does not create the directory; callers should ensure it exists.
