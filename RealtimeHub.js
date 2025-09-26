const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const { URL } = require('url');

function generateClientId() {
    if (typeof randomUUID === 'function') {
        return randomUUID();
    }
    return `client_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

class RealtimeHub {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.path = options.path || '/ws';
        this.wss = null;
        this.clients = new Map(); // clientId -> Set<WebSocket>
    }

    attach(server, options = {}) {
        if (!server || typeof server.listen !== 'function') {
            throw new Error('RealtimeHub.attach requires a valid HTTP server instance');
        }
        if (this.wss) {
            return this.wss;
        }

        const path = options.path || this.path;
        const { Server: WebSocketServer } = WebSocket;

        this.wss = new WebSocketServer({ server, path });
        this.logger.info(`📡 RealtimeHub listening on path ${path}`);

        this.wss.on('connection', (socket, req) => {
            let clientId = this.extractClientId(req?.url);
            const assigned = !clientId;
            if (!clientId) {
                clientId = generateClientId();
            }

            this.registerClient(clientId, socket);

            this.safeSend(socket, {
                type: 'connection_ack',
                clientId,
                assigned,
                serverTime: new Date().toISOString()
            });

            socket.on('message', data => {
                this.handleIncomingMessage(clientId, socket, data);
            });

            socket.on('close', () => {
                this.unregisterClient(clientId, socket);
            });

            socket.on('error', error => {
                this.logger.warn(`RealtimeHub socket error for ${clientId}: ${error.message}`);
            });
        });

        this.wss.on('error', error => {
            this.logger.error('RealtimeHub server error:', error);
        });

        return this.wss;
    }

    extractClientId(requestUrl) {
        if (!requestUrl) {
            return null;
        }
        try {
            const parsed = new URL(requestUrl, 'http://localhost');
            const clientId = parsed.searchParams.get('clientId');
            if (clientId && clientId.length <= 128) {
                return clientId;
            }
        } catch (_) {
            // ignore malformed URLs
        }
        return null;
    }

    registerClient(clientId, socket) {
        if (!clientId || !socket) {
            return;
        }
        const existing = this.clients.get(clientId) || new Set();
        existing.add(socket);
        this.clients.set(clientId, existing);
    }

    unregisterClient(clientId, socket) {
        if (!clientId || !socket) {
            return;
        }
        const sockets = this.clients.get(clientId);
        if (!sockets) {
            return;
        }
        sockets.delete(socket);
        if (!sockets.size) {
            this.clients.delete(clientId);
        }
    }

    handleIncomingMessage(clientId, socket, data) {
        if (!data) {
            return;
        }
        let message = null;
        try {
            message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
        } catch (_) {
            // Ignore non-JSON payloads
            return;
        }

        if (!message || typeof message.type !== 'string') {
            return;
        }

        switch (message.type) {
            case 'ping':
                this.safeSend(socket, { type: 'pong', serverTime: new Date().toISOString() });
                break;
            default:
                // Currently no other message types handled
                break;
        }
    }

    safeSend(socket, payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
            socket.send(data);
            return true;
        } catch (error) {
            this.logger.warn('RealtimeHub failed to send message:', error.message);
            return false;
        }
    }

    sendToClient(clientId, payload) {
        if (!clientId) {
            return false;
        }
        const sockets = this.clients.get(clientId);
        if (!sockets || !sockets.size) {
            return false;
        }
        let didSend = false;
        for (const socket of sockets) {
            if (socket.readyState === WebSocket.OPEN) {
                didSend = this.safeSend(socket, payload) || didSend;
            }
        }
        return didSend;
    }

    broadcast(payload) {
        if (!this.wss) {
            return 0;
        }
        let sent = 0;
        const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
        for (const socket of this.wss.clients) {
            if (socket.readyState === WebSocket.OPEN) {
                try {
                    socket.send(data);
                    sent++;
                } catch (error) {
                    this.logger.warn('RealtimeHub broadcast send failed:', error.message);
                }
            }
        }
        return sent;
    }

    emit(clientId, type, payload = {}) {
        if (!type) {
            return false;
        }
        const message = { type, ...payload };
        if (clientId) {
            return this.sendToClient(clientId, message);
        }
        return this.broadcast(message) > 0;
    }
}

module.exports = RealtimeHub;
