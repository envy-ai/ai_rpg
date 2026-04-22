# ComfyUIClient

## Purpose
Client for a ComfyUI server. Queues workflows, polls status, uploads img2img inputs, downloads images, and saves results locally.

## Construction
- `new ComfyUIClient(config)`: reads `config.imagegen.server.host`/`port` and builds base URL.

## Instance API
- `generatePromptId()`: UUID for prompts.
- `queuePrompt(workflow, promptId)`: POSTs to `/prompt`, returns `{ success, promptId, data|error }`.
- `getHistory(promptId)`: GETs `/history/:id`, returns `{ success, data, isComplete }`.
- `getImage(filename, subfolder, folderType)`: GETs `/view`, returns `Buffer`.
- `uploadInputImage(filePath, options)`: POSTs a local source image to ComfyUI `/upload/image`, returning `{ success, name, subfolder, type, imageReference, data }` for img2img workflows.
- `waitForCompletion(promptId, maxWaitTime, pollInterval)`: polls until outputs are available or times out; returns image list.
- `testConnection()`: GETs `/queue`, returns boolean (note: uses `baseTimeoutMilliseconds`, which must exist in scope).
- `sleep(ms)`: Promise-based delay helper.
- `saveImage(imageData, imageId, originalFilename, saveDirectory)`: writes file and returns `{ success, filename, filepath, size }`.

## Notes
- `queuePrompt` and `getHistory` catch and return errors instead of throwing.
- `uploadInputImage` raises explicit errors for missing files, missing browser-compatible `FormData`/`Blob` globals, or failed ComfyUI upload responses.
- `saveImage` ensures output directory exists.
