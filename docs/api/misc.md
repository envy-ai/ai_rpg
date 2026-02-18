# Misc & Utility API

## GET /api/features/location-image-generation
Return image-generation feature flag.

Response:
- 200: `{ enabled: boolean }` (no `success` flag)
- 500: `{ error }`

## GET /api/hello
Simple health check.

Response:
- 200: `{ message: 'Hello World!', timestamp, port }` (no `success` flag)

## POST /api/test-config
Test AI endpoint configuration.

Request:
- Body: `{ endpoint: string, apiKey: string, model: string }`

Response:
- 200: `{ success: true, message: 'Configuration test successful' }`
- 400/408/503/500: `{ error }` (no `success` flag)

## POST /api/prompts/:promptId/cancel
Cancel an in-flight LLM prompt.

Response:
- 200: `{ success: true, message }`
- 400/404: `{ success: false, error }`

## POST /api/prompts/:promptId/retry
Abort the current in-flight LLM prompt attempt and immediately retry the same prompt call.

Response:
- 200: `{ success: true, message }`
- 400/404: `{ success: false, error }`

## POST /api/slash-command
Execute a registered slash command.

Request:
- Body: `{ command: string, args?: object, argsText?: string, userId?: string }`

Response:
- 200: `{ success: true, replies: array }`
- 400/404/500 with `{ success: false, error | errors }`
