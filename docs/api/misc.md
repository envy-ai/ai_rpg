# Misc & Utility API

## GET /api/features/location-image-generation
Return whether location image generation is enabled. The value is derived from `config.imagegen.enabled`.

Browser use:
- `views/index.njk` reads this flag on page load and stores it on `window.locationImageGenerationEnabled`.

Response:
- 200: `{ enabled: boolean }` (no `success` flag)
- 500: `{ error }`

## GET /api/hello
Simple health check.

Response:
- 200: `{ message: 'Hello World!', timestamp, port }` (no `success` flag)

## POST /api/test-config
Test an AI backend configuration without saving it.

Request:
- Body for OpenAI-compatible backends: `{ backend?: string, endpoint: string, apiKey: string, model: string }`
- Body for Codex bridge: `{ backend: 'codex_cli_bridge', model?: string, codexBridge?: object }`
- Body for Cline bridge: `{ backend: 'cline_cli_bridge', model?: string, clineBridge?: object }`
- Body for Kimi bridge: `{ backend: 'kimi_cli_bridge', model?: string, kimiBridge?: object }`
- The OpenAI-compatible test calls `<endpoint>/chat/completions` using the supplied API key and model.
- The Codex bridge test validates the provided bridge settings before sending a short bridge test prompt.
- The Cline bridge test validates the provided bridge settings before sending a short Cline bridge test prompt.
- The Kimi bridge test validates the provided bridge settings before sending a short prompt through the existing local Kimi login; it does not use an API key.

Response:
- 200: `{ success: true, message: 'Configuration test successful' }`
- 400: `{ error }` for missing required fields or invalid bridge configuration (no `success` flag)
- 408: `{ error: 'Request timeout' }` (no `success` flag)
- 503: `{ error: 'Cannot connect to API endpoint' }` (no `success` flag)
- Provider HTTP status: `{ error: 'API Error (<status>): <message>' }` (no `success` flag)
- 500: `{ error }` for invalid backend responses or other test failures (no `success` flag)

## POST /api/prompts/:promptId/cancel
Cancel an in-flight LLM prompt.

Request:
- Path: `promptId` is the tracked prompt-progress id.
- Body (optional): `{ clientId?: string }`
  - When `clientId` is supplied, pending player-input requests for that client are also cancelled.

Response:
- 200: `{ success: true, message, playerInputRequests: { cancelledCount: number } }`
- 400/404: `{ success: false, error }`

## POST /api/prompts/cancel-all
Cancel all tracked in-flight LLM prompts and pending player-input requests.

Request (optional):
- Body: `{ waitForDrain?: boolean, timeoutMs?: number, clientId?: string }`
  - `waitForDrain` defaults to `true`.
  - `timeoutMs` defaults to `5000`; it must be a finite number greater than or equal to `0`.
  - `timeoutMs` is floored to an integer and only affects the drain wait.
  - When `clientId` is supplied, only pending player-input requests for that client are cancelled. Without `clientId`, all pending player-input requests are cancelled.

Response:
- 200: `{ success: true, message, waitForDrain, timeoutMs, cancellation, drain, playerInputRequests }`
  - `cancellation`: `{ canceledCount, canceledPromptIds, trackedBefore, trackedAfter, activeAfterRequest }`
  - `drain`: `null` when `waitForDrain` is `false`; otherwise `{ elapsedMs, activeCount, trackedCount }`
  - `playerInputRequests`: `{ cancelledCount }`
- 400: `{ success: false, error }` for invalid request fields or cancellation errors
- 408: `{ success: false, error }` (drain wait timed out)

## POST /api/prompts/:promptId/retry
Abort the current in-flight LLM prompt attempt and immediately retry the same prompt call.

Request:
- Path: `promptId` is the tracked prompt-progress id.

Response:
- 200: `{ success: true, message }`
- 400/404: `{ success: false, error }`

## POST /api/slash-command
Execute a registered slash command.

Request:
- Body: `{ command: string, args?: object, argsText?: string, userId?: string, clientId?: string }`
  - `command` is trimmed and resolved by command name or alias.
  - `args` must be an object when supplied; other values are treated as an empty object.
  - `argsText` is the raw text after the command name. For commands that declare positional args, the server tokenizes `argsText` left-to-right, preserving quoted strings, to fill missing `args` values without overwriting supplied values.
  - Declared positional arg types support `integer`, `boolean`, and `string`.
  - Command `validateArgs(...)` errors return an `errors` array.
  - `clientId` allows a command to request a refresh for only the invoking browser tab.

Response:
- 200: `{ success: true, replies: array, executionOptions: { showExecutionOverlay: boolean } }`
  - Each reply is normalized to `{ content: string, ephemeral: boolean, action?: object }`.
  - Supported reply action type: `request_file_upload`, which the chat client routes into the shared slash-command upload modal.
  - `request_file_upload` supports `title`, `description`, `accept`, `multiple`, `uploadMessage`, `submitLabel`, and `cancelLabel`.
  - `executionOptions.showExecutionOverlay` defaults to `true`; commands such as `/import_item` can set it to `false` so an immediate UI action can open without the pre-reply `Executing command...` overlay.
  - When a command requests a client refresh and `clientId` is supplied, the server emits `chat_history_updated` with requested flags such as `locationRefreshRequested: true` or `relationshipGraphRefreshRequested: true` to the invoking tab.
- 400/404/500 with `{ success: false, error | errors }`

## POST /api/slash-command/upload
Send one or more uploaded text files to a slash command that implements `handleUpload(...)`.

Request:
- Body: `{ command: string, args?: object, argsText?: string, userId?: string, clientId?: string, uploads: Upload[] | Upload }`
- `Upload`: `{ filename: string, content: string, mimeType?: string, size?: number }`
  - `filename` is required after trimming.
  - `content` must be a string.
  - `mimeType` is optional.
  - `size` is retained only when it is a finite nonnegative number.
- `uploads` must contain at least one upload entry.
- The target command must implement `handleUpload(interaction, args, uploads)`.

Response:
- 200: `{ success: true, replies: array }`
- 400/404/500 with `{ success: false, error | errors }`
