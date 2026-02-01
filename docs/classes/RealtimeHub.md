# RealtimeHub

## Purpose
Manages WebSocket connections for real-time client updates. Tracks clients by `clientId`, supports targeted send, broadcast, and typed emits.

## Key State
- `path`: WebSocket path (default `/ws`).
- `wss`: WebSocketServer instance.
- `clients`: `Map<clientId, Set<WebSocket>>`.

## Construction
- `new RealtimeHub({ logger, path })`.

## Instance API
- `attach(server, { path })`: attaches a WebSocket server to an HTTP server, handles connect/ping/close.
- `extractClientId(requestUrl)`: parses `clientId` query param.
- `registerClient(clientId, socket)` / `unregisterClient(clientId, socket)`.
- `handleIncomingMessage(clientId, socket, data)`: handles `ping` -> `pong`.
- `safeSend(socket, payload)`: sends JSON safely; returns success.
- `sendToClient(clientId, payload)`: sends to all sockets for a client.
- `broadcast(payload)`: sends to all sockets.
- `emit(clientId, type, payload)`: convenience wrapper around send/broadcast.

## Notes
- `emit` with `clientId = null` broadcasts to all clients.
- Clients without a provided id get an auto-generated id.
