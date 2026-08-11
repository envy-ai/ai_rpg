import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} is required.`);
    }
    return value.trim();
}

export function parseBooleanChoice(value, fallback = false) {
    if (value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'accept', 'accepted', 'confirm'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'decline', 'declined', 'cancel'].includes(normalized)) return false;
    throw new Error(`Invalid boolean choice "${value}".`);
}

export async function readJsonFile(root, filename) {
    const absolute = path.resolve(root, filename);
    return JSON.parse(await fs.readFile(absolute, 'utf8'));
}

export async function writeJson(directory, name, value) {
    await fs.writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(directory, name, value) {
    await fs.writeFile(path.join(directory, name), String(value), 'utf8');
}

export async function nextAttemptDirectory(root, scenario, caseName) {
    const caseDir = path.join(
        root,
        'tmp',
        'followup-api-playtest',
        requireText(scenario, 'scenario').replaceAll(/[^A-Za-z0-9._-]/g, '_'),
        requireText(caseName, 'case').replaceAll(/[^A-Za-z0-9._-]/g, '_')
    );
    await fs.mkdir(caseDir, { recursive: true });
    const names = await fs.readdir(caseDir);
    let attempt = 1;
    while (names.includes(`attempt-${attempt}`)) attempt += 1;
    const attemptDir = path.join(caseDir, `attempt-${attempt}`);
    await fs.mkdir(attemptDir, { recursive: false });
    return attemptDir;
}

export class FollowupApiClient {
    constructor({ baseUrl = 'http://127.0.0.1:7777' } = {}) {
        this.baseUrl = baseUrl;
    }

    async fetchJson(method, route, body) {
        const url = new URL(route, this.baseUrl);
        const requestBody = body === undefined ? null : JSON.stringify(body);
        const transport = url.protocol === 'https:' ? https : http;
        const startedAtMs = Date.now();
        const response = await new Promise((resolve, reject) => {
            const request = transport.request(url, {
                method,
                headers: requestBody === null
                    ? undefined
                    : {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(requestBody)
                    }
            }, (incoming) => {
                const chunks = [];
                incoming.on('data', (chunk) => chunks.push(chunk));
                incoming.on('end', () => resolve({
                    status: incoming.statusCode || 0,
                    text: Buffer.concat(chunks).toString('utf8')
                }));
                incoming.on('error', reject);
            });
            request.on('error', reject);
            if (requestBody !== null) request.write(requestBody);
            request.end();
        });
        const text = response.text;
        let payload;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            payload = { rawText: text };
        }
        return {
            method,
            route,
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            durationMs: Date.now() - startedAtMs,
            payload
        };
    }

    async captureState() {
        const player = await this.fetchJson('GET', '/api/player');
        const playerId = player.payload?.player?.id || null;
        const locationId = player.payload?.player?.locationId
            || player.payload?.player?.currentLocation
            || null;
        const routes = [
            ['/api/players', 'players'],
            ['/api/locations', 'locations'],
            ['/api/regions', 'regions'],
            ['/api/things', 'things'],
            ['/api/chat/history?includeAllEntries=true', 'history'],
            ['/api/calendar', 'calendar']
        ];
        if (locationId) routes.push([`/api/locations/${encodeURIComponent(locationId)}`, 'currentLocation']);
        if (playerId) routes.push([`/api/npcs/${encodeURIComponent(playerId)}`, 'currentPlayerDetail']);
        const results = await Promise.all(routes.map(async ([route, key]) => [key, await this.fetchJson('GET', route)]));
        return Object.fromEntries([['player', player], ...results]);
    }
}

export async function getLogManifest(root) {
    const logsDir = path.join(root, 'logs');
    let names;
    try {
        names = await fs.readdir(logsDir);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const entries = await Promise.all(names.map(async (name) => {
        const filename = path.join(logsDir, name);
        const stat = await fs.stat(filename);
        return { name, mtimeMs: stat.mtimeMs, size: stat.size };
    }));
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function findChangedLogs(beforeLogs, afterLogs) {
    const beforeNames = new Set((beforeLogs || []).map(
        entry => `${entry.name}:${entry.mtimeMs}:${entry.size}`
    ));
    return (afterLogs || []).filter(
        entry => !beforeNames.has(`${entry.name}:${entry.mtimeMs}:${entry.size}`)
    );
}

function normalizeInteractivePolicy(policy = {}) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        throw new Error('Interactive response policy must be an object.');
    }
    const roll = policy.roll === null || policy.roll === undefined
        ? null
        : Number(policy.roll);
    if (roll !== null && !Number.isInteger(roll)) {
        throw new Error('Interactive roll must be an integer or null.');
    }
    return {
        roll,
        questAccepted: parseBooleanChoice(policy.questAccepted, false),
        confirmed: parseBooleanChoice(policy.confirmed, false),
        answer: typeof policy.answer === 'string' && policy.answer.trim()
            ? policy.answer.trim()
            : null
    };
}

export class RealtimeSession {
    constructor({
        apiClient,
        wsUrl = 'ws://127.0.0.1:7777/ws',
        clientId = `followup-${randomUUID()}`
    } = {}) {
        if (!(apiClient instanceof FollowupApiClient)) {
            throw new Error('RealtimeSession requires a FollowupApiClient.');
        }
        this.apiClient = apiClient;
        this.wsUrl = wsUrl;
        this.clientId = clientId;
        this.events = [];
        this.policies = new Map();
        this.currentRequestId = null;
        this.socket = null;
        this.acknowledged = null;
    }

    async connect() {
        if (this.socket) {
            return;
        }
        this.socket = new WebSocket(`${this.wsUrl}?clientId=${encodeURIComponent(this.clientId)}`);
        this.acknowledged = new Promise((resolve, reject) => {
            this.socket.once('error', reject);
            this.socket.on('message', (buffer) => {
                void this.#handleMessage(buffer, resolve).catch((error) => {
                    this.events.push({
                        type: 'harness_response_error',
                        receivedAt: new Date().toISOString(),
                        error: error.stack || error.message
                    });
                });
            });
        });
        await this.acknowledged;
    }

    beginRequest(policy = {}, requestId = `followup-${randomUUID()}`) {
        const normalizedRequestId = requireText(requestId, 'requestId');
        this.policies.set(normalizedRequestId, normalizeInteractivePolicy(policy));
        this.currentRequestId = normalizedRequestId;
        return {
            clientId: this.clientId,
            requestId: normalizedRequestId
        };
    }

    endRequest(requestId) {
        if (typeof requestId === 'string' && this.currentRequestId === requestId) {
            this.currentRequestId = null;
        }
    }

    eventsForRequest(requestId) {
        return this.events.filter(event => (
            event?.requestId === requestId
            || event?.body?.requestId === requestId
            || event?.result?.payload?.requestId === requestId
        ));
    }

    async #respond(route, body) {
        const result = await this.apiClient.fetchJson('POST', route, body);
        this.events.push({
            type: 'harness_response',
            receivedAt: new Date().toISOString(),
            route,
            body,
            result
        });
    }

    #resolvePolicy(event) {
        const requestId = typeof event?.requestId === 'string' && event.requestId.trim()
            ? event.requestId.trim()
            : this.currentRequestId;
        if (!requestId || !this.policies.has(requestId)) {
            throw new Error(
                `No interactive response policy is registered for realtime event ${event?.type || 'unknown'}.`
            );
        }
        return { requestId, policy: this.policies.get(requestId) };
    }

    async #handleMessage(buffer, acknowledge) {
        let event;
        try {
            event = JSON.parse(buffer.toString());
        } catch {
            event = { type: 'unparseable', rawText: buffer.toString() };
        }
        event.receivedAt = new Date().toISOString();
        this.events.push(event);
        if (event.type === 'connection_ack') {
            acknowledge(event);
            return;
        }
        if (event.type === 'quest_confirmation_request') {
            const { requestId, policy } = this.#resolvePolicy(event);
            await this.#respond('/api/quests/confirm', {
                confirmationId: event.confirmationId,
                clientId: this.clientId,
                requestId,
                accepted: policy.questAccepted
            });
            return;
        }
        if (event.type !== 'player_input_request') {
            return;
        }
        const { requestId, policy } = this.#resolvePolicy(event);
        const responseBody = {
            inputRequestId: event.inputRequestId,
            clientId: this.clientId,
            requestId
        };
        if (event.mode === 'integer') {
            if (policy.roll === null) {
                responseBody.cancelled = true;
            } else {
                responseBody.answer = String(policy.roll);
            }
        } else if (event.mode === 'confirmation') {
            responseBody.confirmed = policy.confirmed;
        } else if (policy.answer) {
            responseBody.answer = policy.answer;
        } else {
            responseBody.cancelled = true;
        }
        await this.#respond('/api/chat/user-input-response', responseBody);
    }

    async close() {
        if (!this.socket) {
            return;
        }
        const socket = this.socket;
        this.socket = null;
        await new Promise((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }
            socket.once('close', resolve);
            socket.close();
        });
    }
}
