# RealtimeHub

## Purpose
`RealtimeHub` owns the server-side WebSocket layer used for realtime browser updates. It tracks one or more sockets per `clientId`, sends JSON payloads to one client or every connected socket, and provides a small typed-event helper used by server routes and runtime services.

The hub is a transport helper. Event schema, request correlation, hidden-note filtering, prompt progress tracking, and player-input state live in callers such as `api.js`, `Globals.emitToClient`, `LLMClient`, and `QuestConfirmationManager`.

## Key State
- `path`: WebSocket path (default `/ws`).
- `wss`: `ws.Server` instance after `attach(...)`; `null` before attachment.
- `clients`: `Map<clientId, Set<WebSocket>>`.
- `logger`: logger object, defaulting to `console`.

## Runtime Wiring
- `server.js` creates one hub with `new RealtimeHub({ logger: console })`, assigns it to `Globals.realtimeHub`, and attaches it to the HTTP server on `/ws` during startup.
- `public/js/chat.js` connects to `/ws?clientId=...`, persists the acknowledged client id, reconnects with exponential delay up to 15 seconds, and dispatches recognized event types to chat, generation, image-job, prompt-progress, quest-confirmation, and player-input handlers.
- `public/js/new-game.js` also connects to `/ws?clientId=...` and listens for `connection_ack`, `chat_status`, and scoped `chat_error` updates while the new-game overlay is active.

## Instance API
- `new RealtimeHub({ logger, path })`: stores logger/path options and initializes empty socket state.
- `attach(server, { path })`: attaches a `ws.Server` to an HTTP server. It throws when the server argument is invalid, returns the existing `wss` when already attached, registers connection/close/error handlers, and sends each socket a `connection_ack` payload.
- `extractClientId(requestUrl)`: reads the `clientId` query parameter from the WebSocket request URL. Values longer than 128 characters and malformed URLs are ignored.
- `registerClient(clientId, socket)`: adds the socket to the set for `clientId`.
- `unregisterClient(clientId, socket)`: removes the socket and deletes the map entry when the set becomes empty.
- `handleIncomingMessage(clientId, socket, data)`: parses JSON client messages. The only handled client message type is `ping`, which receives `{ type: 'pong', serverTime }`; invalid JSON and unknown message types are ignored.
- `safeSend(socket, payload)`: sends strings as-is and serializes non-string payloads with `JSON.stringify`. It returns `true` only when the socket is open and `send` succeeds; send failures are logged and return `false`.
- `sendToClient(clientId, payload)`: sends a payload to every open socket registered for that client id. It returns `true` when at least one socket receives the message.
- `broadcast(payload)`: sends a payload to every open socket in `wss.clients`. It returns the number of successful sends and returns `0` when the hub is not attached.
- `emit(clientId, type, payload = {})`: builds `{ type, ...payload }` and routes it through `sendToClient` when `clientId` is truthy, otherwise through `broadcast`. It returns `false` when `type` is empty or no socket receives the event.

## Connection Lifecycle
- A connection may provide `clientId` in the query string. Without an accepted id, the hub generates one with `crypto.randomUUID()` when available, or with a random/date-based string.
- The `connection_ack` payload includes `type`, `clientId`, `assigned`, and `serverTime`. `assigned` is `true` when the server generated the id.
- Multiple tabs can share the same `clientId`; targeted sends fan out to all open sockets in that client set.
- Close events unregister the socket. Socket-level errors are logged with the associated client id.

## Common Event Producers
- `Globals.emitToClient(clientId, type, payload, options)` validates event type and optional client id, wraps non-object payloads as `{ value }`, adds `serverTime` by default, adds `requestId` when supplied, and delegates to `RealtimeHub.emit`.
- `api.js` builds scoped stream emitters for chat and generation routes. Stream emitters target one `clientId`, add `requestId` and `serverTime`, filter hidden notes for client payloads, and emit events such as `chat_status`, `player_action`, `npc_turn`, `chat_complete`, `chat_error`, `chat_history_updated`, `generation_status`, `region_generated`, and `location_generated`.
- Player-input prompts use targeted `player_input_request` and `player_input_request_closed` events. Responses are submitted through `/api/chat/user-input-response`; the hub does not receive answer payloads from the browser.
- `LLMClient` broadcasts `prompt_progress` and `prompt_progress_cleared` while streaming prompt output.
- Image jobs emit targeted or broadcast `image_job_update` events from `server.js`.
- Location and map mutations can broadcast events such as `location_relocated`, `location_exit_created`, `location_exit_deleted`, and `location_stub_expanded`.
- Quest confirmations are emitted through `Globals.emitToClient` as `quest_confirmation_request`.

## Notes
- `RealtimeHub` does not authenticate `clientId` values, persist messages, replay missed events, or validate app-level payload schemas.
- Payload keys are spread after the `type` argument in `emit`, so callers should not include a conflicting `type` field in `payload`.
- Direct `RealtimeHub.emit` calls do not add `serverTime` or `requestId` unless the caller includes them. Use `Globals.emitToClient` or a stream emitter when those fields are required.
