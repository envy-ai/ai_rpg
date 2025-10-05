const { randomUUID } = require('crypto');
const { DOMParser } = require('xmldom');
const Player = require('./Player.js');
const Thing = require('./Thing.js');
const { getCurrencyLabel } = require('./public/js/currency-utils.js');
const Utils = require('./Utils.js');
const console = require('console');

module.exports = function registerApiRoutes(scope) {
    if (!scope || typeof scope !== 'object' || !scope.app || typeof scope.app.use !== 'function') {
        throw new Error('registerApiRoutes requires a scope object containing an Express app');
    }

    if (!scope[Symbol.unscopables]) {
        Object.defineProperty(scope, Symbol.unscopables, {
            value: {},
            configurable: true
        });
    }

    with (scope) {
        // Log all API requests with received/finished timestamps
        app.use((req, res, next) => {
            if (!req.path || !req.path.startsWith('/api')) {
                return next();
            }

            //const routeLabel = `${req.method || 'GET'} ${req.originalUrl || req.path}`;

            // Skip if routeLabel contains /image
            const routeLabel = (() => {
                const method = req.method || 'GET';
                const path = req.originalUrl || req.path || '';
                if (path.includes('/image')) {
                    return `${method} [image request]`;
                }
                return `${method} ${path}`;
            })();

            millisecond_timestamp = Date.now();
            console.log(`⬅️ ${routeLabel} request received at ${new Date().toISOString()}`);

            res.on('finish', () => {
                const duration = (Date.now() - millisecond_timestamp) / 1000;
                console.log(`✅ ${routeLabel} request finished at ${new Date().toISOString()} (Duration: ${duration}s)`);
            });

            next();
        });

        function createStreamEmitter({ clientId, requestId } = {}) {
            const hasRealtime = Boolean(realtimeHub && typeof realtimeHub.emit === 'function');
            const targetClientId = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : null;
            const targetRequestId = (typeof requestId === 'string' && requestId.trim()) ? requestId.trim() : null;
            const isEnabled = hasRealtime && targetClientId;

            const emit = (type, payload = {}) => {
                if (!isEnabled || !type) {
                    return false;
                }
                const enrichedPayload = {
                    requestId: targetRequestId,
                    serverTime: new Date().toISOString(),
                    ...payload
                };
                try {
                    return Boolean(realtimeHub.emit(targetClientId, type, enrichedPayload));
                } catch (error) {
                    console.warn('Failed to emit realtime message:', error.message);
                    return false;
                }
            };

            return {
                clientId: targetClientId,
                requestId: targetRequestId,
                isEnabled,
                emit,
                status(stage, message = null, extra = {}) {
                    if (!stage) {
                        return false;
                    }
                    const payload = { stage, ...extra };
                    if (typeof message === 'string' && message.trim()) {
                        payload.message = message;
                    } else if (message && typeof message === 'object') {
                        Object.assign(payload, message);
                    }
                    return emit('chat_status', payload);
                },
                playerAction(payload = {}) {
                    return emit('player_action', payload);
                },
                npcTurn(payload = {}) {
                    return emit('npc_turn', payload);
                },
                complete(payload = {}) {
                    return emit('chat_complete', payload);
                },
                error(payload = {}) {
                    return emit('chat_error', payload);
                }
            };
        }

        function sanitizeForXml(input) {
            return `<root>${input}</root>`
                .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
                .replace(/<\s*br\s*>/gi, '<br/>')
                .replace(/<\s*hr\s*>/gi, '<hr/>');
        }

        const randomEventCache = {
            common: null,
            rare: null
        };

        function deleteNpcById(npcId, { skipNotFound = false, reason = null } = {}) {
            if (!npcId || typeof npcId !== 'string') {
                return { success: false, error: 'NPC ID is required', status: 400 };
            }

            const npc = players.get(npcId);
            if (!npc || !npc.isNPC) {
                const result = {
                    success: false,
                    error: `NPC with ID '${npcId}' not found`,
                    status: 404
                };
                if (skipNotFound) {
                    result.skipped = true;
                }
                return result;
            }

            const locationId = npc.currentLocation || null;
            let regionId = null;

            if (locationId) {
                const location = gameLocations.get(locationId);
                if (location) {
                    if (typeof location.removeNpcId === 'function') {
                        location.removeNpcId(npcId);
                    } else if (Array.isArray(location.npcIds)) {
                        location.npcIds = location.npcIds.filter(id => id !== npcId);
                    }
                    regionId = location.regionId || location.stubMetadata?.regionId || regionId;
                }
            }

            if (!regionId) {
                for (const region of regions.values()) {
                    if (region && Array.isArray(region.npcIds) && region.npcIds.includes(npcId)) {
                        region.npcIds = region.npcIds.filter(id => id !== npcId);
                        regionId = region.id || region.regionId || region.stubMetadata?.regionId || regionId;
                    }
                }
            } else {
                const regionRecord = regions.get(regionId);
                if (regionRecord && Array.isArray(regionRecord.npcIds)) {
                    regionRecord.npcIds = regionRecord.npcIds.filter(id => id !== npcId);
                }
            }

            for (const actor of players.values()) {
                if (actor && typeof actor.removePartyMember === 'function') {
                    actor.removePartyMember(npcId);
                }
            }

            players.delete(npcId);
            Player.unregister?.(npc);

            if (reason) {
                try {
                    const label = npc.name || npcId;
                    console.log(`💀 Removed NPC ${label} (${npcId}) – reason: ${reason}`);
                } catch (_) {
                    // ignore logging issues
                }
            }

            return {
                success: true,
                npc,
                locationId,
                regionId
            };
        }

        function processNpcCorpses({ reason = 'unspecified' } = {}) {
            const removed = [];
            const countdownUpdates = [];
            const allPlayers = Player.getAll ? Player.getAll() : [];

            for (const npc of allPlayers) {
                if (!npc?.isNPC) {
                    continue;
                }

                const previousCountdown = Number.isFinite(npc?.corpseCountdown)
                    ? npc.corpseCountdown
                    : null;

                if (typeof npc.updateCorpseCountdown === 'function') {
                    npc.updateCorpseCountdown();
                }

                const currentCountdown = Number.isFinite(npc?.corpseCountdown)
                    ? npc.corpseCountdown
                    : null;

                if (npc.isDead && currentCountdown !== null && currentCountdown > 0 && currentCountdown !== previousCountdown) {
                    countdownUpdates.push({
                        npcId: npc.id,
                        corpseCountdown: currentCountdown
                    });
                }

                if (!npc.isDead || currentCountdown !== 0) {
                    continue;
                }

                const result = deleteNpcById(npc.id, { skipNotFound: true, reason });
                if (result.success) {
                    removed.push({
                        npcId: npc.id,
                        name: npc.name || null,
                        locationId: result.locationId || null,
                        regionId: result.regionId || null
                    });
                }
            }

            return { removed, countdownUpdates };
        }

        const generateMessageId = () => {
            if (typeof randomUUID === 'function') {
                try {
                    return randomUUID();
                } catch (_) {
                    // fall through to fallback
                }
            }
            return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        };

        const normalizeChatEntry = (entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            if (!entry.id) {
                entry.id = generateMessageId();
            }
            if (!entry.timestamp) {
                entry.timestamp = new Date().toISOString();
            }
            if (!Object.prototype.hasOwnProperty.call(entry, 'parentId')) {
                entry.parentId = null;
            }
            return entry;
        };

        const collectNpcNamesForContext = (entry = null) => {
            const names = new Set();

            const addNpcId = (npcId) => {
                if (!npcId || typeof npcId !== 'string') {
                    return;
                }
                const npc = players.get(npcId);
                if (npc && npc.isNPC) {
                    const label = typeof npc.name === 'string' && npc.name.trim()
                        ? npc.name.trim()
                        : npcId;
                    names.add(label);
                }
            };

            let locationId = null;
            if (entry && entry.locationId) {
                locationId = entry.locationId;
            } else if (entry && entry.metadata && entry.metadata.locationId) {
                locationId = entry.metadata.locationId;
            } else if (currentPlayer?.currentLocation) {
                locationId = currentPlayer.currentLocation;
            }

            if (locationId) {
                let locationRecord = gameLocations.get(locationId) || null;
                if (!locationRecord && typeof Location?.get === 'function') {
                    try {
                        locationRecord = Location.get(locationId) || null;
                    } catch (_) {
                        locationRecord = null;
                    }
                }

                if (locationRecord && Array.isArray(locationRecord.npcIds)) {
                    locationRecord.npcIds.forEach(addNpcId);
                }
            }

            if (currentPlayer && Array.isArray(currentPlayer.party)) {
                currentPlayer.party.forEach(addNpcId);
            }

            return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        };

        const requireLocationId = (value, contextLabel = 'chat entry') => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length) {
                    return trimmed;
                }
            }

            throw new Error(`${contextLabel} is missing a valid locationId`);
        };

        const pushChatEntry = (entry, collector = null, locationId = null) => {
            const normalized = normalizeChatEntry(entry);
            if (!normalized) {
                return null;
            }

            const resolvedLocationId = (() => {
                if (locationId && typeof locationId === 'string' && locationId.trim()) {
                    return locationId.trim();
                }
                if (typeof normalized.locationId === 'string' && normalized.locationId.trim()) {
                    return normalized.locationId.trim();
                }
                const metadataLocation = normalized.metadata && typeof normalized.metadata === 'object'
                    ? normalized.metadata.locationId
                    : null;
                if (typeof metadataLocation === 'string' && metadataLocation.trim()) {
                    return metadataLocation.trim();
                }
                throw new Error('pushChatEntry is missing a valid locationId');
            })();

            normalized.locationId = resolvedLocationId;
            const existingMetadata = normalized.metadata && typeof normalized.metadata === 'object'
                ? normalized.metadata
                : {};
            normalized.metadata = {
                ...existingMetadata,
                locationId: resolvedLocationId
            };

            if (!normalized.travel) {
                const npcNames = collectNpcNamesForContext(normalized);
                if (npcNames.length) {
                    normalized.metadata = {
                        ...normalized.metadata,
                        npcNames
                    };
                }
            }

            chatHistory.push(normalized);
            if (Array.isArray(collector)) {
                collector.push(normalized);
            }
            return normalized;
        };

        const emitAiUsageMetrics = (response, { label = 'chat_completion', streamEmitter = null } = {}) => {
            if (!response || !response.data || typeof response.data !== 'object') {
                return null;
            }

            const url = response.config?.url || response.config?.baseURL || '';
            const hostnameMatches = (target) => typeof target === 'string' && (
                target.includes('://localhost')
                || target.includes('://127.0.0.1')
                || target.includes('://0.0.0.0')
                || target.includes('://[::1]')
            );
            const isLocalhostCall = hostnameMatches(url) || hostnameMatches(response.config?.baseURL || '');
            if (isLocalhostCall) {
                return null;
            }

            const usage = response.data.usage || {};
            const coalesceNumber = (...values) => {
                for (const value of values) {
                    const numeric = Number(value);
                    if (Number.isFinite(numeric)) {
                        return numeric;
                    }
                }
                return null;
            };

            const promptTokens = coalesceNumber(usage.prompt_tokens, usage.promptTokens);
            const completionTokens = coalesceNumber(usage.completion_tokens, usage.completionTokens);
            const totalTokens = coalesceNumber(
                usage.total_tokens,
                usage.totalTokens,
                promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null
            );
            const cachedTokens = coalesceNumber(usage.cached_tokens, usage.prompt_tokens_cached, usage.prompt_tokens_cache);

            if (promptTokens === null && completionTokens === null && totalTokens === null && cachedTokens === null) {
                return null;
            }

            const startTimestamp = response.config?.metadata?.__aiMetricsStart || null;
            const durationMs = startTimestamp ? Date.now() - startTimestamp : null;
            const durationSeconds = durationMs ? durationMs / 1000 : null;
            const tokensPerSecond = durationSeconds && durationSeconds > 0 && totalTokens !== null
                ? Number((totalTokens / durationSeconds).toFixed(2))
                : null;

            const metricsPayload = {
                label,
                promptTokens,
                completionTokens,
                totalTokens,
                cachedTokens,
                durationMs,
                tokensPerSecond
            };

            if (streamEmitter?.isEnabled) {
                try {
                    streamEmitter.status('ai_metrics:usage', metricsPayload);
                } catch (error) {
                    console.warn('Failed to emit AI usage metrics to client:', error.message);
                }
            }

            return metricsPayload;
        };

        const getSummaryConfig = () => config?.summaries || {};
        const summariesEnabled = () => {
            const summaryConfig = getSummaryConfig();
            return summaryConfig.enabled !== false;
        };

        const getSummaryBatchSize = () => {
            const raw = Number(getSummaryConfig().batch_size);
            if (Number.isInteger(raw) && raw > 0) {
                return raw;
            }
            return 30;
        };

        const getSummaryWordLength = () => {
            const raw = Number(getSummaryConfig().summary_word_length);
            if (Number.isInteger(raw) && raw > 0) {
                return raw;
            }
            return 12;
        };

        const shouldSummarizeEntry = (entry) => {
            if (!entry) {
                return false;
            }
            if (entry.type === 'player-action' || entry.type === 'random-event') {
                return true;
            }
            if (entry.type === null || entry.type === undefined) {
                return true;
            }
            if (entry.randomEvent) {
                return true;
            }
            return false;
        };

        const parseBatchSummaryResponse = (xmlContent, expectedCount) => {
            const result = new Map();
            if (!xmlContent || typeof xmlContent !== 'string') {
                return result;
            }

            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(xmlContent, 'text/xml');
                const parserError = doc.getElementsByTagName('parsererror')[0];
                if (parserError) {
                    throw new Error(parserError.textContent);
                }

                const summaryNodes = Array.from(doc.getElementsByTagName('summary'));
                summaryNodes.forEach(node => {
                    const numberAttr = node.getAttribute('number');
                    const idx = Number(numberAttr);
                    if (!Number.isInteger(idx) || idx <= 0) {
                        return;
                    }
                    const text = node.textContent ? node.textContent.trim() : '';
                    result.set(idx - 1, text);
                });
            } catch (error) {
                console.warn('Failed to parse batch summary response:', error.message);
            }

            if (result.size !== expectedCount) {
                console.warn(`Batch summary parser returned ${result.size} summaries, expected ${expectedCount}.`);
            }

            return result;
        };

        const runSummaryBatch = async (batch, { wordLength }) => {
            if (!Array.isArray(batch) || !batch.length) {
                return true;
            }

            const endpoint = config?.ai?.endpoint;
            const apiKey = config?.ai?.apiKey;
            const model = config?.ai?.model;
            if (!endpoint || !apiKey || !model) {
                return false;
            }

            let locationOverride = null;
            const primaryLocationId = batch[0]?.locationId || null;
            if (primaryLocationId && typeof Location?.get === 'function') {
                try {
                    locationOverride = Location.get(primaryLocationId) || null;
                } catch (_) {
                    locationOverride = null;
                }
            }

            let baseContext = {};
            try {
                baseContext = buildBasePromptContext({ locationOverride });
            } catch (error) {
                console.warn('Failed to build base context for chat summarization:', error.message);
            }

            const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                ...baseContext,
                promptType: 'summarize_batch',
                entries: batch.map(item => ({ content: item.content })),
                summaries: {
                    summary_word_length: wordLength
                }
            });

            const parsedTemplate = parseXMLTemplate(renderedTemplate);
            if (!parsedTemplate?.systemPrompt) {
                return false;
            }

            const messages = [
                { role: 'system', content: String(parsedTemplate.systemPrompt).trim() }
            ];
            if (parsedTemplate.generationPrompt) {
                messages.push({ role: 'user', content: parsedTemplate.generationPrompt });
            }

            const chatEndpoint = endpoint.endsWith('/')
                ? `${endpoint}chat/completions`
                : `${endpoint}/chat/completions`;

            const requestData = {
                model,
                messages,
                max_tokens: parsedTemplate.maxTokens || 600,
                temperature: typeof parsedTemplate.temperature === 'number'
                    ? parsedTemplate.temperature
                    : 0.2
            };

            try {
                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const summaryResponse = response.data?.choices?.[0]?.message?.content || '';
                const parsedSummaries = parseBatchSummaryResponse(summaryResponse, batch.length);

                batch.forEach((item, index) => {
                    const summaryText = parsedSummaries.get(index) || null;
                    if (summaryText) {
                        Utils.setChatSummary(item.entryId, {
                            summary: summaryText,
                            type: item.type || null,
                            timestamp: item.timestamp || null
                        });

                        const historyEntry = chatHistory.find(history => history && history.id === item.entryId);
                        if (historyEntry) {
                            historyEntry.summary = summaryText;
                        }
                    }
                });

                return true;
            } catch (error) {
                console.warn('Failed to process summary batch:', error.message);
                for (let i = batch.length - 1; i >= 0; i -= 1) {
                    Utils.enqueueChatSummaryCandidate(batch[i]);
                }
                return false;
            }
        };

        const processSummaryQueue = async (options = {}) => {
            if (!summariesEnabled()) {
                return;
            }

            const { flushRemainder = false } = options;
            const batchSize = getSummaryBatchSize();
            const wordLength = getSummaryWordLength();

            while (Utils.getChatSummaryQueueLength() >= batchSize) {
                const batch = Utils.dequeueChatSummaryBatch(batchSize);
                if (!batch.length) {
                    break;
                }
                const success = await runSummaryBatch(batch, { wordLength });
                if (!success) {
                    return;
                }
            }

            if (!flushRemainder) {
                return;
            }

            const remaining = Utils.getChatSummaryQueueLength();
            if (remaining <= 0) {
                return;
            }

            const tailBatch = Utils.dequeueChatSummaryBatch(remaining);
            if (!tailBatch.length) {
                return;
            }

            await runSummaryBatch(tailBatch, { wordLength });
        };

        const summarizeChatEntry = async (entry, { location = null, type = null } = {}) => {
            if (!entry || !entry.id || !entry.content) {
                return null;
            }
            if (!summariesEnabled()) {
                return null;
            }
            if (Utils.hasChatSummary(entry.id)) {
                const existing = Utils.getChatSummary(entry.id);
                if (existing && existing.summary && !entry.summary) {
                    entry.summary = existing.summary;
                }
                return existing;
            }

            if (!shouldSummarizeEntry(entry)) {
                return null;
            }

            const summaryType = type || entry.type || (entry.randomEvent ? 'random-event' : 'general');
            const locationId = location?.id || entry.locationId || null;

            Utils.enqueueChatSummaryCandidate({
                entryId: entry.id,
                content: entry.content,
                locationId,
                type: summaryType,
                timestamp: entry.timestamp || null
            });

            await processSummaryQueue();

            return null;
        };

        const summarizeChatBacklog = async (entries) => {
            if (!Array.isArray(entries) || !summariesEnabled()) {
                return;
            }

            console.log(`Starting chat backlog summarization for ${entries.length} entries...`);

            let count = 0;
            for (const entry of entries) {
                count += 1;
                if (count % 10 === 0 || count === entries.length) {
                    console.log(`Summarizing entry ${count} of ${entries.length}`);
                }
                if (!entry || !entry.id || !entry.content) {
                    continue;
                }

                const stored = Utils.getChatSummary(entry.id);
                if (stored && stored.summary) {
                    entry.summary = stored.summary;
                    continue;
                }

                if (!shouldSummarizeEntry(entry)) {
                    continue;
                }

                const beforeEnqueue = Utils.getChatSummaryQueueLength();
                Utils.enqueueChatSummaryCandidate({
                    entryId: entry.id,
                    content: entry.content,
                    locationId: entry.locationId || null,
                    type: entry.type || (entry.randomEvent ? 'random-event' : 'general'),
                    timestamp: entry.timestamp || null
                });

                const afterEnqueue = Utils.getChatSummaryQueueLength();
                if (afterEnqueue === beforeEnqueue) {
                    continue;
                }

                await processSummaryQueue();
            }

            if (Utils.getChatSummaryQueueLength() > 0) {
                await processSummaryQueue({ flushRemainder: true });
            }
        };

        const findChatEntryIndexByTimestamp = (timestamp) => {
            if (!timestamp) {
                return -1;
            }
            return chatHistory.findIndex(entry => entry && entry.timestamp === timestamp);
        };

        if (Array.isArray(chatHistory)) {
            chatHistory.forEach(normalizeChatEntry);
        }

        function formatDurationLabel(durationSeconds) {
            if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
                return `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`;
            }
            return '=== API CALL DURATION: N/A ===';
        }

        const EVENT_LOCATION_REFRESH_TYPES = new Set([
            'item_appear',
            'drop_item',
            'pick_up_item',
            'transfer_item',
            'consume_item',
            'move_location',
            'npc_arrival_departure',
            'needbar_change',
            'alter_location',
            'alter_npc'
        ]);

        const normalizeSummaryText = (value, fallback) => {
            if (value === null || value === undefined) {
                return fallback;
            }

            console.log("Normalize summary text value:", value);
            if (typeof value === 'object') {
                const candidateKeys = ['text', 'name', 'title', 'label', 'description', 'raw'];
                for (const key of candidateKeys) {
                    const entry = value[key];
                    if (typeof entry === 'string') {
                        const trimmedEntry = entry.trim();
                        if (trimmedEntry) {
                            return trimmedEntry;
                        }
                    }
                }
                return fallback;
            }

            const text = String(value).trim();
            return text || fallback;
        };

        const safeSummaryName = (value) => {
            const text = normalizeSummaryText(value, 'Someone');
            if (!text) {
                return 'Someone';
            }
            const lower = text.toLowerCase();
            if (lower === 'player' || lower === 'the player') {
                return 'You';
            }
            return text;
        };

        const safeSummaryItem = (value, fallback = 'an item') => {
            return normalizeSummaryText(value, fallback) || fallback;
        };

        const formatLabel = (value) => {
            if (typeof value !== 'string') {
                return '';
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return '';
            }
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
        };

        const buildEnvironmentalSummaryText = ({ name, amount, severity, reason, isHealing }) => {
            const baseName = name ? String(name).trim() : '';
            const severityLabel = severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : '';
            let description = baseName
                ? (isHealing ? `${baseName} regained ${amount} HP` : `${baseName} took ${amount} damage`)
                : (isHealing ? `Regained ${amount} HP` : `Took ${amount} damage`);
            if (severityLabel) {
                description += ` (${severityLabel})`;
            }
            if (reason) {
                description += ` - ${reason}`;
            }
            return description;
        };

        function buildEventSummaryBundle({
            events = null,
            experienceAwards = [],
            currencyChanges = [],
            environmentalDamageEvents = [],
            needBarChanges = []
        } = {}) {
            const bundle = [];
            let shouldRefresh = false;

            const add = (icon, text) => {
                const normalizedText = text && String(text).trim();
                if (!normalizedText) {
                    return;
                }
                bundle.push({ icon: icon || '•', text: normalizedText });
            };

            const parsed = events && typeof events === 'object'
                ? (events.parsed && typeof events.parsed === 'object' ? events.parsed : events)
                : null;

            if (parsed) {
                Object.entries(parsed).forEach(([eventType, payload]) => {
                    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
                        return;
                    }

                    const entries = Array.isArray(payload) ? payload : [payload];
                    switch (eventType) {
                        case 'attack_damage':
                            entries.forEach(entry => {
                                const attacker = safeSummaryName(entry?.attacker);
                                const target = safeSummaryName(entry?.target || 'their target');
                                add('⚔️', `${attacker} attacked ${target}.`);
                            });
                            break;
                        case 'consume_item':
                            entries.forEach(entry => {
                                const user = safeSummaryName(entry?.user);
                                const item = safeSummaryItem(entry?.item);
                                add('🧪', `${user} consumed ${item}.`);
                            });
                            break;
                        case 'death_incapacitation':
                            entries.forEach(name => {
                                add('☠️', `${safeSummaryName(name)} was incapacitated.`);
                            });
                            break;
                        case 'drop_item':
                            entries.forEach(entry => {
                                const character = safeSummaryName(entry?.character);
                                const item = safeSummaryItem(entry?.item);
                                add('📦', `${character} dropped ${item}.`);
                            });
                            break;
                        case 'heal_recover':
                            entries.forEach(entry => {
                                const healer = entry?.healer ? safeSummaryName(entry.healer) : null;
                                const recipient = safeSummaryName(entry?.recipient);
                                const effect = entry?.effect && String(entry.effect).trim();
                                const detail = effect ? ` (${effect})` : '';
                                add('💖', healer
                                    ? `${healer} healed ${recipient}${detail}.`
                                    : `${recipient} recovered${detail}.`);
                            });
                            break;
                        case 'item_appear':
                            entries.forEach(item => {
                                add('✨', `${safeSummaryItem(item)} appeared in the scene.`);
                            });
                            break;
                        case 'move_location':
                            entries.forEach(location => {
                                add('🚶', `Travelled to ${safeSummaryItem(location, 'a new location')}.`);
                            });
                            break;
                        case 'new_exit_discovered':
                            entries.forEach(description => {
                                add('🚪', `New exit discovered: ${safeSummaryItem(description, 'a new path')}.`);
                                console.log("[Debug] New exit discovered event:", description);
                            });
                            break;
                        case 'npc_arrival_departure':
                            entries.forEach(entry => {
                                const name = safeSummaryName(entry?.name);
                                const action = (entry?.action || '').trim().toLowerCase();
                                const destination = entry?.destination || entry?.location;
                                const destinationText = destination
                                    ? safeSummaryItem(destination, 'another location')
                                    : null;
                                if (action === 'arrived') {
                                    add('🙋', `${name} arrived at the location.`);
                                } else if (action === 'left') {
                                    const detail = destinationText ? ` for ${destinationText}` : '';
                                    add('🏃', `${name} left the area${detail}.`);
                                } else {
                                    add('📍', `${name} ${entry?.action || 'moved'}.`);
                                }
                            });
                            break;
                        case 'party_change':
                            entries.forEach(entry => {
                                const name = safeSummaryName(entry?.name);
                                const action = (entry?.action || '').trim().toLowerCase();
                                if (action === 'joined') {
                                    add('🤝', `${name} joined the party.`);
                                } else if (action === 'left') {
                                    add('👋', `${name} left the party.`);
                                } else {
                                    add('📣', `${name} ${entry?.action || 'changed party status'}.`);
                                }
                            });
                            break;
                        case 'pick_up_item':
                            entries.forEach(entry => {
                                const actor = safeSummaryName(entry?.name);
                                const itemName = safeSummaryItem(entry?.item);
                                add('🎒', `${actor} picked up ${itemName}.`);
                            });
                            break;
                        case 'alter_item':
                            entries.forEach(entry => {
                                if (!entry) {
                                    return;
                                }
                                const original = safeSummaryItem(entry.originalName || entry.newName || 'an item');
                                const renamed = entry.newName && entry.originalName && entry.newName !== entry.originalName
                                    ? safeSummaryItem(entry.newName)
                                    : null;
                                const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                                let text;
                                if (renamed) {
                                    text = `${original} changed to ${renamed}`;
                                } else {
                                    text = `${original} was altered permanently`;
                                }
                                if (changeDescription) {
                                    text += ` (${changeDescription})`;
                                }
                                text += '.';
                                add('🛠️', text);
                            });
                            shouldRefresh = true;
                            break;
                        case 'alter_location':
                            entries.forEach(entry => {
                                if (!entry) {
                                    return;
                                }
                                const locationName = safeSummaryItem(entry.name || 'The location', 'the location');
                                const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                                const text = changeDescription
                                    ? `${locationName} changed: ${changeDescription}.`
                                    : `${locationName} was altered.`;
                                add('🏙️', text);
                            });
                            shouldRefresh = true;
                            break;
                        case 'alter_npc':
                            entries.forEach(entry => {
                                if (!entry) {
                                    return;
                                }
                                const npcName = safeSummaryName(entry.name || entry.originalName || 'An NPC');
                                const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                                let text = changeDescription
                                    ? `${npcName}: ${changeDescription}`
                                    : `${npcName} was altered.`;
                                if (Array.isArray(entry.droppedItems) && entry.droppedItems.length) {
                                    const droppedList = entry.droppedItems.map(item => safeSummaryItem(item, 'an item')).join(', ');
                                    text += ` Dropped ${droppedList}.`;
                                }
                                add('🧬', text.endsWith('.') ? text : `${text}.`);
                            });
                            shouldRefresh = true;
                            break;
                        case 'status_effect_change':
                            entries.forEach(entry => {
                                const entity = safeSummaryName(entry?.entity);
                                const description = entry?.description ? String(entry.description).trim() : 'a status effect';
                                const action = (entry?.action || '').trim().toLowerCase();
                                if (action === 'gained' || action === 'added' || action === 'applied') {
                                    add('🌀', `${entity} gained ${description}.`);
                                } else if (action === 'lost' || action === 'removed') {
                                    add('🌀', `${entity} lost ${description}.`);
                                } else {
                                    add('🌀', `${entity} changed status: ${description}.`);
                                }
                            });
                            break;
                        case 'transfer_item':
                            entries.forEach(entry => {
                                const giver = safeSummaryName(entry?.giver);
                                const receiver = safeSummaryName(entry?.receiver || 'someone');
                                const item = safeSummaryItem(entry?.item);
                                add('🔄', `${giver} gave ${item} to ${receiver}.`);
                            });
                            break;
                        case 'needbar_change':
                            {
                                let emitted = false;
                                entries.forEach(entry => {
                                    const isPassiveAdjustment = (() => {
                                        const magnitudeRaw = entry?.magnitude ? String(entry.magnitude).trim().toLowerCase() : '';
                                        const reasonRaw = entry?.reason ? String(entry.reason).trim().toLowerCase() : '';
                                        return magnitudeRaw === 'perturn' || reasonRaw.includes('passive per-turn adjustment');
                                    })();
                                    if (isPassiveAdjustment) {
                                        return;
                                    }
                                    const actor = safeSummaryName(entry?.character || entry?.name);
                                    const barName = safeSummaryItem(entry?.needBar, 'a Need Bar');
                                    const direction = formatLabel(entry?.direction || '');
                                    const magnitude = formatLabel(entry?.magnitude || '');
                                    const detailParts = [];
                                    if (magnitude) {
                                        detailParts.push(magnitude.toLowerCase());
                                    }
                                    if (direction) {
                                        detailParts.push(direction.toLowerCase());
                                    }
                                    const detail = detailParts.length ? detailParts.join(' ') : 'changed';
                                    add('🧪', `${actor}'s ${barName} ${detail}.`);
                                    emitted = true;
                                });
                                if (emitted) {
                                    shouldRefresh = true;
                                }
                            }
                            break;
                        default:
                            break;
                    }

                    if (!shouldRefresh && EVENT_LOCATION_REFRESH_TYPES.has(eventType)) {
                        shouldRefresh = true;
                    }
                });
            }

            if (Array.isArray(experienceAwards)) {
                experienceAwards.forEach(entry => {
                    if (!entry) {
                        return;
                    }
                    const amount = Number(entry.amount ?? entry);
                    if (!Number.isFinite(amount) || amount <= 0) {
                        return;
                    }
                    const reason = entry.reason && String(entry.reason).trim();
                    const text = `+${Math.round(amount)} XP${reason ? ` (${reason})` : ''}`;
                    add('✨', text);
                });
            }

            if (Array.isArray(currencyChanges)) {
                currencyChanges.forEach(entry => {
                    if (!entry) {
                        return;
                    }
                    const amount = Number(entry.amount ?? entry);
                    if (!Number.isFinite(amount) || amount === 0) {
                        return;
                    }
                    const sign = amount > 0 ? '+' : '-';
                    const absolute = Math.abs(Math.round(amount));
                    const label = getCurrencyLabel(absolute, { setting: currentSetting || null });
                    add('💰', `${sign}${absolute} ${label}`);
                });
            }

            if (Array.isArray(environmentalDamageEvents)) {
                environmentalDamageEvents.forEach(entry => {
                    if (!entry) {
                        return;
                    }
                    const amount = Number(entry.amount ?? entry.damage ?? entry.value);
                    if (!Number.isFinite(amount) || amount === 0) {
                        return;
                    }
                    const severity = entry.severity ? String(entry.severity).trim() : '';
                    const reason = entry.reason ? String(entry.reason).trim() : '';
                    const effectType = entry.type ? String(entry.type).trim().toLowerCase() : 'damage';
                    const isHealing = effectType === 'healing' || effectType === 'heal';
                    add(
                        isHealing ? '🌿' : '☠️',
                        buildEnvironmentalSummaryText({
                            name: entry.name ? String(entry.name).trim() : '',
                            amount: Math.abs(Math.round(amount)),
                            severity,
                            reason,
                            isHealing
                        })
                    );
                });
            }

            if (Array.isArray(needBarChanges)) {
                needBarChanges.forEach(entry => {
                    if (!entry) {
                        return;
                    }
                    const actorName = safeSummaryName(entry.actorName || entry.actorId || 'Unknown');
                    const barName = safeSummaryItem(entry.needBarName || entry.needBar || 'Need Bar');
                    const directionLabel = formatLabel(entry.direction || '');
                    const magnitudeLabel = formatLabel(entry.magnitude || '');
                    const parts = [];
                    if (magnitudeLabel) {
                        parts.push(magnitudeLabel.toLowerCase());
                    }
                    if (directionLabel) {
                        parts.push(directionLabel.toLowerCase());
                    }
                    const detail = parts.length ? parts.join(' ') : 'changed';
                    const segments = [`${actorName}'s ${barName} ${detail}`];
                    const delta = Number(entry.delta);
                    if (Number.isFinite(delta) && delta !== 0) {
                        segments.push(`Δ ${delta > 0 ? '+' : ''}${Math.round(delta)}`);
                    }
                    const reason = entry.reason && String(entry.reason).trim();
                    if (reason) {
                        segments.push(`– ${reason}`);
                    }
                    const threshold = entry.currentThreshold;
                    if (threshold && threshold.name) {
                        const effect = threshold.effect ? ` – ${threshold.effect}` : '';
                        segments.push(`→ ${threshold.name}${effect}`);
                    }
                    add('🧪', segments.join(' '));
                });
                shouldRefresh = true;
            }

            return {
                items: bundle,
                shouldRefresh
            };
        }

        function formatEventSummaryText(bundle, title = '📋 Events') {
            if (!Array.isArray(bundle) || !bundle.length) {
                return '';
            }
            const lines = [title];
            bundle.forEach(item => {
                if (!item) {
                    return;
                }
                const icon = item.icon || '•';
                const text = item.text || '';
                lines.push(`• ${icon} ${text}`.trim());
            });
            return lines.join('\n');
        }

        function recordEventSummaryEntry({
            label = '📋 Events',
            events = null,
            experienceAwards = null,
            currencyChanges = null,
            environmentalDamageEvents = null,
            needBarChanges = null,
            timestamp = null,
            parentId = null,
            locationId = null
        } = {}, collector = null) {
            if (!Array.isArray(chatHistory)) {
                return null;
            }

            const bundle = buildEventSummaryBundle({
                events,
                experienceAwards,
                currencyChanges,
                environmentalDamageEvents,
                needBarChanges
            });

            if (!bundle.items.length) {
                return null;
            }

            const resolvedLocationId = requireLocationId(locationId, 'recordEventSummaryEntry');

            const summaryText = formatEventSummaryText(bundle.items, label);
            if (!summaryText) {
                return null;
            }

            const entry = {
                role: 'assistant',
                content: summaryText,
                timestamp: timestamp || new Date().toISOString(),
                parentId: parentId || null,
                type: 'event-summary',
                summaryTitle: label,
                summaryItems: bundle.items.map(item => ({
                    icon: item?.icon || '•',
                    text: item?.text || ''
                })),
                locationId: resolvedLocationId
            };

            const storedEntry = pushChatEntry(entry, collector, resolvedLocationId);
            return {
                summaryText,
                shouldRefresh: bundle.shouldRefresh,
                entry: storedEntry
            };
        }

        function recordPlausibilityEntry({ data, timestamp = null, parentId = null, locationId = null } = {}, collector = null) {
            if (!Array.isArray(chatHistory)) {
                return null;
            }
            if (!data || typeof data !== 'object') {
                throw new Error('recordPlausibilityEntry requires structured plausibility data');
            }

            const resolvedLocationId = requireLocationId(locationId, 'recordPlausibilityEntry');

            const raw = typeof data.raw === 'string' && data.raw.trim().length ? data.raw.trim() : null;
            const structured = data.structured && typeof data.structured === 'object' ? data.structured : null;
            if (!raw && !structured) {
                throw new Error('recordPlausibilityEntry received data without raw text or structured content');
            }

            let serialized;
            try {
                serialized = JSON.parse(JSON.stringify({ raw, structured }));
            } catch (error) {
                throw new Error(`Failed to serialize plausibility data: ${error.message}`);
            }

            const entry = {
                role: 'assistant',
                type: 'plausibility',
                timestamp: timestamp || new Date().toISOString(),
                parentId: parentId || null,
                plausibility: serialized,
                locationId: resolvedLocationId
            };

            return pushChatEntry(entry, collector, resolvedLocationId);
        }

        function recordSkillCheckEntry({ resolution, timestamp = null, parentId = null, locationId = null } = {}, collector = null) {
            if (!Array.isArray(chatHistory)) {
                return null;
            }
            if (!resolution || typeof resolution !== 'object') {
                return null;
            }

            const resolvedLocationId = requireLocationId(locationId, 'recordSkillCheckEntry');

            let serializedResolution = null;
            try {
                serializedResolution = JSON.parse(JSON.stringify(resolution));
            } catch (_) {
                serializedResolution = { ...resolution };
            }

            const entry = {
                role: 'assistant',
                type: 'skill-check',
                timestamp: timestamp || new Date().toISOString(),
                parentId: parentId || null,
                skillCheck: serializedResolution,
                locationId: resolvedLocationId
            };

            return pushChatEntry(entry, collector, resolvedLocationId);
        }

        function recordAttackCheckEntry({ summary, attackCheck = null, timestamp = null, parentId = null, locationId = null } = {}, collector = null) {
            if (!Array.isArray(chatHistory)) {
                return null;
            }
            if (!summary || typeof summary !== 'object') {
                return null;
            }

            const resolvedLocationId = requireLocationId(locationId, 'recordAttackCheckEntry');

            let summaryCopy;
            try {
                summaryCopy = JSON.parse(JSON.stringify(summary));
            } catch (_) {
                summaryCopy = { ...summary };
            }

            let attackCheckCopy = null;
            if (attackCheck && typeof attackCheck === 'object') {
                try {
                    attackCheckCopy = JSON.parse(JSON.stringify(attackCheck));
                } catch (_) {
                    attackCheckCopy = { ...attackCheck };
                }
            }

            const entry = {
                role: 'assistant',
                type: 'attack-check',
                timestamp: timestamp || new Date().toISOString(),
                parentId: parentId || null,
                attackSummary: summaryCopy,
                locationId: resolvedLocationId
            };

            if (attackCheckCopy) {
                entry.attackCheck = attackCheckCopy;
            }

            return pushChatEntry(entry, collector, resolvedLocationId);
        }

        function loadRandomEventLines(type) {
            const normalized = type === 'rare' ? 'rare' : 'common';
            if (Array.isArray(randomEventCache[normalized])) {
                return randomEventCache[normalized];
            }

            try {
                const baseDir = path.resolve(__dirname);
                const filePath = path.join(baseDir, 'random_events', `${normalized}.txt`);
                if (!fs.existsSync(filePath)) {
                    console.warn(`Random event list not found for type "${normalized}": ${filePath}`);
                    randomEventCache[normalized] = [];
                    return randomEventCache[normalized];
                }

                const contents = fs.readFileSync(filePath, 'utf8');
                const lines = contents
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('#'));

                randomEventCache[normalized] = lines;
                return lines;
            } catch (error) {
                console.warn(`Failed to load random event list for type "${normalized}":`, error.message);
                randomEventCache[normalized] = [];
                return randomEventCache[normalized];
            }
        }

        function pickRandomEventSeed(type) {
            const lines = loadRandomEventLines(type);
            if (!lines.length) {
                return null;
            }
            const index = Math.floor(Math.random() * lines.length);
            return lines[index];
        }

        function parseRandomEventResponse(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return null;
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return null;
            }

            let doc;
            try {
                const parser = new DOMParser({
                    errorHandler: {
                        warning: () => { },
                        error: () => { },
                        fatalError: () => { }
                    }
                });
                doc = parser.parseFromString(sanitizeForXml(trimmed), 'text/xml');
            } catch (error) {
                console.warn('Failed to parse random event response XML:', error.message);
                return null;
            }

            if (!doc || doc.getElementsByTagName('parsererror')?.length) {
                return null;
            }

            const root = doc.getElementsByTagName('eventResponse')[0] || doc.documentElement;
            if (!root) {
                return null;
            }

            const textNode = root.getElementsByTagName('eventText')[0];
            const attackNode = root.getElementsByTagName('isAttack')[0];

            const eventText = textNode && typeof textNode.textContent === 'string'
                ? textNode.textContent.trim()
                : '';
            const isAttack = attackNode && typeof attackNode.textContent === 'string'
                ? /^true$/i.test(attackNode.textContent.trim())
                : false;

            return {
                eventText,
                isAttack
            };
        }

        function logRandomEventPrompt({ rarity, eventText, systemPrompt, generationPrompt, responseText, durationSeconds }) {
            try {
                const logsDir = path.join(baseDir, 'logs');
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }

                const timestamp = Date.now();
                const safeSeed = (eventText || '')
                    .replace(/[^a-zA-Z0-9_-]+/g, '_')
                    .replace(/_{2,}/g, '_')
                    .replace(/^_+|_+$/g, '')
                    .slice(0, 40);
                const filename = `random_event_${rarity || 'common'}_${timestamp}${safeSeed ? `_${safeSeed}` : ''}.log`;
                const logPath = path.join(logsDir, filename);

                const parts = [
                    formatDurationLabel(durationSeconds),
                    `Rarity: ${rarity || 'common'}`,
                    `Seed Event: ${eventText || '(unknown)'}`,
                    '=== RANDOM EVENT SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== RANDOM EVENT GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== RANDOM EVENT RESPONSE ===',
                    responseText || '(none)',
                    ''
                ];

                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log random event prompt:', error.message);
            }
        }

        async function generateRandomEventNarrative({ eventText, rarity, locationOverride = null, stream = null } = {}) {
            if (!eventText || !eventText.trim()) {
                return null;
            }

            const trimmedEventText = eventText.trim();

            if (stream && stream.isEnabled) {
                stream.status('random_event:processing', {
                    rarity: rarity || 'common',
                    seed: trimmedEventText
                });
            }

            try {
                const baseContext = buildBasePromptContext({ locationOverride });
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'random-event',
                    eventText: trimmedEventText
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
                    console.warn('Random event template missing prompts; skipping.');
                    return null;
                }

                const messages = [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ];

                const endpoint = config?.ai?.endpoint;
                const apiKey = config?.ai?.apiKey;
                const model = config?.ai?.model;

                if (!endpoint || !apiKey || !model) {
                    console.warn('AI configuration missing; unable to run random event prompt.');
                    return null;
                }

                const chatEndpoint = endpoint.endsWith('/')
                    ? `${endpoint}chat/completions`
                    : `${endpoint}/chat/completions`;

                const requestData = {
                    model,
                    messages,
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 400,
                    temperature: typeof parsedTemplate.temperature === 'number'
                        ? parsedTemplate.temperature
                        : (config.ai.temperature || 0.7)
                };

                const start = Date.now();
                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: (config.ai.baseTimeoutMilliseconds ? config.ai.baseTimeoutMilliseconds * 1000 : 60000)
                });
                const durationSeconds = (Date.now() - start) / 1000;

                const rawResponse = response.data?.choices?.[0]?.message?.content || '';
                logRandomEventPrompt({
                    rarity,
                    eventText: trimmedEventText,
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText: rawResponse,
                    durationSeconds
                });

                const parsedResponse = parseRandomEventResponse(rawResponse);
                const narrativeText = (parsedResponse?.eventText || rawResponse || '').trim();
                const isAttack = Boolean(parsedResponse?.isAttack);

                if (!narrativeText) {
                    return null;
                }

                const randomEventLocationId = requireLocationId(location?.id, 'random event entry');
                const randomEventEntry = pushChatEntry({
                    role: 'assistant',
                    content: narrativeText,
                    actor: 'Random Event',
                    randomEvent: true,
                    rarity: rarity || 'common',
                    type: 'random-event',
                    locationId: randomEventLocationId
                }, null, randomEventLocationId);
                const randomEventTimestamp = randomEventEntry?.timestamp || new Date().toISOString();

                let eventChecks = null;
                try {
                    eventChecks = await Events.runEventChecks({ textToCheck: narrativeText, stream });
                } catch (eventCheckError) {
                    console.warn('Failed to apply random event checks:', eventCheckError.message);
                }

                const summary = {
                    type: 'random-event',
                    randomEvent: true,
                    rarity: rarity || 'common',
                    seedText: trimmedEventText,
                    response: narrativeText,
                    rawResponse,
                    isAttack,
                    timestamp: randomEventTimestamp,
                    eventChecks: eventChecks?.html || null,
                    events: eventChecks?.structured || null
                };

                if (Array.isArray(eventChecks?.experienceAwards) && eventChecks.experienceAwards.length) {
                    summary.experienceAwards = eventChecks.experienceAwards;
                }
                if (Array.isArray(eventChecks?.currencyChanges) && eventChecks.currencyChanges.length) {
                    summary.currencyChanges = eventChecks.currencyChanges;
                }
                if (Array.isArray(eventChecks?.environmentalDamageEvents) && eventChecks.environmentalDamageEvents.length) {
                    summary.environmentalDamageEvents = eventChecks.environmentalDamageEvents;
                }

                try {
                    await summarizeChatEntry(randomEventEntry, { location, type: 'random-event' });
                } catch (summaryError) {
                    console.warn('Failed to summarize random event entry:', summaryError.message);
                }

                if (randomEventEntry.summary) {
                    summary.summary = randomEventEntry.summary;
                }
                if (Array.isArray(eventChecks?.needBarChanges) && eventChecks.needBarChanges.length) {
                    summary.needBarChanges = eventChecks.needBarChanges;
                }

                recordEventSummaryEntry({
                    label: '📋 Events – Random Event',
                    events: summary.events,
                    experienceAwards: summary.experienceAwards,
                    currencyChanges: summary.currencyChanges,
                    environmentalDamageEvents: summary.environmentalDamageEvents,
                    needBarChanges: summary.needBarChanges,
                    timestamp: summary.timestamp,
                    parentId: randomEventEntry?.id || null,
                    locationId: randomEventLocationId
                });

                return summary;
            } finally {
                if (stream && stream.isEnabled) {
                    stream.status('random_event:complete', {
                        rarity: rarity || 'common',
                        seed: eventText || ''
                    });
                }
            }
        }

        async function maybeTriggerRandomEvent({ stream = null, locationOverride = null } = {}) {
            const frequencyConfig = config?.random_event_frequency || {};
            const commonChance = Number(frequencyConfig.common);
            const rareChance = Number(frequencyConfig.rare);

            let rarity = null;
            if (Number.isFinite(commonChance) && commonChance > 0 && Math.random() < commonChance) {
                rarity = 'common';
            } else if (Number.isFinite(rareChance) && rareChance > 0 && Math.random() < rareChance) {
                rarity = 'rare';
            }

            if (!rarity) {
                return null;
            }

            const seedText = pickRandomEventSeed(rarity);
            if (!seedText) {
                console.warn(`Random event triggered, but no ${rarity} entries were available.`);
                return null;
            }

            return generateRandomEventNarrative({
                eventText: seedText,
                rarity,
                locationOverride,
                stream
            });
        }

        function parseAttackCheckResponse(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return null;
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return null;
            }

            let doc;
            try {
                const parser = new DOMParser({
                    errorHandler: {
                        warning: () => { },
                        error: () => { },
                        fatalError: () => { }
                    }
                });
                doc = parser.parseFromString(sanitizeForXml(trimmed), 'text/xml');
            } catch (error) {
                console.warn('Failed to parse attack check XML:', error.message);
                return null;
            }

            if (!doc || doc.getElementsByTagName('parsererror')?.length) {
                console.warn('Attack check XML contained parser errors.');
                return null;
            }

            const attackNodes = Array.from(doc.getElementsByTagName('attack'));
            if (!attackNodes.length) {
                const normalized = trimmed.toLowerCase();
                if (normalized === 'n/a') {
                    return { attacks: [], hasAttack: false };
                }
                return null;
            }

            const normalizeValue = (value) => {
                if (value === null || value === undefined) {
                    return null;
                }
                const text = String(value).trim();
                if (!text || text.toLowerCase() === 'n/a') {
                    return null;
                }
                return text;
            };

            const getTagValue = (node, tag) => {
                const element = node.getElementsByTagName(tag)?.[0];
                if (!element || typeof element.textContent !== 'string') {
                    return null;
                }
                return normalizeValue(element.textContent);
            };

            const getNestedTagValue = (node, parentTag, childTag) => {
                const parentNode = node.getElementsByTagName(parentTag)?.[0];
                if (!parentNode) {
                    return null;
                }
                const childNode = parentNode.getElementsByTagName(childTag)?.[0];
                if (!childNode || typeof childNode.textContent !== 'string') {
                    return null;
                }
                return normalizeValue(childNode.textContent);
            };

            const getNumericTagValue = (node, tag) => {
                const raw = getTagValue(node, tag);
                if (raw === null || raw === undefined) {
                    return null;
                }
                const numeric = Number(raw);
                return Number.isFinite(numeric) ? numeric : null;
            };

            const attacks = [];
            let rejectionReason = null;
            for (const attackNode of attackNodes) {
                const rejectedNode = attackNode.getElementsByTagName('rejected')?.[0] || null;
                if (rejectedNode) {
                    const rejectionText = getNestedTagValue(attackNode, 'rejected', 'reason')
                        || getTagValue(rejectedNode, 'reason');
                    if (rejectionText) {
                        rejectionReason = rejectionReason || rejectionText;
                    }
                    continue;
                }

                const attacker = getTagValue(attackNode, 'attacker');
                const defender = getTagValue(attackNode, 'defender');
                const ability = getTagValue(attackNode, 'ability');
                const weapon = getTagValue(attackNode, 'weapon');

                const attackSkill = getNestedTagValue(attackNode, 'attackerInfo', 'attackSkill');
                const damageAttribute = getNestedTagValue(attackNode, 'attackerInfo', 'damageAttribute');
                const defenseSkillLegacy = getNestedTagValue(attackNode, 'defenderInfo', 'defenseSkill');
                const evadeSkill = getNestedTagValue(attackNode, 'defenderInfo', 'evadeSkill') || defenseSkillLegacy;
                const deflectSkill = getNestedTagValue(attackNode, 'defenderInfo', 'deflectSkill');
                const toughnessAttribute = getNestedTagValue(attackNode, 'defenderInfo', 'toughnessAttribute');

                const hasNestedInfo = attackSkill || damageAttribute || evadeSkill || deflectSkill || toughnessAttribute;

                if (!attacker && !defender && !ability && !weapon && !hasNestedInfo) {
                    continue;
                }

                const attackEntry = { attacker, defender, ability, weapon };

                const collectCircumstanceModifiers = (node) => {
                    if (!node || typeof node.getElementsByTagName !== 'function') {
                        return [];
                    }

                    const modifierNodes = Array.from(node.getElementsByTagName('circumstanceModifier') || []);
                    const modifiers = [];

                    for (const modifierNode of modifierNodes) {
                        if (!modifierNode || typeof modifierNode.getElementsByTagName !== 'function') {
                            continue;
                        }

                        const amountNode = modifierNode.getElementsByTagName('amount')?.[0] || null;
                        const reasonNode = modifierNode.getElementsByTagName('reason')?.[0] || null;

                        const amountText = amountNode && typeof amountNode.textContent === 'string'
                            ? amountNode.textContent.trim()
                            : null;
                        const reasonText = reasonNode && typeof reasonNode.textContent === 'string'
                            ? reasonNode.textContent.trim()
                            : null;

                        const amount = amountText !== null && amountText !== '' ? Number(amountText) : null;
                        const hasReason = reasonText && reasonText.toLowerCase() !== 'n/a';

                        if (!Number.isFinite(amount) && !hasReason) {
                            continue;
                        }

                        modifiers.push({
                            amount: Number.isFinite(amount) ? amount : 0,
                            reason: hasReason ? reasonText : null
                        });
                    }

                    return modifiers;
                };

                if (attackSkill || damageAttribute) {
                    attackEntry.attackerInfo = {
                        attackSkill: attackSkill || null,
                        damageAttribute: damageAttribute || null
                    };
                }

                if (evadeSkill || deflectSkill || toughnessAttribute || defenseSkillLegacy) {
                    const defenderInfo = {};
                    if (evadeSkill) {
                        defenderInfo.evadeSkill = evadeSkill;
                    }
                    if (defenseSkillLegacy && !evadeSkill) {
                        defenderInfo.defenseSkill = defenseSkillLegacy;
                    }
                    if (deflectSkill) {
                        defenderInfo.deflectSkill = deflectSkill;
                    }
                    if (toughnessAttribute) {
                        defenderInfo.toughnessAttribute = toughnessAttribute;
                    }
                    attackEntry.defenderInfo = defenderInfo;
                }

                const parsedCircumstances = collectCircumstanceModifiers(attackNode);
                if (parsedCircumstances.length) {
                    attackEntry.circumstanceModifiers = parsedCircumstances;
                    const totalModifier = parsedCircumstances.reduce((sum, entry) => {
                        return sum + (Number.isFinite(entry?.amount) ? entry.amount : 0);
                    }, 0);
                    attackEntry.circumstanceModifier = totalModifier;

                    const combinedReasons = parsedCircumstances
                        .map(entry => (entry && entry.reason && entry.reason.toLowerCase() !== 'n/a') ? entry.reason : null)
                        .filter(Boolean);
                    if (combinedReasons.length) {
                        attackEntry.circumstanceModifierReason = combinedReasons.join('; ');
                    }
                } else {
                    const circumstanceModifier = getNumericTagValue(attackNode, 'circumstanceModifier');
                    if (Number.isFinite(circumstanceModifier)) {
                        attackEntry.circumstanceModifier = circumstanceModifier;
                        attackEntry.circumstanceModifiers = [{
                            amount: circumstanceModifier,
                            reason: null
                        }];
                    }
                    const circumstanceReason = getTagValue(attackNode, 'circumstanceModifierReason');
                    if (circumstanceReason) {
                        attackEntry.circumstanceModifierReason = circumstanceReason;
                        if (!attackEntry.circumstanceModifiers) {
                            attackEntry.circumstanceModifiers = [{
                                amount: Number.isFinite(attackEntry.circumstanceModifier)
                                    ? attackEntry.circumstanceModifier
                                    : 0,
                                reason: circumstanceReason && circumstanceReason.toLowerCase() !== 'n/a'
                                    ? circumstanceReason
                                    : null
                            }];
                        } else if (attackEntry.circumstanceModifiers.length) {
                            const firstEntry = attackEntry.circumstanceModifiers[0];
                            if (firstEntry && !firstEntry.reason && circumstanceReason.toLowerCase() !== 'n/a') {
                                firstEntry.reason = circumstanceReason;
                            }
                        }
                    }
                }

                attacks.push(attackEntry);
            }

            const hasAttack = attacks.length > 0;
            const result = {
                attacks,
                hasAttack
            };

            if (!hasAttack && rejectionReason) {
                result.isRejected = true;
                result.rejection = { reason: rejectionReason };
                result.rejectionReason = rejectionReason;
            }

            return result;
        }

        function logAttackCheck({ systemPrompt, generationPrompt, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `attack_check_${timestamp}.log`);
                const parts = [
                    '=== ATTACK CHECK SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== ATTACK CHECK GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== ATTACK CHECK RESPONSE ===',
                    responseText || '(no response)',
                    ''
                ];
                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log attack check:', error.message);
            }
        }

        function logPlayerActionPrompt({ systemPrompt, generationPrompt }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `player_action_${timestamp}.log`);
                const parts = [
                    '=== PLAYER ACTION SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== PLAYER ACTION GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    ''
                ];
                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log player action prompt:', error.message);
            }
        }

        async function runAttackCheckPrompt({ actionText, locationOverride, characterName = 'The player' }) {
            if (!actionText || !actionText.trim()) {
                return null;
            }

            if (!currentPlayer) {
                return null;
            }

            try {
                const baseContext = buildBasePromptContext({ locationOverride: locationOverride || null });
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'attack-check',
                    actionText,
                    characterName
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    console.warn('Attack template missing prompts, skipping attack analysis.');
                    return null;
                }

                const messages = [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ];

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages,
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 200,
                    temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.3
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const attackResponse = response.data?.choices?.[0]?.message?.content || '';

                logAttackCheck({
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText: attackResponse
                });

                if (!attackResponse.trim()) {
                    return null;
                }

                const safeResponse = Events.escapeHtml(attackResponse.trim());
                return {
                    raw: attackResponse,
                    html: safeResponse.replace(/\n/g, '<br>'),
                    structured: parseAttackCheckResponse(attackResponse)
                };
            } catch (error) {
                console.warn('Attack check failed:', error.message);
                return null;
            }
        }

        function logDispositionCheck({ systemPrompt, generationPrompt, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `disposition_check_${timestamp}.log`);
                const parts = [
                    '=== DISPOSITION CHECK SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== DISPOSITION CHECK GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== DISPOSITION CHECK RESPONSE ===',
                    responseText || '(no response)',
                    ''
                ];
                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log disposition check prompt:', error.message);
            }
        }

        const BAREHANDED_KEYWORDS = new Set(['barehanded', 'bare hands', 'unarmed', 'fists']);

        const applyNeedBarTurnTick = () => {
            const summaries = [];
            for (const actor of players.values()) {
                if (!actor || typeof actor.applyNeedBarTurnChange !== 'function') {
                    continue;
                }
                const adjustments = actor.applyNeedBarTurnChange();
                if (adjustments && adjustments.length) {
                    summaries.push({
                        actorId: actor.id,
                        actorName: actor.name || null,
                        adjustments
                    });
                }
            }
            return summaries;
        };

        const sanitizeNamedValue = (value) => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            const lowered = trimmed.toLowerCase();
            if (lowered === 'n/a' || lowered === 'none') {
                return null;
            }
            return trimmed;
        };

        const resolveSkillDefinition = (skillName) => {
            const sanitized = sanitizeNamedValue(skillName);
            if (!sanitized || !skills || typeof skills.entries !== 'function') {
                return null;
            }
            const direct = skills.get(sanitized) || skills.get(sanitized.toLowerCase());
            if (direct) {
                return direct;
            }
            const normalized = sanitized.toLowerCase();
            for (const [name, definition] of skills.entries()) {
                if (typeof name === 'string' && name.toLowerCase() === normalized) {
                    return definition;
                }
            }
            return null;
        };

        const resolveActorSkillInfo = (actor, skillName) => {
            const sanitized = sanitizeNamedValue(skillName);
            if (!actor || !sanitized) {
                return { key: null, value: 0 };
            }

            if (typeof actor.getSkillValue === 'function') {
                const directValue = actor.getSkillValue(sanitized);
                if (Number.isFinite(directValue)) {
                    return { key: sanitized, value: directValue };
                }
            }

            if (typeof actor.getSkills === 'function') {
                try {
                    const skillMap = actor.getSkills();
                    if (skillMap && typeof skillMap.entries === 'function') {
                        const normalized = sanitized.toLowerCase();
                        for (const [name, value] of skillMap.entries()) {
                            if (typeof name === 'string' && name.toLowerCase() === normalized && Number.isFinite(value)) {
                                return { key: name, value };
                            }
                        }
                    }
                } catch (_) {
                    // ignore inventory/skill access issues for non-player actors
                }
            }

            return { key: sanitized, value: 0 };
        };

        const resolveActorAttributeKey = (actor, attributeName) => {
            const sanitized = sanitizeNamedValue(attributeName);
            if (!actor || !sanitized || typeof actor.getAttributeNames !== 'function') {
                return null;
            }
            const normalized = sanitized.toLowerCase();
            try {
                for (const name of actor.getAttributeNames()) {
                    if (typeof name === 'string' && name.toLowerCase() === normalized) {
                        return name;
                    }
                }
            } catch (_) {
                // Defensive: actor may not expose attribute list
            }
            return null;
        };

        const resolveActorAttributeInfo = (actor, attributeName) => {
            const sanitized = sanitizeNamedValue(attributeName);
            if (!actor || !sanitized) {
                return { key: null, modifier: 0 };
            }
            const key = resolveActorAttributeKey(actor, sanitized) || sanitized;
            if (typeof actor.getAttributeModifier === 'function') {
                try {
                    const modifier = actor.getAttributeModifier(key);
                    return {
                        key,
                        modifier: Number.isFinite(modifier) ? modifier : 0
                    };
                } catch (_) {
                    return { key, modifier: 0 };
                }
            }
            return { key, modifier: 0 };
        };

        const resolveWeaponThing = (attacker, weaponName) => {
            const sanitized = sanitizeNamedValue(weaponName);
            const normalized = sanitized ? sanitized.toLowerCase() : '';
            if (sanitized && Thing && typeof Thing.getByName === 'function') {
                const byName = Thing.getByName(sanitized);
                if (byName) {
                    return byName;
                }
            }

            if (attacker && typeof attacker.getInventoryItems === 'function' && sanitized) {
                try {
                    const items = attacker.getInventoryItems();
                    if (Array.isArray(items)) {
                        for (const item of items) {
                            if (item && typeof item.name === 'string' && item.name.trim().toLowerCase() === normalized) {
                                return item;
                            }
                        }
                    }
                } catch (_) {
                    // ignore inventory access issues
                }
            }

            if (attacker && typeof attacker.getEquippedItemIdForType === 'function') {
                try {
                    const equippedId = attacker.getEquippedItemIdForType('weapon');
                    if (equippedId) {
                        const byId = Thing.getById(equippedId);
                        if (byId) {
                            return byId;
                        }
                    }
                } catch (_) {
                    // ignore equip lookup issues
                }
            }

            return null;
        };

        const resolveWeaponData = (attacker, weaponName) => {
            const fallbackName = sanitizeNamedValue(weaponName) || 'Barehanded';
            const normalizedName = fallbackName.toLowerCase();
            const weaponThing = resolveWeaponThing(attacker, fallbackName);

            let weaponLevel = Number.isFinite(weaponThing?.level) ? weaponThing.level : null;
            if (!Number.isFinite(weaponLevel)) {
                weaponLevel = Number.isFinite(attacker?.level) ? attacker.level : 1;
            }
            weaponLevel = Math.max(1, weaponLevel || 1);

            const rarity = sanitizeNamedValue(weaponThing?.rarity);
            let rating = rarity ? Thing.getRarityDamageMultiplier(rarity) : null;
            if (!rating) {
                if (BAREHANDED_KEYWORDS.has(normalizedName)) {
                    rating = 0.5;
                } else {
                    rating = Thing.getRarityDamageMultiplier(Thing.getDefaultRarityKey());
                }
            }

            const baseDamage = 10 + weaponLevel * rating;

            return {
                thingId: weaponThing?.id || null,
                name: weaponThing?.name || fallbackName,
                level: weaponLevel,
                rarity: rarity || null,
                rating,
                baseDamage
            };
        };

        const computeAttackOutcome = ({ attackEntry, attacker, defender, weaponName }) => {
            if (!attackEntry || !attacker) {
                return null;
            }

            const attackerInfo = attackEntry.attackerInfo || {};
            const defenderInfo = attackEntry.defenderInfo || {};

            const parsedCircumstanceModifiers = Array.isArray(attackEntry.circumstanceModifiers)
                ? attackEntry.circumstanceModifiers.map(entry => ({
                    amount: Number.isFinite(entry?.amount) ? entry.amount : 0,
                    reason: entry && entry.reason && entry.reason.toLowerCase() !== 'n/a'
                        ? entry.reason
                        : null
                }))
                : [];

            const legacyCircumstanceValueRaw = Number(attackEntry.circumstanceModifier);
            const legacyCircumstanceValue = Number.isFinite(legacyCircumstanceValueRaw) ? legacyCircumstanceValueRaw : 0;

            const totalCircumstanceModifier = parsedCircumstanceModifiers.length
                ? parsedCircumstanceModifiers.reduce((sum, entry) => sum + (Number.isFinite(entry.amount) ? entry.amount : 0), 0)
                : legacyCircumstanceValue;

            const legacyCircumstanceReason = typeof attackEntry.circumstanceModifierReason === 'string'
                ? attackEntry.circumstanceModifierReason.trim()
                : null;

            const combinedCircumstanceReasons = parsedCircumstanceModifiers
                .map(entry => entry.reason && entry.reason.toLowerCase() !== 'n/a' ? entry.reason : null)
                .filter(Boolean);

            const circumstanceReason = combinedCircumstanceReasons.length
                ? combinedCircumstanceReasons.join('; ')
                : (legacyCircumstanceReason && legacyCircumstanceReason.toLowerCase() !== 'n/a'
                    ? legacyCircumstanceReason
                    : null);

            const attackSkillName = sanitizeNamedValue(attackerInfo.attackSkill);
            const damageAttributeName = sanitizeNamedValue(attackerInfo.damageAttribute);
            const attackSkillInfo = resolveActorSkillInfo(attacker, attackSkillName);
            const attackSkillValue = Number.isFinite(attackSkillInfo.value) ? attackSkillInfo.value : 0;

            let attackAttributeName = null;
            const skillDefinition = attackSkillInfo.key ? resolveSkillDefinition(attackSkillInfo.key) : null;
            if (skillDefinition && typeof skillDefinition.attribute === 'string' && skillDefinition.attribute.trim()) {
                attackAttributeName = skillDefinition.attribute;
            }
            if (!attackAttributeName && typeof attackerInfo.attackAttribute === 'string') {
                const sanitized = sanitizeNamedValue(attackerInfo.attackAttribute);
                if (sanitized) {
                    attackAttributeName = sanitized;
                }
            }
            if (!attackAttributeName && damageAttributeName) {
                attackAttributeName = damageAttributeName;
            }

            const attackAttributeInfo = resolveActorAttributeInfo(attacker, attackAttributeName);
            const damageAttributeInfo = damageAttributeName
                ? resolveActorAttributeInfo(attacker, damageAttributeName)
                : attackAttributeInfo;

            const rollResult = diceModule && typeof diceModule.rollDice === 'function'
                ? diceModule.rollDice('1d20')
                : { total: Math.floor(Math.random() * 20) + 1, detail: '1d20 (fallback)' };
            const dieRoll = Number.isFinite(rollResult.total) ? rollResult.total : Math.floor(Math.random() * 20) + 1;

            const defenseCandidates = [];
            const addDefenseCandidate = (name, source) => {
                const sanitized = sanitizeNamedValue(name);
                if (sanitized) {
                    defenseCandidates.push({ name: sanitized, source });
                }
            };
            addDefenseCandidate(defenderInfo.evadeSkill, 'evade');
            addDefenseCandidate(defenderInfo.deflectSkill, 'deflect');
            addDefenseCandidate(defenderInfo.defenseSkill, 'defense');

            if (!defenseCandidates.length && defender) {
                addDefenseCandidate('Evade', 'fallback');
                addDefenseCandidate('Deflect', 'fallback');
            }

            let bestDefense = { name: null, value: 0, source: null };
            if (defender) {
                for (const candidate of defenseCandidates) {
                    const info = resolveActorSkillInfo(defender, candidate.name);
                    const value = Number.isFinite(info.value) ? info.value : 0;
                    if (value > bestDefense.value) {
                        bestDefense = {
                            name: info.key || candidate.name,
                            value,
                            source: candidate.source
                        };
                    }
                }
            }

            const defenderLevel = Number.isFinite(defender?.level) ? defender.level : 0;
            const hitDifficulty = 10 + defenderLevel + (Number.isFinite(bestDefense.value) ? bestDefense.value : 0);

            const hitRollTotal = dieRoll + attackSkillValue + attackAttributeInfo.modifier + totalCircumstanceModifier;
            const hitDegreeRaw = (hitRollTotal - hitDifficulty) / 5;
            const hitDegree = Number.isFinite(hitDegreeRaw) ? Math.round(hitDegreeRaw * 100) / 100 : 0;
            const hit = hitRollTotal >= hitDifficulty;

            const toughnessAttributeName = sanitizeNamedValue(defenderInfo.toughnessAttribute);
            const toughnessInfo = toughnessAttributeName && defender
                ? resolveActorAttributeInfo(defender, toughnessAttributeName)
                : { key: toughnessAttributeName || null, modifier: 0 };

            const weaponData = resolveWeaponData(attacker, weaponName);

            let attackDamage = 0;
            let unmitigatedDamage = 0;
            let mitigatedDamage = 0;
            let toughnessReduction = 0;
            if (hit && hitDegreeRaw >= 0) {
                unmitigatedDamage = 1 + Math.round(
                    weaponData.baseDamage * (0.5 + hitDegreeRaw) + damageAttributeInfo.modifier
                );
                toughnessReduction = Number.isFinite(toughnessInfo.modifier) ? toughnessInfo.modifier : 0;
                mitigatedDamage = unmitigatedDamage - toughnessReduction;
                attackDamage = mitigatedDamage > 0 ? mitigatedDamage : 0;
            }

            const targetHealth = Number.isFinite(defender?.health) ? defender.health : null;
            const targetMaxHealth = Number.isFinite(defender?.maxHealth) ? defender.maxHealth : null;
            const rawRemainingHealth = targetHealth !== null ? targetHealth - attackDamage : null;
            const remainingHealth = rawRemainingHealth !== null ? Math.max(0, rawRemainingHealth) : null;
            const defeated = rawRemainingHealth !== null && attackDamage > 0 && rawRemainingHealth <= 0;

            return {
                hit,
                hitRoll: {
                    die: dieRoll,
                    total: hitRollTotal,
                    detail: rollResult.detail || null,
                    attackSkill: {
                        name: attackSkillInfo.key,
                        value: attackSkillValue
                    },
                    attackAttribute: {
                        name: attackAttributeInfo.key,
                        modifier: attackAttributeInfo.modifier
                    },
                    circumstanceModifier: totalCircumstanceModifier,
                    circumstanceModifiers: parsedCircumstanceModifiers,
                    circumstanceReason: circumstanceReason && circumstanceReason.toLowerCase() !== 'n/a'
                        ? circumstanceReason
                        : null
                },
                difficulty: {
                    value: hitDifficulty,
                    base: 10,
                    defenderLevel,
                    defenseSkill: bestDefense.name ? {
                        name: bestDefense.name,
                        value: bestDefense.value,
                        source: bestDefense.source
                    } : null
                },
                hitDegree,
                damage: {
                    total: attackDamage,
                    raw: unmitigatedDamage,
                    mitigated: mitigatedDamage,
                    toughnessReduction,
                    baseWeaponDamage: weaponData.baseDamage,
                    weaponLevel: weaponData.level,
                    weaponRating: weaponData.rating,
                    weaponName: weaponData.name,
                    weaponRarity: weaponData.rarity,
                    damageAttribute: {
                        name: damageAttributeInfo.key,
                        modifier: damageAttributeInfo.modifier
                    }
                },
                target: {
                    name: sanitizeNamedValue(attackEntry.defender) || null,
                    startingHealth: targetHealth,
                    remainingHealth,
                    rawRemainingHealth,
                    maxHealth: targetMaxHealth,
                    defeated,
                    toughness: {
                        name: toughnessInfo.key,
                        modifier: toughnessInfo.modifier
                    }
                }
            };
        };

        const buildAttackSummary = ({ attackContext, attackOutcome, damageApplication }) => {
            if (!attackContext || !attackOutcome) {
                return null;
            }

            const attacker = attackContext.attacker || {};
            const target = attackContext.target || {};
            const difficulty = attackOutcome.difficulty || {};
            const roll = attackOutcome.hitRoll || {};
            const damage = attackOutcome.damage || {};
            const targetOutcome = attackOutcome.target || {};

            const summary = {
                hit: Boolean(attackOutcome.hit),
                hitDegree: Number.isFinite(attackOutcome.hitDegree) ? attackOutcome.hitDegree : null,
                attacker: {
                    name: typeof attacker.name === 'string' ? attacker.name : null,
                    level: Number.isFinite(attacker.level) ? attacker.level : null,
                    weapon: attacker.weapon || null,
                    ability: attacker.ability || null,
                    attackSkill: roll.attackSkill || null,
                    attackAttribute: roll.attackAttribute || null
                },
                defender: {
                    name: target?.name || targetOutcome?.name || null,
                    level: Number.isFinite(target?.level) ? target.level : (Number.isFinite(targetOutcome?.level) ? targetOutcome.level : null),
                    defenseSkill: difficulty.defenseSkill || null
                },
                roll: {
                    die: Number.isFinite(roll.die) ? roll.die : null,
                    total: Number.isFinite(roll.total) ? roll.total : null,
                    detail: typeof roll.detail === 'string' ? roll.detail : null,
                    attackSkill: roll.attackSkill || null,
                    attackAttribute: roll.attackAttribute || null,
                    circumstanceModifier: Number.isFinite(roll.circumstanceModifier) ? roll.circumstanceModifier : null,
                    circumstanceModifiers: Array.isArray(roll.circumstanceModifiers)
                        ? roll.circumstanceModifiers.map(entry => ({
                            amount: Number.isFinite(entry?.amount) ? entry.amount : 0,
                            reason: entry && entry.reason ? entry.reason : null
                        }))
                        : [],
                    circumstanceReason: roll.circumstanceReason || null
                },
                difficulty: {
                    value: Number.isFinite(difficulty.value) ? difficulty.value : null,
                    base: Number.isFinite(difficulty.base) ? difficulty.base : null,
                    defenderLevel: Number.isFinite(difficulty.defenderLevel) ? difficulty.defenderLevel : null,
                    defenseSkill: difficulty.defenseSkill || null
                },
                damage: {
                    total: Number.isFinite(damage.total) ? damage.total : null,
                    mitigated: Number.isFinite(damage.mitigated) ? damage.mitigated : null,
                    raw: Number.isFinite(damage.raw) ? damage.raw : null,
                    applied: Number.isFinite(damage.applied) ? damage.applied : (Number.isFinite(damageApplication?.damageApplied) ? damageApplication.damageApplied : null),
                    toughnessReduction: Number.isFinite(damage.toughnessReduction) ? damage.toughnessReduction : null,
                    baseWeaponDamage: Number.isFinite(damage.baseWeaponDamage) ? damage.baseWeaponDamage : null,
                    weaponName: damage.weaponName || null,
                    weaponRarity: damage.weaponRarity || null,
                    weaponLevel: Number.isFinite(damage.weaponLevel) ? damage.weaponLevel : null,
                    weaponRating: Number.isFinite(damage.weaponRating) ? damage.weaponRating : null,
                    damageAttribute: damage.damageAttribute || null
                },
                target: {
                    startingHealth: Number.isFinite(targetOutcome.startingHealth) ? targetOutcome.startingHealth : (Number.isFinite(target.health) ? target.health : null),
                    remainingHealth: Number.isFinite(targetOutcome.remainingHealth) ? targetOutcome.remainingHealth : (Number.isFinite(target.remainingHealth) ? target.remainingHealth : null),
                    rawRemainingHealth: Number.isFinite(targetOutcome.rawRemainingHealth) ? targetOutcome.rawRemainingHealth : null,
                    defeated: typeof targetOutcome.defeated === 'boolean' ? targetOutcome.defeated : (typeof target.defeated === 'boolean' ? target.defeated : null),
                    toughness: targetOutcome.toughness || target.toughness || null,
                    healthLostPercent: Number.isFinite(targetOutcome.healthLostPercent)
                        ? targetOutcome.healthLostPercent
                        : (Number.isFinite(damageApplication?.healthLostPercent) ? damageApplication.healthLostPercent : null),
                    remainingHealthPercent: Number.isFinite(targetOutcome.remainingHealthPercent)
                        ? targetOutcome.remainingHealthPercent
                        : (Number.isFinite(damageApplication?.remainingHealthPercent) ? damageApplication.remainingHealthPercent : null)
                }
            };

            return summary;
        };

        function buildAttackContextForActor({ attackCheckInfo, actor, location }) {
            if (!attackCheckInfo || !attackCheckInfo.structured || !actor) {
                return { isAttack: false };
            }

            const structured = attackCheckInfo.structured;
            const attacks = Array.isArray(structured.attacks) ? structured.attacks : [];
            if (!attacks.length) {
                return { isAttack: false };
            }

            const normalize = (value) => typeof value === 'string' ? value.trim().toLowerCase() : null;
            const actorName = normalize(actor.name);
            const aliases = new Set();
            if (actorName) {
                aliases.add(actorName);
            }
            if (!actor.isNPC) {
                aliases.add('player');
                aliases.add('the player');
                aliases.add('you');
            }

            const actorAttack = attacks.find(entry => {
                if (!entry || typeof entry.attacker !== 'string') {
                    return false;
                }
                const attackerName = normalize(entry.attacker);
                if (!attackerName) {
                    return false;
                }
                return aliases.has(attackerName);
            });

            if (!actorAttack) {
                return { isAttack: false };
            }

            const targetNameRaw = typeof actorAttack.defender === 'string' ? actorAttack.defender : '';
            const targetName = targetNameRaw ? targetNameRaw.trim() : '';

            let targetActor = null;
            if (targetName) {
                targetActor = (typeof findActorByName === 'function' ? findActorByName(targetName) : null)
                    || (typeof Player.getByName === 'function' ? Player.getByName(targetName) : null)
                    || null;
            }

            if (targetActor?.id) {
                actorAttack.targetActorId = targetActor.id;
            }

            const collectStatusEffects = (entity) => {
                if (!entity || typeof entity.getStatusEffects !== 'function') {
                    return [];
                }
                return entity.getStatusEffects()
                    .map(effect => {
                        if (!effect) {
                            return null;
                        }
                        if (typeof effect === 'string') {
                            return effect.trim() || null;
                        }
                        if (typeof effect.description === 'string' && effect.description.trim()) {
                            return effect.description.trim();
                        }
                        if (typeof effect.name === 'string' && effect.name.trim()) {
                            return effect.name.trim();
                        }
                        return null;
                    })
                    .filter(Boolean);
            };

            const collectGearNames = (entity) => {
                if (!entity || typeof entity.getGear !== 'function') {
                    return [];
                }
                const gear = entity.getGear();
                if (!gear || typeof gear !== 'object') {
                    return [];
                }
                const names = [];
                for (const slotInfo of Object.values(gear)) {
                    if (!slotInfo || !slotInfo.itemId || typeof slotInfo.itemId !== 'string') {
                        continue;
                    }
                    const thing = Thing.getById(slotInfo.itemId);
                    names.push(thing?.name || slotInfo.itemId);
                }
                return names;
            };

            const attackerWeapon = (() => {
                if (typeof actorAttack.weapon === 'string') {
                    const trimmed = actorAttack.weapon.trim();
                    if (trimmed && trimmed.toLowerCase() !== 'n/a') {
                        return trimmed;
                    }
                }
                if (typeof actor.getEquippedItemIdForType === 'function') {
                    const weaponId = actor.getEquippedItemIdForType('weapon');
                    if (weaponId) {
                        const item = Thing.getById(weaponId);
                        return item?.name || weaponId;
                    }
                }
                return 'Barehanded';
            })();

            const attackerAbility = (() => {
                if (typeof actorAttack.ability === 'string') {
                    const trimmed = actorAttack.ability.trim();
                    if (trimmed && trimmed.toLowerCase() !== 'n/a') {
                        return trimmed;
                    }
                }
                return 'N/A';
            })();

            const attackerStatus = collectStatusEffects(actor);
            const targetStatus = collectStatusEffects(targetActor);
            const targetGear = collectGearNames(targetActor);

            const computedOutcome = computeAttackOutcome({
                attackEntry: actorAttack,
                attacker: actor,
                defender: targetActor,
                weaponName: attackerWeapon
            });

            if (computedOutcome) {
                actorAttack.outcome = computedOutcome;
                attackCheckInfo.computedOutcome = computedOutcome;
            }

            const targetContext = {
                id: targetActor?.id || null,
                name: targetName || null,
                level: Number.isFinite(targetActor?.level) ? targetActor.level : 'unknown',
                gear: targetGear,
                statusEffects: targetStatus,
                healthAttribute: targetActor?.healthAttribute || null
            };

            if (Number.isFinite(targetActor?.health)) {
                targetContext.health = targetActor.health;
            }
            if (Number.isFinite(targetActor?.maxHealth)) {
                targetContext.maxHealth = targetActor.maxHealth;
            }
            if (computedOutcome?.target) {
                const targetOutcome = computedOutcome.target;
                if (targetOutcome.remainingHealth !== undefined && targetOutcome.remainingHealth !== null) {
                    targetContext.remainingHealth = targetOutcome.remainingHealth;
                }
                if (targetOutcome.rawRemainingHealth !== undefined && targetOutcome.rawRemainingHealth !== null) {
                    targetContext.rawRemainingHealth = targetOutcome.rawRemainingHealth;
                }
                if (typeof targetOutcome.defeated === 'boolean') {
                    targetContext.defeated = targetOutcome.defeated;
                }
                if (targetOutcome.toughness) {
                    targetContext.toughness = targetOutcome.toughness;
                }
                if (Number.isFinite(targetOutcome.healthLostPercent)) {
                    targetContext.healthLostPercent = targetOutcome.healthLostPercent;
                }
                if (Number.isFinite(targetOutcome.remainingHealthPercent)) {
                    targetContext.remainingHealthPercent = targetOutcome.remainingHealthPercent;
                }
            }

            const attackerContext = {
                name: typeof actor?.name === 'string' ? actor.name : null,
                id: actor?.id || null,
                level: Number.isFinite(actor?.level) ? actor.level : 'unknown',
                weapon: attackerWeapon,
                ability: attackerAbility,
                statusEffects: attackerStatus
            };

            if (Number.isFinite(actor?.health)) {
                attackerContext.health = actor.health;
            }
            if (Number.isFinite(actor?.maxHealth)) {
                attackerContext.maxHealth = actor.maxHealth;
            }

            if (computedOutcome?.damage) {
                attackerContext.weaponInfo = {
                    name: computedOutcome.damage.weaponName,
                    rating: computedOutcome.damage.weaponRating,
                    level: computedOutcome.damage.weaponLevel,
                    baseDamage: computedOutcome.damage.baseWeaponDamage,
                    rarity: computedOutcome.damage.weaponRarity || null
                };
            }

            return {
                isAttack: true,
                attacker: attackerContext,
                target: targetContext,
                attackEntry: actorAttack,
                outcome: computedOutcome || null
            };
        }

        function applyAttackDamageToTarget({ attackContext, attackOutcome, attacker }) {
            if (!attackContext?.isAttack || !attackOutcome?.hit) {
                return { application: null, targetActor: null };
            }

            const declaredDamage = Number.isFinite(attackOutcome?.damage?.total)
                ? attackOutcome.damage.total
                : 0;

            if (!Number.isFinite(declaredDamage) || declaredDamage <= 0) {
                return { application: null, targetActor: null };
            }

            const targetId = attackContext?.target?.id
                || attackContext?.attackEntry?.targetActorId
                || null;

            let targetActor = null;
            if (targetId && players && typeof players.get === 'function') {
                targetActor = players.get(targetId) || null;
            }

            if (!targetActor) {
                const fallbackName = typeof attackContext?.attackEntry?.defender === 'string'
                    ? attackContext.attackEntry.defender
                    : (typeof attackContext?.target?.name === 'string' ? attackContext.target.name : null);
                if (fallbackName && typeof findActorByName === 'function') {
                    targetActor = findActorByName(fallbackName) || null;
                }
            }

            if (!targetActor || typeof targetActor.modifyHealth !== 'function') {
                return { application: null, targetActor: null };
            }

            const startingHealth = Number.isFinite(targetActor.health) ? targetActor.health : 0;
            const maxHealthBefore = Number.isFinite(targetActor.maxHealth) ? targetActor.maxHealth : 0;
            const rawRemaining = startingHealth - declaredDamage;

            targetActor.modifyHealth(-declaredDamage, 'attack damage');

            const endingHealth = Number.isFinite(targetActor.health) ? targetActor.health : startingHealth - declaredDamage;
            const actualDamage = startingHealth - endingHealth;
            const maxHealthAfter = Number.isFinite(targetActor.maxHealth) ? targetActor.maxHealth : maxHealthBefore;

            const percent = (value, max) => {
                if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
                    return 0;
                }
                return Number(((value / max) * 100).toFixed(2));
            };

            const healthLostPercent = percent(actualDamage, maxHealthAfter);
            const remainingHealthPercent = percent(endingHealth, maxHealthAfter);

            if (attackOutcome.damage) {
                attackOutcome.damage.applied = actualDamage;
            } else {
                attackOutcome.damage = { applied: actualDamage };
            }

            if (!attackOutcome.target) {
                attackOutcome.target = {};
            }

            Object.assign(attackOutcome.target, {
                startingHealth,
                remainingHealth: endingHealth,
                rawRemainingHealth: rawRemaining,
                maxHealth: maxHealthAfter,
                defeated: endingHealth <= 0,
                healthLostPercent,
                remainingHealthPercent
            });

            if (attackContext.target) {
                Object.assign(attackContext.target, {
                    health: endingHealth,
                    remainingHealth: endingHealth,
                    rawRemainingHealth: rawRemaining,
                    maxHealth: maxHealthAfter,
                    defeated: endingHealth <= 0,
                    healthLostPercent,
                    remainingHealthPercent
                });
            }

            const application = {
                targetId: targetActor.id || null,
                targetName: targetActor.name || attackContext?.target?.name || null,
                damageDeclared: declaredDamage,
                damageApplied: actualDamage,
                startingHealth,
                endingHealth,
                rawRemainingHealth: rawRemaining,
                maxHealthBefore,
                maxHealthAfter,
                healthLostPercent,
                remainingHealthPercent
            };

            return { application, targetActor };
        }

        function parseNpcQueueResponse(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return [];
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return [];
            }

            let doc;
            try {
                const parser = new DOMParser({
                    errorHandler: {
                        warning: () => { },
                        error: () => { },
                        fatalError: () => { }
                    }
                });
                doc = parser.parseFromString(sanitizeForXml(trimmed), 'text/xml');
            } catch (_) {
                return [];
            }

            if (!doc || doc.getElementsByTagName('parsererror')?.length) {
                return [];
            }

            const root = doc.documentElement;
            if (!root || root.tagName?.toLowerCase() !== 'npcs') {
                return [];
            }

            const npcNodes = Array.from(doc.getElementsByTagName('npc'));
            if (!npcNodes.length) {
                return [];
            }

            const seen = new Set();
            const names = [];
            for (const node of npcNodes) {
                const value = typeof node.textContent === 'string' ? node.textContent.trim() : '';
                if (!value) {
                    continue;
                }
                const lowered = value.toLowerCase();
                if (seen.has(lowered)) {
                    continue;
                }
                seen.add(lowered);
                names.push(value);
            }

            return names;
        }

        function logNextNpcListPrompt({ systemPrompt, generationPrompt, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `next_npc_list_${timestamp}.log`);
                const parts = [
                    '=== NEXT NPC LIST SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== NEXT NPC LIST GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== NEXT NPC LIST RESPONSE ===',
                    responseText || '(no response)',
                    ''
                ];
                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log next NPC list prompt:', error.message);
            }
        }

        function logNpcMemoriesPrompt({ npcName, systemPrompt, generationPrompt, historyEntries, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const safeName = (npcName || 'unknown_npc').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 64) || 'npc';
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `npc_memories_${safeName}_${timestamp}.log`);

                const parts = [
                    `NPC: ${npcName || 'Unknown NPC'}`,
                    '',
                    '=== NPC MEMORIES SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== NPC MEMORIES GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== HISTORY ENTRIES ===',
                    Array.isArray(historyEntries)
                        ? JSON.stringify(historyEntries, null, 2)
                        : '(history unavailable)',
                    '',
                    '=== NPC MEMORIES RESPONSE ===',
                    responseText || '(no response)',
                    ''
                ];

                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log npc memories prompt:', error.message);
            }
        }

        async function runNextNpcListPrompt({ locationOverride = null } = {}) {
            try {
                const baseContext = buildBasePromptContext({ locationOverride });
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'next-npc-list'
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    return { raw: '', names: [] };
                }

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/')
                    ? endpoint + 'chat/completions'
                    : endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages: [
                        { role: 'system', content: parsedTemplate.systemPrompt },
                        { role: 'user', content: parsedTemplate.generationPrompt }
                    ],
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 150,
                    temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.2
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const raw = response.data?.choices?.[0]?.message?.content || '';
                const names = parseNpcQueueResponse(raw);

                logNextNpcListPrompt({
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText: raw
                });

                return { raw, names };
            } catch (error) {
                console.warn('Failed to run next NPC list prompt:', error.message);
                return { raw: '', names: [] };
            }
        }

        function parseNpcActionPlan(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return null;
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return null;
            }

            let doc;
            try {
                const parser = new DOMParser({
                    errorHandler: {
                        warning: () => { },
                        error: () => { },
                        fatalError: () => { }
                    }
                });
                doc = parser.parseFromString(sanitizeForXml(trimmed), 'text/xml');
            } catch (_) {
                return null;
            }

            if (!doc || doc.getElementsByTagName('parsererror')?.length) {
                return null;
            }

            const actionNode = doc.getElementsByTagName('npcAction')?.[0];
            if (!actionNode) {
                return null;
            }

            const getTagValue = (tag) => {
                const node = actionNode.getElementsByTagName(tag)?.[0];
                if (!node || typeof node.textContent !== 'string') {
                    return null;
                }
                const value = node.textContent.trim();
                return value || null;
            };

            return {
                description: getTagValue('description'),
                difficulty: getTagValue('difficulty'),
                skill: getTagValue('skill')
            };
        }

        function normalizeDifficultyLabel(value) {
            if (!value || typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            return trimmed.replace(/\s+/g, ' ')
                .toLowerCase()
                .split(' ')
                .map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
                .join(' ');
        }

        function parseDispositionCheckResponse(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return [];
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return [];
            }

            let doc;
            try {
                const parser = new DOMParser({
                    errorHandler: {
                        warning: () => { },
                        error: () => { },
                        fatalError: () => { }
                    }
                });
                doc = parser.parseFromString(sanitizeForXml(trimmed), 'text/xml');
            } catch (_) {
                return [];
            }

            if (!doc || doc.getElementsByTagName('parsererror')?.length) {
                return [];
            }

            const root = doc.getElementsByTagName('npcDispositions')[0] || doc.documentElement;
            if (!root) {
                return [];
            }

            const npcNodes = Array.from(root.getElementsByTagName('npc'));
            const results = [];

            for (const npcNode of npcNodes) {
                if (!npcNode) {
                    continue;
                }

                const nameNode = npcNode.getElementsByTagName('name')[0];
                const name = nameNode && typeof nameNode.textContent === 'string'
                    ? nameNode.textContent.trim()
                    : '';
                if (!name) {
                    continue;
                }

                const container = npcNode.getElementsByTagName('dispositionsTowardsPlayer')[0] || null;
                const dispositionNodes = container
                    ? Array.from(container.getElementsByTagName('disposition'))
                    : Array.from(npcNode.getElementsByTagName('disposition'));

                const dispositions = [];

                for (const dispositionNode of dispositionNodes) {
                    if (!dispositionNode) {
                        continue;
                    }

                    const getText = (tag) => {
                        const node = dispositionNode.getElementsByTagName(tag)[0];
                        if (!node || typeof node.textContent !== 'string') {
                            return null;
                        }
                        const value = node.textContent.trim();
                        return value || null;
                    };

                    const type = getText('type');
                    const intensityText = getText('intensity');
                    const reason = getText('reason');

                    if (!type || !intensityText) {
                        continue;
                    }

                    const intensityValue = parseInt(intensityText, 10);
                    if (!Number.isFinite(intensityValue) || intensityValue === 0) {
                        continue;
                    }

                    dispositions.push({
                        type,
                        intensity: intensityValue,
                        reason: reason || null,
                        rawIntensity: intensityText
                    });
                }

                if (dispositions.length) {
                    results.push({ name, dispositions });
                }
            }

            return results;
        }

        async function runDispositionCheckPrompt({ locationOverride = null } = {}) {
            try {
                const historyEntries = Array.isArray(chatHistory) ? chatHistory : [];
                let textToCheck = '';
                for (let index = historyEntries.length - 1; index >= 0; index -= 1) {
                    const entry = historyEntries[index];
                    if (!entry || entry.travel) {
                        continue;
                    }
                    const candidate = typeof entry.content === 'string' ? entry.content.trim() : '';
                    const summaryCandidate = !candidate && typeof entry.summary === 'string'
                        ? entry.summary.trim()
                        : '';
                    const resolved = candidate || summaryCandidate;
                    if (!resolved) {
                        continue;
                    }
                    textToCheck = resolved;
                    break;
                }

                const baseContext = buildBasePromptContext({ locationOverride });
                const dispositionTypes = Array.isArray(baseContext?.dispositionTypes)
                    ? baseContext.dispositionTypes
                    : [];

                if (!dispositionTypes.length || !Array.isArray(baseContext?.npcs) || !baseContext.npcs.length) {
                    return { raw: '', structured: [] };
                }

                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'disposition-check',
                    dispositionTypes,
                    textToCheck
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    return { raw: '', structured: [] };
                }

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/')
                    ? endpoint + 'chat/completions'
                    : endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages: [
                        { role: 'system', content: parsedTemplate.systemPrompt },
                        { role: 'user', content: parsedTemplate.generationPrompt }
                    ],
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 250,
                    temperature: typeof parsedTemplate.temperature === 'number'
                        ? parsedTemplate.temperature
                        : 0.2
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const raw = response.data?.choices?.[0]?.message?.content || '';
                const structured = parseDispositionCheckResponse(raw);

                logDispositionCheck({
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText: raw
                });

                return { raw, structured };
            } catch (error) {
                console.warn('Failed to run disposition check prompt:', error.message);
                return { raw: '', structured: [] };
            }
        }

        function applyDispositionChanges(dispositionEntries = []) {
            if (!Array.isArray(dispositionEntries) || !dispositionEntries.length) {
                return [];
            }

            if (!currentPlayer) {
                return [];
            }

            const definitions = Player.getDispositionDefinitions();
            const range = definitions?.range || {};

            const minRange = Number.isFinite(Number(range.min)) ? Number(range.min) : null;
            const maxRange = Number.isFinite(Number(range.max)) ? Number(range.max) : null;
            const typicalStep = Number.isFinite(Number(range.typicalStep))
                ? Number(range.typicalStep)
                : null;
            const typicalBigStep = Number.isFinite(Number(range.typicalBigStep))
                ? Number(range.typicalBigStep)
                : null;

            const appliedChanges = [];

            for (const npcEntry of dispositionEntries) {
                const npcName = npcEntry?.name;
                if (!npcName) {
                    continue;
                }

                const npc = findActorByName(npcName);
                if (!npc || npc === currentPlayer) {
                    continue;
                }

                const dispositionList = Array.isArray(npcEntry.dispositions)
                    ? npcEntry.dispositions
                    : [];

                for (const dispositionChange of dispositionList) {
                    const typeLabel = dispositionChange?.type;
                    if (!typeLabel) {
                        continue;
                    }

                    const typeDefinition = Player.getDispositionDefinition(typeLabel);
                    if (!typeDefinition || !typeDefinition.key) {
                        console.warn(`Unknown disposition type '${typeLabel}'—skipping.`);
                        continue;
                    }

                    const intensityValue = Number(dispositionChange.intensity);
                    if (!Number.isFinite(intensityValue) || intensityValue === 0) {
                        continue;
                    }

                    let delta = 0;

                    if (intensityValue === -10) {
                        if (!Number.isFinite(typicalBigStep)) {
                            console.warn('typicalBigStep not defined; cannot apply major negative disposition change.');
                            continue;
                        }
                        delta = -typicalBigStep;
                    } else if (intensityValue >= -3 && intensityValue <= 3) {
                        if (!Number.isFinite(typicalStep)) {
                            console.warn('typicalStep not defined; cannot apply minor disposition change.');
                            continue;
                        }
                        const scaled = (intensityValue / 2) * typicalStep;
                        const rounded = Math.round(scaled);
                        if (rounded !== 0) {
                            delta = rounded;
                        } else {
                            delta = Math.sign(intensityValue) * Math.max(1, Math.round(Math.abs(scaled)) || 1);
                        }
                    } else {
                        if (!Number.isFinite(typicalStep)) {
                            console.warn('typicalStep not defined; cannot apply disposition change.');
                            continue;
                        }
                        const scaled = (intensityValue / 2) * typicalStep;
                        const rounded = Math.round(scaled);
                        if (rounded === 0) {
                            delta = Math.sign(intensityValue) * Math.max(1, Math.round(Math.abs(scaled)) || 1);
                        } else {
                            delta = rounded;
                        }
                    }

                    if (delta === 0) {
                        continue;
                    }

                    const currentValue = npc.getDispositionTowardsCurrentPlayer(typeDefinition.key);
                    let newValue = currentValue + delta;

                    if (Number.isFinite(minRange)) {
                        newValue = Math.max(minRange, newValue);
                    }
                    if (Number.isFinite(maxRange)) {
                        newValue = Math.min(maxRange, newValue);
                    }

                    npc.setDispositionTowardsCurrentPlayer(typeDefinition.key, newValue);

                    const logReason = dispositionChange.reason ? ` Reason: ${dispositionChange.reason}` : '';
                    console.log(`[Disposition] ${npc.name} (${typeDefinition.label || typeDefinition.key}) ${currentValue} -> ${newValue} (Δ ${delta >= 0 ? '+' : ''}${delta}).${logReason}`);

                    appliedChanges.push({
                        npcId: npc.id || null,
                        npcName: npc.name || npcEntry.name,
                        typeKey: typeDefinition.key,
                        typeLabel: typeDefinition.label || typeDefinition.key,
                        intensity: intensityValue,
                        delta,
                        previousValue: currentValue,
                        newValue,
                        reason: dispositionChange.reason || null
                    });
                }
            }

            return appliedChanges;
        }

        function mapNpcActionPlanToPlausibility(actionPlan) {
            if (!actionPlan) {
                return null;
            }

            const normalizedDifficulty = (actionPlan.difficulty || '').trim().toLowerCase();
            const description = actionPlan.description || null;

            if (!normalizedDifficulty || normalizedDifficulty === 'trivial' || normalizedDifficulty === 'automatic') {
                return {
                    type: 'Trivial',
                    reason: description
                };
            }

            if (normalizedDifficulty === 'implausible') {
                return {
                    type: 'Implausible',
                    reason: description
                };
            }

            if (normalizedDifficulty === 'rejected') {
                return {
                    type: 'Rejected',
                    reason: description
                };
            }

            const difficultyLabel = normalizeDifficultyLabel(actionPlan.difficulty) || 'Medium';
            const skillLabel = actionPlan.skill && actionPlan.skill.trim() ? actionPlan.skill.trim() : 'N/A';

            return {
                type: 'Plausible',
                reason: description,
                skillCheck: {
                    reason: description,
                    skill: skillLabel,
                    attribute: null,
                    difficulty: difficultyLabel
                }
            };
        }

        async function runNpcPlausibilityPrompt({ npc, locationOverride = null } = {}) {
            if (!npc) {
                return { raw: '', structured: null };
            }

            try {
                const baseContext = buildBasePromptContext({ locationOverride });
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'npc-plausibility-check',
                    characterName: npc.name || 'Unknown NPC'
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    return { raw: '', structured: null };
                }

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/')
                    ? endpoint + 'chat/completions'
                    : endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages: [
                        { role: 'system', content: parsedTemplate.systemPrompt },
                        { role: 'user', content: parsedTemplate.generationPrompt }
                    ],
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 200,
                    temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.2
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const raw = response.data?.choices?.[0]?.message?.content || '';
                const actionPlan = parseNpcActionPlan(raw);
                const structured = actionPlan
                    ? {
                        ...actionPlan,
                        plausibility: mapNpcActionPlanToPlausibility(actionPlan)
                    }
                    : null;

                return { raw, structured };
            } catch (error) {
                console.warn(`Failed to run NPC plausibility prompt for ${npc.name}:`, error.message);
                return { raw: '', structured: null };
            }
        }

        async function runNpcMemoriesPrompt({ npc, historyEntries = [], locationOverride = null, totalPrompts = 1 } = {}) {
            if (!npc || !Array.isArray(historyEntries) || !historyEntries.length) {
                return { raw: '', memory: null };
            }

            const endpoint = config?.ai?.endpoint;
            const apiKey = config?.ai?.apiKey;
            const model = config?.ai?.model;
            if (!endpoint || !apiKey || !model) {
                return { raw: '', memory: null };
            }

            let baseContext;
            try {
                baseContext = buildBasePromptContext({ locationOverride });
            } catch (error) {
                console.warn('Failed to build base context for NPC memories:', error.message);
                baseContext = {};
            }

            const npcName = typeof npc.name === 'string' ? npc.name.trim() : '';
            const nameLower = npcName.toLowerCase();

            const deepClone = (value) => {
                if (!value || typeof value !== 'object') {
                    return value;
                }
                try {
                    return JSON.parse(JSON.stringify(value));
                } catch (_) {
                    return Array.isArray(value) ? [...value] : { ...value };
                }
            };

            let currentNpcContext = null;
            if (Array.isArray(baseContext?.npcs)) {
                currentNpcContext = baseContext.npcs.find(candidate => {
                    const candidateName = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
                    return candidateName && candidateName.toLowerCase() === nameLower;
                }) || null;
            }
            if (!currentNpcContext && Array.isArray(baseContext?.party)) {
                currentNpcContext = baseContext.party.find(candidate => {
                    const candidateName = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
                    return candidateName && candidateName.toLowerCase() === nameLower;
                }) || null;
            }

            if (currentNpcContext) {
                currentNpcContext = deepClone(currentNpcContext);
            } else {
                currentNpcContext = {
                    name: npc.name || 'Unknown NPC',
                    description: npc.description || '',
                    class: npc.class || null,
                    race: npc.race || null,
                    personality: {
                        type: npc.personalityType || '',
                        traits: npc.personalityTraits || '',
                        notes: npc.personalityNotes || ''
                    },
                    health: npc.health ?? 'unknown',
                    maxHealth: npc.maxHealth ?? 'unknown',
                    dispositionsTowardsPlayer: [],
                    inventory: [],
                    skills: [],
                    abilities: [],
                    statusEffects: [],
                    needBars: []
                };
            }

            if (!currentNpcContext.personality) {
                currentNpcContext.personality = {
                    type: npc.personalityType || '',
                    traits: npc.personalityTraits || '',
                    notes: npc.personalityNotes || ''
                };
            }

            const existingMemories = Array.isArray(npc.importantMemories) ? npc.importantMemories : [];
            currentNpcContext.importantMemories = existingMemories.slice(0);

            const sanitizedHistoryEntries = historyEntries
                .map(entry => {
                    if (!entry || typeof entry !== 'object') {
                        return null;
                    }
                    const metadata = entry.metadata && typeof entry.metadata === 'object'
                        ? {
                            npcNames: Array.isArray(entry.metadata.npcNames) ? entry.metadata.npcNames.slice(0) : undefined,
                            locationId: entry.metadata.locationId || null
                        }
                        : undefined;
                    return {
                        role: entry.role || null,
                        content: entry.content || null,
                        summary: entry.summary || null,
                        metadata
                    };
                })
                .filter(Boolean);

            if (!sanitizedHistoryEntries.length) {
                return { raw: '', memory: null };
            }

            const templatePayload = {
                ...baseContext,
                promptType: 'npc-memories',
                currentNpc: currentNpcContext,
                historyEntries: sanitizedHistoryEntries
            };

            let renderedTemplate;
            try {
                renderedTemplate = promptEnv.render('base-context.xml.njk', templatePayload);
            } catch (error) {
                const prettyError = nunjucks && nunjucks.lib && typeof nunjucks.lib.prettifyError === 'function'
                    ? nunjucks.lib.prettifyError(error)
                    : error;
                console.warn('Failed to render npc-memories template:', prettyError);
                return { raw: '', memory: null };
            }

            const parsedTemplate = parseXMLTemplate(renderedTemplate);
            if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
                return { raw: '', memory: null };
            }

            const chatEndpoint = endpoint.endsWith('/')
                ? `${endpoint}chat/completions`
                : `${endpoint}/chat/completions`;

            const requestData = {
                model,
                messages: [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ],
                max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 200,
                temperature: typeof parsedTemplate.temperature === 'number'
                    ? parsedTemplate.temperature
                    : 0.2
            };

            try {
                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds * (Number.isFinite(totalPrompts) && totalPrompts > 0 ? totalPrompts : 1)
                });

                const raw = response.data?.choices?.[0]?.message?.content || '';

                let memoryText = '';
                try {
                    const parser = new DOMParser();
                    const sanitized = sanitizeForXml(raw || '');
                    const doc = parser.parseFromString(sanitized, 'text/xml');
                    const parseError = doc.getElementsByTagName('parsererror')[0];
                    if (!parseError) {
                        const memoryNode = doc.getElementsByTagName('memory')[0];
                        if (memoryNode && typeof memoryNode.textContent === 'string') {
                            memoryText = memoryNode.textContent.trim();
                        }
                    }
                } catch (parseError) {
                    console.warn(`Failed to parse npc-memories response for ${npc.name || 'NPC'}:`, parseError.message);
                }

                logNpcMemoriesPrompt({
                    npcName: npc.name || 'Unknown NPC',
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    historyEntries: sanitizedHistoryEntries,
                    responseText: raw
                });

                return {
                    raw,
                    memory: memoryText ? memoryText : null
                };
            } catch (error) {
                console.warn(`Failed to run npc-memories prompt for ${npc.name || 'NPC'}:`, error.message);
                return { raw: '', memory: null };
            }
        }

        async function generateNpcMemoriesForLocationChange({ previousLocationId, newLocationId, player } = {}) {
            if (!previousLocationId || !player) {
                return;
            }
            if (previousLocationId === newLocationId) {
                return;
            }

            let previousLocation = gameLocations.get(previousLocationId);
            if (!previousLocation && typeof Location?.get === 'function') {
                try {
                    previousLocation = Location.get(previousLocationId) || null;
                } catch (_) {
                    previousLocation = null;
                }
            }

            if (!previousLocation) {
                return;
            }

            const npcIds = Array.isArray(previousLocation.npcIds)
                ? previousLocation.npcIds.slice(0)
                : [];
            const partyMemberIds = typeof player.getPartyMembers === 'function'
                ? player.getPartyMembers()
                : [];

            const candidateIds = new Set();
            npcIds.forEach(id => { if (id) candidateIds.add(id); });
            if (Array.isArray(partyMemberIds)) {
                partyMemberIds.forEach(id => {
                    if (id && id !== player.id) {
                        candidateIds.add(id);
                    }
                });
            }

            if (!candidateIds.size) {
                return;
            }

            const historyEntries = Array.isArray(chatHistory) ? chatHistory : [];

            const lowercaseCache = new Map();

            const memoryTasks = [];
            const totalCandidates = candidateIds.size;

            for (const actorId of candidateIds) {
                const actor = players.get(actorId);
                if (!actor) {
                    continue;
                }

                const actorName = typeof actor.name === 'string' ? actor.name.trim() : '';
                if (!actorName) {
                    continue;
                }

                const actorLower = lowercaseCache.get(actorName) || actorName.toLowerCase();
                lowercaseCache.set(actorName, actorLower);

                const filteredHistory = [];
                for (const entry of historyEntries) {
                    if (!entry || entry.travel) {
                        continue;
                    }
                    const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null;
                    const npcNames = Array.isArray(metadata?.npcNames) ? metadata.npcNames : null;
                    if (!npcNames || !npcNames.length) {
                        continue;
                    }
                    const matches = npcNames.some(name => {
                        if (typeof name !== 'string') {
                            return false;
                        }
                        return name.trim().toLowerCase() === actorLower;
                    });
                    if (!matches) {
                        continue;
                    }
                    filteredHistory.push(entry);
                }

                if (!filteredHistory.length) {
                    continue;
                }

                memoryTasks.push((async () => {
                    try {
                        const result = await runNpcMemoriesPrompt({
                            npc: actor,
                            historyEntries: filteredHistory,
                            locationOverride: previousLocation,
                            totalPrompts: totalCandidates
                        });

                        if (result?.memory) {
                            const added = typeof actor.addImportantMemory === 'function'
                                ? actor.addImportantMemory(result.memory)
                                : false;
                            if (added) {
                                console.log(`🧠 Added memory for ${actor.name}: ${result.memory}`);
                            }
                        }
                    } catch (error) {
                        console.warn(`Error while generating memories for ${actor.name}:`, error.message);
                    }
                })());
            }

            if (memoryTasks.length) {
                await Promise.allSettled(memoryTasks);
            }
        }

        async function runActionNarrativeForActor({
            actor,
            actionText,
            actionResolution,
            attackContext,
            attackDamageApplication = null,
            locationOverride = null,
            isCreativeModeAction = false
        }) {
            if (!actor) {
                return { raw: '', debug: null };
            }

            try {
                const baseContext = buildBasePromptContext({ locationOverride });
                const promptVariables = {
                    ...baseContext,
                    promptType: isCreativeModeAction ? 'creative-mode-action' : 'player-action',
                    actionText: actionText || '',
                    characterName: actor.isNPC ? (actor.name || 'Unknown NPC') : 'The player'
                };

                if (attackContext?.isAttack) {
                    const attackOutcome = attackContext.outcome || null;
                    const summary = attackContext.summary || null;
                    promptVariables.isAttack = true;
                    promptVariables.attacker = attackContext.attacker || null;
                    promptVariables.target = attackContext.target || null;
                    promptVariables.attackOutcome = attackOutcome;
                    promptVariables.attackContext = {
                        ...attackContext,
                        damageApplication: attackDamageApplication || null
                    };
                    if (summary) {
                        promptVariables.attackSummary = summary;
                    }
                } else {
                    promptVariables.success_or_failure = actionResolution?.label || 'success';
                }

                const renderedPrompt = promptEnv.render('base-context.xml.njk', promptVariables);
                const parsedTemplate = parseXMLTemplate(renderedPrompt);

                if (!parsedTemplate.systemPrompt) {
                    throw new Error('Action template missing system prompt.');
                }

                logPlayerActionPrompt({
                    systemPrompt: String(parsedTemplate.systemPrompt).trim(),
                    generationPrompt: parsedTemplate.generationPrompt || null
                });

                const systemMessage = {
                    role: 'system',
                    content: String(parsedTemplate.systemPrompt).trim()
                };

                const messages = [systemMessage];
                if (parsedTemplate.generationPrompt) {
                    messages.push({
                        role: 'user',
                        content: parsedTemplate.generationPrompt
                    });
                }

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/')
                    ? endpoint + 'chat/completions'
                    : endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages,
                    max_tokens: config.ai.maxTokens || 800,
                    temperature: config.ai.temperature || 0.7
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const raw = response.data?.choices?.[0]?.message?.content || '';
                const debug = {
                    actorId: actor.id || null,
                    actorName: actor.name || null,
                    systemMessage: systemMessage.content,
                    generationPrompt: parsedTemplate.generationPrompt || null,
                    renderedTemplate: renderedPrompt,
                    actionResolution,
                    attackContext,
                    attackDamageApplication
                };

                return { raw, debug };
            } catch (error) {
                console.warn(`Failed to run action narrative for ${actor.name}:`, error.message);
                return { raw: '', debug: { error: error.message } };
            }
        }

        async function executeNpcTurnsAfterPlayer({ location, stream = null, skipNpcEvents = false }) {
            if (skipNpcEvents) {
                if (stream && stream.isEnabled) {
                    stream.status('npc_turns:skipped', 'Skipping NPC and random events due to forced action.');
                }
                return [];
            }
            const results = [];

            try {
                const npcQueue = await runNextNpcListPrompt({ locationOverride: location });
                const npcNames = Array.isArray(npcQueue.names) ? npcQueue.names : [];

                if (stream && stream.isEnabled && npcNames.length) {
                    stream.status('npc_turns:start', {
                        message: `Processing ${npcNames.length} NPC ${npcNames.length === 1 ? 'turn' : 'turns'}.`,
                        count: npcNames.length
                    });
                }

                let npcTurnIndex = 0;
                for (const npcName of npcNames) {
                    const npc = typeof findActorByName === 'function' ? findActorByName(npcName) : null;
                    if (!npc || !npc.isNPC || npc.isDead) {
                        continue;
                    }

                    if (stream && stream.isEnabled) {
                        stream.status('npc_turn:planning', {
                            message: `Planning action for ${npc.name || 'NPC'}.`,
                            npcName: npc.name || npcName,
                            index: npcTurnIndex
                        });
                    }

                    let npcLocation = location;
                    try {
                        const tickResult = tickStatusEffectsForAction({ player: npc, location: npcLocation });
                        if (tickResult?.location) {
                            npcLocation = tickResult.location;
                        }
                    } catch (error) {
                        console.warn(`Failed to tick status effects for NPC ${npc.name}:`, error.message);
                    }

                    const plausibilityResult = await runNpcPlausibilityPrompt({ npc, locationOverride: npcLocation });
                    const plan = plausibilityResult.structured;
                    if (!plan || !plan.description) {
                        continue;
                    }

                    const actionText = plan.description;

                    if (stream && stream.isEnabled) {
                        stream.status('npc_turn:attack_check', {
                            npcName: npc.name || npcName,
                            index: npcTurnIndex
                        });
                    }

                    const attackCheck = await runAttackCheckPrompt({
                        actionText,
                        locationOverride: npcLocation,
                        characterName: npc.name || 'Unknown NPC'
                    });

                    let attackContext = buildAttackContextForActor({
                        attackCheckInfo: attackCheck,
                        actor: npc,
                        location: npcLocation
                    });

                    const attackOutcome = attackContext?.outcome || null;
                    let attackDamageApplication = null;

                    const isAttack = Boolean(attackContext?.isAttack);

                    if (isAttack && attackOutcome?.hit) {
                        const damageResult = applyAttackDamageToTarget({
                            attackContext,
                            attackOutcome,
                            attacker: npc
                        });
                        attackDamageApplication = damageResult.application;
                    }

                    if (isAttack) {
                        const attackSummary = buildAttackSummary({
                            attackContext,
                            attackOutcome,
                            damageApplication: attackDamageApplication
                        });
                        if (attackSummary) {
                            attackContext.summary = attackSummary;
                            if (attackCheck) {
                                attackCheck.summary = attackSummary;
                            }
                        }
                    }

                    const actionResolution = (!isAttack && plan.plausibility)
                        ? resolveActionOutcome({ plausibility: plan.plausibility, player: npc })
                        : null;

                    const attackContextForNarrative = isAttack ? attackContext : null;
                    const attackSummaryValue = isAttack ? (attackContext?.summary || null) : null;
                    const attackCheckForResult = isAttack ? attackCheck : null;

                    if (stream && stream.isEnabled) {
                        stream.status('npc_turn:narrative', {
                            npcName: npc.name || npcName,
                            index: npcTurnIndex
                        });
                    }

                    const narrativeResult = await runActionNarrativeForActor({
                        actor: npc,
                        actionText,
                        actionResolution,
                        attackContext: attackContextForNarrative,
                        attackDamageApplication,
                        locationOverride: npcLocation
                    });

                    const npcResponse = narrativeResult.raw && narrativeResult.raw.trim()
                        ? narrativeResult.raw.trim()
                        : `${npc.name} considers their options but ultimately does nothing noteworthy.`;

                    let npcEventResult = null;
                    try {
                        npcEventResult = await Events.runEventChecks({ textToCheck: npcResponse, stream, allowEnvironmentalEffects: false, isNpcTurn: true });
                    } catch (error) {
                        console.warn(`Failed to process events for NPC ${npc.name}:`, error.message);
                    }

                    const npcTurnLocationId = requireLocationId(npcLocation?.id, 'npc turn entry');
                    const npcTurnEntry = pushChatEntry({
                        role: 'assistant',
                        content: npcResponse,
                        actor: npc.name || null,
                        isNpcTurn: true,
                        locationId: npcTurnLocationId
                    }, newChatEntries, npcTurnLocationId);
                    const npcTurnTimestamp = npcTurnEntry?.timestamp || new Date().toISOString();

                    const npcTurnResult = {
                        name: npc.name,
                        npcId: npc.id || null,
                        plan,
                        plausibilityRaw: plausibilityResult.raw,
                        response: npcResponse,
                        events: npcEventResult?.structured || null,
                        eventChecks: npcEventResult?.html || null,
                        debug: narrativeResult.debug,
                        timestamp: npcTurnTimestamp
                    };

                    if (Array.isArray(npcEventResult?.experienceAwards) && npcEventResult.experienceAwards.length) {
                        npcTurnResult.experienceAwards = npcEventResult.experienceAwards;
                    }
                    if (Array.isArray(npcEventResult?.currencyChanges) && npcEventResult.currencyChanges.length) {
                        npcTurnResult.currencyChanges = npcEventResult.currencyChanges;
                    }
                    if (Array.isArray(npcEventResult?.environmentalDamageEvents) && npcEventResult.environmentalDamageEvents.length) {
                        npcTurnResult.environmentalDamageEvents = npcEventResult.environmentalDamageEvents;
                    }
                    if (Array.isArray(npcEventResult?.needBarChanges) && npcEventResult.needBarChanges.length) {
                        npcTurnResult.needBarChanges = npcEventResult.needBarChanges;
                    }

                    const npcNameLabel = safeSummaryName(npc?.name || npcName || 'NPC');
                    recordEventSummaryEntry({
                        label: `📋 Events – NPC Turn (${npcNameLabel})`,
                        events: npcTurnResult.events,
                        experienceAwards: npcTurnResult.experienceAwards,
                        currencyChanges: npcTurnResult.currencyChanges,
                        environmentalDamageEvents: npcTurnResult.environmentalDamageEvents,
                        needBarChanges: npcTurnResult.needBarChanges,
                        timestamp: npcTurnTimestamp,
                        parentId: npcTurnEntry?.id || null,
                        locationId: npcTurnLocationId
                    }, newChatEntries);

                    if (!isAttack && actionResolution) {
                        npcTurnResult.actionResolution = actionResolution;
                    }

                    if (npcTurnResult.actionResolution) {
                        recordSkillCheckEntry({
                            resolution: npcTurnResult.actionResolution,
                            timestamp: npcTurnTimestamp,
                            parentId: npcTurnEntry?.id || null,
                            locationId: npcTurnLocationId
                        }, newChatEntries);
                    }

                    if (isAttack) {
                        if (attackSummaryValue) {
                            npcTurnResult.attackSummary = attackSummaryValue;
                            recordAttackCheckEntry({
                                summary: attackSummaryValue,
                                attackCheck: attackCheckForResult,
                                timestamp: npcTurnTimestamp,
                                parentId: npcTurnEntry?.id || null,
                                locationId: npcTurnLocationId
                            }, newChatEntries);
                        }
                        if (attackDamageApplication) {
                            npcTurnResult.attackDamage = attackDamageApplication;
                        }
                        if (attackCheckForResult) {
                            npcTurnResult.attackCheck = attackCheckForResult;
                        }
                    }

                    results.push(npcTurnResult);

                    const { removed: corpseRemovals, countdownUpdates } = processNpcCorpses({ reason: 'npc-turn' });
                    if (countdownUpdates.length) {
                        npcTurnResult.corpseCountdownUpdates = countdownUpdates;
                    }
                    if (corpseRemovals.length) {
                        npcTurnResult.corpseRemovals = corpseRemovals;
                    }

                    if (stream && stream.isEnabled) {
                        stream.npcTurn({
                            index: npcTurnIndex,
                            total: npcNames.length,
                            ...npcTurnResult
                        });
                    }

                    npcTurnIndex += 1;
                }

                if (stream && stream.isEnabled) {
                    stream.status('npc_turns:complete', {
                        message: 'NPC turns complete.',
                        count: results.length
                    });
                }

                try {
                    const randomEventResult = await maybeTriggerRandomEvent({ stream, locationOverride: location });
                    if (randomEventResult) {
                        results.push(randomEventResult);
                    }
                } catch (randomEventError) {
                    console.warn('Failed to process random event:', randomEventError.message);
                }
            } catch (error) {
                console.warn('Failed to execute NPC turns:', error.message);
                if (stream && stream.isEnabled) {
                    stream.error({
                        scope: 'npc_turns',
                        message: error.message || 'Failed to execute NPC turns'
                    });
                }
            }

            return results;
        }

        // Chat API endpoint
        app.post('/api/chat', async (req, res) => {
            const requestBody = req.body || {};
            const {
                messages,
                clientId: rawClientId,
                requestId: rawRequestId,
                travel: rawTravelFlag
            } = requestBody;
            const stream = createStreamEmitter({ clientId: rawClientId, requestId: rawRequestId });
            let corpseProcessingRan = false;

            res.on('finish', () => {
                if (corpseProcessingRan) {
                    return;
                }
                try {
                    processNpcCorpses({ reason: 'player-action:finish' });
                } catch (error) {
                    console.warn('Failed to process NPC corpses after response:', error?.message || error);
                }
            });
            const streamState = {
                playerAction: false,
                npcTurns: 0,
                forcedEvent: false
            };
            let playerActionStreamSent = false;
            const newChatEntries = [];

            const initialPlayerLocationId = currentPlayer?.currentLocation || null;
            let locationMemoriesProcessed = false;

            const processLocationChangeMemoriesIfNeeded = async () => {
                if (locationMemoriesProcessed) {
                    return;
                }
                locationMemoriesProcessed = true;

                const player = currentPlayer || null;
                if (!player || !initialPlayerLocationId) {
                    return;
                }

                const currentLocationId = player.currentLocation || null;
                if (!currentLocationId || currentLocationId === initialPlayerLocationId) {
                    return;
                }

                try {
                    await generateNpcMemoriesForLocationChange({
                        previousLocationId: initialPlayerLocationId,
                        newLocationId: currentLocationId,
                        player
                    });
                } catch (error) {
                    console.warn('Failed to update NPC memories after travel:', error.message || error);
                }
            };

            const respond = async (payload, statusCode = 200) => {
                try {
                    await processLocationChangeMemoriesIfNeeded();
                } catch (error) {
                    console.warn('Failed during post-turn memory update:', error.message || error);
                }

                if (statusCode !== 200) {
                    return res.status(statusCode).json(payload);
                }
                return res.json(payload);
            };

            const stripStreamedEventArtifacts = (payload) => {
                if (!payload || typeof payload !== 'object') {
                    return;
                }

                delete payload.eventChecks;
                delete payload.events;
                delete payload.experienceAwards;
                delete payload.currencyChanges;
                delete payload.environmentalDamageEvents;
                delete payload.needBarChanges;

                if (Array.isArray(payload.npcTurns)) {
                    payload.npcTurns.forEach(turn => stripStreamedEventArtifacts(turn));
                }
            };

            try {
                if (!messages) {
                    stream.error({ message: 'Missing messages parameter.' });
                    stream.complete({ aborted: true });
                    return respond({ error: 'Missing messages parameter' }, 400);
                }

                stream.status('player_action:received', 'Processing player action.');
                Player.updatePreviousLocationsForAll();

                // Store user message in history (last message from the request)
                const userMessage = messages[messages.length - 1];
                if (userMessage && userMessage.role === 'user') {
                    const isTravelMessage = rawTravelFlag === true;
                    if (isTravelMessage && Array.isArray(chatHistory) && chatHistory.length > 0) {
                        const previousEntry = chatHistory[chatHistory.length - 1];
                        if (previousEntry && previousEntry.travel === true && previousEntry.role === 'user') {
                            chatHistory.pop();
                            if (Array.isArray(newChatEntries) && newChatEntries.length > 0) {
                                const lastCollectorEntry = newChatEntries[newChatEntries.length - 1];
                                if (lastCollectorEntry && lastCollectorEntry.id === previousEntry.id) {
                                    newChatEntries.pop();
                                }
                            }
                        }
                    }

                    const playerChatLocationId = requireLocationId(currentPlayer?.currentLocation, 'player chat entry');
                    pushChatEntry({
                        role: 'user',
                        content: userMessage.content,
                        travel: isTravelMessage,
                        locationId: playerChatLocationId
                    }, newChatEntries, playerChatLocationId);
                }

                stream.status('player_action:context', 'Preparing game state for action.');

                let location = null;
                let plausibilityInfo = null;
                let attackCheckInfo = null;
                let attackContextForPlausibility = null;
                let actionResolution = null;
                let attackDamageApplication = null;

                const originalUserContent = typeof userMessage?.content === 'string' ? userMessage.content : '';
                const firstVisibleIndex = typeof originalUserContent === 'string' ? originalUserContent.search(/\S/) : -1;
                const trimmedVisibleContent = firstVisibleIndex > -1
                    ? originalUserContent.slice(firstVisibleIndex)
                    : '';
                const isCommentOnlyAction = firstVisibleIndex > -1 && trimmedVisibleContent.startsWith('#');

                if (isCommentOnlyAction) {
                    const responseData = {
                        response: '',
                        commentLogged: true,
                        messages: newChatEntries
                    };

                    streamState.commentOnly = true;
                    stream.status('player_action:complete', 'Comment logged; skipping processing.');

                    if (stream.isEnabled) {
                        const previewMeta = {
                            ...streamState,
                            enabled: true,
                            playerAction: true,
                            commentOnly: true
                        };
                        stream.playerAction({
                            ...responseData,
                            streamMeta: previewMeta
                        });
                        stream.complete({ commentOnly: true, playerActionStreamed: true });
                    } else {
                        stream.complete({ commentOnly: true, playerActionStreamed: false });
                    }

                    if (stream.requestId) {
                        responseData.requestId = stream.requestId;
                        responseData.streamMeta = {
                            ...streamState,
                            enabled: stream.isEnabled,
                            commentOnly: true
                        };
                    }

                    return respond(responseData);
                }
                const isForcedEventAction = firstVisibleIndex > -1 && trimmedVisibleContent.startsWith('!!');
                const forcedEventText = isForcedEventAction
                    ? trimmedVisibleContent.slice(2).replace(/^\s+/, '')
                    : null;
                const isCreativeModeAction = !isForcedEventAction
                    && firstVisibleIndex > -1
                    && trimmedVisibleContent.startsWith('!');
                const creativeActionText = isCreativeModeAction
                    ? trimmedVisibleContent.slice(1).replace(/^\s+/, '')
                    : null;

                const trimLeadingMarkers = (text) => {
                    if (typeof text !== 'string') {
                        return text;
                    }
                    const match = text.match(/^([!#]+)/);
                    if (!match) {
                        return text;
                    }
                    const markers = match[0];
                    const trimmed = text.slice(markers.length);
                    return trimmed;
                };

                const sanitizedUserContent = isForcedEventAction
                    ? (forcedEventText || '')
                    : (isCreativeModeAction ? (creativeActionText || '') : trimLeadingMarkers(originalUserContent));

                if (isForcedEventAction) {
                    stream.status('player_action:forced_event', 'Processing forced event override.');
                } else if (isCreativeModeAction) {
                    stream.status('player_action:creative', 'Processing creative mode action.');
                }

                let finalMessages = messages;
                if (userMessage && sanitizedUserContent !== undefined && sanitizedUserContent !== userMessage.content) {
                    finalMessages = messages.map(msg => {
                        if (msg === userMessage) {
                            return { ...msg, content: sanitizedUserContent };
                        }
                        return msg;
                    });
                }

                const baseDebugInfo = {
                    usedForcedEventAction: Boolean(isForcedEventAction)
                };
                let debugInfo = null;

                // Add the location with the id of currentPlayer.curentLocation to the player context if available
                if (currentPlayer && currentPlayer.currentLocation) {
                    location = Location.get(currentPlayer.currentLocation);
                }

                if (currentPlayer && userMessage && userMessage.role === 'user') {
                    try {
                        const tickResult = tickStatusEffectsForAction({ player: currentPlayer, location });
                        if (tickResult) {
                            location = tickResult.location || location;
                        }
                    } catch (tickError) {
                        console.warn('Failed to update status effects before action:', tickError.message);
                    }

                    if (!isCreativeModeAction && !isForcedEventAction) {
                        try {
                            stream.status('player_action:attack_check', 'Checking for potential attacks.');
                            const attackActionText = typeof sanitizedUserContent === 'string'
                                ? sanitizedUserContent
                                : (userMessage?.content || '');
                            attackCheckInfo = await runAttackCheckPrompt({
                                actionText: attackActionText,
                                locationOverride: location || null,
                                characterName: 'The player'
                            });

                            const attackRejectionReasonRaw = attackCheckInfo?.structured?.rejectionReason
                                || attackCheckInfo?.structured?.rejection?.reason
                                || attackCheckInfo?.structured?.rejected?.reason
                                || null;
                            const attackRejectionReason = (typeof attackRejectionReasonRaw === 'string'
                                && attackRejectionReasonRaw.trim().length)
                                ? attackRejectionReasonRaw.trim()
                                : null;

                            if (attackRejectionReason) {
                                const responseData = {
                                    response: attackRejectionReason
                                };

                                if (attackCheckInfo) {
                                    responseData.attackCheck = attackCheckInfo;
                                }

                                const rejectionDebug = {
                                    ...baseDebugInfo,
                                    attackCheck: attackCheckInfo?.structured || null,
                                    attackRejectionReason,
                                    usedPlayerTemplate: false,
                                    usedCreativeTemplate: false,
                                    rejectionSource: 'attack_check'
                                };

                                responseData.debug = rejectionDebug;

                                const attackRejectionLocationId = requireLocationId(location?.id || currentPlayer?.currentLocation, 'attack rejection entry');
                                pushChatEntry({
                                    role: 'assistant',
                                    content: attackRejectionReason,
                                    locationId: attackRejectionLocationId
                                }, newChatEntries, attackRejectionLocationId);

                                responseData.messages = newChatEntries;
                                return respond(responseData);
                            }

                            attackContextForPlausibility = buildAttackContextForActor({
                                attackCheckInfo,
                                actor: currentPlayer,
                                location
                            });
                        } catch (attackError) {
                            console.warn('Failed to execute attack check:', attackError.message);
                        }

                        try {
                            stream.status('player_action:plausibility', 'Evaluating plausibility.');
                            plausibilityInfo = await runPlausibilityCheck({
                                actionText: userMessage.content,
                                locationId: currentPlayer.currentLocation || null,
                                attackContext: attackContextForPlausibility
                            });
                            if (plausibilityInfo?.structured) {
                                actionResolution = resolveActionOutcome({
                                    plausibility: plausibilityInfo.structured,
                                    player: currentPlayer
                                });
                            }
                        } catch (plausibilityError) {
                            console.warn('Failed to execute plausibility check:', plausibilityError.message);
                        }
                    }
                }

                const attackDebugData = {
                    attackCheck: attackCheckInfo,
                    attackContext: attackContextForPlausibility
                };

                const attackOutcome = attackContextForPlausibility?.outcome || null;

                const plausibilityType = (plausibilityInfo?.structured?.type || '').trim().toLowerCase();
                if (!isForcedEventAction && !isCreativeModeAction && plausibilityType === 'rejected') {
                    const rejectionReasonRaw = plausibilityInfo?.structured?.reason || 'Action rejected.';
                    const rejectionReason = typeof rejectionReasonRaw === 'string' && rejectionReasonRaw.trim().length
                        ? rejectionReasonRaw.trim()
                        : 'Action rejected.';

                    const responseData = {
                        response: rejectionReason
                    };

                    if (attackCheckInfo) {
                        responseData.attackCheck = attackCheckInfo;
                    }

                    if (attackContextForPlausibility?.summary) {
                        responseData.attackSummary = attackContextForPlausibility.summary;
                    }

                    if (attackDamageApplication) {
                        responseData.attackDamage = attackDamageApplication;
                    }

                    if (attackDamageApplication) {
                        responseData.attackDamage = attackDamageApplication;
                    }

                    if (plausibilityInfo?.structured || plausibilityInfo?.raw) {
                        responseData.plausibility = {
                            raw: plausibilityInfo.raw || null,
                            structured: plausibilityInfo.structured || null
                        };
                    }

                    const rejectionDebug = {
                        ...(debugInfo || baseDebugInfo),
                        ...attackDebugData,
                        usedPlayerTemplate: false,
                        usedCreativeTemplate: false,
                        plausibilityType: 'Rejected',
                        rejectionReason
                    };

                    responseData.debug = rejectionDebug;

                    const rejectionLocationId = requireLocationId(location?.id || currentPlayer?.currentLocation, 'plausibility rejection entry');
                    const rejectionMessageEntry = pushChatEntry({
                        role: 'assistant',
                        content: rejectionReason,
                        locationId: rejectionLocationId
                    }, newChatEntries, rejectionLocationId);

                    if (attackContextForPlausibility?.summary) {
                        recordAttackCheckEntry({
                            summary: attackContextForPlausibility.summary,
                            attackCheck: attackCheckInfo,
                            timestamp: rejectionMessageEntry?.timestamp || new Date().toISOString(),
                            parentId: rejectionMessageEntry?.id || null,
                            locationId: rejectionLocationId
                        }, newChatEntries);
                    }

                    if (plausibilityInfo?.structured || plausibilityInfo?.raw) {
                        recordPlausibilityEntry({
                            data: {
                                raw: plausibilityInfo.raw || null,
                                structured: plausibilityInfo.structured || null
                            },
                            timestamp: rejectionMessageEntry?.timestamp || new Date().toISOString(),
                            parentId: rejectionMessageEntry?.id || null,
                            locationId: rejectionLocationId
                        }, newChatEntries);
                    }

                    responseData.messages = newChatEntries;
                    return respond(responseData);
                }

                if (!isForcedEventAction
                    && !isCreativeModeAction
                    && attackContextForPlausibility?.isAttack
                    && attackOutcome?.hit
                    && plausibilityType === 'plausible') {
                    const damageResult = applyAttackDamageToTarget({
                        attackContext: attackContextForPlausibility,
                        attackOutcome,
                        attacker: currentPlayer
                    });
                    attackDamageApplication = damageResult.application;
                }

                if (attackDamageApplication) {
                    attackDebugData.damageApplication = attackDamageApplication;
                }

                if (attackOutcome) {
                    const attackSummary = buildAttackSummary({
                        attackContext: attackContextForPlausibility,
                        attackOutcome,
                        damageApplication: attackDamageApplication
                    });
                    if (attackSummary) {
                        attackContextForPlausibility.summary = attackSummary;
                        if (attackCheckInfo) {
                            attackCheckInfo.summary = attackSummary;
                        }
                        attackDebugData.attackSummary = attackSummary;
                    }
                }

                // If we have a current player, use the player action template for the system message
                if (isForcedEventAction && !debugInfo) {
                    debugInfo = {
                        ...baseDebugInfo,
                        usedPlayerTemplate: false,
                        usedCreativeTemplate: false,
                        forcedEventText,
                        reason: 'Forced event action bypassed plausibility and templating.'
                    };
                }

                if (!isForcedEventAction && currentPlayer && userMessage && userMessage.role === 'user') {
                    try {
                        stream.status('player_action:prompt', 'Building prompt for AI response.');
                        const baseContext = buildBasePromptContext({ locationOverride: location });
                        const templateName = 'base-context.xml.njk';

                        const promptVariables = {
                            ...baseContext,
                            promptType: isCreativeModeAction ? 'creative-mode-action' : 'player-action',
                            actionText: isCreativeModeAction ? (creativeActionText || '') : sanitizedUserContent,
                            characterName: 'The player'
                        };

                        if (attackContextForPlausibility) {
                            const isAttack = Boolean(attackContextForPlausibility.isAttack);
                            const attackerDetails = attackContextForPlausibility.attacker || null;
                            const targetDetails = attackContextForPlausibility.target || null;
                            const outcomeDetails = attackContextForPlausibility.outcome || null;
                            const summaryDetails = attackContextForPlausibility.summary || null;

                            promptVariables.isAttack = isAttack;
                            promptVariables.attacker = attackerDetails;
                            promptVariables.target = targetDetails;
                            promptVariables.attackOutcome = outcomeDetails;
                            promptVariables.attackContext = {
                                isAttack,
                                attacker: attackerDetails,
                                target: targetDetails,
                                outcome: outcomeDetails,
                                damageApplication: attackDamageApplication || null,
                                summary: summaryDetails
                            };
                            if (summaryDetails) {
                                promptVariables.attackSummary = summaryDetails;
                            }

                        }

                        if (!isCreativeModeAction) {
                            promptVariables.success_or_failure = actionResolution?.label || 'success';
                        }

                        const renderedPrompt = promptEnv.render(templateName, promptVariables);

                        const promptData = parseXMLTemplate(renderedPrompt);

                        if (!promptData.systemPrompt) {
                            throw new Error('Action template missing system prompt.');
                        }

                        logPlayerActionPrompt({
                            systemPrompt: String(promptData.systemPrompt).trim(),
                            generationPrompt: promptData.generationPrompt || null
                        });

                        const systemMessage = {
                            role: 'system',
                            content: String(promptData.systemPrompt).trim()
                        };

                        // Replace any existing system message or add new one
                        const nonSystemMessages = messages
                            .filter(msg => msg.role !== 'system')
                            .map(msg => {
                                if (isCreativeModeAction && msg === userMessage) {
                                    return { ...msg, content: creativeActionText || '' };
                                }
                                return msg;
                            });

                        finalMessages = [systemMessage, ...nonSystemMessages];

                        // Append promptData.generationPrompt to finalMessages
                        if (promptData.generationPrompt) {
                            finalMessages.push({
                                role: 'user',
                                content: promptData.generationPrompt
                            });
                        }

                        // Store debug information
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: !isCreativeModeAction,
                            usedCreativeTemplate: isCreativeModeAction,
                            playerName: currentPlayer.name,
                            playerDescription: currentPlayer.description,
                            systemMessage: systemMessage.content,
                            generationPrompt: promptData.generationPrompt || null,
                            rawTemplate: renderedPrompt
                        };

                        if (isCreativeModeAction) {
                            debugInfo.creativeActionText = creativeActionText || '';
                        }
                        if (!isCreativeModeAction) {
                            debugInfo.actionOutcomeLabel = actionResolution?.label || 'success';
                        }

                        if (isCreativeModeAction) {
                            console.log('Using creative mode action template for:', currentPlayer.name);
                        } else {
                            console.log('Using player action template for:', currentPlayer.name);
                        }
                    } catch (templateError) {
                        console.error('Error rendering player action template:', templateError);
                        // Fall back to original messages if template fails
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: isCreativeModeAction,
                            error: templateError.message
                        };
                    }
                } else {
                    if (debugInfo) {
                        const existingDebugInfo = debugInfo;
                        debugInfo = {
                            ...existingDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: false,
                            reason: existingDebugInfo.reason || (currentPlayer ? 'No user message detected' : 'No current player set')
                        };
                    } else {
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: false,
                            reason: currentPlayer ? 'No user message detected' : 'No current player set'
                        };
                    }
                }

                if (debugInfo) {
                    debugInfo = { ...debugInfo, ...attackDebugData };
                }

                let forcedEventResult = null;
                if (isForcedEventAction && forcedEventText && forcedEventText.trim()) {
                    try {
                        forcedEventResult = await Events.runEventChecks({ textToCheck: forcedEventText, stream });
                        if (forcedEventResult && debugInfo) {
                            debugInfo.forcedEventStructured = forcedEventResult.structured || null;
                        }
                    } catch (forcedEventError) {
                        console.warn('Failed to run forced event checks:', forcedEventError.message);
                    }
                }

                if (isForcedEventAction) {
                    const responseData = {
                        response: `[Forced] ${forcedEventText || 'Event processed.'}`
                    };

                    if (forcedEventResult) {
                        if (forcedEventResult.html) {
                            responseData.eventChecks = forcedEventResult.html;
                        }
                        if (forcedEventResult.structured) {
                            responseData.events = forcedEventResult.structured;
                        }
                        if (Array.isArray(forcedEventResult.experienceAwards) && forcedEventResult.experienceAwards.length) {
                            responseData.experienceAwards = forcedEventResult.experienceAwards;
                        }
                        if (Array.isArray(forcedEventResult.currencyChanges) && forcedEventResult.currencyChanges.length) {
                            responseData.currencyChanges = forcedEventResult.currencyChanges;
                        }
                        if (Array.isArray(forcedEventResult.environmentalDamageEvents) && forcedEventResult.environmentalDamageEvents.length) {
                            responseData.environmentalDamageEvents = forcedEventResult.environmentalDamageEvents;
                        }
                        if (Array.isArray(forcedEventResult.needBarChanges) && forcedEventResult.needBarChanges.length) {
                            responseData.needBarChanges = forcedEventResult.needBarChanges;
                        }
                    }

                    const forcedEventLocationId = requireLocationId(location?.id || currentPlayer?.currentLocation, 'forced event entry');
                    const forcedEventEntry = pushChatEntry({
                        role: 'assistant',
                        content: responseData.response,
                        type: 'player-action',
                        locationId: forcedEventLocationId
                    }, newChatEntries, forcedEventLocationId);

                    try {
                        await summarizeChatEntry(forcedEventEntry, { location, type: 'player-action' });
                    } catch (summaryError) {
                        console.warn('Failed to summarize forced event entry:', summaryError.message);
                    }

                    if (forcedEventEntry.summary) {
                        responseData.summary = forcedEventEntry.summary;
                    }

                    recordEventSummaryEntry({
                        label: '📋 Events – Forced Action',
                        events: responseData.events,
                        experienceAwards: responseData.experienceAwards,
                        currencyChanges: responseData.currencyChanges,
                        environmentalDamageEvents: responseData.environmentalDamageEvents,
                        needBarChanges: responseData.needBarChanges,
                        timestamp: forcedEventEntry?.timestamp || new Date().toISOString(),
                        parentId: forcedEventEntry?.id || null,
                        locationId: forcedEventLocationId
                    }, newChatEntries);

                    if (debugInfo) {
                        responseData.debug = {
                            ...debugInfo,
                            actionResolution: null,
                            plausibilityStructured: null,
                            eventStructured: forcedEventResult?.structured || null
                        };
                    }

                    if (stream.requestId) {
                        responseData.requestId = stream.requestId;
                    }

                    streamState.forcedEvent = true;

                    stream.status('player_action:complete', 'Forced event processed.');

                    if (stream.isEnabled) {
                        const previewMeta = {
                            ...streamState,
                            playerAction: true,
                            enabled: true
                        };
                        playerActionStreamSent = stream.playerAction({
                            ...responseData,
                            streamMeta: previewMeta
                        });
                        if (playerActionStreamSent) {
                            streamState.playerAction = true;
                        }
                        stream.complete({ forcedEvent: true, playerActionStreamed: Boolean(playerActionStreamSent) });
                    }

                    if (stream.requestId) {
                        responseData.streamMeta = {
                            ...streamState,
                            enabled: stream.isEnabled,
                            playerActionStreamed: Boolean(playerActionStreamSent)
                        };
                    }

                    if (stream.isEnabled) {
                        stripStreamedEventArtifacts(responseData);
                    }

                    const { removed: corpseRemovals, countdownUpdates } = processNpcCorpses({ reason: 'player-action' });
                    corpseProcessingRan = true;
                    if (countdownUpdates.length) {
                        responseData.corpseCountdownUpdates = countdownUpdates;
                    }
                    if (corpseRemovals.length) {
                        responseData.corpseRemovals = corpseRemovals;
                    }

                    responseData.messages = newChatEntries;
                    return respond(responseData);
                }

                // Use configuration from config.yaml
                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const model = config.ai.model;

                // Prepare the request to the OpenAI-compatible API
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: model,
                    messages: finalMessages,
                    max_tokens: config.ai.maxTokens || 1000,
                    temperature: config.ai.temperature || 0.7
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds // 60 second timeout
                });

                const usageMetrics = emitAiUsageMetrics(response, { label: 'player_action', streamEmitter: stream });

                if (response.data && response.data.choices && response.data.choices.length > 0) {
                    const aiResponse = response.data.choices[0].message.content;

                    if (config.omit_npc_generation) {
                        stream.status('player_action:llm_complete', 'Skipping disposition checks (NPC generation disabled).');
                    } else {
                        stream.status('player_action:llm_complete', 'Checking for disposition changes.');
                    }

                    // Store AI response in history
                    const aiResponseLocationId = requireLocationId(location?.id || currentPlayer?.currentLocation, 'player action entry');
                    const aiResponseEntry = pushChatEntry({
                        role: 'assistant',
                        content: aiResponse,
                        type: 'player-action',
                        locationId: aiResponseLocationId
                    }, newChatEntries, aiResponseLocationId);

                    try {
                        await summarizeChatEntry(aiResponseEntry, { location, type: 'player-action' });
                    } catch (summaryError) {
                        console.warn('Failed to summarize player action entry:', summaryError.message);
                    }

                    let dispositionPromptResult = null;
                    let dispositionChanges = [];
                    if (!config.omit_npc_generation) {
                        try {
                            dispositionPromptResult = await runDispositionCheckPrompt({ location });
                            if (Array.isArray(dispositionPromptResult?.structured) && dispositionPromptResult.structured.length) {
                                dispositionChanges = applyDispositionChanges(dispositionPromptResult.structured);
                            }
                        } catch (dispositionError) {
                            console.warn('Failed to evaluate disposition changes:', dispositionError.message);
                        }
                    }

                    // Include debug information in response for development
                    const responseData = {
                        response: aiResponse
                    };

                    if (usageMetrics) {
                        responseData.aiUsage = usageMetrics;
                    }

                    if (aiResponseEntry.summary) {
                        responseData.summary = aiResponseEntry.summary;
                    }

                    if (stream.requestId) {
                        responseData.requestId = stream.requestId;
                    }

                    // Add debug info if available
                    if (debugInfo) {
                        debugInfo.actionResolution = actionResolution;
                        debugInfo.plausibilityStructured = plausibilityInfo?.structured || null;
                        if (dispositionPromptResult?.raw) {
                            debugInfo.dispositionPrompt = dispositionPromptResult.raw;
                        }
                        if (dispositionChanges.length) {
                            debugInfo.dispositionChanges = dispositionChanges;
                        }
                        responseData.debug = debugInfo;
                    }

                    if (dispositionChanges.length) {
                        responseData.dispositionChanges = dispositionChanges;
                    }

                    if (actionResolution) {
                        responseData.actionResolution = actionResolution;
                    }

                    if (attackCheckInfo) {
                        console.log("Attached attack check info");
                        console.log(attackCheckInfo.summary);
                        responseData.attackCheck = attackCheckInfo;
                    } else {
                        console.log("No attack check info to attach")
                    }

                    let eventResult = null;
                    if (isForcedEventAction) {
                        eventResult = forcedEventResult;
                    } else {
                        try {
                            stream.status('player_action:event_checks', 'Evaluating resulting events.');
                            eventResult = await Events.runEventChecks({ textToCheck: aiResponse, stream });
                        } catch (eventError) {
                            console.warn('Failed to run event checks:', eventError.message);
                        }
                    }

                    if (eventResult) {
                        if (eventResult.html) {
                            responseData.eventChecks = eventResult.html;
                        }
                        if (eventResult.structured) {
                            responseData.events = eventResult.structured;
                            if (debugInfo) {
                                debugInfo.eventStructured = eventResult.structured;
                            }
                            if (currentPlayer && currentPlayer.currentLocation) {
                                try {
                                    location = Location.get(currentPlayer.currentLocation) || location;
                                } catch (_) {
                                    // ignore lookup failures here
                                }
                            }
                        }
                        if (Array.isArray(eventResult.experienceAwards) && eventResult.experienceAwards.length) {
                            responseData.experienceAwards = eventResult.experienceAwards;
                        }
                        if (Array.isArray(eventResult.currencyChanges) && eventResult.currencyChanges.length) {
                            responseData.currencyChanges = eventResult.currencyChanges;
                        }
                        if (Array.isArray(eventResult.environmentalDamageEvents) && eventResult.environmentalDamageEvents.length) {
                            responseData.environmentalDamageEvents = eventResult.environmentalDamageEvents;
                        }
                        if (Array.isArray(eventResult.needBarChanges) && eventResult.needBarChanges.length) {
                            responseData.needBarChanges = eventResult.needBarChanges;
                        }
                    }

                    const needBarAdjustments = applyNeedBarTurnTick();
                    if (needBarAdjustments.length && debugInfo) {
                        debugInfo.needBarAdjustments = needBarAdjustments;
                    }

                    if (plausibilityInfo?.structured || plausibilityInfo?.raw) {
                        responseData.plausibility = {
                            raw: plausibilityInfo.raw || null,
                            structured: plausibilityInfo.structured || null
                        };
                    }

                    recordEventSummaryEntry({
                        label: '📋 Events – Player Turn',
                        events: responseData.events,
                        experienceAwards: responseData.experienceAwards,
                        currencyChanges: responseData.currencyChanges,
                        environmentalDamageEvents: responseData.environmentalDamageEvents,
                        needBarChanges: responseData.needBarChanges,
                        timestamp: aiResponseEntry?.timestamp || new Date().toISOString(),
                        parentId: aiResponseEntry?.id || null,
                        locationId: aiResponseLocationId
                    }, newChatEntries);

                    if (responseData.plausibility) {
                        recordPlausibilityEntry({
                            data: responseData.plausibility,
                            timestamp: aiResponseEntry?.timestamp || new Date().toISOString(),
                            parentId: aiResponseEntry?.id || null,
                            locationId: aiResponseLocationId
                        }, newChatEntries);
                    }

                    if (responseData.actionResolution) {
                        recordSkillCheckEntry({
                            resolution: responseData.actionResolution,
                            timestamp: aiResponseEntry?.timestamp || new Date().toISOString(),
                            parentId: aiResponseEntry?.id || null,
                            locationId: aiResponseLocationId
                        }, newChatEntries);
                    }

                    const attackSummaryForLogging = responseData.attackSummary
                        || responseData.attackCheck?.summary
                        || null;
                    if (attackSummaryForLogging) {
                        recordAttackCheckEntry({
                            summary: attackSummaryForLogging,
                            attackCheck: responseData.attackCheck || null,
                            timestamp: aiResponseEntry?.timestamp || new Date().toISOString(),
                            parentId: aiResponseEntry?.id || null,
                            locationId: aiResponseLocationId
                        }, newChatEntries);
                    }

                    if (stream.isEnabled && !playerActionStreamSent) {
                        const playerActionPreview = { ...responseData };
                        delete playerActionPreview.npcTurns;
                        playerActionPreview.streamMeta = {
                            ...streamState,
                            playerAction: true,
                            enabled: true,
                            phase: 'player'
                        };
                        playerActionStreamSent = stream.playerAction(playerActionPreview);
                        if (playerActionStreamSent) {
                            streamState.playerAction = true;
                        }
                    }

                    try {
                        const skipNpcEvents = Boolean(isForcedEventAction);
                        stream.status('npc_turns:pending', skipNpcEvents
                            ? 'Forced event detected; skipping NPC turns and random events.'
                            : 'Resolving NPC turns.');
                        const npcTurns = await executeNpcTurnsAfterPlayer({
                            location,
                            stream,
                            skipNpcEvents
                        });
                        if (!skipNpcEvents && npcTurns && npcTurns.length) {
                            responseData.npcTurns = npcTurns;
                            streamState.npcTurns = npcTurns.length;

                            const aggregatedCountdowns = [];
                            const aggregatedRemovals = [];
                            for (const turn of npcTurns) {
                                if (Array.isArray(turn?.corpseCountdownUpdates)) {
                                    aggregatedCountdowns.push(...turn.corpseCountdownUpdates);
                                }
                                if (Array.isArray(turn?.corpseRemovals)) {
                                    aggregatedRemovals.push(...turn.corpseRemovals);
                                }
                            }
                            if (aggregatedCountdowns.length) {
                                responseData.corpseCountdownUpdates = Array.isArray(responseData.corpseCountdownUpdates)
                                    ? responseData.corpseCountdownUpdates.concat(aggregatedCountdowns)
                                    : aggregatedCountdowns;
                            }
                            if (aggregatedRemovals.length) {
                                responseData.corpseRemovals = Array.isArray(responseData.corpseRemovals)
                                    ? responseData.corpseRemovals.concat(aggregatedRemovals)
                                    : aggregatedRemovals;
                            }
                        }
                    } catch (npcTurnError) {
                        console.warn('Failed to process NPC turns after player action:', npcTurnError.message);
                    }

                    if (stream.isEnabled && !playerActionStreamSent) {
                        const previewMeta = {
                            ...streamState,
                            playerAction: true,
                            enabled: true
                        };
                        const streamedNow = stream.playerAction({
                            ...responseData,
                            streamMeta: previewMeta
                        });
                        if (streamedNow) {
                            streamState.playerAction = true;
                            playerActionStreamSent = true;
                        }
                    }

                    if (stream.requestId) {
                        responseData.streamMeta = {
                            ...streamState,
                            enabled: stream.isEnabled,
                            playerActionStreamed: Boolean(playerActionStreamSent)
                        };
                    }

                    stream.status('player_action:complete', 'Player action resolved.');
                    stream.complete({
                        hasNpcTurns: Boolean(responseData.npcTurns && responseData.npcTurns.length),
                        playerActionStreamed: Boolean(playerActionStreamSent)
                    });

                    if (stream.isEnabled) {
                        stripStreamedEventArtifacts(responseData);
                    }

                    responseData.messages = newChatEntries;
                    await respond(responseData);
                } else {
                    await respond({ error: 'Invalid response from AI API' }, 500);
                }

            } catch (error) {
                console.error('Chat API error:', error);

                stream.error({ message: error.message || 'Chat processing failed.' });
                stream.complete({ aborted: true, error: error.message || 'Chat processing failed.' });

                const withMeta = (payload) => {
                    if (stream.requestId) {
                        payload.requestId = stream.requestId;
                        payload.streamMeta = {
                            ...streamState,
                            enabled: stream.isEnabled,
                            error: true
                        };
                    }
                    return payload;
                };

                if (error.response) {
                    // API returned an error
                    const statusCode = error.response.status;
                    const errorMessage = error.response.data?.error?.message || 'API request failed';
                    await respond(withMeta({ error: `API Error (${statusCode}): ${errorMessage}` }), statusCode);
                } else if (error.code === 'ECONNABORTED') {
                    // Timeout
                    await respond(withMeta({ error: 'Request timeout - AI API took too long to respond' }), 408);
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    // Connection issues
                    await respond(withMeta({ error: 'Cannot connect to AI API - check your endpoint URL' }), 503);
                } else {
                    // Other errors
                    await respond(withMeta({ error: `Request failed: ${error.message}` }), 500);
                }
            }
        });

        // Chat history API endpoint
        app.get('/api/chat/history', (req, res) => {
            res.json({
                history: chatHistory,
                count: chatHistory.length
            });
        });

        // Clear chat history API endpoint (for testing/reset)
        app.delete('/api/chat/history', (req, res) => {
            chatHistory = [];
            res.json({
                message: 'Chat history cleared',
                count: chatHistory.length
            });
        });

        app.put('/api/chat/message', (req, res) => {
            const { timestamp, content } = req.body || {};

            if (typeof timestamp !== 'string' || !timestamp.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'timestamp is required'
                });
            }

            if (typeof content !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'content must be a string'
                });
            }

            const index = findChatEntryIndexByTimestamp(timestamp.trim());
            if (index === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Message not found'
                });
            }

            const entry = chatHistory[index];
            entry.content = content;
            entry.lastEditedAt = new Date().toISOString();

            if (entry.type === 'event-summary') {
                entry.summaryItems = [];
                entry.summaryTitle = entry.summaryTitle || 'Event Summary';
            }

            res.json({
                success: true,
                entry
            });
        });

        app.delete('/api/chat/message', (req, res) => {
            const { timestamp } = req.body || {};

            if (typeof timestamp !== 'string' || !timestamp.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'timestamp is required'
                });
            }

            const index = findChatEntryIndexByTimestamp(timestamp.trim());
            if (index === -1) {
                return res.status(404).json({
                    success: false,
                    error: 'Message not found'
                });
            }

            const [removed] = chatHistory.splice(index, 1);
            res.json({
                success: true,
                removed
            });
        });

        // Player management API endpoints

        // Create a new player
        app.post('/api/player', async (req, res) => {
            try {
                const { name, attributes, level } = req.body;

                const player = new Player({
                    name: name || 'New Player',
                    attributes: attributes || {},
                    level: level || 1
                });

                players.set(player.id, player);
                currentPlayer = player;

                try {
                    const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
                    const region = location ? findRegionByLocationId(location.id) : null;
                    await generateInventoryForCharacter({
                        character: player,
                        characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                        region,
                        location
                    });
                    restoreCharacterHealthToMaximum(player);
                } catch (inventoryError) {
                    console.warn('Failed to generate player inventory:', inventoryError);
                }

                res.json({
                    success: true,
                    player: serializeNpcForClient(player),
                    message: 'Player created successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get current player status
        app.get('/api/player', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            res.json({
                success: true,
                player: serializeNpcForClient(currentPlayer)
            });
        });

        app.get('/api/player/party', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const memberIds = currentPlayer.getPartyMembers();
                const members = memberIds
                    .map(id => players.get(id))
                    .filter(Boolean)
                    .map(member => serializeNpcForClient(member, { includePartyMembers: false }));

                res.json({
                    success: true,
                    members,
                    count: members.length
                });
            } catch (error) {
                console.error('Error retrieving party members:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/player/party', (req, res) => {
            try {
                const { ownerId, memberId } = req.body || {};

                if (!ownerId || typeof ownerId !== 'string') {
                    return res.status(400).json({ success: false, error: 'ownerId is required' });
                }
                if (!memberId || typeof memberId !== 'string') {
                    return res.status(400).json({ success: false, error: 'memberId is required' });
                }

                const owner = players.get(ownerId);
                const member = players.get(memberId);

                if (!owner) {
                    return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
                }
                if (!member) {
                    return res.status(404).json({ success: false, error: `Member player '${memberId}' not found` });
                }

                const added = owner.addPartyMember(memberId);
                if (!added) {
                    return res.json({
                        success: true,
                        message: 'Player already in party',
                        members: owner.getPartyMembers()
                    });
                }

                try {
                    // Image generation is now client-driven; ensure placeholders render on the frontend.
                    // We don't need to generate party inventory item images, as they aren't visible anywhere.
                    /*
                    const inventoryItems = typeof member?.getInventoryItems === 'function' ? member.getInventoryItems() : [];
                    for (const item of inventoryItems) {
                        if (!shouldGenerateThingImage(item)) {
                            continue;
                        }
                        generateThingImage(item).catch(itemError => {
                            console.warn('Failed to generate image for party item:', itemError.message);
                        });
                    }
                    */
                } catch (partyImageError) {
                    console.warn('Failed to schedule party imagery updates:', partyImageError.message);
                }

                res.json({
                    success: true,
                    message: `Added ${member.name} to ${owner.name}'s party`,
                    members: owner.getPartyMembers()
                });
            } catch (error) {
                console.error('Error adding party member:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.delete('/api/player/party', (req, res) => {
            try {
                const { ownerId, memberId } = req.body || {};

                if (!ownerId || typeof ownerId !== 'string') {
                    return res.status(400).json({ success: false, error: 'ownerId is required' });
                }
                if (!memberId || typeof memberId !== 'string') {
                    return res.status(400).json({ success: false, error: 'memberId is required' });
                }

                const owner = players.get(ownerId);

                if (!owner) {
                    return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
                }

                const removed = owner.removePartyMember(memberId);
                if (!removed) {
                    return res.status(404).json({ success: false, error: `Player '${memberId}' was not in the party` });
                }

                res.json({
                    success: true,
                    message: `Removed player '${memberId}' from ${owner.name}'s party`,
                    members: owner.getPartyMembers()
                });
            } catch (error) {
                console.error('Error removing party member:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Update player attributes
        app.put('/api/player/attributes', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { attributes } = req.body;

                for (const [attrName, value] of Object.entries(attributes || {})) {
                    currentPlayer.setAttribute(attrName, value);
                }

                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    message: 'Attributes updated successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Modify player health
        app.put('/api/player/health', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { amount, reason } = req.body;

                if (typeof amount !== 'number') {
                    throw new Error('Health amount must be a number');
                }

                const result = currentPlayer.modifyHealth(amount, reason || '');

                res.json({
                    success: true,
                    healthChange: result,
                    player: serializeNpcForClient(currentPlayer),
                    message: `Health ${amount > 0 ? 'increased' : 'decreased'} by ${Math.abs(amount)}`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Level up player
        app.post('/api/player/levelup', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const oldLevel = currentPlayer.level;
                currentPlayer.levelUp();

                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    message: `Player leveled up from ${oldLevel} to ${currentPlayer.level}!`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.get('/api/player/needs', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const payload = buildNeedBarSnapshot(currentPlayer, {
                    includePlayerOnly: true,
                    type: 'player'
                });

                res.json({
                    success: true,
                    ...payload
                });
            } catch (error) {
                console.error('Failed to load player needs:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to load player needs'
                });
            }
        });

        app.put('/api/player/needs', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { needs: needUpdates } = req.body || {};
                if (!Array.isArray(needUpdates)) {
                    return res.status(400).json({
                        success: false,
                        error: 'needs must be provided as an array'
                    });
                }

                const applied = [];
                for (const entry of needUpdates) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
                    if (!rawId) {
                        continue;
                    }

                    const numericValue = Number(entry.value);
                    if (!Number.isFinite(numericValue)) {
                        return res.status(400).json({
                            success: false,
                            error: `Invalid value for need '${rawId}'.`
                        });
                    }

                    const updatedBar = currentPlayer.setNeedBarValue(rawId, numericValue);
                    applied.push(normalizeNeedBarResponse(updatedBar));
                }

                const payload = buildNeedBarSnapshot(currentPlayer, {
                    includePlayerOnly: true,
                    type: 'player'
                });
                payload.applied = applied;

                res.json({
                    success: true,
                    message: applied.length ? 'Need bars updated successfully' : 'No need bar changes applied',
                    ...payload
                });
            } catch (error) {
                console.error('Failed to update player needs:', error);
                res.status(400).json({
                    success: false,
                    error: error.message || 'Failed to update player needs'
                });
            }
        });

        function buildNpcDispositionSnapshot(actor) {
            if (!actor) {
                return {
                    npc: null,
                    player: null,
                    range: {
                        min: null,
                        max: null,
                        typicalStep: null,
                        typicalBigStep: null
                    },
                    dispositions: []
                };
            }

            const dispositionDefinitions = Player.getDispositionDefinitions() || {};
            const rangeConfig = dispositionDefinitions.range || {};
            const typeMap = dispositionDefinitions.types || {};
            const currentPlayerId = currentPlayer && currentPlayer.id ? currentPlayer.id : null;
            const isNPC = Boolean(actor.isNPC);

            const normalizedRange = {
                min: Number.isFinite(rangeConfig.min) ? rangeConfig.min : null,
                max: Number.isFinite(rangeConfig.max) ? rangeConfig.max : null,
                typicalStep: Number.isFinite(rangeConfig.typicalStep) ? rangeConfig.typicalStep : null,
                typicalBigStep: Number.isFinite(rangeConfig.typicalBigStep) ? rangeConfig.typicalBigStep : null
            };

            const dispositions = [];
            for (const typeDef of Object.values(typeMap)) {
                if (!typeDef || !typeDef.key) {
                    continue;
                }

                const rawValue = currentPlayerId && typeof actor.getDisposition === 'function'
                    ? actor.getDisposition(currentPlayerId, typeDef.key)
                    : 0;
                const numericValue = Number(rawValue);
                const value = Number.isFinite(numericValue) ? numericValue : 0;
                const intensity = Player.resolveDispositionIntensity(typeDef.key, value);

                dispositions.push({
                    key: typeDef.key,
                    label: typeDef.label || typeDef.key,
                    description: typeDef.description || '',
                    value,
                    intensity,
                    thresholds: Array.isArray(typeDef.thresholds) ? typeDef.thresholds : [],
                    moveUp: Array.isArray(typeDef.moveUp) ? typeDef.moveUp : [],
                    moveDown: Array.isArray(typeDef.moveDown) ? typeDef.moveDown : [],
                    moveWayDown: Array.isArray(typeDef.moveWayDown) ? typeDef.moveWayDown : []
                });
            }

            const identity = {
                id: actor.id,
                name: actor.name || (isNPC ? 'Unknown NPC' : 'Player'),
                isNPC
            };

            return {
                npc: identity,
                player: currentPlayerId && currentPlayer
                    ? {
                        id: currentPlayer.id,
                        name: currentPlayer.name || 'Player'
                    }
                    : null,
                range: normalizedRange,
                dispositions
            };
        }

        function clampDispositionValue(value, rangeConfig = {}) {
            let resolved = Number(value);
            if (!Number.isFinite(resolved)) {
                resolved = 0;
            }

            const min = Number.isFinite(rangeConfig.min) ? rangeConfig.min : null;
            const max = Number.isFinite(rangeConfig.max) ? rangeConfig.max : null;

            if (Number.isFinite(min) && resolved < min) {
                resolved = min;
            }
            if (Number.isFinite(max) && resolved > max) {
                resolved = max;
            }

            return resolved;
        }

        function normalizeNeedBarResponse(bar) {
            if (!bar) {
                return null;
            }

            const toNumber = (input) => {
                const numeric = Number(input);
                return Number.isFinite(numeric) ? numeric : null;
            };

            const sanitizeList = (input) => Array.isArray(input)
                ? input.map(item => (typeof item === 'string' ? item.trim() : `${item ?? ''}`.trim())).filter(Boolean)
                : [];

            const effectThresholds = Array.isArray(bar.effectThresholds)
                ? bar.effectThresholds.map(entry => ({
                    threshold: toNumber(entry?.threshold),
                    name: typeof entry?.name === 'string' ? entry.name : '',
                    effect: typeof entry?.effect === 'string' ? entry.effect : ''
                }))
                : [];

            const currentThreshold = bar.currentThreshold && typeof bar.currentThreshold === 'object'
                ? {
                    threshold: toNumber(bar.currentThreshold.threshold),
                    name: typeof bar.currentThreshold.name === 'string' ? bar.currentThreshold.name : '',
                    effect: typeof bar.currentThreshold.effect === 'string' ? bar.currentThreshold.effect : ''
                }
                : null;

            const min = toNumber(bar.min);
            const max = toNumber(bar.max);
            const value = toNumber(bar.value);
            const changePerTurn = toNumber(bar.changePerTurn);

            return {
                id: typeof bar.id === 'string' ? bar.id : null,
                name: typeof bar.name === 'string' ? bar.name : (typeof bar.id === 'string' ? bar.id : 'Need'),
                description: typeof bar.description === 'string' ? bar.description : '',
                icon: typeof bar.icon === 'string' ? bar.icon : null,
                color: typeof bar.color === 'string' ? bar.color : null,
                min,
                max,
                value,
                changePerTurn,
                playerOnly: Boolean(bar.playerOnly),
                initialValue: toNumber(bar.initialValue),
                currentThreshold,
                effectThresholds,
                increases: {
                    small: sanitizeList(bar.increases?.small),
                    large: sanitizeList(bar.increases?.large),
                    fill: sanitizeList(bar.increases?.fill)
                },
                decreases: {
                    small: sanitizeList(bar.decreases?.small),
                    large: sanitizeList(bar.decreases?.large)
                },
                relatedAttribute: typeof bar.relatedAttribute === 'string' ? bar.relatedAttribute : null,
                relativeToLevel: typeof bar.relativeToLevel === 'string' ? bar.relativeToLevel : null
            };
        }

        function buildNeedBarSnapshot(actor, { includePlayerOnly, type } = {}) {
            if (!actor) {
                return {
                    needs: [],
                    includePlayerOnly: Boolean(includePlayerOnly),
                    npc: null,
                    player: null
                };
            }

            const isNPC = Boolean(actor.isNPC);
            const resolvedIncludePlayerOnly = includePlayerOnly !== undefined
                ? Boolean(includePlayerOnly)
                : !isNPC;

            let bars = [];
            try {
                if (typeof actor.getNeedBars === 'function') {
                    bars = actor.getNeedBars({ includePlayerOnly: resolvedIncludePlayerOnly }) || [];
                }
            } catch (error) {
                console.warn('Failed to collect need bars:', error?.message || error);
                bars = [];
            }

            const normalizedNeeds = bars
                .map(normalizeNeedBarResponse)
                .filter(Boolean)
                .sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    if (nameA < nameB) return -1;
                    if (nameA > nameB) return 1;
                    return 0;
                });

            const identity = {
                id: actor.id,
                name: actor.name || (isNPC ? 'Unknown NPC' : 'Player'),
                isNPC
            };

            const payload = {
                needs: normalizedNeeds,
                includePlayerOnly: resolvedIncludePlayerOnly
            };

            if (type === 'player') {
                payload.player = identity;
            } else {
                payload.npc = identity;
            }

            return payload;
        }

        function buildLocationResponse(location) {
            if (!location) {
                return null;
            }

            const locationData = location.toJSON();
            locationData.pendingImageJobId = pendingLocationImages.get(location.id) || null;

            if (locationData.exits) {
                for (const exit of Object.values(locationData.exits)) {
                    if (!exit) {
                        continue;
                    }

                    const destinationLocation = gameLocations.get(exit.destination);
                    const destinationIsStub = Boolean(destinationLocation?.isStub);
                    const destinationIsRegionEntryStub = Boolean(destinationLocation?.stubMetadata?.isRegionEntryStub);
                    if (destinationLocation) {
                        exit.destinationName = destinationLocation.name
                            || destinationLocation.stubMetadata?.blueprintDescription
                            || exit.destination;
                    }

                    const destinationRegionId = exit.destinationRegion || null;
                    let destinationRegionName = null;
                    let destinationRegionExpanded = false;

                    if (destinationRegionId) {
                        if (regions.has(destinationRegionId)) {
                            const targetRegion = regions.get(destinationRegionId);
                            destinationRegionName = targetRegion?.name || null;
                            destinationRegionExpanded = true;
                        } else {
                            const pending = pendingRegionStubs.get(destinationRegionId);
                            if (pending) {
                                destinationRegionName = pending.name || null;
                            } else if (destinationLocation?.stubMetadata?.targetRegionName) {
                                destinationRegionName = destinationLocation.stubMetadata.targetRegionName;
                            }
                        }
                    }

                    if (!destinationRegionName && destinationLocation) {
                        destinationRegionName = destinationLocation.name
                            || destinationLocation.stubMetadata?.blueprintDescription
                            || null;
                    }

                    exit.destinationRegionName = destinationRegionName;
                    exit.destinationRegionExpanded = destinationRegionExpanded;
                    exit.destinationIsStub = destinationIsStub;
                    exit.destinationIsRegionEntryStub = destinationIsRegionEntryStub;
                }
            }

            locationData.npcs = buildNpcProfiles(location);
            locationData.things = buildThingProfiles(location);

            return locationData;
        }

        function buildRegionParentOptions({ excludeId = null } = {}) {
            const options = [];
            for (const region of regions.values()) {
                if (excludeId && region.id === excludeId) {
                    continue;
                }
                options.push({
                    id: region.id,
                    name: region.name,
                    description: region.description,
                    parentRegionId: region.parentRegionId || null
                });
            }
            options.sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            return options;
        }

        app.get('/api/regions/:id', (req, res) => {
            try {
                const regionIdRaw = req.params.id;
                const regionId = typeof regionIdRaw === 'string' ? regionIdRaw.trim() : '';
                if (!regionId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Region ID is required'
                    });
                }

                const region = regions.get(regionId);
                if (!region) {
                    return res.status(404).json({
                        success: false,
                        error: `Region '${regionId}' not found`
                    });
                }

                const parentOptions = buildRegionParentOptions({ excludeId: regionId });
                const payload = {
                    id: region.id,
                    name: region.name,
                    description: region.description,
                    parentRegionId: region.parentRegionId || null
                };

                let parentRegionName = null;
                if (payload.parentRegionId && regions.has(payload.parentRegionId)) {
                    parentRegionName = regions.get(payload.parentRegionId).name || null;
                }

                res.json({
                    success: true,
                    region: {
                        ...payload,
                        parentRegionName
                    },
                    parentOptions
                });
            } catch (error) {
                console.error('Failed to load region:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to load region'
                });
            }
        });

        app.put('/api/regions/:id', (req, res) => {
            try {
                const regionIdRaw = req.params.id;
                const regionId = typeof regionIdRaw === 'string' ? regionIdRaw.trim() : '';
                if (!regionId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Region ID is required'
                    });
                }

                const region = regions.get(regionId);
                if (!region) {
                    return res.status(404).json({
                        success: false,
                        error: `Region '${regionId}' not found`
                    });
                }

                const {
                    name,
                    description,
                    parentRegionId: parentRegionIdRaw
                } = req.body || {};

                if (typeof name !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Region name must be provided as a string'
                    });
                }
                if (typeof description !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Region description must be provided as a string'
                    });
                }

                const parentRegionId = typeof parentRegionIdRaw === 'string' && parentRegionIdRaw.trim()
                    ? parentRegionIdRaw.trim()
                    : null;

                if (parentRegionId === regionId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Region cannot be its own parent'
                    });
                }

                if (parentRegionId && !regions.has(parentRegionId)) {
                    return res.status(404).json({
                        success: false,
                        error: `Parent region '${parentRegionId}' not found`
                    });
                }

                if (parentRegionId) {
                    let cursor = regions.get(parentRegionId);
                    const guard = new Set([regionId]);
                    while (cursor) {
                        if (guard.has(cursor.id)) {
                            return res.status(400).json({
                                success: false,
                                error: 'Cannot set parent region because it would create a cycle'
                            });
                        }
                        if (!cursor.parentRegionId) {
                            break;
                        }
                        guard.add(cursor.id);
                        cursor = regions.get(cursor.parentRegionId) || null;
                    }
                }

                try {
                    const trimmedName = name.trim();
                    const trimmedDescription = description.trim();
                    region.name = trimmedName;
                    region.description = trimmedDescription;
                } catch (validationError) {
                    return res.status(400).json({
                        success: false,
                        error: validationError?.message || 'Invalid region values'
                    });
                }

                if (parentRegionId !== undefined && parentRegionId !== region.parentRegionId) {
                    region.parentRegionId = parentRegionId;
                }

                const parentOptions = buildRegionParentOptions({ excludeId: regionId });
                const payload = {
                    id: region.id,
                    name: region.name,
                    description: region.description,
                    parentRegionId: region.parentRegionId || null
                };

                let parentRegionName = null;
                if (payload.parentRegionId && regions.has(payload.parentRegionId)) {
                    parentRegionName = regions.get(payload.parentRegionId).name || null;
                }

                res.json({
                    success: true,
                    message: 'Region updated successfully.',
                    region: {
                        ...payload,
                        parentRegionName
                    },
                    parentOptions
                });
            } catch (error) {
                console.error('Failed to update region:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to update region'
                });
            }
        });

        // Update an NPC's core data (experimental editing UI)
        app.put('/api/npcs/:id', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({ success: false, error: 'Character ID is required' });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({ success: false, error: `Character with ID '${npcId}' not found` });
                }

                const {
                    name,
                    description,
                    race,
                    class: className,
                    level,
                    health,
                    shortDescription,
                    healthAttribute,
                    attributes,
                    skills: skillValues,
                    abilities,
                    unspentSkillPoints,
                    currency,
                    experience
                } = req.body || {};

                if (typeof name === 'string' && name.trim()) {
                    npc.setName(name.trim());
                }

                if (typeof description === 'string') {
                    npc.description = description;
                }

                if (typeof race === 'string') {
                    npc.race = race.trim();
                }

                if (typeof className === 'string') {
                    npc.class = className.trim();
                }

                if (typeof shortDescription === 'string') {
                    npc.shortDescription = shortDescription;
                }

                if (level !== undefined) {
                    const parsedLevel = Number.parseInt(level, 10);
                    if (Number.isFinite(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 20) {
                        npc.setLevel(parsedLevel);
                    }
                }

                if (health !== undefined) {
                    const parsedHealth = Number.parseInt(health, 10);
                    if (Number.isFinite(parsedHealth) && parsedHealth >= 0) {
                        npc.setHealth(parsedHealth);
                    }
                }

                if (typeof healthAttribute === 'string' && healthAttribute.trim()) {
                    try {
                        npc.setHealthAttribute(healthAttribute.trim());
                    } catch (healthAttrError) {
                        console.warn(`Failed to set health attribute for NPC ${npcId}:`, healthAttrError.message);
                    }
                }

                if (attributes && typeof attributes === 'object') {
                    for (const [attrName, value] of Object.entries(attributes)) {
                        const numeric = Number(value);
                        if (!Number.isFinite(numeric)) {
                            continue;
                        }
                        try {
                            npc.setAttribute(attrName, numeric);
                        } catch (attrError) {
                            console.warn(`Failed to set attribute '${attrName}' for NPC ${npcId}:`, attrError.message);
                        }
                    }
                }

                if (skillValues && typeof skillValues === 'object') {
                    for (const [skillName, value] of Object.entries(skillValues)) {
                        const numeric = Number(value);
                        if (!Number.isFinite(numeric)) {
                            continue;
                        }
                        const updated = npc.setSkillValue(skillName, numeric);
                        if (updated === false) {
                            console.warn(`Failed to set skill '${skillName}' for NPC ${npcId}`);
                        }
                    }
                }

                if (Array.isArray(abilities)) {
                    try {
                        npc.setAbilities(abilities);
                    } catch (abilityError) {
                        console.warn(`Failed to update abilities for NPC ${npcId}:`, abilityError.message);
                    }
                }

                if (unspentSkillPoints !== undefined) {
                    const parsedPoints = Number.parseInt(unspentSkillPoints, 10);
                    if (Number.isFinite(parsedPoints) && parsedPoints >= 0) {
                        try {
                            npc.setUnspentSkillPoints(parsedPoints);
                        } catch (uspError) {
                            console.warn(`Failed to set unspent skill points for NPC ${npcId}:`, uspError.message);
                        }
                    }
                }

                if (currency !== undefined) {
                    const parsedCurrency = Number.parseInt(currency, 10);
                    if (Number.isFinite(parsedCurrency) && parsedCurrency >= 0) {
                        try {
                            npc.setCurrency(parsedCurrency);
                        } catch (currencyError) {
                            console.warn(`Failed to set currency for NPC ${npcId}:`, currencyError.message);
                        }
                    }
                }

                if (experience !== undefined) {
                    const parsedExperience = Number.parseInt(experience, 10);
                    if (Number.isFinite(parsedExperience) && parsedExperience >= 0) {
                        try {
                            npc.setExperience(parsedExperience);
                        } catch (experienceError) {
                            console.warn(`Failed to set experience for NPC ${npcId}:`, experienceError.message);
                        }
                    }
                }

                const npcProfile = serializeNpcForClient(npc);
                res.json({
                    success: true,
                    npc: npcProfile,
                    message: `Character '${npc.name}' updated`
                });
            } catch (error) {
                console.error('Error updating NPC:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/npcs/:id/equipment', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({ success: false, error: 'Character ID is required' });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({ success: false, error: `Character with ID '${npcId}' not found` });
                }

                const { itemId, action, slotName, slotType } = req.body || {};
                if (!itemId || typeof itemId !== 'string' || !itemId.trim()) {
                    return res.status(400).json({ success: false, error: 'Item ID is required' });
                }

                const trimmedItemId = itemId.trim();
                const inventoryItems = typeof npc.getInventoryItems === 'function' ? npc.getInventoryItems() : [];
                const targetItem = inventoryItems.find(entry => entry && entry.id === trimmedItemId);

                if (!targetItem) {
                    return res.status(404).json({ success: false, error: 'Item not found in character inventory' });
                }

                const desiredAction = (typeof action === 'string' ? action.toLowerCase() : action) || 'equip';
                let message = '';

                if (desiredAction === 'unequip' || desiredAction === false) {
                    const changed = npc.unequipItemId(trimmedItemId);
                    if (!changed) {
                        return res.status(400).json({ success: false, error: 'Item is not currently equipped.' });
                    }
                    message = `${targetItem.name || 'Item'} unequipped.`;
                } else {
                    let result;
                    const normalizedSlotName = typeof slotName === 'string' ? slotName.trim() : '';
                    const normalizedSlotTypeRaw = typeof slotType === 'string' ? slotType.trim() : '';

                    if (normalizedSlotName) {
                        result = npc.equipItemInSlot(targetItem, normalizedSlotName);
                    } else if (normalizedSlotTypeRaw && typeof npc.getGearSlotsByType === 'function') {
                        const slotTypeLower = normalizedSlotTypeRaw.toLowerCase();
                        const gearByType = npc.getGearSlotsByType() || {};
                        const gearSnapshot = typeof npc.getGear === 'function' ? npc.getGear() : {};
                        const candidateSlots = [];
                        for (const [typeKey, slotNames] of Object.entries(gearByType)) {
                            if (!typeKey || !Array.isArray(slotNames)) {
                                continue;
                            }
                            if (typeKey === normalizedSlotTypeRaw || typeKey.toLowerCase() === slotTypeLower) {
                                candidateSlots.push(...slotNames);
                            }
                        }

                        result = false;
                        for (const candidate of candidateSlots) {
                            const slotInfo = gearSnapshot?.[candidate];
                            if (slotInfo && slotInfo.itemId) {
                                continue; // slot already occupied, try next
                            }
                            result = npc.equipItemInSlot(targetItem, candidate);
                            if (result === true) {
                                break;
                            }
                        }

                        if (result !== true) {
                            result = npc.equipItem(targetItem);
                        }
                    } else {
                        result = npc.equipItem(targetItem);
                    }

                    if (result !== true) {
                        const errorMessage = typeof result === 'string' && result.trim() ? result : 'Unable to equip item.';
                        return res.status(400).json({ success: false, error: errorMessage });
                    }
                    message = `${targetItem.name || 'Item'} equipped.`;
                }

                const npcProfile = serializeNpcForClient(npc);
                res.json({ success: true, npc: npcProfile, message });
            } catch (error) {
                console.error('Error updating character equipment:', error);
                res.status(500).json({ success: false, error: error.message || 'Failed to update character equipment' });
            }
        });

        app.get('/api/npcs/:id/needs', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Character ID is required'
                    });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({
                        success: false,
                        error: `Character with ID '${npcId}' not found`
                    });
                }

                const includePlayerOnly = !npc.isNPC;
                const payload = buildNeedBarSnapshot(npc, {
                    includePlayerOnly,
                    type: npc.isNPC ? 'npc' : 'player'
                });

                res.json({
                    success: true,
                    ...payload
                });
            } catch (error) {
                console.error('Failed to load character needs:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to load character needs'
                });
            }
        });

        app.put('/api/npcs/:id/needs', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Character ID is required'
                    });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({
                        success: false,
                        error: `Character with ID '${npcId}' not found`
                    });
                }

                const { needs: needUpdates } = req.body || {};
                if (!Array.isArray(needUpdates)) {
                    return res.status(400).json({
                        success: false,
                        error: 'needs must be provided as an array'
                    });
                }

                const includePlayerOnly = !npc.isNPC;
                const applied = [];
                for (const entry of needUpdates) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
                    if (!rawId) {
                        continue;
                    }

                    const numericValue = Number(entry.value);
                    if (!Number.isFinite(numericValue)) {
                        return res.status(400).json({
                            success: false,
                            error: `Invalid value for need '${rawId}'.`
                        });
                    }

                    const updatedBar = npc.setNeedBarValue(rawId, numericValue, { allowPlayerOnly: includePlayerOnly });
                    applied.push(normalizeNeedBarResponse(updatedBar));
                }

                const payload = buildNeedBarSnapshot(npc, {
                    includePlayerOnly,
                    type: npc.isNPC ? 'npc' : 'player'
                });
                payload.applied = applied;

                res.json({
                    success: true,
                    message: applied.length ? 'Need bars updated successfully' : 'No need bar changes applied',
                    ...payload
                });
            } catch (error) {
                console.error('Failed to update character needs:', error);
                res.status(400).json({
                    success: false,
                    error: error.message || 'Failed to update character needs'
                });
            }
        });

        app.get('/api/npcs/:id/dispositions', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Character ID is required'
                    });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({
                        success: false,
                        error: `Character with ID '${npcId}' not found`
                    });
                }

                const payload = buildNpcDispositionSnapshot(npc);
                res.json({
                    success: true,
                    ...payload
                });
            } catch (error) {
                console.error('Failed to load character dispositions:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to load dispositions'
                });
            }
        });

        app.put('/api/npcs/:id/dispositions', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Character ID is required'
                    });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({
                        success: false,
                        error: `Character with ID '${npcId}' not found`
                    });
                }

                if (!currentPlayer || !currentPlayer.id) {
                    return res.status(400).json({
                        success: false,
                        error: 'No current player found to compare dispositions against'
                    });
                }

                const { dispositions: dispositionUpdates } = req.body || {};
                if (dispositionUpdates !== undefined && !Array.isArray(dispositionUpdates)) {
                    return res.status(400).json({
                        success: false,
                        error: 'dispositions must be an array'
                    });
                }

                const definitions = Player.getDispositionDefinitions() || {};
                const rangeConfig = definitions.range || {};
                const applied = [];

                if (Array.isArray(dispositionUpdates)) {
                    for (const entry of dispositionUpdates) {
                        if (!entry) {
                            continue;
                        }
                        const definition = Player.getDispositionDefinition(entry.key || entry.type);
                        if (!definition || !definition.key) {
                            continue;
                        }

                        const clampedValue = clampDispositionValue(entry.value, rangeConfig);
                        npc.setDisposition(currentPlayer.id, definition.key, clampedValue);
                        const intensity = Player.resolveDispositionIntensity(definition.key, clampedValue);

                        applied.push({
                            key: definition.key,
                            label: definition.label || definition.key,
                            value: clampedValue,
                            intensity
                        });
                    }
                }

                const payload = buildNpcDispositionSnapshot(npc);
                payload.applied = applied;

                res.json({
                    success: true,
                    message: applied.length ? 'Dispositions updated successfully' : 'No disposition changes applied',
                    ...payload
                });
            } catch (error) {
                console.error('Failed to update character dispositions:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to update dispositions'
                });
            }
        });

        // Get all players (for future multi-player support)
        app.get('/api/players', (req, res) => {
            const playerList = Array.from(players.values()).map(player => (
                serializeNpcForClient(player)
            ));

            res.json({
                success: true,
                players: playerList,
                count: playerList.length,
                currentPlayer: currentPlayer ? currentPlayer.id : null
            });
        });

        // Set current player
        app.post('/api/player/set-current', (req, res) => {
            try {
                const { playerId } = req.body;

                if (!playerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Player ID is required'
                    });
                }

                const player = players.get(playerId);
                if (!player) {
                    return res.status(404).json({
                        success: false,
                        error: `Player with ID '${playerId}' not found`
                    });
                }

                currentPlayer = player;

                res.json({
                    success: true,
                    currentPlayer: serializeNpcForClient(currentPlayer),
                    message: `Current player set to: ${currentPlayer.name}`
                });
            } catch (error) {
                console.error('Error setting current player:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get attribute definitions
        app.get('/api/attributes', (req, res) => {
            if (!currentPlayer) {
                // Create a temporary player to get definitions
                const tempPlayer = new Player();
                res.json({
                    success: true,
                    attributes: tempPlayer.attributeDefinitions,
                    generationMethods: tempPlayer.getGenerationMethods(),
                    systemConfig: tempPlayer.systemConfig
                });
            } else {
                res.json({
                    success: true,
                    attributes: currentPlayer.attributeDefinitions,
                    generationMethods: currentPlayer.getGenerationMethods(),
                    systemConfig: currentPlayer.systemConfig
                });
            }
        });

        // Generate new attributes for current player
        app.post('/api/player/generate-attributes', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { method } = req.body;
                const availableMethods = Object.keys(currentPlayer.getGenerationMethods());

                if (method && !availableMethods.includes(method)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid generation method. Available: ${availableMethods.join(', ')}`
                    });
                }

                const diceModule = require('./nunjucks_dice.js');
                const newAttributes = currentPlayer.generateAttributes(method || 'standard', diceModule);

                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    generatedAttributes: newAttributes,
                    method: method || 'standard',
                    message: `Attributes generated using ${method || 'standard'} method`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete an NPC entirely
        app.delete('/api/npcs/:id', (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId || typeof npcId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'NPC ID is required'
                    });
                }

                const result = deleteNpcById(npcId, { reason: 'api-request' });
                if (!result.success) {
                    const statusCode = result.status || (result.error === 'NPC ID is required' ? 400 : 404);
                    return res.status(statusCode).json({
                        success: false,
                        error: result.error || 'Failed to delete NPC'
                    });
                }

                res.json({
                    success: true,
                    message: 'NPC deleted successfully',
                    locationId: result.locationId,
                    regionId: result.regionId
                });
            } catch (error) {
                console.error('Failed to delete NPC:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to delete NPC'
                });
            }
        });

        app.post('/api/player/equip', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { slotName, itemId } = req.body || {};
                const resolvedSlotName = typeof slotName === 'string' ? slotName.trim() : '';

                if (!resolvedSlotName) {
                    return res.status(400).json({
                        success: false,
                        error: 'Slot name is required'
                    });
                }

                const gearSnapshot = currentPlayer.getGear();
                if (!gearSnapshot || !Object.prototype.hasOwnProperty.call(gearSnapshot, resolvedSlotName)) {
                    return res.status(400).json({
                        success: false,
                        error: `Unknown equipment slot '${resolvedSlotName}'`
                    });
                }

                let actionSucceeded = false;

                if (itemId) {
                    const inventoryItems = currentPlayer.getInventoryItems();
                    const targetItem = inventoryItems.find(item => item?.id === itemId);

                    if (!targetItem) {
                        return res.status(404).json({
                            success: false,
                            error: 'Item not found in inventory'
                        });
                    }

                    actionSucceeded = currentPlayer.equipItemInSlot(targetItem, resolvedSlotName);

                    if (!actionSucceeded) {
                        return res.status(400).json({
                            success: false,
                            error: 'Failed to equip item in the requested slot'
                        });
                    }
                } else {
                    const gearEntry = gearSnapshot[resolvedSlotName];
                    if (!gearEntry?.itemId) {
                        actionSucceeded = true; // Already empty
                    } else {
                        actionSucceeded = currentPlayer.unequipSlot(resolvedSlotName);
                    }
                }

                if (!actionSucceeded) {
                    return res.status(400).json({
                        success: false,
                        error: 'No changes were applied to equipment'
                    });
                }

                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    message: 'Equipment updated successfully'
                });
            } catch (error) {
                console.error('Error equipping item:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Player Stats Configuration Routes

        // Get player stats page
        app.get('/player-stats', (req, res) => {
            res.render('player-stats.njk', {
                title: 'Player Stats Configuration',
                player: currentPlayer ? serializeNpcForClient(currentPlayer) : null,
                currentPage: 'player-stats',
                availableSkills: Array.from(skills.values()).map(skill => skill.toJSON())
            });
        });

        // Debug page - shows current player information
        app.get('/debug', (req, res) => {
            // Collect all players data
            const allPlayersData = {};
            for (const [playerId, player] of players) {
                allPlayersData[playerId] = player.toJSON();
            }

            // Load locations from defs/locations.yaml if it exists
            let locationsData = {};
            try {
                const locationsPath = path.join(__dirname, 'defs', 'locations.yaml');
                if (fs.existsSync(locationsPath)) {
                    const locationsFile = fs.readFileSync(locationsPath, 'utf8');
                    if (locationsFile.trim()) {
                        locationsData = yaml.load(locationsFile) || {};
                    }
                }
            } catch (error) {
                console.error('Error loading locations data:', error.message);
                locationsData = { error: 'Failed to load locations data' };
            }

            // Convert game world Maps to objects for display
            const gameWorldData = {
                locations: Object.fromEntries(
                    Array.from(gameLocations.entries()).map(([id, location]) => [id, location.toJSON()])
                ),
                locationExits: Object.fromEntries(
                    Array.from(gameLocationExits.entries()).map(([id, exit]) => [id, exit.toJSON()])
                ),
                regions: Object.fromEntries(
                    Array.from(regions.entries()).map(([id, region]) => [id, region.toJSON()])
                )
            };

            const debugData = {
                title: 'Debug: Player Information',
                player: currentPlayer ? serializeNpcForClient(currentPlayer) : null,
                playerStatus: currentPlayer ? serializeNpcForClient(currentPlayer) : null,
                playerJson: currentPlayer ? currentPlayer.toJSON() : null,
                totalPlayers: players.size,
                currentPlayerId: currentPlayer ? currentPlayer.toJSON().id : null,
                allPlayers: allPlayersData,
                allLocations: locationsData, // YAML-loaded locations for reference
                allSettings: SettingInfo.getAll().map(setting => setting.toJSON()),
                currentSetting: currentSetting,
                gameWorld: gameWorldData, // In-memory game world data
                gameWorldCounts: {
                    locations: gameLocations.size,
                    locationExits: gameLocationExits.size,
                    regions: regions.size
                },
                currentPage: 'debug'
            };

            res.render('debug.njk', debugData);
        });

        // Update player stats
        app.post('/api/player/update-stats', (req, res) => {
            try {
                const { name, description, level, health, attributes, skills: skillValues, unspentSkillPoints } = req.body;

                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found. Please create a player first.'
                    });
                }

                // Track if description changed for image regeneration
                const originalDescription = currentPlayer.description;
                const originalName = currentPlayer.name;
                let descriptionChanged = false;
                let nameChanged = false;

                // Update basic information
                if (name && name.trim()) {
                    const trimmedName = name.trim();
                    if (trimmedName !== originalName) {
                        nameChanged = true;
                    }
                    currentPlayer.setName(trimmedName);
                }

                if (description !== undefined) {
                    const newDescription = description.trim();
                    if (originalDescription !== newDescription) {
                        descriptionChanged = true;
                    }
                    currentPlayer.setDescription(newDescription);
                }

                if (level && !isNaN(level) && level >= 1 && level <= 20) {
                    currentPlayer.setLevel(parseInt(level));
                }

                if (health !== undefined && !isNaN(health) && health >= 0) {
                    currentPlayer.setHealth(parseInt(health));
                }


                // Update attributes
                if (attributes && typeof attributes === 'object') {
                    for (const [attrName, value] of Object.entries(attributes)) {
                        if (!isNaN(value) && value >= 3 && value <= 18) {
                            currentPlayer.setAttribute(attrName, parseInt(value));
                        }
                    }
                }

                if (skillValues && typeof skillValues === 'object') {
                    for (const [skillName, value] of Object.entries(skillValues)) {
                        if (!isNaN(value)) {
                            currentPlayer.setSkillValue(skillName, parseInt(value));
                        }
                    }
                }

                if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                    currentPlayer.setUnspentSkillPoints(parseInt(unspentSkillPoints));
                }

                if (typeof currentPlayer.syncSkillsWithAvailable === 'function') {
                    currentPlayer.syncSkillsWithAvailable();
                }

                // Trigger image regeneration if description changed
                if (descriptionChanged || nameChanged) {
                    currentPlayer.imageId = null;
                }

                const imageNeedsUpdate = descriptionChanged || nameChanged;
                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    message: 'Player stats updated successfully',
                    imageNeedsUpdate
                });

            } catch (error) {
                console.error('Error updating player stats:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Create new player from stats form
        app.post('/api/player/create-from-stats', async (req, res) => {
            try {
                const { name, description, level, health, attributes, skills: skillValues, unspentSkillPoints } = req.body;

                // Validate required fields
                if (!name || !name.trim()) {
                    return res.status(400).json({
                        success: false,
                        error: 'Player name is required'
                    });
                }

                // Create player data object
                const playerData = {
                    name: name.trim(),
                    description: description ? description.trim() : '',
                    level: level && !isNaN(level) ? Math.max(1, Math.min(20, parseInt(level))) : 1,
                    health: -1,
                    attributes: {}
                };

                // Process attributes
                if (attributes && typeof attributes === 'object') {
                    for (const [attrName, value] of Object.entries(attributes)) {
                        if (!isNaN(value)) {
                            playerData.attributes[attrName] = Math.max(3, Math.min(18, parseInt(value)));
                        }
                    }
                }

                if (skillValues && typeof skillValues === 'object') {
                    playerData.skills = {};
                    for (const [skillName, value] of Object.entries(skillValues)) {
                        if (!isNaN(value)) {
                            playerData.skills[skillName] = Math.max(0, parseInt(value));
                        }
                    }
                }

                if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                    playerData.unspentSkillPoints = Math.max(0, parseInt(unspentSkillPoints));
                }

                // Create the player
                const player = new Player(playerData);
                players.set(player.id, player);
                currentPlayer = player;

                if (typeof player.syncSkillsWithAvailable === 'function') {
                    player.syncSkillsWithAvailable();
                }

                try {
                    const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
                    const region = location ? findRegionByLocationId(location.id) : null;
                    await generateInventoryForCharacter({
                        character: player,
                        characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                        region,
                        location
                    });
                    restoreCharacterHealthToMaximum(player);
                } catch (inventoryError) {
                    console.warn('Failed to generate player inventory (stats):', inventoryError);
                }

                res.json({
                    success: true,
                    player: serializeNpcForClient(player),
                    message: 'Player created successfully from stats'
                });

            } catch (error) {
                console.error('Error creating player from stats:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/player/skills/:skillName/increase', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { skillName } = req.params;
                const amountRaw = req.body?.amount;
                const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : 1;

                const newRank = currentPlayer.increaseSkill(skillName, amount);

                res.json({
                    success: true,
                    player: serializeNpcForClient(currentPlayer),
                    skill: {
                        name: skillName,
                        rank: newRank
                    },
                    amount
                });
            } catch (error) {
                console.error('Error increasing skill:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate player portrait manually
        app.post('/api/players/:id/portrait', async (req, res) => {
            try {
                const playerId = req.params.id;

                // Find the player by ID
                const player = players.get(playerId);
                if (!player) {
                    return res.status(404).json({
                        success: false,
                        error: `Player with ID '${playerId}' not found`
                    });
                }

                // Check if image generation is enabled
                if (!config.imagegen || !config.imagegen.enabled) {
                    return res.status(503).json({
                        success: false,
                        error: 'Image generation is not enabled'
                    });
                }

                if (!comfyUIClient) {
                    return res.status(503).json({
                        success: false,
                        error: 'ComfyUI client not initialized or unavailable'
                    });
                }

                // Generate the portrait
                const imageResult = await generatePlayerImage(player, { force: true });

                if (imageResult.success) {
                    return res.json({
                        success: true,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        },
                        imageGeneration: imageResult,
                        message: `Portrait regeneration initiated for ${player.name}`
                    });
                }

                if (imageResult.existingJob) {
                    return res.status(202).json({
                        success: false,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        },
                        imageGeneration: imageResult,
                        message: 'Portrait job already in progress'
                    });
                }

                if (imageResult.skipped) {
                    return res.status(409).json({
                        success: false,
                        error: 'Portrait generation is only available for companions in your party or at your current location.',
                        reason: imageResult.reason,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        }
                    });
                }

                res.status(500).json({
                    success: false,
                    error: imageResult.message || 'Failed to queue portrait generation'
                });

            } catch (error) {
                console.error('Error generating player portrait:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/npcs/:id/portrait', async (req, res) => {
            try {
                const npcId = req.params.id;
                if (!npcId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Character ID is required'
                    });
                }

                const npc = players.get(npcId);
                if (!npc) {
                    return res.status(404).json({
                        success: false,
                        error: `Character with ID '${npcId}' not found`
                    });
                }

                if (!config.imagegen || !config.imagegen.enabled) {
                    return res.status(503).json({
                        success: false,
                        error: 'Image generation is not enabled'
                    });
                }

                if (!comfyUIClient) {
                    return res.status(503).json({
                        success: false,
                        error: 'ComfyUI client not initialized or unavailable'
                    });
                }

                const rawClientId = req.body?.clientId;
                const clientId = typeof rawClientId === 'string' && rawClientId.trim()
                    ? rawClientId.trim()
                    : null;

                const imageResult = await generatePlayerImage(npc, { force: true, clientId });

                if (imageResult.success) {
                    return res.json({
                        success: true,
                        npc: {
                            id: npc.id,
                            name: npc.name,
                            imageId: npc.imageId
                        },
                        imageGeneration: imageResult,
                        message: `Portrait regeneration initiated for ${npc.name}`
                    });
                }

                if (imageResult.existingJob) {
                    return res.status(202).json({
                        success: false,
                        npc: {
                            id: npc.id,
                            name: npc.name,
                            imageId: npc.imageId
                        },
                        imageGeneration: imageResult,
                        message: 'Portrait job already in progress'
                    });
                }

                if (imageResult.skipped) {
                    return res.status(409).json({
                        success: false,
                        error: 'Portrait generation is only available for companions in your party or at your current location.',
                        reason: imageResult.reason,
                        npc: {
                            id: npc.id,
                            name: npc.name,
                            imageId: npc.imageId
                        }
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: imageResult.message || 'Failed to queue portrait generation'
                });
            } catch (error) {
                console.error('Error generating NPC portrait:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== PLAYER AND LOCATION QUERY ENDPOINTS ====================

        // Get all named locations (summary list)
        app.get('/api/locations', (req, res) => {
            try {
                const scope = typeof req.query?.scope === 'string' ? req.query.scope.trim().toLowerCase() : null;
                const includeNamedOnly = !scope || scope === 'named' || scope === 'names';

                if (!(gameLocations instanceof Map) || gameLocations.size === 0) {
                    return res.json({
                        success: true,
                        locations: []
                    });
                }

                const summaries = [];
                const seenIds = new Set();

                const resolveRegionName = (regionId) => {
                    if (!regionId || !(regions instanceof Map)) {
                        return null;
                    }
                    const region = regions.get(regionId);
                    if (!region) {
                        return null;
                    }
                    const rawName = typeof region.name === 'string' ? region.name.trim() : '';
                    return rawName || null;
                };

                const pushLocation = (location) => {
                    if (!location || !location.id || seenIds.has(location.id)) {
                        return;
                    }

                    const rawName = typeof location.name === 'string' ? location.name.trim() : '';
                    if (includeNamedOnly && !rawName) {
                        return;
                    }

                    const regionId = location.regionId || location.stubMetadata?.regionId || null;
                    const regionName = resolveRegionName(regionId) || 'Unknown Region';
                    const label = rawName ? `[${regionName}]: ${rawName}` : `[${regionName}]`;

                    summaries.push({
                        id: location.id,
                        name: rawName,
                        regionId,
                        regionName,
                        label
                    });
                    seenIds.add(location.id);
                };

                for (const location of gameLocations.values()) {
                    pushLocation(location);
                }

                summaries.sort((a, b) => {
                    const labelA = typeof a.label === 'string' ? a.label.toLowerCase() : '';
                    const labelB = typeof b.label === 'string' ? b.label.toLowerCase() : '';
                    return labelA.localeCompare(labelB);
                });

                res.json({
                    success: true,
                    locations: summaries
                });
            } catch (error) {
                console.error('Failed to list locations:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to list locations'
                });
            }
        });

        // Get location by ID
        app.get('/api/locations/:id', async (req, res) => {
            try {
                const locationId = req.params.id;
                let location = Location.get(locationId);

                if (!location) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                if (location.isStub && location.stubMetadata?.isRegionEntryStub) {
                    try {
                        const expanded = await expandRegionEntryStub(location);
                        if (expanded) {
                            location = expanded;
                        }
                    } catch (expansionError) {
                        console.error('Failed to expand region entry stub:', expansionError);
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand region: ${expansionError.message}`,
                            trace: expansionError.stack || String(expansionError)
                        });
                    }
                }

                if (location.isStub && !location.stubMetadata?.isRegionEntryStub) {
                    try {
                        await scheduleStubExpansion(location);
                        location = gameLocations.get(location.id) || location;
                    } catch (expansionError) {
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand location: ${expansionError.message}`
                        });
                    }
                }

                if (currentPlayer && currentPlayer.currentLocation === location.id) {
                    try {
                        queueLocationThingImages(location);
                    } catch (itemQueueError) {
                        console.warn('Failed to queue thing images after fetching location:', itemQueueError.message);
                    }
                }

                const locationData = buildLocationResponse(location);
                if (!locationData) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to serialize location data.'
                    });
                }

                res.json({
                    success: true,
                    location: locationData
                });
            } catch (error) {
                console.error('Error fetching location:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.put('/api/locations/:id', (req, res) => {
            try {
                const locationId = req.params.id;
                if (!locationId || typeof locationId !== 'string') {
                    return res.status(400).json({ success: false, error: 'Location ID is required' });
                }

                const location = gameLocations.get(locationId) || Location.get(locationId);
                if (!location) {
                    return res.status(404).json({ success: false, error: `Location with ID '${locationId}' not found` });
                }

                const body = req.body || {};
                const hasOwn = Object.prototype.hasOwnProperty;
                const hasName = hasOwn.call(body, 'name');
                const hasDescription = hasOwn.call(body, 'description');
                const hasLevel = hasOwn.call(body, 'level');

                if (!hasDescription) {
                    return res.status(400).json({ success: false, error: 'Description is required' });
                }

                if (!hasLevel) {
                    return res.status(400).json({ success: false, error: 'Level is required' });
                }

                let resolvedName = location.name;
                if (hasName) {
                    if (typeof body.name === 'string') {
                        resolvedName = body.name.trim() || null;
                    } else if (body.name === null) {
                        resolvedName = null;
                    } else if (body.name === undefined) {
                        resolvedName = location.name;
                    } else {
                        return res.status(400).json({ success: false, error: 'Name must be a string or null' });
                    }
                }

                if (typeof body.description !== 'string' || !body.description.trim()) {
                    return res.status(400).json({ success: false, error: 'Description must be a non-empty string' });
                }
                const resolvedDescription = body.description.trim();

                const numericLevel = Number(body.level);
                if (!Number.isFinite(numericLevel)) {
                    return res.status(400).json({ success: false, error: 'Level must be a number' });
                }
                const resolvedLevel = Math.max(1, Math.round(numericLevel));

                const previousName = location.name;
                const previousDescription = location.description;
                const previousLevel = location.baseLevel;
                const previousImageId = location.imageId;

                let nameChanged = false;
                if (hasName && resolvedName !== previousName) {
                    location.name = resolvedName;
                    nameChanged = true;
                }

                let descriptionChanged = false;
                if (resolvedDescription !== previousDescription) {
                    location.description = resolvedDescription;
                    descriptionChanged = true;
                }

                let levelChanged = false;
                if (hasLevel && previousLevel !== resolvedLevel) {
                    location.baseLevel = resolvedLevel;
                    levelChanged = true;
                }

                const shouldClearImage = (nameChanged || descriptionChanged) && previousImageId;
                if (shouldClearImage) {
                    location.imageId = null;

                    if (pendingLocationImages && typeof pendingLocationImages.delete === 'function') {
                        pendingLocationImages.delete(location.id);
                    }
                    if (generatedImages && typeof generatedImages.delete === 'function') {
                        generatedImages.delete(previousImageId);
                    }
                }

                const locationPayload = buildLocationResponse(location);
                if (!locationPayload) {
                    return res.status(500).json({ success: false, error: 'Failed to serialize location after update.' });
                }

                res.json({
                    success: true,
                    message: 'Location updated successfully',
                    location: locationPayload,
                    imageCleared: Boolean(shouldClearImage),
                    changes: {
                        name: nameChanged,
                        description: descriptionChanged,
                        level: levelChanged
                    }
                });
            } catch (error) {
                console.error('Error updating location:', error);
                res.status(500).json({ success: false, error: error.message || 'Unknown error updating location' });
            }
        });

        function findExitOnLocation(location, predicate) {
            if (!location || typeof location.getAvailableDirections !== 'function' || typeof location.getExit !== 'function') {
                return null;
            }

            const directions = location.getAvailableDirections();
            for (const direction of directions) {
                const exit = location.getExit(direction);
                if (!exit) {
                    continue;
                }
                try {
                    if (predicate(exit, direction)) {
                        return { direction, exit };
                    }
                } catch (error) {
                    console.warn('findExitOnLocation predicate failure:', error.message);
                    throw error;
                }
            }
            return null;
        }

        function findExitById(location, exitId) {
            if (!exitId) {
                return null;
            }
            return findExitOnLocation(location, exit => exit.id === exitId);
        }

        function removeExitStrict(location, direction, exitId = null) {
            if (!location || typeof location.removeExit !== 'function' || !direction) {
                throw new Error('removeExitStrict requires a location with a removable exit');
            }
            const removed = location.removeExit(direction);
            if (!removed) {
                const locationId = location.id || 'unknown';
                const message = exitId
                    ? `Failed to remove exit '${exitId}' from direction '${direction}' on location '${locationId}'`
                    : `Failed to remove exit on direction '${direction}' for location '${locationId}'`;
                throw new Error(message);
            }
            if (exitId && gameLocationExits.has(exitId)) {
                gameLocationExits.delete(exitId);
            }
            return true;
        }

        function deleteStubLocation(stubLocation) {
            if (!stubLocation || typeof stubLocation.getAvailableDirections !== 'function') {
                return null;
            }

            const stubId = stubLocation.id || null;
            const removedExitIds = [];

            const directions = stubLocation.getAvailableDirections();
            for (const direction of directions) {
                const stubExit = stubLocation.getExit(direction);
                if (!stubExit) {
                    continue;
                }
                removeExitStrict(stubLocation, direction, stubExit.id || null);
                if (stubExit.id) {
                    removedExitIds.push(stubExit.id);
                }
            }

            if (stubId && pendingLocationImages && typeof pendingLocationImages.delete === 'function') {
                pendingLocationImages.delete(stubId);
            }

            if (stubId && stubExpansionPromises && typeof stubExpansionPromises.delete === 'function') {
                stubExpansionPromises.delete(stubId);
            }

            if (stubId && regionEntryExpansionPromises && typeof regionEntryExpansionPromises.delete === 'function') {
                regionEntryExpansionPromises.delete(stubId);
            }

            const stubRegionId = stubLocation.regionId || (stubLocation.stubMetadata?.regionId ?? null);
            if (stubRegionId) {
                const stubRegion = regions.get(stubRegionId);
                if (stubRegion) {
                    try {
                        const filteredIds = stubRegion.locationIds.filter(id => id !== stubId);
                        stubRegion.locationIds = filteredIds;
                        if (stubRegion.entranceLocationId === stubId) {
                            stubRegion.entranceLocationId = null;
                        }
                    } catch (error) {
                        console.warn(`Failed to update region '${stubRegionId}' while deleting stub '${stubId}':`, error.message);
                    }
                }
            }

            if (stubId && gameLocations.has(stubId)) {
                gameLocations.delete(stubId);
            }

            return {
                stubId,
                stubRegionId,
                removedExitIds,
                name: stubLocation.name
                    || stubLocation.stubMetadata?.shortDescription
                    || stubLocation.stubMetadata?.targetRegionName
                    || stubId
            };
        }

        app.get('/api/exits/options', (req, res) => {
            try {
                const originLocationIdRaw = typeof req.query.originLocationId === 'string' ? req.query.originLocationId.trim() : '';
                const originLocationId = originLocationIdRaw || null;
                const originRegion = originLocationId ? findRegionByLocationId(originLocationId) : null;

                const regionEntries = new Map();

                const ensureRegionEntry = (regionId, { name, isStub = false }) => {
                    if (!regionId) {
                        return null;
                    }
                    if (!regionEntries.has(regionId)) {
                        regionEntries.set(regionId, {
                            id: regionId,
                            name: name || regionId,
                            isStub: Boolean(isStub),
                            locations: [],
                            sortKey: (name || regionId).toLowerCase()
                        });
                    } else if (name && !regionEntries.get(regionId).name) {
                        regionEntries.get(regionId).name = name;
                        regionEntries.get(regionId).sortKey = name.toLowerCase();
                    }
                    if (isStub) {
                        regionEntries.get(regionId).isStub = true;
                    }
                    return regionEntries.get(regionId);
                };

                const summarizeLocation = (location) => {
                    if (!location) {
                        return null;
                    }
                    const primaryName = location.name
                        || location.stubMetadata?.shortDescription
                        || location.stubMetadata?.targetRegionName
                        || location.description
                        || location.id;
                    return {
                        id: location.id,
                        name: primaryName,
                        isStub: Boolean(location.isStub),
                        regionId: location.regionId || location.stubMetadata?.regionId || null,
                        isRegionEntryStub: Boolean(location.stubMetadata?.isRegionEntryStub),
                        sortKey: primaryName.toLowerCase()
                    };
                };

                for (const region of regions.values()) {
                    ensureRegionEntry(region.id, { name: region.name, isStub: false });
                }

                for (const pending of pendingRegionStubs.values()) {
                    ensureRegionEntry(pending.id, { name: pending.name || pending.id, isStub: true });
                }

                for (const location of gameLocations.values()) {
                    const summary = summarizeLocation(location);
                    if (!summary || !summary.regionId) {
                        continue;
                    }
                    const entry = ensureRegionEntry(summary.regionId, {
                        name: regions.get(summary.regionId)?.name || pendingRegionStubs.get(summary.regionId)?.name || summary.regionId,
                        isStub: Boolean(pendingRegionStubs.has(summary.regionId))
                    });
                    if (!entry) {
                        continue;
                    }
                    if (!entry.locations.some(loc => loc.id === summary.id)) {
                        entry.locations.push(summary);
                    }
                }

                for (const pending of pendingRegionStubs.values()) {
                    if (!pending?.entranceStubId) {
                        continue;
                    }
                    const stubLocation = gameLocations.get(pending.entranceStubId);
                    if (!stubLocation) {
                        continue;
                    }
                    const summary = summarizeLocation(stubLocation);
                    if (!summary) {
                        continue;
                    }
                    const entry = ensureRegionEntry(pending.id, { name: pending.name || pending.id, isStub: true });
                    if (!entry) {
                        continue;
                    }
                    if (!entry.locations.some(loc => loc.id === summary.id)) {
                        entry.locations.push(summary);
                    }
                }

                const regionsList = Array.from(regionEntries.values())
                    .map(entry => {
                        entry.locations.sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));
                        entry.locations.forEach(loc => { delete loc.sortKey; });
                        return entry;
                    })
                    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));

                regionsList.forEach(entry => { delete entry.sortKey; });

                res.json({
                    success: true,
                    regions: regionsList,
                    originRegionId: originRegion?.id || null
                });
            } catch (error) {
                console.error('Failed to load exit options:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to load exit options'
                });
            }
        });

        app.post('/api/locations/:id/exits', async (req, res) => {
            try {
                const locationId = req.params.id;
                if (!locationId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Location ID is required'
                    });
                }

                const originLocation = Location.get(locationId);
                if (!originLocation) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                const {
                    type,
                    name,
                    description,
                    regionId: targetRegionIdRaw,
                    locationId: targetLocationIdRaw,
                    parentRegionId: parentRegionIdRaw,
                    clientId: initiatorClientIdRaw
                } = req.body || {};
                const resolvedName = typeof name === 'string' ? name.trim() : '';
                const resolvedDescription = typeof description === 'string' ? description.trim() : '';
                const resolvedType = typeof type === 'string' ? type.trim().toLowerCase() : 'location';
                const initiatorClientId = (typeof initiatorClientIdRaw === 'string' && initiatorClientIdRaw.trim())
                    ? initiatorClientIdRaw.trim()
                    : null;
                const targetRegionId = typeof targetRegionIdRaw === 'string' && targetRegionIdRaw.trim()
                    ? targetRegionIdRaw.trim()
                    : null;
                const targetLocationId = typeof targetLocationIdRaw === 'string' && targetLocationIdRaw.trim()
                    ? targetLocationIdRaw.trim()
                    : null;
                const requestedParentRegionId = typeof parentRegionIdRaw === 'string' && parentRegionIdRaw.trim()
                    ? parentRegionIdRaw.trim()
                    : null;

                const normalizedType = targetRegionId && resolvedType === 'region' ? 'location' : resolvedType;

                if (targetRegionId && !regions.has(targetRegionId) && !pendingRegionStubs.has(targetRegionId)) {
                    return res.status(400).json({
                        success: false,
                        error: `Region '${targetRegionId}' was not found.`
                    });
                }

                let createdInfo = null;

                if (normalizedType === 'region') {
                    if (!resolvedName) {
                        return res.status(400).json({
                            success: false,
                            error: 'Exit name is required'
                        });
                    }

                    let parentRegionId = null;
                    if (requestedParentRegionId) {
                        if (regions.has(requestedParentRegionId)) {
                            parentRegionId = requestedParentRegionId;
                        } else if (pendingRegionStubs.has(requestedParentRegionId)) {
                            parentRegionId = requestedParentRegionId;
                        }
                    }

                    const regionStub = createRegionStubFromEvent({
                        name: resolvedName,
                        description: resolvedDescription,
                        originLocation,
                        parentRegionId
                    });

                    if (!regionStub) {
                        return res.status(400).json({
                            success: false,
                            error: 'Unable to create region exit. An exit with this destination may already exist.'
                        });
                    }

                    createdInfo = {
                        type: 'region',
                        stubId: regionStub?.id || null,
                        regionId: regionStub?.stubMetadata?.targetRegionId || regionStub?.stubMetadata?.regionId || null,
                        name: regionStub?.name || resolvedName,
                        parentRegionId: parentRegionId || null
                    };
                } else if (normalizedType === 'location' && targetLocationId) {
                    const destinationLocation = gameLocations.get(targetLocationId) || Location.get(targetLocationId);
                    if (!destinationLocation) {
                        return res.status(404).json({
                            success: false,
                            error: `Destination location '${targetLocationId}' not found`
                        });
                    }

                    const destinationRegion = targetRegionId
                        ? (regions.get(targetRegionId) || null)
                        : findRegionByLocationId(destinationLocation.id) || null;
                    const originRegionId = originLocation ? (findRegionByLocationId(originLocation.id)?.id || originLocation.stubMetadata?.regionId || null) : null;
                    const computedDestinationRegionId = destinationRegion?.id
                        || destinationLocation.regionId
                        || destinationLocation.stubMetadata?.regionId
                        || null;
                    const destinationRegionForExit = computedDestinationRegionId && originRegionId !== computedDestinationRegionId
                        ? computedDestinationRegionId
                        : null;
                    const fallbackName = destinationLocation.name
                        || destinationLocation.stubMetadata?.shortDescription
                        || destinationLocation.stubMetadata?.targetRegionName
                        || destinationLocation.description
                        || destinationLocation.id;
                    const exitName = resolvedName || fallbackName;

                    ensureExitConnection(originLocation, destinationLocation, {
                        description: resolvedDescription || exitName,
                        bidirectional: true,
                        destinationRegion: destinationRegionForExit
                    });

                    createdInfo = {
                        type: 'location',
                        destinationId: destinationLocation.id,
                        name: fallbackName,
                        isStub: Boolean(destinationLocation.isStub),
                        existing: true
                    };
                } else if (normalizedType === 'location') {
                    if (!resolvedName) {
                        return res.status(400).json({
                            success: false,
                            error: 'Exit name is required to create a new location.'
                        });
                    }

                    const locationStub = await createLocationFromEvent({
                        name: resolvedName,
                        originLocation,
                        descriptionHint: resolvedDescription || resolvedName,
                        directionHint: null,
                        expandStub: false,
                        targetRegionId
                    });

                    if (!locationStub) {
                        return res.status(500).json({
                            success: false,
                            error: 'Failed to create location exit'
                        });
                    }

                    createdInfo = {
                        type: 'location',
                        destinationId: locationStub.id,
                        name: locationStub.name || resolvedName,
                        isStub: Boolean(locationStub.isStub)
                    };
                } else {
                    return res.status(400).json({
                        success: false,
                        error: 'Unsupported exit type. Use "location" or "region".'
                    });
                }

                const refreshedLocation = Location.get(originLocation.id) || originLocation;
                const locationData = buildLocationResponse(refreshedLocation);

                if (!locationData) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to serialize updated location.'
                    });
                }

                const originRegion = findRegionByLocationId(refreshedLocation.id) || null;
                const eventPayload = {
                    originLocationId: refreshedLocation.id,
                    originLocationName: locationData.name || null,
                    originRegionId: originRegion?.id || null,
                    originRegionName: originRegion?.name || null,
                    created: createdInfo,
                    location: locationData,
                    initiatedBy: initiatorClientId || null,
                    timestamp: new Date().toISOString()
                };

                if (realtimeHub && typeof realtimeHub.emit === 'function') {
                    try {
                        realtimeHub.emit(null, 'location_exit_created', eventPayload);
                    } catch (broadcastError) {
                        console.warn('Failed to broadcast exit creation:', broadcastError.message);
                    }
                }

                res.json({
                    success: true,
                    message: resolvedType === 'region' ? 'Region exit created.' : 'Location exit created.',
                    location: locationData,
                    created: createdInfo
                });
            } catch (error) {
                console.error('Error creating exit:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to create exit'
                });
            }
        });

        app.delete('/api/locations/:id/exits/:exitId', (req, res) => {
            try {
                const locationIdRaw = req.params.id;
                const exitIdRaw = req.params.exitId;

                const locationId = typeof locationIdRaw === 'string' ? locationIdRaw.trim() : '';
                const exitId = typeof exitIdRaw === 'string' ? exitIdRaw.trim() : '';

                if (!locationId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Location ID is required'
                    });
                }

                if (!exitId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Exit ID is required'
                    });
                }

                const originLocation = gameLocations.get(locationId) || Location.get(locationId);
                if (!originLocation) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                const locatedExit = findExitById(originLocation, exitId);
                if (!locatedExit) {
                    return res.status(404).json({
                        success: false,
                        error: `Exit '${exitId}' was not found on location '${locationId}'`
                    });
                }

                const { direction: originDirection, exit: targetExit } = locatedExit;
                const destinationId = targetExit.destination || null;
                const destinationLocation = destinationId
                    ? (gameLocations.get(destinationId) || Location.get(destinationId))
                    : null;
                const destinationMetadata = destinationLocation?.stubMetadata || null;

                const regionCandidateIds = [];
                if (targetExit.destinationRegion) {
                    regionCandidateIds.push(targetExit.destinationRegion);
                }
                if (destinationMetadata?.targetRegionId) {
                    regionCandidateIds.push(destinationMetadata.targetRegionId);
                }
                if (destinationMetadata?.regionId) {
                    regionCandidateIds.push(destinationMetadata.regionId);
                }

                let resolvedRegionStubId = null;
                for (const candidate of regionCandidateIds) {
                    if (candidate && pendingRegionStubs.has(candidate)) {
                        resolvedRegionStubId = candidate;
                        break;
                    }
                }

                if (!resolvedRegionStubId && destinationLocation?.id) {
                    for (const [candidateId, stubInfo] of pendingRegionStubs.entries()) {
                        if (stubInfo?.entranceStubId === destinationLocation.id) {
                            resolvedRegionStubId = candidateId;
                            break;
                        }
                    }
                }

                const pendingRegionStub = resolvedRegionStubId ? pendingRegionStubs.get(resolvedRegionStubId) : null;
                const destinationIsRegionStub = Boolean(destinationMetadata?.isRegionEntryStub || pendingRegionStub);
                const destinationWasStub = Boolean(destinationLocation?.isStub);

                const body = req.body || {};
                const initiatorClientIdRaw = body.clientId ?? req.query?.clientId;
                const requestIdRaw = body.requestId ?? req.query?.requestId;

                const initiatorClientId = typeof initiatorClientIdRaw === 'string' && initiatorClientIdRaw.trim()
                    ? initiatorClientIdRaw.trim()
                    : null;
                const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim()
                    ? requestIdRaw.trim()
                    : null;

                removeExitStrict(originLocation, originDirection, targetExit.id || null);

                let reverseRemoval = null;
                if (destinationLocation) {
                    const reverseExit = findExitOnLocation(destinationLocation, candidate => candidate.destination === originLocation.id);
                    if (reverseExit) {
                        removeExitStrict(destinationLocation, reverseExit.direction, reverseExit.exit.id || null);
                        reverseRemoval = {
                            exitId: reverseExit.exit.id || null,
                            direction: reverseExit.direction
                        };
                    }
                }

                let deletedStubInfo = null;
                let preservedStubInfo = null;

                if (destinationLocation && destinationWasStub) {
                    if (destinationIsRegionStub) {
                        const stubDescriptor = deleteStubLocation(destinationLocation);
                        if (resolvedRegionStubId && pendingRegionStubs.has(resolvedRegionStubId)) {
                            const stubRecord = pendingRegionStubs.get(resolvedRegionStubId);
                            stubDescriptor.regionStubId = resolvedRegionStubId;
                            stubDescriptor.regionStubName = stubRecord?.name || stubDescriptor.name;
                            pendingRegionStubs.delete(resolvedRegionStubId);
                        } else if (resolvedRegionStubId) {
                            stubDescriptor.regionStubId = resolvedRegionStubId;
                            stubDescriptor.regionStubName = stubDescriptor.name;
                        }
                        deletedStubInfo = stubDescriptor;
                    } else {
                        const remainingDirections = destinationLocation.getAvailableDirections()
                            .map(direction => ({ direction, exit: destinationLocation.getExit(direction) }))
                            .filter(entry => Boolean(entry.exit));

                        if (remainingDirections.length === 0) {
                            deletedStubInfo = deleteStubLocation(destinationLocation);
                        } else {
                            preservedStubInfo = {
                                stubId: destinationLocation.id,
                                remainingExitCount: remainingDirections.length
                            };
                        }
                    }
                }

                const refreshedOrigin = gameLocations.get(originLocation.id) || Location.get(originLocation.id) || originLocation;
                const locationData = buildLocationResponse(refreshedOrigin);
                if (!locationData) {
                    throw new Error('Failed to serialize updated location after deleting exit.');
                }

                const originRegion = findRegionByLocationId(originLocation.id) || null;

                if (realtimeHub && typeof realtimeHub.emit === 'function') {
                    const realtimePayload = {
                        originLocationId: originLocation.id,
                        originLocationName: locationData.name || null,
                        originRegionId: originRegion?.id || null,
                        originRegionName: originRegion?.name || null,
                        removed: {
                            exitId: targetExit.id || null,
                            direction: originDirection,
                            destinationId: targetExit.destination || null,
                            destinationRegionId: targetExit.destinationRegion || null
                        },
                        reverseRemoved: reverseRemoval,
                        deletedStub: deletedStubInfo,
                        preservedStub: preservedStubInfo,
                        location: locationData,
                        initiatedBy: initiatorClientId,
                        requestId: requestId,
                        timestamp: new Date().toISOString()
                    };

                    try {
                        realtimeHub.emit(null, 'location_exit_deleted', realtimePayload);
                    } catch (broadcastError) {
                        console.warn('Failed to broadcast exit deletion:', broadcastError.message);
                    }
                }

                res.json({
                    success: true,
                    message: 'Exit deleted.',
                    location: locationData,
                    removed: {
                        exitId: targetExit.id || null,
                        direction: originDirection
                    },
                    reverseRemoved: reverseRemoval,
                    deletedStub: deletedStubInfo,
                    preservedStub: preservedStubInfo
                });
            } catch (error) {
                console.error('Error deleting exit:', error);
                const statusCode = Number.isFinite(error?.statusCode)
                    ? Number(error.statusCode)
                    : (Number.isFinite(error?.status) ? Number(error.status) : 500);
                res.status(statusCode).json({
                    success: false,
                    error: error?.message || 'Failed to delete exit'
                });
            }
        });

        app.post('/api/locations/:id/npcs', async (req, res) => {
            try {
                const locationId = req.params.id;
                if (!locationId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Location ID is required'
                    });
                }

                const location = Location.get(locationId);
                if (!location) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                const payload = req.body || {};
                const nameValue = typeof payload.name === 'string' ? payload.name.trim() : '';
                const region = findRegionByLocationId(location.id) || null;
                const trimText = (value) => {
                    if (typeof value !== 'string') {
                        return '';
                    }
                    const trimmed = value.trim();
                    return trimmed.length ? trimmed : '';
                };

                const npcSeed = { name: nameValue };

                const description = trimText(payload.description);
                if (description) {
                    npcSeed.description = description;
                }

                const shortDescription = trimText(payload.shortDescription);
                if (shortDescription) {
                    npcSeed.shortDescription = shortDescription;
                }

                const role = trimText(payload.role);
                if (role) {
                    npcSeed.role = role;
                }

                const className = trimText(payload.class);
                if (className) {
                    npcSeed.class = className;
                }

                const race = trimText(payload.race);
                if (race) {
                    npcSeed.race = race;
                }

                if (payload.currency !== undefined && payload.currency !== null && payload.currency !== '') {
                    const currencyValue = Number(payload.currency);
                    if (Number.isFinite(currencyValue) && currencyValue >= 0) {
                        npcSeed.currency = Math.max(0, Math.round(currencyValue));
                    }
                }

                if (payload.level !== undefined && payload.level !== null && payload.level !== '') {
                    const absoluteLevel = Number(payload.level);
                    if (Number.isFinite(absoluteLevel)) {
                        const locationBaseLevel = Number.isFinite(Number(location.baseLevel))
                            ? Number(location.baseLevel)
                            : (Number.isFinite(region?.averageLevel) ? Number(region.averageLevel) : (currentPlayer?.level || 1));
                        npcSeed.relativeLevel = absoluteLevel - locationBaseLevel;
                    }
                }

                const generatedNpc = await generateNpcFromEvent({
                    name: nameValue,
                    npc: npcSeed,
                    location,
                    region
                });

                if (!generatedNpc) {
                    throw new Error('Failed to generate NPC');
                }

                const locationData = buildLocationResponse(location);
                const npcStatus = typeof generatedNpc.getStatus === 'function'
                    ? serializeNpcForClient(generatedNpc)
                    : null;

                res.json({
                    success: true,
                    npc: npcStatus,
                    location: locationData,
                    message: `${generatedNpc.name || nameValue} has been created.`
                });
            } catch (error) {
                console.error('Error generating NPC:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to generate NPC'
                });
            }
        });

        app.post('/api/locations/:id/things', async (req, res) => {
            try {
                const locationId = req.params.id;
                if (!locationId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Location ID is required'
                    });
                }

                let location = null;
                try {
                    location = Location.get(locationId);
                } catch (_) {
                    location = null;
                }

                if (!location) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                const payload = req.body || {};
                const rawSeed = payload.seed || {};
                const rawName = typeof rawSeed.name === 'string' ? rawSeed.name.trim() : '';
                if (!rawName) {
                    return res.status(400).json({
                        success: false,
                        error: 'Item name is required to generate a new item.'
                    });
                }

                if (findThingByName(rawName)) {
                    return res.status(409).json({
                        success: false,
                        error: `An item named "${rawName}" already exists.`
                    });
                }

                const region = findRegionByLocationId(location.id) || null;

                const normalizeSeedString = (value) => {
                    if (typeof value !== 'string') {
                        return '';
                    }
                    const trimmed = value.trim();
                    return trimmed.length ? trimmed : '';
                };

                const seed = {
                    name: rawName,
                    description: normalizeSeedString(rawSeed.description),
                    type: normalizeSeedString(rawSeed.type),
                    slot: normalizeSeedString(rawSeed.slot),
                    rarity: normalizeSeedString(rawSeed.rarity)
                };

                const rawItemOrScenery = normalizeSeedString(rawSeed.itemOrScenery);
                seed.itemOrScenery = rawItemOrScenery && rawItemOrScenery.toLowerCase() === 'scenery'
                    ? 'scenery'
                    : 'item';

                if (rawSeed.value !== undefined && rawSeed.value !== null && rawSeed.value !== '') {
                    const numericValue = Number(rawSeed.value);
                    seed.value = Number.isFinite(numericValue) ? numericValue : rawSeed.value;
                }

                if (rawSeed.weight !== undefined && rawSeed.weight !== null && rawSeed.weight !== '') {
                    const numericWeight = Number(rawSeed.weight);
                    seed.weight = Number.isFinite(numericWeight) ? numericWeight : rawSeed.weight;
                }

                let absoluteLevel = null;
                if (payload.level !== undefined && payload.level !== null && payload.level !== '') {
                    const levelValue = Number(payload.level);
                    if (Number.isFinite(levelValue)) {
                        absoluteLevel = Math.max(1, Math.round(levelValue));
                    }
                } else if (rawSeed.level !== undefined && rawSeed.level !== null && rawSeed.level !== '') {
                    const levelValue = Number(rawSeed.level);
                    if (Number.isFinite(levelValue)) {
                        absoluteLevel = Math.max(1, Math.round(levelValue));
                    }
                }

                if (Number.isFinite(absoluteLevel)) {
                    const baseReference = Number.isFinite(Number(location.baseLevel))
                        ? Number(location.baseLevel)
                        : (Number.isFinite(Number(location.level))
                            ? Number(location.level)
                            : (Number.isFinite(Number(region?.averageLevel))
                                ? Number(region.averageLevel)
                                : (Number.isFinite(Number(currentPlayer?.level))
                                    ? Number(currentPlayer.level)
                                    : 1)));

                    const relativeLevel = absoluteLevel - baseReference;
                    seed.relativeLevel = Math.max(-10, Math.min(10, Math.round(relativeLevel)));
                } else if (rawSeed.relativeLevel !== undefined && rawSeed.relativeLevel !== null && rawSeed.relativeLevel !== '') {
                    const relativeCandidate = Number(rawSeed.relativeLevel);
                    if (Number.isFinite(relativeCandidate)) {
                        seed.relativeLevel = Math.max(-10, Math.min(10, Math.round(relativeCandidate)));
                    }
                }

                const createdItems = await generateItemsByNames({
                    itemNames: [rawName],
                    location,
                    region,
                    seeds: [seed]
                });

                let generatedThing = null;
                if (Array.isArray(createdItems) && createdItems.length) {
                    generatedThing = createdItems[0];
                }
                if (!generatedThing) {
                    generatedThing = findThingByName(rawName);
                }
                if (!generatedThing) {
                    throw new Error('Failed to generate item.');
                }

                const locationData = buildLocationResponse(location);
                const thingJson = typeof generatedThing.toJSON === 'function'
                    ? generatedThing.toJSON()
                    : generatedThing;

                res.json({
                    success: true,
                    thing: thingJson,
                    location: locationData,
                    message: `${thingJson.name || rawName} has been created.`
                });
            } catch (error) {
                console.error('Error generating item:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to generate item'
                });
            }
        });

        // Move player to a connected location
        app.post('/api/player/move', async (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { destinationId, direction } = req.body || {};
                if (!destinationId && !direction) {
                    return res.status(400).json({
                        success: false,
                        error: 'Destination ID or direction is required'
                    });
                }

                const currentLocationId = currentPlayer.currentLocation;
                const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;
                if (!currentLocation) {
                    return res.status(400).json({
                        success: false,
                        error: 'Current location not found in game world'
                    });
                }

                const directions = currentLocation.getAvailableDirections();
                let matchedExit = null;
                let matchedDirection = null;
                for (const dir of directions) {
                    const exit = currentLocation.getExit(dir);
                    if (!exit) continue;
                    if (destinationId && exit.destination === destinationId) {
                        matchedExit = exit;
                        matchedDirection = dir;
                        break;
                    }
                    if (!destinationId && direction && dir === direction) {
                        matchedExit = exit;
                        matchedDirection = dir;
                        break;
                    }
                }

                if (!matchedExit) {
                    return res.status(404).json({
                        success: false,
                        error: 'Exit not found from current location'
                    });
                }

                let destinationLocation = gameLocations.get(matchedExit.destination);
                if (!destinationLocation) {
                    return res.status(404).json({
                        success: false,
                        error: 'Destination location not found'
                    });
                }

                if (destinationLocation.isStub && destinationLocation.stubMetadata?.isRegionEntryStub) {
                    try {
                        const expanded = await expandRegionEntryStub(destinationLocation);
                        if (expanded) {
                            destinationLocation = expanded;
                        } else {
                            return res.status(500).json({
                                success: false,
                                error: 'Failed to generate destination region.'
                            });
                        }
                    } catch (expansionError) {
                        console.error('Failed to expand region entry stub:', expansionError);
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand region: ${expansionError.message}`,
                            trace: expansionError.stack || String(expansionError)
                        });
                    }
                }

                if (destinationLocation.isStub && !destinationLocation.stubMetadata?.isRegionEntryStub) {
                    try {
                        await scheduleStubExpansion(destinationLocation);
                        destinationLocation = gameLocations.get(destinationLocation.id);
                    } catch (expansionError) {
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand destination location: ${expansionError.message}`
                        });
                    }
                }

                const previousLocationIdForMemories = currentPlayer.currentLocation || null;

                currentPlayer.setLocation(destinationLocation.id);

                if (typeof currentPlayer.getPartyMembers === 'function') {
                    const partyMemberIds = currentPlayer.getPartyMembers();
                    if (Array.isArray(partyMemberIds) || partyMemberIds instanceof Set) {
                        const memberIds = Array.isArray(partyMemberIds)
                            ? partyMemberIds
                            : Array.from(partyMemberIds);

                        for (const memberId of memberIds) {
                            const member = players.get(memberId);
                            if (!member) {
                                continue;
                            }

                            const previousLocationId = member.currentLocation;
                            if (previousLocationId && gameLocations.has(previousLocationId)) {
                                const previousLocation = gameLocations.get(previousLocationId);
                                if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                                    previousLocation.removeNpcId(member.id);
                                }
                            }

                            try {
                                member.setLocation(destinationLocation.id);
                            } catch (memberError) {
                                console.warn(`Failed to update location for party member ${member.name || member.id}:`, memberError.message);
                                continue;
                            }

                            if (member.isNPC && typeof destinationLocation.removeNpcId === 'function') {
                                destinationLocation.removeNpcId(member.id);
                            }
                        }
                    }
                }

                queueNpcAssetsForLocation(destinationLocation);
                try {
                    queueLocationThingImages(destinationLocation);
                } catch (thingQueueError) {
                    console.warn('Failed to queue thing images after moving:', thingQueueError.message);
                }

                if (previousLocationIdForMemories && previousLocationIdForMemories !== destinationLocation.id) {
                    try {
                        await generateNpcMemoriesForLocationChange({
                            previousLocationId: previousLocationIdForMemories,
                            newLocationId: destinationLocation.id,
                            player: currentPlayer
                        });
                    } catch (memoryError) {
                        console.warn('Failed to generate NPC memories after direct move:', memoryError.message || memoryError);
                    }
                }

                const locationData = destinationLocation.toJSON();
                locationData.pendingImageJobId = pendingLocationImages.get(destinationLocation.id) || null;
                if (locationData.exits) {
                    for (const [dirKey, exit] of Object.entries(locationData.exits)) {
                        if (!exit) continue;
                        const destLocation = gameLocations.get(exit.destination);
                        const destinationIsStub = Boolean(destLocation?.isStub);
                        const destinationIsRegionEntryStub = Boolean(destLocation?.stubMetadata?.isRegionEntryStub);
                        if (destLocation) {
                            exit.destinationName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || exit.destination;
                        }

                        const destinationRegionId = exit.destinationRegion || null;
                        let destinationRegionName = null;
                        let destinationRegionExpanded = false;

                        if (destinationRegionId) {
                            if (regions.has(destinationRegionId)) {
                                const targetRegion = regions.get(destinationRegionId);
                                destinationRegionName = targetRegion?.name || null;
                                destinationRegionExpanded = true;
                            } else {
                                const pending = pendingRegionStubs.get(destinationRegionId);
                                if (pending) {
                                    destinationRegionName = pending.name || null;
                                } else if (destLocation?.stubMetadata?.targetRegionName) {
                                    destinationRegionName = destLocation.stubMetadata.targetRegionName;
                                }
                            }
                        }

                        if (!destinationRegionName && destLocation) {
                            destinationRegionName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || null;
                        }

                        exit.destinationRegionName = destinationRegionName;
                        exit.destinationRegionExpanded = destinationRegionExpanded;
                        exit.destinationIsStub = destinationIsStub;
                        exit.destinationIsRegionEntryStub = destinationIsRegionEntryStub;
                    }
                }
                locationData.npcs = buildNpcProfiles(destinationLocation);

                res.json({
                    success: true,
                    location: locationData,
                    message: `Moved to ${locationData.name || locationData.id}`,
                    direction: matchedDirection
                });
            } catch (error) {
                console.error('Error moving player:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.get('/api/map/region', (req, res) => {
            try {
                let requestedRegionId = null;
                if (req.query && typeof req.query.regionId === 'string') {
                    requestedRegionId = req.query.regionId.trim() || null;
                }

                if (!currentPlayer && !requestedRegionId) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const currentLocationId = currentPlayer ? currentPlayer.currentLocation : null;
                const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;

                let region = null;

                if (requestedRegionId) {
                    if (regions.has(requestedRegionId)) {
                        region = regions.get(requestedRegionId);
                    } else {
                        return res.status(404).json({
                            success: false,
                            error: `Region with ID '${requestedRegionId}' not found`
                        });
                    }
                } else {
                    if (!currentLocation) {
                        return res.status(404).json({
                            success: false,
                            error: 'Current location not found'
                        });
                    }

                    const regionId = currentLocation.stubMetadata?.regionId;
                    if (regionId && regions.has(regionId)) {
                        region = regions.get(regionId);
                    } else {
                        region = Array.from(regions.values()).find(r => r.locationIds.includes(currentLocationId)) || null;
                    }
                }

                if (!region) {
                    return res.status(404).json({
                        success: false,
                        error: 'Region not found for mapping'
                    });
                }

                const locations = region.locationIds
                    .map(id => gameLocations.get(id))
                    .filter(Boolean);

                const payload = {
                    regionId: region.id,
                    regionName: region.name,
                    currentLocationId,
                    locations: locations.map(loc => {
                        const locationPayload = {
                            id: loc.id,
                            name: loc.name || loc.id,
                            isStub: Boolean(loc.isStub),
                            visited: Boolean(loc.visited),
                            exits: Array.from(loc.getAvailableDirections()).map(direction => {
                                const exit = loc.getExit(direction);
                                const destinationRegionId = exit?.destinationRegion || null;
                                const destinationLocation = exit?.destination ? gameLocations.get(exit.destination) : null;
                                const destinationName = destinationLocation?.name
                                    || destinationLocation?.stubMetadata?.blueprintDescription
                                    || null;
                                const destinationIsStub = Boolean(destinationLocation?.isStub);
                                const destinationIsRegionEntryStub = Boolean(destinationLocation?.stubMetadata?.isRegionEntryStub);

                                let destinationRegionName = null;
                                let destinationRegionExpanded = false;

                                if (destinationRegionId) {
                                    if (regions.has(destinationRegionId)) {
                                        const targetRegion = regions.get(destinationRegionId);
                                        destinationRegionName = targetRegion?.name || null;
                                        destinationRegionExpanded = true;
                                    } else if (typeof pendingRegionStubs !== 'undefined' && pendingRegionStubs?.get) {
                                        const pending = pendingRegionStubs.get(destinationRegionId);
                                        if (pending) {
                                            destinationRegionName = pending.name || null;
                                        }
                                    }
                                }

                                return {
                                    id: exit?.id || `${loc.id}_${direction}`,
                                    destination: exit?.destination || null,
                                    destinationRegion: destinationRegionId,
                                    destinationRegionName,
                                    destinationRegionExpanded,
                                    destinationName,
                                    bidirectional: exit?.bidirectional !== false,
                                    isVehicle: Boolean(exit?.isVehicle),
                                    vehicleType: exit?.vehicleType || null,
                                    destinationIsStub,
                                    destinationIsRegionEntryStub
                                };
                            })
                        };

                        if (loc.imageId) {
                            const metadata = generatedImages.get(loc.imageId);
                            const firstImage = metadata?.images?.[0];
                            locationPayload.image = firstImage
                                ? { id: loc.imageId, url: firstImage.url }
                                : { id: loc.imageId, url: null };
                        }

                        return locationPayload;
                    })
                };

                res.json({ success: true, region: payload });
            } catch (error) {
                console.error('Error building map data:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== LOCATION GENERATION FUNCTIONALITY ====================

        // Generate a new region using AI
        app.post('/api/regions/generate', async (req, res) => {
            const body = req.body || {};
            const stream = createStreamEmitter({ clientId: body.clientId, requestId: body.requestId });

            try {
                const { regionName, regionDescription, regionNotes } = body;
                const activeSetting = getActiveSettingSnapshot();

                const options = {
                    setting: describeSettingForPrompt(activeSetting),
                    regionName: regionName && regionName.trim() ? regionName.trim() : null,
                    regionDescription: regionDescription || null,
                    regionNotes: regionNotes || null,
                    report: (stage, info = {}) => {
                        const message = info.message || `Stage: ${stage}`;
                        stream.emit('generation_status', {
                            scope: 'region',
                            stage,
                            message
                        });
                    }
                };

                const result = await generateRegionFromPrompt(options);

                stream.emit('generation_status', {
                    scope: 'region',
                    stage: 'region:complete',
                    message: `Region "${result.region.name}" ready.`
                });

                if (stream.isEnabled) {
                    stream.emit('region_generated', {
                        region: result.region.toJSON(),
                        createdLocationIds: result.region.locationIds,
                        entranceLocationId: result.region.entranceLocationId || result.entranceLocationId
                    });
                }

                const payload = {
                    success: true,
                    region: result.region.toJSON(),
                    createdLocationIds: result.region.locationIds,
                    createdLocations: result.createdLocations.map(loc => loc.toJSON()),
                    entranceLocationId: result.region.entranceLocationId || result.entranceLocationId,
                    message: `Region "${result.region.name}" generated with ${result.region.locationIds.length} stub locations.`
                };

                if (stream.requestId) {
                    payload.requestId = stream.requestId;
                }

                res.json(payload);
            } catch (error) {
                console.error('Error generating region:', error);
                stream.emit('generation_status', {
                    scope: 'region',
                    stage: 'error',
                    message: error.message || 'Region generation failed.'
                });
                const errorPayload = {
                    success: false,
                    error: error.message
                };
                if (stream.requestId) {
                    errorPayload.requestId = stream.requestId;
                }
                res.status(500).json(errorPayload);
            }
        });

        // Generate a new location using AI
        app.post('/api/locations/generate', async (req, res) => {
            const body = req.body || {};
            const stream = createStreamEmitter({ clientId: body.clientId, requestId: body.requestId });

            try {
                const activeSetting = getActiveSettingSnapshot();
                const derivedLocationStyle = resolveLocationStyle(body.locationStyle, activeSetting);
                const settingDescription = describeSettingForPrompt(activeSetting);
                const shortDescription = buildLocationShortDescription(derivedLocationStyle, activeSetting);
                const locationPurpose = buildLocationPurpose(derivedLocationStyle, activeSetting);
                const playerLevel = getSuggestedPlayerLevel(activeSetting);

                const options = {
                    setting: settingDescription,
                    theme: derivedLocationStyle,
                    locationTheme: derivedLocationStyle,
                    locationStyle: derivedLocationStyle,
                    shortDescription,
                    locationPurpose,
                    playerLevel,
                    settingInfoId: activeSetting?.id || null
                };

                console.log('🏗️  Starting location generation with options derived from current setting:', options);

                stream.emit('generation_status', {
                    scope: 'location',
                    stage: 'start',
                    message: 'Generating new location.'
                });

                const result = await generateLocationFromPrompt(options);

                stream.emit('generation_status', {
                    scope: 'location',
                    stage: 'complete',
                    message: `Location "${result.location.name || result.location.id}" generated.`
                });

                const locationData = result.location.toJSON();
                locationData.pendingImageJobId = pendingLocationImages.get(result.location.id) || null;
                locationData.npcs = buildNpcProfiles(result.location);
                locationData.things = buildThingProfiles(result.location);

                if (stream.isEnabled) {
                    stream.emit('location_generated', {
                        location: locationData,
                        locationId: result.location.id
                    });
                }

                const payload = {
                    success: true,
                    location: locationData,
                    locationId: result.location.id,
                    locationName: result.location.name,
                    gameWorldStats: {
                        totalLocations: gameLocations.size,
                        totalLocationExits: gameLocationExits.size,
                        totalThings: things.size
                    },
                    generationInfo: {
                        aiResponse: result.aiResponse,
                        options: result.generationOptions,
                        activeSetting,
                        requestedLocationStyle: derivedLocationStyle,
                        newStubs: result.newStubs || []
                    },
                    message: `Location "${result.location.name || result.location.id}" generated successfully`
                };

                if (stream.requestId) {
                    payload.requestId = stream.requestId;
                }

                res.json(payload);

            } catch (error) {
                console.error('Error in location generation API:', error);

                let errorMessage = error.message;
                let statusCode = 500;

                if (error.code === 'ECONNABORTED') {
                    errorMessage = 'Request timeout - AI API took too long to respond';
                    statusCode = 408;
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    errorMessage = 'Cannot connect to AI API - check your endpoint URL';
                    statusCode = 503;
                } else if (error.response) {
                    const apiStatusCode = error.response.status;
                    const apiErrorMessage = error.response.data?.error?.message || 'API request failed';
                    errorMessage = `AI API Error (${apiStatusCode}): ${apiErrorMessage}`;
                    statusCode = apiStatusCode;
                }

                stream.emit('generation_status', {
                    scope: 'location',
                    stage: 'error',
                    message: errorMessage
                });

                const errorPayload = {
                    success: false,
                    error: errorMessage,
                    details: error.message
                };

                if (stream.requestId) {
                    errorPayload.requestId = stream.requestId;
                }

                res.status(statusCode).json(errorPayload);
            }
        });

        // ==================== THING MANAGEMENT API ENDPOINTS ====================

        // Create a new thing
        app.post('/api/things', async (req, res) => {
            try {
                const {
                    name,
                    description,
                    thingType,
                    imageId,
                    rarity,
                    itemTypeDetail,
                    metadata,
                    slot,
                    attributeBonuses,
                    causeStatusEffect,
                    level,
                    relativeLevel,
                    statusEffects
                } = req.body || {};

                const thing = new Thing({
                    name,
                    description,
                    thingType,
                    imageId,
                    rarity,
                    itemTypeDetail,
                    metadata,
                    slot,
                    attributeBonuses,
                    causeStatusEffect,
                    level,
                    relativeLevel,
                    statusEffects
                });

                things.set(thing.id, thing);

                const imageEligible = shouldGenerateThingImage(thing);
                if (!imageEligible) {
                    console.log(`🎒 Skipping automatic image generation for ${thing.name} (${thing.id}) - not in player inventory`);
                } else {
                    thing.imageId = null;
                }

                res.json({
                    success: true,
                    thing: thing.toJSON(),
                    message: 'Thing created successfully',
                    imageNeedsGeneration: Boolean(imageEligible)
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all things (with optional type filtering)
        app.get('/api/things', (req, res) => {
            try {
                const { type } = req.query;
                let result = Array.from(things.values()).map(thing => thing.toJSON());

                if (type) {
                    if (!Thing.validTypes.includes(type)) {
                        return res.status(400).json({
                            success: false,
                            error: `Invalid type. Must be one of: ${Thing.validTypes.join(', ')}`
                        });
                    }
                    result = result.filter(thing => thing.thingType === type);
                }

                res.json({
                    success: true,
                    things: result,
                    count: result.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get a specific thing by ID
        app.get('/api/things/:id', (req, res) => {
            try {
                const { id } = req.params;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                res.json({
                    success: true,
                    thing: thing.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.get('/api/gear-slots', (req, res) => {
            try {
                const definitions = Player.gearSlotDefinitions;
                const slotTypes = [];

                if (definitions?.byType instanceof Map) {
                    for (const type of definitions.byType.keys()) {
                        if (typeof type === 'string' && type.trim()) {
                            slotTypes.push(type.trim());
                        }
                    }
                }

                slotTypes.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

                res.json({
                    success: true,
                    slotTypes
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to load gear slot definitions',
                    details: error.message
                });
            }
        });

        app.get('/api/attributes', (req, res) => {
            try {
                const template = new Player({ name: 'Attribute Loader' });
                const definitions = template.attributeDefinitions || {};
                const attributes = Object.entries(definitions)
                    .filter(([key]) => typeof key === 'string' && key.trim())
                    .map(([key, def]) => {
                        const trimmed = key.trim();
                        return {
                            key: trimmed,
                            label: def?.label || trimmed,
                            description: def?.description || '',
                            abbreviation: def?.abbreviation || ''
                        };
                    })
                    .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }));

                res.json({
                    success: true,
                    attributes
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to load attribute definitions',
                    details: error.message
                });
            }
        });

        // Update a thing
        app.put('/api/things/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const {
                    name,
                    description,
                    thingType,
                    imageId,
                    rarity,
                    itemTypeDetail,
                    metadata,
                    slot,
                    attributeBonuses,
                    causeStatusEffect,
                    level,
                    relativeLevel,
                    statusEffects
                } = req.body || {};
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                // Update properties if provided
                let shouldRegenerateImage = false;
                if (name !== undefined) {
                    thing.name = name;
                    shouldRegenerateImage = true;
                }
                if (description !== undefined) {
                    thing.description = description;
                    shouldRegenerateImage = true;
                }
                if (thingType !== undefined) {
                    thing.thingType = thingType;
                    shouldRegenerateImage = true;
                }
                if (rarity !== undefined) {
                    thing.rarity = rarity;
                    shouldRegenerateImage = true;
                }
                if (itemTypeDetail !== undefined) {
                    thing.itemTypeDetail = itemTypeDetail;
                    shouldRegenerateImage = true;
                }
                if (metadata !== undefined) {
                    if (metadata === null) {
                        thing.metadata = {};
                        shouldRegenerateImage = true;
                    } else if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
                        thing.metadata = metadata;
                        shouldRegenerateImage = true;
                    } else {
                        return res.status(400).json({
                            success: false,
                            error: 'Metadata must be an object.'
                        });
                    }
                }
                if (imageId !== undefined) thing.imageId = imageId;

                if (slot !== undefined) {
                    thing.slot = slot;
                }

                if (attributeBonuses !== undefined) {
                    if (Array.isArray(attributeBonuses)) {
                        thing.attributeBonuses = attributeBonuses;
                    } else if (attributeBonuses === null) {
                        thing.attributeBonuses = [];
                    } else {
                        return res.status(400).json({
                            success: false,
                            error: 'Attribute bonuses must be provided as an array.'
                        });
                    }
                }

                if (causeStatusEffect !== undefined) {
                    thing.causeStatusEffect = causeStatusEffect;
                }

                if (level !== undefined) {
                    thing.level = level;
                }

                if (relativeLevel !== undefined) {
                    thing.relativeLevel = relativeLevel;
                }

                if (statusEffects !== undefined) {
                    if (Array.isArray(statusEffects)) {
                        thing.setStatusEffects(statusEffects);
                    } else if (statusEffects === null) {
                        thing.setStatusEffects([]);
                    } else {
                        return res.status(400).json({
                            success: false,
                            error: 'Status effects must be provided as an array.'
                        });
                    }
                }

                // Trigger image regeneration if visual properties changed (only when relevant)
                let imageNeedsUpdate = false;
                if (shouldRegenerateImage && imageId === undefined) {
                    if (shouldGenerateThingImage(thing)) {
                        thing.imageId = null;
                        imageNeedsUpdate = true;
                    } else {
                        console.log(`🎒 Skipping ${thing.thingType} image regeneration for ${thing.name} - not in player inventory`);
                    }
                }

                res.json({
                    success: true,
                    thing: thing.toJSON(),
                    message: 'Thing updated successfully',
                    imageNeedsUpdate
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/things/:id/give', (req, res) => {
            try {
                const rawThingId = req.params.id;
                const thingId = typeof rawThingId === 'string' ? rawThingId.trim() : '';
                if (!thingId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Thing ID is required'
                    });
                }

                const thing = things.get(thingId) || Thing.getById(thingId);
                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: `Thing with ID '${thingId}' not found`
                    });
                }

                if (thing.thingType && thing.thingType !== 'item') {
                    return res.status(400).json({
                        success: false,
                        error: 'Only item-type things can be moved into an inventory.'
                    });
                }

                const payload = req.body && typeof req.body === 'object' ? req.body : {};

                const normalizeText = (value) => {
                    if (typeof value !== 'string') {
                        return null;
                    }
                    const trimmed = value.trim();
                    return trimmed || null;
                };

                const ownerId = normalizeText(payload.ownerId);
                const ownerType = normalizeText(payload.ownerType);
                const requestedLocationId = normalizeText(payload.locationId);

                if (!ownerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'ownerId is required'
                    });
                }

                const resolveOwnerById = (candidateId) => {
                    if (!candidateId) {
                        return null;
                    }
                    if (players instanceof Map && players.has(candidateId)) {
                        return players.get(candidateId);
                    }
                    if (currentPlayer && currentPlayer.id === candidateId) {
                        return currentPlayer;
                    }
                    return null;
                };

                let owner = resolveOwnerById(ownerId);
                if (!owner && ownerType === 'player' && currentPlayer && currentPlayer.id) {
                    owner = currentPlayer.id === ownerId ? currentPlayer : owner;
                }

                if (!owner) {
                    return res.status(404).json({
                        success: false,
                        error: `Owner '${ownerId}' not found`
                    });
                }

                if (typeof owner.addInventoryItem !== 'function' || typeof owner.hasInventoryItem !== 'function') {
                    return res.status(400).json({
                        success: false,
                        error: 'Target owner cannot hold inventory items.'
                    });
                }

                const resolveLocationById = (targetId) => {
                    if (!targetId) {
                        return null;
                    }
                    let location = null;
                    if (typeof Location?.get === 'function') {
                        try {
                            location = Location.get(targetId);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && gameLocations instanceof Map) {
                        location = gameLocations.get(targetId) || null;
                    }
                    return location;
                };

                const previousMetadata = thing.metadata && typeof thing.metadata === 'object' ? thing.metadata : {};
                const previousOwnerId = normalizeText(previousMetadata.ownerId || previousMetadata.ownerID || previousMetadata.owner);
                const previousLocationId = normalizeText(previousMetadata.locationId || previousMetadata.locationID);

                if (previousOwnerId && previousOwnerId !== owner.id) {
                    const previousOwner = resolveOwnerById(previousOwnerId);
                    if (previousOwner && typeof previousOwner.removeInventoryItem === 'function') {
                        previousOwner.removeInventoryItem(thing.id);
                    }
                }

                const candidateLocationIds = new Set();
                if (requestedLocationId) {
                    candidateLocationIds.add(requestedLocationId);
                }
                if (previousLocationId) {
                    candidateLocationIds.add(previousLocationId);
                }

                const touchedLocations = [];
                const removeThingFromLocation = (location) => {
                    if (!location) {
                        return false;
                    }
                    let changed = false;
                    if (typeof location.removeThingId === 'function') {
                        changed = location.removeThingId(thing.id) || changed;
                    }
                    if (!changed && Array.isArray(location.thingIds) && location.thingIds.includes(thing.id)) {
                        location.thingIds = location.thingIds.filter(id => id !== thing.id);
                        changed = true;
                    }
                    if (changed) {
                        touchedLocations.push(location);
                        if (gameLocations instanceof Map && location.id) {
                            gameLocations.set(location.id, location);
                        }
                    }
                    return changed;
                };

                let ensuredLocationRemoval = false;
                for (const locationId of candidateLocationIds) {
                    const location = resolveLocationById(locationId);
                    const changed = removeThingFromLocation(location);
                    ensuredLocationRemoval = ensuredLocationRemoval || changed;
                }

                if (requestedLocationId && !ensuredLocationRemoval) {
                    return res.status(409).json({
                        success: false,
                        error: `Thing '${thingId}' was not present in location '${requestedLocationId}'.`
                    });
                }

                owner.addInventoryItem(thing);

                if (!owner.hasInventoryItem(thing.id)) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to move item into inventory.'
                    });
                }

                const updatedMetadata = { ...previousMetadata };
                updatedMetadata.ownerId = owner.id;
                delete updatedMetadata.owner;
                delete updatedMetadata.ownerID;
                delete updatedMetadata.locationId;
                delete updatedMetadata.locationID;
                thing.metadata = updatedMetadata;

                if (things instanceof Map) {
                    things.set(thing.id, thing);
                }

                let locationPayload = null;
                if (touchedLocations.length) {
                    const mostRecent = touchedLocations[touchedLocations.length - 1];
                    if (typeof buildLocationResponse === 'function') {
                        locationPayload = buildLocationResponse(mostRecent);
                    }
                }

                const responsePayload = {
                    success: true,
                    thing: typeof thing.toJSON === 'function' ? thing.toJSON() : { id: thing.id },
                    owner: serializeNpcForClient(owner),
                    location: locationPayload,
                    message: `${thing.name || 'Item'} moved to inventory.`
                };

                res.json(responsePayload);
            } catch (error) {
                console.error('Failed to move thing into inventory:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to move item into inventory'
                });
            }
        });

        app.post('/api/things/:id/teleport', (req, res) => {
            try {
                const { id } = req.params;
                const thingId = typeof id === 'string' ? id.trim() : '';
                if (!thingId) {
                    return res.status(400).json({ success: false, error: 'Thing ID is required' });
                }

                const thing = things.get(thingId) || Thing.getById(thingId);
                if (!thing) {
                    return res.status(404).json({ success: false, error: 'Thing not found' });
                }

                const body = req.body && typeof req.body === 'object' ? req.body : {};
                const rawLocationId = typeof body.locationId === 'string' ? body.locationId.trim() : '';
                if (!rawLocationId) {
                    return res.status(400).json({ success: false, error: 'Destination locationId is required' });
                }

                const resolveLocationById = (targetId) => {
                    if (!targetId) {
                        return null;
                    }
                    let location = null;
                    if (typeof Location?.get === 'function') {
                        try {
                            location = Location.get(targetId);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && gameLocations instanceof Map) {
                        location = gameLocations.get(targetId) || null;
                    }
                    return location;
                };

                const destinationLocation = resolveLocationById(rawLocationId);
                if (!destinationLocation) {
                    return res.status(404).json({ success: false, error: `Destination location '${rawLocationId}' not found` });
                }

                const previousMetadata = thing.metadata || {};
                const previousLocationId = typeof previousMetadata.locationId === 'string' ? previousMetadata.locationId.trim() : null;
                const previousLocation = previousLocationId ? resolveLocationById(previousLocationId) : null;

                const affectedOwnerIds = new Set();
                const removeFromActor = (actor) => {
                    if (!actor || typeof actor.removeInventoryItem !== 'function') {
                        return;
                    }
                    let removed = false;
                    try {
                        removed = actor.removeInventoryItem(thing.id, { suppressNpcEquip: Boolean(actor.isNPC) });
                    } catch (error) {
                        console.warn('Failed to remove item from actor inventory:', error?.message || error);
                    }
                    if (removed && typeof actor.unequipItemId === 'function') {
                        try {
                            actor.unequipItemId(thing.id, { suppressTimestamp: true });
                        } catch (_) {
                            /* ignore */
                        }
                    }
                    if (removed && actor.id) {
                        affectedOwnerIds.add(actor.id);
                    }
                };

                if (players instanceof Map) {
                    for (const actor of players.values()) {
                        removeFromActor(actor);
                    }
                }
                if (currentPlayer && (!players || !players.has?.(currentPlayer.id))) {
                    removeFromActor(currentPlayer);
                }

                if (previousLocation && typeof previousLocation.removeThingId === 'function') {
                    try {
                        previousLocation.removeThingId(thing.id);
                    } catch (error) {
                        console.warn('Failed to detach thing from previous location:', error?.message || error);
                    }
                    if (gameLocations instanceof Map) {
                        gameLocations.set(previousLocation.id, previousLocation);
                    }
                }

                if (typeof destinationLocation.addThingId === 'function') {
                    destinationLocation.addThingId(thing.id);
                }
                if (gameLocations instanceof Map) {
                    gameLocations.set(destinationLocation.id, destinationLocation);
                }

                const updatedMetadata = { ...previousMetadata };
                delete updatedMetadata.owner;
                delete updatedMetadata.ownerId;
                delete updatedMetadata.ownerID;
                updatedMetadata.locationId = destinationLocation.id;
                thing.metadata = updatedMetadata;

                if (things instanceof Map) {
                    things.set(thing.id, thing);
                }

                let previousLocationPayload = null;
                if (previousLocation && typeof buildLocationResponse === 'function') {
                    try {
                        previousLocationPayload = buildLocationResponse(previousLocation);
                    } catch (error) {
                        console.warn('Failed to serialize previous location after teleport:', error?.message || error);
                    }
                }

                let destinationPayload = null;
                if (typeof buildLocationResponse === 'function') {
                    try {
                        destinationPayload = buildLocationResponse(destinationLocation);
                    } catch (error) {
                        console.warn('Failed to serialize destination location after teleport:', error?.message || error);
                    }
                }

                const responsePayload = {
                    success: true,
                    thing: typeof thing.toJSON === 'function' ? thing.toJSON() : { id: thing.id },
                    destination: destinationPayload,
                    previousLocation: previousLocationPayload,
                    removedOwnerIds: Array.from(affectedOwnerIds),
                    locationIds: Array.from(new Set([
                        destinationLocation.id,
                        previousLocation?.id || null
                    ].filter(Boolean))),
                    message: `${thing.name || 'Item'} teleported successfully.`
                };

                res.json(responsePayload);
            } catch (error) {
                console.error('Failed to teleport item:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to teleport item'
                });
            }
        });

        app.post('/api/things/:id/drop', (req, res) => {
            try {
                const { id } = req.params;
                const thingId = typeof id === 'string' ? id.trim() : '';
                if (!thingId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Thing ID is required'
                    });
                }

                const thing = things.get(thingId) || Thing.getById(thingId);
                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                const body = req.body && typeof req.body === 'object' ? req.body : {};
                let { ownerId = null, ownerType = null, locationId = null } = body;

                const normalize = (value) => {
                    if (typeof value !== 'string') {
                        return null;
                    }
                    const trimmed = value.trim();
                    return trimmed || null;
                };

                ownerId = normalize(ownerId);
                ownerType = normalize(ownerType);
                locationId = normalize(locationId);

                const resolveActorById = (actorId) => {
                    if (!actorId) {
                        return null;
                    }
                    try {
                        if (players instanceof Map && players.has(actorId)) {
                            return players.get(actorId);
                        }
                    } catch (_) { }
                    if (currentPlayer && currentPlayer.id === actorId) {
                        return currentPlayer;
                    }
                    return null;
                };

                let owner = null;
                if (ownerId) {
                    owner = resolveActorById(ownerId);
                }
                if (!owner && ownerType === 'player' && currentPlayer) {
                    owner = currentPlayer;
                    ownerId = currentPlayer.id;
                }

                if (!owner) {
                    const meta = thing.metadata || {};
                    const metaOwnerId = normalize(meta.ownerId || meta.ownerID || meta.owner);
                    if (metaOwnerId) {
                        owner = resolveActorById(metaOwnerId);
                        if (owner) {
                            ownerId = owner.id || metaOwnerId;
                        }
                    }
                }

                const resolveLocationById = (targetId) => {
                    if (!targetId) {
                        return null;
                    }
                    let location = null;
                    if (Location && typeof Location.get === 'function') {
                        try {
                            location = Location.get(targetId);
                        } catch (_) {
                            location = null;
                        }
                    }
                    if (!location && gameLocations instanceof Map) {
                        location = gameLocations.get(targetId) || null;
                    }
                    return location;
                };

                let targetLocation = resolveLocationById(locationId);
                if (!targetLocation && owner && owner.currentLocation) {
                    targetLocation = resolveLocationById(owner.currentLocation);
                }
                if (!targetLocation && owner && owner.locationId) {
                    targetLocation = resolveLocationById(owner.locationId);
                }
                if (!targetLocation && currentPlayer?.currentLocation) {
                    targetLocation = resolveLocationById(currentPlayer.currentLocation);
                }

                if (!targetLocation) {
                    return res.status(400).json({
                        success: false,
                        error: 'Unable to determine drop location'
                    });
                }

                if (owner && typeof owner.removeInventoryItem === 'function') {
                    try {
                        owner.removeInventoryItem(thing.id);
                    } catch (inventoryError) {
                        console.warn('Failed to remove thing from owner inventory:', inventoryError?.message || inventoryError);
                    }
                }

                const existingMetadata = thing.metadata || {};
                const previousLocationId = normalize(existingMetadata.locationId);
                if (previousLocationId && previousLocationId !== targetLocation.id) {
                    const previousLocation = resolveLocationById(previousLocationId);
                    if (previousLocation && typeof previousLocation.removeThingId === 'function') {
                        previousLocation.removeThingId(thing.id);
                        if (gameLocations instanceof Map) {
                            gameLocations.set(previousLocation.id, previousLocation);
                        }
                    }
                }

                const updatedMetadata = { ...existingMetadata };
                delete updatedMetadata.owner;
                delete updatedMetadata.ownerId;
                delete updatedMetadata.ownerID;
                updatedMetadata.locationId = targetLocation.id;
                thing.metadata = updatedMetadata;

                if (typeof targetLocation.addThingId === 'function') {
                    targetLocation.addThingId(thing.id);
                }
                if (gameLocations instanceof Map) {
                    gameLocations.set(targetLocation.id, targetLocation);
                }

                const responsePayload = {
                    success: true,
                    thing: thing.toJSON ? thing.toJSON() : { id: thing.id, name: thing.name },
                    location: typeof buildLocationResponse === 'function' ? buildLocationResponse(targetLocation) : null,
                    message: `${thing.name || 'Item'} dropped successfully.`
                };

                if (owner) {
                    responsePayload.owner = serializeNpcForClient(owner);
                }

                res.json(responsePayload);
            } catch (error) {
                console.error('Failed to drop item:', error);
                res.status(500).json({
                    success: false,
                    error: error?.message || 'Failed to drop item'
                });
            }
        });

        // Delete a thing
        app.delete('/api/things/:id', (req, res) => {
            try {
                const { id } = req.params;
                if (!id || typeof id !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Thing ID is required'
                    });
                }

                const thing = things.get(id) || Thing.getById(id);
                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: `Thing with ID '${id}' not found`
                    });
                }

                const affectedLocationIds = new Set();
                const affectedPlayerIds = new Set();
                const affectedNpcIds = new Set();

                for (const location of gameLocations.values()) {
                    if (!location) {
                        continue;
                    }

                    let changed = false;
                    if (typeof location.removeThingId === 'function') {
                        changed = location.removeThingId(id) || changed;
                    }

                    if (!changed && Array.isArray(location.thingIds) && location.thingIds.includes(id)) {
                        location.thingIds = location.thingIds.filter(thingId => thingId !== id);
                        changed = true;
                    }

                    if (changed) {
                        affectedLocationIds.add(location.id);
                    }
                }

                for (const actor of players.values()) {
                    if (!actor || typeof actor.removeInventoryItem !== 'function') {
                        continue;
                    }

                    let actorChanged = false;
                    if (actor.removeInventoryItem(id, { suppressNpcEquip: Boolean(actor.isNPC) })) {
                        actorChanged = true;
                    }
                    if (typeof actor.unequipItemId === 'function' && actor.unequipItemId(id, { suppressTimestamp: true })) {
                        actorChanged = true;
                    }

                    if (actorChanged) {
                        if (actor.isNPC) {
                            affectedNpcIds.add(actor.id);
                        } else {
                            affectedPlayerIds.add(actor.id);
                        }
                    }
                }

                things.delete(id);
                thing.delete();

                res.json({
                    success: true,
                    message: 'Thing deleted successfully',
                    locationIds: Array.from(affectedLocationIds),
                    playerIds: Array.from(affectedPlayerIds),
                    npcIds: Array.from(affectedNpcIds)
                });
            } catch (error) {
                console.error('Failed to delete thing:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to delete thing'
                });
            }
        });

        // Get all scenery things
        app.get('/api/things/scenery', (req, res) => {
            try {
                const sceneryThings = Array.from(things.values())
                    .filter(thing => thing.isScenery())
                    .map(thing => thing.toJSON());

                res.json({
                    success: true,
                    things: sceneryThings,
                    count: sceneryThings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all item things
        app.get('/api/things/items', (req, res) => {
            try {
                const itemThings = Array.from(things.values())
                    .filter(thing => thing.isItem())
                    .map(thing => thing.toJSON());

                res.json({
                    success: true,
                    things: itemThings,
                    count: itemThings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate image for a specific thing
        app.post('/api/things/:id/image', async (req, res) => {
            try {
                const { id } = req.params;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                if (!shouldGenerateThingImage(thing)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Item images can only be generated for gear in your inventory.',
                        thing: thing.toJSON()
                    });
                }

                const imageResult = await generateThingImage(thing, { force: true });

                if (imageResult.success) {
                    return res.json({
                        success: true,
                        thing: thing.toJSON(),
                        imageGeneration: imageResult,
                        message: `${thing.thingType} image generation initiated for ${thing.name}`
                    });
                }

                if (imageResult.existingJob) {
                    return res.status(202).json({
                        success: false,
                        thing: thing.toJSON(),
                        imageGeneration: imageResult,
                        message: 'Image job already in progress'
                    });
                }

                if (imageResult.skipped) {
                    return res.status(409).json({
                        success: false,
                        error: 'Image generation is not available or disabled',
                        reason: imageResult.reason,
                        thing: thing.toJSON()
                    });
                }

                res.status(500).json({
                    success: false,
                    error: imageResult.message || 'Failed to queue image generation',
                    thing: thing.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== SETTINGS API ENDPOINTS ====================

        // Get all settings
        app.get('/api/settings', (req, res) => {
            try {
                const allSettings = SettingInfo.getAll().map(setting => setting.toJSON());

                res.json({
                    success: true,
                    settings: allSettings,
                    count: allSettings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Create a new setting
        app.post('/api/settings', (req, res) => {
            try {
                const settingData = req.body;

                // Validate required fields
                if (!settingData.name || typeof settingData.name !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Setting name is required and must be a string'
                    });
                }

                // Check if setting with same name already exists
                if (SettingInfo.getByName(settingData.name)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Setting with this name already exists'
                    });
                }

                const newSetting = new SettingInfo(settingData);

                res.status(201).json({
                    success: true,
                    setting: newSetting.toJSON(),
                    message: 'Setting created successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        function normalizeSettingPayload(raw = {}) {
            const toStringValue = (value) => {
                if (value === null || value === undefined) {
                    return '';
                }
                return String(value).trim();
            };

            const toNumberString = (value) => {
                const str = toStringValue(value);
                if (!str) {
                    return '';
                }
                const parsed = parseInt(str, 10);
                return Number.isFinite(parsed) ? String(parsed) : '';
            };

            const toStringArray = (value) => {
                if (!value) {
                    return [];
                }
                if (Array.isArray(value)) {
                    return value
                        .map(v => toStringValue(v))
                        .filter(v => v.length > 0);
                }
                return toStringValue(value)
                    .split(/\r?\n/)
                    .map(item => item.trim())
                    .filter(item => item.length > 0);
            };

            return {
                name: toStringValue(raw.name),
                description: toStringValue(raw.description),
                theme: toStringValue(raw.theme),
                genre: toStringValue(raw.genre),
                startingLocationType: toStringValue(raw.startingLocationType),
                magicLevel: toStringValue(raw.magicLevel),
                techLevel: toStringValue(raw.techLevel),
                tone: toStringValue(raw.tone),
                difficulty: toStringValue(raw.difficulty),
                currencyName: toStringValue(raw.currencyName),
                currencyNamePlural: toStringValue(raw.currencyNamePlural),
                currencyValueNotes: toStringValue(raw.currencyValueNotes),
                writingStyleNotes: toStringValue(raw.writingStyleNotes ?? raw.styleNotes),
                imagePromptPrefixCharacter: toStringValue(raw.imagePromptPrefixCharacter),
                imagePromptPrefixLocation: toStringValue(raw.imagePromptPrefixLocation),
                imagePromptPrefixItem: toStringValue(raw.imagePromptPrefixItem),
                imagePromptPrefixScenery: toStringValue(raw.imagePromptPrefixScenery),
                playerStartingLevel: toNumberString(raw.playerStartingLevel),
                defaultPlayerName: toStringValue(raw.defaultPlayerName),
                defaultPlayerDescription: toStringValue(raw.defaultPlayerDescription),
                defaultStartingLocation: toStringValue(raw.defaultStartingLocation),
                defaultStartingCurrency: toNumberString(raw.defaultStartingCurrency),
                defaultNumSkills: toNumberString(raw.defaultNumSkills),
                defaultExistingSkills: toStringArray(raw.defaultExistingSkills),
                availableClasses: toStringArray(raw.availableClasses),
                availableRaces: toStringArray(raw.availableRaces)
            };
        }

        function sanitizeXmlForDom(input) {
            return (`<root>${input}</root>`)
                .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
                .replace(/<\s*br\s*>/gi, '<br/>')
                .replace(/<\s*hr\s*>/gi, '<hr/>');
        }

        function parseSettingXmlResponse(xmlContent) {
            if (!xmlContent || typeof xmlContent !== 'string') {
                throw new Error('AI response was empty');
            }

            const trimmed = xmlContent.trim();
            if (!trimmed) {
                throw new Error('AI response was empty');
            }

            const parser = new DOMParser({
                errorHandler: {
                    warning: () => { },
                    error: () => { },
                    fatalError: () => { }
                }
            });

            const wrapped = sanitizeXmlForDom(trimmed);
            const doc = parser.parseFromString(wrapped, 'text/xml');
            const parserError = doc.getElementsByTagName('parsererror')[0];
            if (parserError) {
                throw new Error(`AI response XML parsing error: ${parserError.textContent}`);
            }

            const settingNode = doc.getElementsByTagName('setting')[0];
            if (!settingNode) {
                throw new Error('AI response missing <setting> element');
            }

            const getText = (tag) => {
                const node = settingNode.getElementsByTagName(tag)[0];
                if (!node || typeof node.textContent !== 'string') {
                    return '';
                }
                return node.textContent.trim();
            };

            const getList = (parentTag, childTag) => {
                const parent = settingNode.getElementsByTagName(parentTag)[0];
                if (!parent) {
                    return [];
                }
                return Array.from(parent.getElementsByTagName(childTag))
                    .map(node => (typeof node.textContent === 'string' ? node.textContent.trim() : ''))
                    .filter(text => text.length > 0);
            };

            const toNumber = (value) => {
                const parsed = parseInt(value, 10);
                return Number.isFinite(parsed) ? parsed : '';
            };

            return {
                name: getText('name'),
                description: getText('description'),
                theme: getText('theme'),
                genre: getText('genre'),
                startingLocationType: getText('startingLocationType'),
                magicLevel: getText('magicLevel'),
                techLevel: getText('techLevel'),
                tone: getText('tone'),
                difficulty: getText('difficulty'),
                currencyName: getText('currencyName'),
                currencyNamePlural: getText('currencyNamePlural'),
                currencyValueNotes: getText('currencyValueNotes'),
                writingStyleNotes: getText('writingStyleNotes') || getText('styleNotes'),
                imagePromptPrefixCharacter: getText('imagePromptPrefixCharacter'),
                imagePromptPrefixLocation: getText('imagePromptPrefixLocation'),
                imagePromptPrefixItem: getText('imagePromptPrefixItem'),
                imagePromptPrefixScenery: getText('imagePromptPrefixScenery'),
                playerStartingLevel: toNumber(getText('playerStartingLevel')),
                defaultPlayerName: getText('defaultPlayerName'),
                defaultPlayerDescription: getText('defaultPlayerDescription'),
                defaultStartingLocation: getText('defaultStartingLocation'),
                defaultStartingCurrency: toNumber(getText('defaultStartingCurrency')),
                defaultNumSkills: toNumber(getText('defaultNumSkills')),
                defaultExistingSkills: getList('defaultExistingSkills', 'skill'),
                availableClasses: getList('availableClasses', 'class'),
                availableRaces: getList('availableRaces', 'race')
            };
        }

        function isEmptySettingValue(value) {
            if (value === null || value === undefined) {
                return true;
            }
            if (typeof value === 'string') {
                return value.trim().length === 0;
            }
            if (Array.isArray(value)) {
                return value.length === 0;
            }
            return false;
        }

        function mergeSettingValues(baseSetting, generatedSetting) {
            const merged = { ...baseSetting };
            for (const [key, value] of Object.entries(generatedSetting)) {
                if (value === undefined || value === null) {
                    continue;
                }
                if (isEmptySettingValue(merged[key]) && !isEmptySettingValue(value)) {
                    merged[key] = value;
                }
            }
            return merged;
        }

        function logSettingAutofillPrompt({ systemPrompt, generationPrompt, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `setting_autofill_${timestamp}.log`);
                const parts = [
                    `=== SETTINGS AUTOFILL (${new Date().toISOString()}) ===`,
                    '=== SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    ''
                ];

                if (responseText !== undefined) {
                    parts.push('=== AI RESPONSE ===', responseText || '(empty)', '');
                }

                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log settings autofill prompt:', error.message);
            }
        }

        function sanitizeForAbilityXml(value) {
            if (value === null || value === undefined) {
                return '';
            }
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        function buildAbilityContextForPlayer(player, { settingDescription = '', location = null, region = null } = {}) {
            if (!player || typeof player.getSkills !== 'function') {
                return null;
            }

            const lines = [];
            lines.push('<npcs>');
            lines.push('  <npc>');
            lines.push(`    <name>${sanitizeForAbilityXml(player.name || 'Unnamed Hero')}</name>`);
            lines.push(`    <description>${sanitizeForAbilityXml(player.description || '')}</description>`);
            lines.push(`    <class>${sanitizeForAbilityXml(player.class || '')}</class>`);
            lines.push(`    <race>${sanitizeForAbilityXml(player.race || '')}</race>`);
            lines.push(`    <level>${sanitizeForAbilityXml(player.level || 1)}</level>`);

            if (settingDescription) {
                lines.push(`    <setting>${sanitizeForAbilityXml(settingDescription)}</setting>`);
            }
            if (region && (region.name || region.description)) {
                lines.push(`    <regionContext>${sanitizeForAbilityXml((region.name ? `${region.name}: ` : '') + (region.description || ''))}</regionContext>`);
            }
            if (location && (location.name || location.description)) {
                lines.push(`    <locationContext>${sanitizeForAbilityXml((location.name ? `${location.name}: ` : '') + (location.description || ''))}</locationContext>`);
            }

            const skillsMap = player.getSkills();
            lines.push('    <skills>');
            if (skillsMap && typeof skillsMap.forEach === 'function') {
                skillsMap.forEach((value, key) => {
                    lines.push(`      <skill><name>${sanitizeForAbilityXml(key)}</name><rank>${sanitizeForAbilityXml(value)}</rank></skill>`);
                });
            }
            lines.push('    </skills>');
            lines.push('  </npc>');
            lines.push('</npcs>');

            return lines.join('\n');
        }

        app.post('/api/settings/fill-missing', async (req, res) => {
            try {
                const incomingSetting = req.body?.setting;
                if (!incomingSetting || typeof incomingSetting !== 'object') {
                    return res.status(400).json({
                        success: false,
                        error: 'Request body must include a setting object'
                    });
                }

                const normalizedSetting = normalizeSettingPayload(incomingSetting);

                const renderedTemplate = promptEnv.render('fill-setting-form.xml.njk', {
                    setting: {
                        ...normalizedSetting,
                        defaultExistingSkills: normalizedSetting.defaultExistingSkills,
                        availableClasses: normalizedSetting.availableClasses,
                        availableRaces: normalizedSetting.availableRaces
                    }
                });

                const promptData = parseXMLTemplate(renderedTemplate);
                const systemPrompt = promptData.systemPrompt ? promptData.systemPrompt.trim() : '';
                const generationPrompt = promptData.generationPrompt ? promptData.generationPrompt.trim() : '';

                if (!generationPrompt) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to build generation prompt from template'
                    });
                }

                const messages = [];
                if (systemPrompt) {
                    messages.push({ role: 'system', content: systemPrompt });
                }
                messages.push({ role: 'user', content: generationPrompt });

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const model = config.ai.model;

                if (!endpoint || !apiKey || !model) {
                    return res.status(500).json({
                        success: false,
                        error: 'AI configuration is incomplete. Please update config.yaml.'
                    });
                }

                const chatEndpoint = endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`;

                const requestPayload = {
                    model,
                    messages,
                    max_tokens: promptData.maxTokens || config.ai.maxTokens || 800,
                    temperature: (promptData.temperature ?? config.ai.temperature ?? 0.7)
                };

                const aiResponse = await axios.post(chatEndpoint, requestPayload, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds
                });

                const aiMessage = aiResponse?.data?.choices?.[0]?.message?.content;
                if (!aiMessage || typeof aiMessage !== 'string') {
                    throw new Error('AI did not return a usable response');
                }

                logSettingAutofillPrompt({
                    systemPrompt,
                    generationPrompt,
                    responseText: aiMessage
                });

                const generatedSetting = parseSettingXmlResponse(aiMessage);
                const mergedSetting = mergeSettingValues(normalizedSetting, generatedSetting);

                res.json({
                    success: true,
                    setting: mergedSetting,
                    raw: aiMessage
                });
            } catch (error) {
                console.error('Failed to fill setting form:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to generate setting details'
                });
            }
        });

        // Get a specific setting by ID
        app.get('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                res.json({
                    success: true,
                    setting: setting.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Update a setting
        app.put('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const updates = req.body;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    const fallbackName = (updates && typeof updates.name === 'string' && updates.name.trim())
                        ? updates.name.trim()
                        : `Setting ${id}`;

                    if (SettingInfo.getByName(fallbackName)) {
                        return res.status(404).json({
                            success: false,
                            error: 'Setting not found, and a new setting with the provided name already exists.'
                        });
                    }

                    const newSetting = new SettingInfo({
                        ...updates,
                        id,
                        name: fallbackName
                    });

                    return res.status(201).json({
                        success: true,
                        setting: newSetting.toJSON(),
                        created: true,
                        message: 'Setting not found. Created a new setting instead.'
                    });
                }

                if (updates.name && updates.name !== setting.name) {
                    const existingSetting = SettingInfo.getByName(updates.name);
                    if (existingSetting && existingSetting.id !== id) {
                        return res.status(409).json({
                            success: false,
                            error: 'Setting with this name already exists'
                        });
                    }
                }

                setting.update(updates);

                res.json({
                    success: true,
                    setting: setting.toJSON(),
                    message: 'Setting updated successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a setting
        app.delete('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                const deleted = SettingInfo.delete(id);

                if (deleted) {
                    res.json({
                        success: true,
                        message: 'Setting deleted successfully'
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to delete setting'
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Clone a setting
        app.post('/api/settings/:id/clone', (req, res) => {
            try {
                const { id } = req.params;
                const { newName } = req.body;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                // Check if new name already exists
                if (newName && SettingInfo.getByName(newName)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Setting with this name already exists'
                    });
                }

                const clonedSetting = setting.clone(newName);

                res.status(201).json({
                    success: true,
                    setting: clonedSetting.toJSON(),
                    message: 'Setting cloned successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Save all settings to files
        app.post('/api/settings/save', (req, res) => {
            try {
                const result = SettingInfo.saveAll();

                res.json({
                    success: true,
                    result,
                    message: `Saved ${result.count} settings to ${result.directory}`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Load all settings from files
        app.post('/api/settings/load', (req, res) => {
            try {
                const result = SettingInfo.loadAll();

                res.json({
                    success: true,
                    result,
                    message: `Loaded ${result.count} settings from ${result.directory}`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // List saved setting files
        app.get('/api/settings/saved', (req, res) => {
            try {
                const savedSettings = SettingInfo.listSavedSettings();

                res.json({
                    success: true,
                    savedSettings,
                    count: savedSettings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Save individual setting to file
        app.post('/api/settings/:id/save', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                const filepath = setting.save();

                res.json({
                    success: true,
                    filepath,
                    message: 'Setting saved to file successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Apply setting as current game setting
        app.post('/api/settings/:id/apply', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                // Apply globally so other routes/templates can access it
                currentSetting = setting;
                try {
                    const settingJSON = typeof setting.toJSON === 'function' ? setting.toJSON() : setting;
                    if (app && app.locals) {
                        app.locals.currentSetting = settingJSON;
                        // Also expose prompt variables for convenience in views
                        app.locals.promptVariables = typeof setting.getPromptVariables === 'function' ? setting.getPromptVariables() : undefined;
                    }
                    if (typeof viewsEnv?.addGlobal === 'function') {
                        viewsEnv.addGlobal('currentSetting', settingJSON);
                        viewsEnv.addGlobal('promptVariables', app.locals.promptVariables);
                    }
                    // Optional: expose on global for non-module consumers
                    global.currentSetting = setting;
                } catch (_) {
                    // Best-effort; do not block on template/global propagation
                }

                res.json({
                    success: true,
                    setting: setting.toJSON(),
                    message: `Applied setting: ${setting.name}`,
                    promptVariables: setting.getPromptVariables()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get current applied setting
        app.get('/api/settings/current', (req, res) => {
            try {
                if (!currentSetting) {
                    return res.json({
                        success: true,
                        setting: null,
                        message: 'No setting currently applied'
                    });
                }

                res.json({
                    success: true,
                    setting: currentSetting.toJSON(),
                    promptVariables: currentSetting.getPromptVariables()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Clear current setting (revert to config defaults)
        app.delete('/api/settings/current', (req, res) => {
            try {
                const previousSetting = currentSetting;
                currentSetting = null;
                // Clear globals so templates/consumers reflect reset
                try {
                    if (app && app.locals) {
                        app.locals.currentSetting = null;
                        app.locals.promptVariables = undefined;
                    }
                    if (typeof viewsEnv?.addGlobal === 'function') {
                        viewsEnv.addGlobal('currentSetting', null);
                        viewsEnv.addGlobal('promptVariables', undefined);
                    }
                    global.currentSetting = null;
                } catch (_) {
                    // Non-fatal cleanup
                }

                res.json({
                    success: true,
                    message: 'Current setting cleared - reverted to configuration defaults',
                    previousSetting: previousSetting ? previousSetting.toJSON() : null
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== NEW GAME FUNCTIONALITY ====================

        // Create a new game with fresh player and starting location
        app.post('/api/new-game', async (req, res) => {
            const requestStart = Date.now();
            const body = req.body || {};
            const stream = createStreamEmitter({ clientId: body.clientId, requestId: body.requestId });
            const report = (stage, message) => {
                if (stream && stream.isEnabled) {
                    stream.status(stage, message, { scope: 'new_game' });
                }
            };
            const reportError = (message) => {
                if (stream && stream.isEnabled) {
                    stream.status('new_game:error', message, { scope: 'new_game' });
                }
            };

            try {
                const {
                    playerName,
                    playerDescription,
                    playerClass: playerClassInput,
                    playerRace: playerRaceInput,
                    startingLocation,
                    numSkills: numSkillsInput,
                    existingSkills: existingSkillsInput,
                    startingCurrency: startingCurrencyInput
                } = body;
                const activeSetting = getActiveSettingSnapshot();
                const newGameDefaults = buildNewGameDefaults(activeSetting);
                const settingDescription = describeSettingForPrompt(activeSetting);
                const rawPlayerName = typeof playerName === 'string' ? playerName.trim() : '';
                const rawPlayerDescription = typeof playerDescription === 'string' ? playerDescription.trim() : '';
                const rawPlayerClass = typeof playerClassInput === 'string' ? playerClassInput.trim() : '';
                const rawPlayerRace = typeof playerRaceInput === 'string' ? playerRaceInput.trim() : '';
                const requestedStartingLocation = typeof startingLocation === 'string' ? startingLocation.trim() : '';
                const resolvedPlayerName = rawPlayerName || newGameDefaults.playerName || 'Adventurer';
                const resolvedPlayerDescription = rawPlayerDescription || newGameDefaults.playerDescription || 'A brave soul embarking on a new adventure.';
                const resolvedPlayerClass = rawPlayerClass || newGameDefaults.playerClass || 'Adventurer';
                const resolvedPlayerRace = rawPlayerRace || newGameDefaults.playerRace || 'Human';
                const resolvedStartingLocation = requestedStartingLocation || newGameDefaults.startingLocation;
                const parsedStartingCurrency = Number.parseInt(startingCurrencyInput, 10);
                const fallbackStartingCurrencySource = newGameDefaults.startingCurrency;
                const fallbackStartingCurrencyParsed = Number.parseInt(fallbackStartingCurrencySource, 10);
                const fallbackStartingCurrency = Number.isFinite(fallbackStartingCurrencyParsed)
                    ? Math.max(0, fallbackStartingCurrencyParsed)
                    : 0;
                const resolvedStartingCurrency = Number.isFinite(parsedStartingCurrency)
                    ? Math.max(0, parsedStartingCurrency)
                    : fallbackStartingCurrency;
                const startingPlayerLevel = activeSetting?.playerStartingLevel || 1;
                const startingLocationStyle = resolveLocationStyle(activeSetting?.startingLocationType || resolvedStartingLocation, activeSetting);
                const parsedSkillCount = Number.parseInt(numSkillsInput, 10);
                const fallbackSkillCount = Math.max(0, Math.min(100, newGameDefaults.numSkills || 20));
                const endpoint = config.ai?.endpoint;
                const apiKey = config.ai?.apiKey;
                const model = config.ai?.model;
                const chatEndpoint = endpoint
                    ? (endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`)
                    : null;
                const numSkills = Number.isFinite(parsedSkillCount)
                    ? Math.max(0, Math.min(100, parsedSkillCount))
                    : fallbackSkillCount;

                report('new_game:start', 'Preparing your adventure...');
                report('new_game:reset', 'Clearing previous game state...');

                // Clear existing game state
                players.clear();
                gameLocations.clear();
                gameLocationExits.clear();
                regions.clear();
                Region.clear();
                stubExpansionPromises.clear();
                chatHistory.length = 0;
                skills.clear();
                Player.setAvailableSkills(new Map());

                console.log('🎮 Starting new game...');
                report('new_game:reset_complete', 'Game state cleared. Preparing skills...');

                const rawExistingSkills = typeof existingSkillsInput === 'undefined'
                    ? newGameDefaults.existingSkills
                    : existingSkillsInput;

                const existingSkillNames = Array.isArray(rawExistingSkills)
                    ? rawExistingSkills
                    : (typeof rawExistingSkills === 'string'
                        ? rawExistingSkills.split(/\r?\n/)
                        : []);

                const normalizedExistingSkills = existingSkillNames
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean);

                let detailedExistingSkills = [];
                if (normalizedExistingSkills.length) {
                    try {
                        report('new_game:skills_existing', 'Integrating existing skills...');
                        detailedExistingSkills = await generateSkillsByNames({
                            skillNames: normalizedExistingSkills,
                            settingDescription
                        });
                    } catch (detailedError) {
                        console.warn('Failed to generate detailed skills by name:', detailedError.message);
                        detailedExistingSkills = [];
                    }
                }

                let generatedSkills = [];
                try {
                    report('new_game:skills_generate', `Generating ${numSkills} new skills...`);
                    generatedSkills = await generateSkillsList({
                        count: numSkills,
                        settingDescription,
                        existingSkills: normalizedExistingSkills
                    });
                } catch (skillError) {
                    console.warn('Failed to generate skills from prompt:', skillError.message);
                    generatedSkills = [];
                }

                const combinedSkills = new Map();

                const addSkillToCombined = (skill) => {
                    if (!skill || !skill.name) {
                        return;
                    }
                    const key = skill.name.trim().toLowerCase();
                    if (!key || combinedSkills.has(key)) {
                        return;
                    }
                    combinedSkills.set(key, skill);
                };

                if (Array.isArray(detailedExistingSkills) && detailedExistingSkills.length) {
                    detailedExistingSkills.forEach(addSkillToCombined);
                }

                for (const name of normalizedExistingSkills) {
                    if (!name) continue;
                    const key = name.toLowerCase();
                    if (!combinedSkills.has(key)) {
                        combinedSkills.set(key, new Skill({
                            name,
                            description: '',
                            attribute: ''
                        }));
                    }
                }

                for (const skill of generatedSkills) {
                    if (!skill || !skill.name) continue;
                    const key = skill.name.trim().toLowerCase();
                    if (!combinedSkills.has(key)) {
                        combinedSkills.set(key, skill);
                    }
                }

                skills.clear();
                if (combinedSkills.size > 0) {
                    for (const skill of combinedSkills.values()) {
                        skills.set(skill.name, skill);
                    }
                    Player.setAvailableSkills(skills);
                    for (const player of players.values()) {
                        if (typeof player.syncSkillsWithAvailable === 'function') {
                            player.syncSkillsWithAvailable();
                        }
                    }
                } else {
                    Player.setAvailableSkills(new Map());
                }

                report('new_game:skills_ready', 'Skill library ready. Forging your hero...');

                // Create new player
                const newPlayer = new Player({
                    name: resolvedPlayerName,
                    description: resolvedPlayerDescription,
                    class: resolvedPlayerClass,
                    race: resolvedPlayerRace,
                    level: startingPlayerLevel,
                    health: -1,
                    currency: resolvedStartingCurrency,
                    attributes: {
                        strength: 10,
                        dexterity: 10,
                        constitution: 10,
                        intelligence: 10,
                        wisdom: 10,
                        charisma: 10
                    }
                });
                if (typeof newPlayer.syncSkillsWithAvailable === 'function') {
                    newPlayer.syncSkillsWithAvailable();
                }

                report('new_game:player_created', `Forged ${resolvedPlayerName}. Generating starting region...`);

                // Generate an initial region and choose its entrance as the starting location
                console.log('🗺️ Generating starting region...');
                const defaultRegionName = activeSetting?.name
                    ? `${activeSetting.name}`
                    : resolvedStartingLocation
                        ? `${resolvedStartingLocation} Region`
                        : 'Starting Region';

                const regionStageDetails = {
                    'region:prepare': { stage: 'new_game:region_prepare', message: 'Preparing region prompt...' },
                    'region:request': { stage: 'new_game:region_request', message: 'Requesting region layout from AI...' },
                    'region:response': { stage: 'new_game:region_response', message: 'Region layout received.' },
                    'region:parse': { stage: 'new_game:region_parse', message: 'Interpreting region blueprint...' },
                    'region:instantiate': { stage: 'new_game:region_instantiate', message: 'Placing region locations...' },
                    'region:entrance': { stage: 'new_game:region_entrance', message: 'Selecting starting entrance...' },
                    'region:npcs': { stage: 'new_game:region_npcs', message: 'Populating region with NPCs...' },
                    'region:complete': { stage: 'new_game:region_complete', message: 'Region generation complete.' }
                };

                const regionOptions = {
                    setting: settingDescription,
                    regionName: resolvedStartingLocation ? `${resolvedStartingLocation}` : defaultRegionName,
                    regionNotes: startingLocationStyle || null,
                    report: (stage, info = {}) => {
                        const detail = regionStageDetails[stage] || null;
                        const targetStage = detail?.stage || 'new_game:region';
                        const message = detail?.message || info.message || 'Generating starting region...';
                        report(targetStage, message);
                    }
                };

                const regionResult = await generateRegionFromPrompt(regionOptions);
                const region = regionResult.region;

                let entranceLocationId = region.entranceLocationId || regionResult.entranceLocationId;
                if (!entranceLocationId && region.locationIds.length > 0) {
                    entranceLocationId = region.locationIds[0];
                }

                if (!entranceLocationId) {
                    throw new Error('No entrance location generated for starting region');
                }

                let entranceLocation = gameLocations.get(entranceLocationId);
                if (!entranceLocation) {
                    throw new Error('Entrance location not found in game world');
                }

                if (entranceLocation.isStub) {
                    report('new_game:location_detail', 'Detailing starting location...');
                    try {
                        const expansion = await generateLocationFromPrompt({
                            stubLocation: entranceLocation,
                            createStubs: false
                        });
                        if (expansion?.location) {
                            entranceLocation = expansion.location;
                            entranceLocationId = entranceLocation.id;
                            region.entranceLocationId = entranceLocationId;
                        }
                    } catch (expansionError) {
                        console.warn('Failed to expand entrance stub:', expansionError.message);
                    }
                }

                if (entranceLocation.baseLevel && entranceLocation.baseLevel > 3) {
                    entranceLocation.baseLevel = Math.min(3, Math.max(1, entranceLocation.baseLevel));
                } else if (!entranceLocation.baseLevel) {
                    entranceLocation.baseLevel = 1;
                }

                gameLocations.set(entranceLocation.id, entranceLocation);
                console.log(`🏠 Starting at region entrance: ${entranceLocation.name} (Level ${entranceLocation.baseLevel})`);

                // Place player in starting location
                newPlayer.setLocation(entranceLocation.id);

                // Store new player and set as current
                players.set(newPlayer.id, newPlayer);
                currentPlayer = newPlayer;

                queueNpcAssetsForLocation(entranceLocation);

                report('new_game:inventory', 'Outfitting your character...');
                try {
                    await generateInventoryForCharacter({
                        character: newPlayer,
                        characterDescriptor: { role: 'adventurer', class: newPlayer.class, race: newPlayer.race },
                        region,
                        location: entranceLocation
                    });
                    restoreCharacterHealthToMaximum(newPlayer);
                } catch (inventoryError) {
                    console.warn('Failed to generate inventory for new-game player:', inventoryError);
                }

                if (chatEndpoint && apiKey && model) {
                    try {
                        report('new_game:abilities', 'Discovering unique abilities...');
                        const playerContext = buildAbilityContextForPlayer(newPlayer, {
                            settingDescription,
                            location: entranceLocation,
                            region
                        });

                        const abilityBaseMessages = playerContext
                            ? [{ role: 'assistant', content: playerContext }]
                            : [];

                        const abilityLogPath = path.join(__dirname, 'logs', `player_${newPlayer.id}_abilities.log`);
                        const abilityResult = await requestNpcAbilityAssignments({
                            baseMessages: abilityBaseMessages,
                            chatEndpoint,
                            model,
                            apiKey,
                            logPath: abilityLogPath
                        });

                        const abilityAssignments = abilityResult.assignments || new Map();
                        const abilityEntry = abilityAssignments.get((newPlayer.name || '').trim().toLowerCase());
                        if (abilityEntry && Array.isArray(abilityEntry.abilities) && abilityEntry.abilities.length) {
                            applyNpcAbilities(newPlayer, abilityEntry.abilities);
                        } else if (typeof newPlayer.setAbilities === 'function') {
                            newPlayer.setAbilities([]);
                        }
                    } catch (abilityError) {
                        console.warn('Failed to generate abilities for new-game player:', abilityError.message);
                        if (typeof newPlayer.setAbilities === 'function') {
                            newPlayer.setAbilities([]);
                        }
                    }
                } else if (typeof newPlayer.setAbilities === 'function') {
                    newPlayer.setAbilities([]);
                }

                console.log(`🧙‍♂️ Created new player: ${newPlayer.name} at ${entranceLocation.name}`);

                report('new_game:finalizing', 'Finalizing world setup...');

                const startingLocationData = entranceLocation.toJSON();
                startingLocationData.pendingImageJobId = pendingLocationImages.get(entranceLocation.id) || null;
                startingLocationData.npcs = buildNpcProfiles(entranceLocation);

                report('new_game:complete', 'Adventure ready! Redirecting...');
                res.json({
                    success: true,
                    message: 'New game started successfully',
                    player: newPlayer.toJSON(),
                    startingLocation: startingLocationData,
                    region: region.toJSON(),
                    skills: generatedSkills.map(skill => skill.toJSON()),
                    gameState: {
                        totalPlayers: players.size,
                        totalLocations: gameLocations.size,
                        currentLocation: entranceLocation.name,
                        regionEntranceId: entranceLocation.id
                    }
                });
                const durationSeconds = (Date.now() - requestStart) / 1000;
                console.log(`✅ /api/new-game completed in ${durationSeconds.toFixed(3)}s`);

            } catch (error) {
                console.error('Error creating new game:', error);
                reportError(error?.message || 'Failed to create new game');
                res.status(500).json({
                    success: false,
                    error: 'Failed to create new game',
                    details: error.message
                });
                const durationSeconds = (Date.now() - requestStart) / 1000;
                console.log(`❌ /api/new-game failed after ${durationSeconds.toFixed(3)}s`);
            }
        });

        // ==================== SAVE/LOAD FUNCTIONALITY ====================

        // Save current game state
        app.post('/api/save', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(400).json({
                        success: false,
                        error: 'No current player to save'
                    });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const playerName = currentPlayer.name.replace(/[^a-zA-Z0-9]/g, '_');
                const saveName = `${timestamp}_${playerName}`;
                const saveDir = path.join(__dirname, 'saves', saveName);

                const serialized = Utils.serializeGameState({
                    currentPlayer,
                    gameLocations,
                    gameLocationExits,
                    regions,
                    chatHistory,
                    generatedImages,
                    things,
                    players,
                    skills,
                    currentSetting
                });

                const metadata = serialized.metadata || {};
                serialized.metadata = metadata;
                metadata.saveName = saveName;
                metadata.timestamp = metadata.timestamp || new Date().toISOString();
                metadata.totalPlayers = players.size;
                metadata.totalThings = things.size;
                metadata.totalLocations = gameLocations.size;
                metadata.totalLocationExits = gameLocationExits.size;
                metadata.totalRegions = regions.size;
                metadata.chatHistoryLength = Array.isArray(chatHistory) ? chatHistory.length : (metadata.chatHistoryLength || 0);
                metadata.totalGeneratedImages = generatedImages.size;
                metadata.totalSkills = skills.size;
                metadata.currentSettingId = currentSetting?.id || metadata.currentSettingId || null;
                metadata.currentSettingName = currentSetting?.name || metadata.currentSettingName || null;

                Utils.writeSerializedGameState(saveDir, serialized);

                res.json({
                    success: true,
                    saveName: saveName,
                    saveDir: saveDir,
                    metadata: metadata,
                    message: `Game saved successfully as: ${saveName}`
                });

            } catch (error) {
                console.error('Error saving game:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Load game state from a save
        app.post('/api/load', async (req, res) => {
            try {
                const { saveName } = req.body;

                if (!saveName) {
                    return res.status(400).json({
                        success: false,
                        error: 'Save name is required'
                    });
                }

                const saveDir = path.join(__dirname, 'saves', saveName);

                // Check if save directory exists
                if (!fs.existsSync(saveDir)) {
                    return res.status(404).json({
                        success: false,
                        error: `Save '${saveName}' not found`
                    });
                }

                const serialized = Utils.loadSerializedGameState(saveDir);

                jobQueue.length = 0;
                imageJobs.clear();
                pendingLocationImages.clear();
                generatedImages.clear();
                npcGenerationPromises.clear();
                isProcessingJob = false;

                const hydrationResult = Utils.hydrateGameState(serialized, {
                    gameLocations,
                    gameLocationExits,
                    regions,
                    chatHistoryRef: chatHistory,
                    generatedImages,
                    things,
                    players,
                    skills,
                    jobQueue,
                    imageJobs,
                    pendingLocationImages,
                    npcGenerationPromises
                });

                let metadata = hydrationResult.metadata || {};
                if (!metadata || typeof metadata !== 'object') {
                    metadata = {};
                }
                metadata.saveName = metadata.saveName || saveName;

                const loadedSetting = hydrationResult.setting || null;
                if (loadedSetting) {
                    if (currentSetting && typeof currentSetting.updateFromJSON === 'function') {
                        try {
                            currentSetting.updateFromJSON(loadedSetting);
                        } catch (settingError) {
                            console.warn('Failed to apply loaded setting:', settingError.message);
                        }
                    } else if (typeof SettingInfo?.fromJSON === 'function') {
                        try {
                            currentSetting = SettingInfo.fromJSON(loadedSetting);
                        } catch (settingError) {
                            console.warn('Failed to instantiate setting from save:', settingError.message);
                            currentSetting = loadedSetting;
                        }
                    } else {
                        currentSetting = loadedSetting;
                    }
                } else {
                    currentSetting = null;
                }

                let resolvedPlayer = null;
                if (metadata.playerId && players.has(metadata.playerId)) {
                    resolvedPlayer = players.get(metadata.playerId);
                }
                if (!resolvedPlayer) {
                    const iterator = players.values();
                    resolvedPlayer = iterator.next().value || null;
                }
                if (!resolvedPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No players found in save file'
                    });
                }

                currentPlayer = resolvedPlayer;
                this.currentPlayer = currentPlayer;
                Player.setCurrentPlayer?.(currentPlayer);
                if (typeof Player.register === 'function') {
                    Player.register(currentPlayer);
                }

                const KNOWN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
                const hasImage = (imageId) => {
                    if (!imageId) {
                        return false;
                    }
                    if (generatedImages.has(imageId)) {
                        return true;
                    }
                    const imagesDir = path.join(__dirname, 'public', 'generated-images');
                    return KNOWN_EXTENSIONS.some(ext => fs.existsSync(path.join(imagesDir, `${imageId}${ext}`)));
                };

                const ensureInventoryImages = (character) => {
                    if (!character || typeof character.getInventoryItems !== 'function') {
                        return;
                    }
                    const items = character.getInventoryItems();
                    if (!Array.isArray(items)) {
                        return;
                    }
                    for (const item of items) {
                        if (!item) {
                            continue;
                        }
                        if (item.imageId && !hasImage(item.imageId)) {
                            item.imageId = null;
                        }
                    }
                };

                for (const thing of things.values()) {
                    if (thing && thing.imageId && !hasImage(thing.imageId)) {
                        thing.imageId = null;
                    }
                }

                for (const player of players.values()) {
                    if (!player) {
                        continue;
                    }
                    if (player.imageId && !hasImage(player.imageId)) {
                        player.imageId = null;
                    }
                    ensureInventoryImages(player);
                }

                if (currentPlayer) {
                    if (currentPlayer.imageId && !hasImage(currentPlayer.imageId)) {
                        currentPlayer.imageId = null;
                    }
                    ensureInventoryImages(currentPlayer);
                }

                const currentLocationId = currentPlayer?.currentLocation || null;
                if (currentLocationId && gameLocations.has(currentLocationId)) {
                    const location = gameLocations.get(currentLocationId);
                    try {
                        queueNpcAssetsForLocation(location);
                    } catch (npcQueueError) {
                        console.warn('Failed to queue NPC assets after load:', npcQueueError.message);
                    }
                    try {
                        queueLocationThingImages(location);
                    } catch (thingQueueError) {
                        console.warn('Failed to queue location thing images after load:', thingQueueError.message);
                    }

                    const npcIds = Array.isArray(location.npcIds) ? location.npcIds : [];
                    for (const npcId of npcIds) {
                        const npc = players.get(npcId);
                        if (!npc) {
                            continue;
                        }
                        if (npc.imageId && !hasImage(npc.imageId)) {
                            npc.imageId = null;
                        }
                        ensureInventoryImages(npc);
                    }
                }

                metadata.playerId = metadata.playerId || currentPlayer.id;
                metadata.playerName = metadata.playerName || currentPlayer.name;
                try {
                    if (typeof currentPlayer.getCurrentLocation === 'function') {
                        const locationId = currentPlayer.currentLocation;
                        if (locationId && gameLocations.has(locationId)) {
                            this.currentLocation = gameLocations.get(locationId);
                        }
                    }
                } catch (locationError) {
                    console.warn('Failed to resolve current location after load:', locationError.message);
                }

                metadata.playerLevel = metadata.playerLevel || currentPlayer.level;
                metadata.timestamp = metadata.timestamp || new Date().toISOString();
                metadata.currentSettingId = currentSetting?.id || metadata.currentSettingId || null;
                metadata.currentSettingName = currentSetting?.name || metadata.currentSettingName || null;
                metadata.totalPlayers = players.size;
                metadata.totalThings = things.size;
                metadata.totalLocations = gameLocations.size;
                metadata.totalLocationExits = gameLocationExits.size;
                metadata.totalRegions = regions.size;
                metadata.chatHistoryLength = Array.isArray(chatHistory) ? chatHistory.length : (metadata.chatHistoryLength || 0);
                metadata.totalGeneratedImages = generatedImages.size;
                metadata.totalSkills = skills.size;

                const summaryConfig = getSummaryConfig();
                if (summaryConfig.summarize_on_load !== false) {
                    await summarizeChatBacklog(chatHistory);
                }

                res.json({
                    success: true,
                    saveName: saveName,
                    metadata: metadata,
                    loadedData: {
                        currentPlayer: currentPlayer ? serializeNpcForClient(currentPlayer) : null,
                        totalPlayers: players.size,
                        totalThings: things.size,
                        totalLocations: gameLocations.size,
                        totalLocationExits: gameLocationExits.size,
                        chatHistoryLength: chatHistory.length,
                        totalGeneratedImages: generatedImages.size,
                        currentSetting: currentSetting && typeof currentSetting.toJSON === 'function'
                            ? currentSetting.toJSON()
                            : (currentSetting || null)
                    },
                    message: `Game loaded successfully from: ${saveName}`
                });

            } catch (error) {
                console.error('Error loading game:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // List available saves
        app.get('/api/saves', (req, res) => {
            try {
                const savesDir = path.join(__dirname, 'saves');

                if (!fs.existsSync(savesDir)) {
                    return res.json({
                        success: true,
                        saves: [],
                        message: 'No saves directory found'
                    });
                }

                const saveDirectories = fs.readdirSync(savesDir)
                    .filter(item => {
                        const itemPath = path.join(savesDir, item);
                        return fs.statSync(itemPath).isDirectory();
                    });

                const saves = saveDirectories.map(saveName => {
                    const saveDir = path.join(savesDir, saveName);
                    const metadataPath = path.join(saveDir, 'metadata.json');

                    let metadata = {
                        saveName: saveName,
                        timestamp: 'Unknown',
                        playerName: 'Unknown',
                        playerLevel: 'Unknown'
                    };

                    if (fs.existsSync(metadataPath)) {
                        try {
                            const metadataContent = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                            metadata = { ...metadata, ...metadataContent };
                        } catch (error) {
                            console.error(`Error reading metadata for save ${saveName}:`, error);
                        }
                    }

                    return metadata;
                }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by newest first

                res.json({
                    success: true,
                    saves: saves,
                    count: saves.length,
                    message: `Found ${saves.length} save(s)`
                });

            } catch (error) {
                console.error('Error listing saves:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a save
        app.delete('/api/save/:saveName', (req, res) => {
            try {
                const { saveName } = req.params;
                const saveDir = path.join(__dirname, 'saves', saveName);

                if (!fs.existsSync(saveDir)) {
                    return res.status(404).json({
                        success: false,
                        error: `Save '${saveName}' not found`
                    });
                }

                // Remove the save directory and all its contents
                fs.rmSync(saveDir, { recursive: true, force: true });

                res.json({
                    success: true,
                    saveName: saveName,
                    message: `Save '${saveName}' deleted successfully`
                });

            } catch (error) {
                console.error('Error deleting save:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Additional API endpoint for JSON response
        app.get('/api/hello', (req, res) => {
            res.json({
                message: 'Hello World!',
                timestamp: new Date().toISOString(),
                port: PORT
            });
        });

        // API endpoint to test configuration without saving
        app.post('/api/test-config', async (req, res) => {
            try {
                const { endpoint, apiKey, model } = req.body;

                if (!endpoint || !apiKey || !model) {
                    return res.status(400).json({ error: 'Missing required parameters' });
                }

                // Test the configuration by making a simple request
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: model,
                    messages: [{ role: 'user', content: 'Hello, this is a test.' }],
                    max_tokens: 50,
                    temperature: 0.7
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: baseTimeoutMilliseconds // 30 second timeout for test
                });

                if (response.data && response.data.choices && response.data.choices.length > 0) {
                    res.json({ success: true, message: 'Configuration test successful' });
                } else {
                    res.status(500).json({ error: 'Invalid response from AI API' });
                }

            } catch (error) {
                console.error('Config test error:', error);

                if (error.response) {
                    const statusCode = error.response.status;
                    const errorMessage = error.response.data?.error?.message || 'API request failed';
                    res.status(statusCode).json({ error: `API Error (${statusCode}): ${errorMessage}` });
                } else if (error.code === 'ECONNABORTED') {
                    res.status(408).json({ error: 'Request timeout' });
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    res.status(503).json({ error: 'Cannot connect to API endpoint' });
                } else {
                    res.status(500).json({ error: `Test failed: ${error.message}` });
                }
            }
        });

        // Image generation functionality
        app.post('/api/images/request', async (req, res) => {
            try {
                const { entityType, entityId, force = false, clientId = null } = req.body || {};

                const normalizedType = typeof entityType === 'string'
                    ? entityType.trim().toLowerCase()
                    : '';

                if (!normalizedType || !entityId || typeof entityId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'entityType and entityId are required'
                    });
                }

                let entity = null;
                let generator = null;
                let resolvedType = normalizedType;

                switch (normalizedType) {
                    case 'player':
                    case 'npc': {
                        entity = players.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Player with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generatePlayerImage(entity, options);
                        resolvedType = entity.isNPC ? 'npc' : 'player';
                        break;
                    }

                    case 'location': {
                        entity = gameLocations.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Location with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateLocationImage(entity, options);
                        break;
                    }

                    case 'exit':
                    case 'location-exit':
                    case 'location_exit': {
                        entity = gameLocationExits.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Location exit with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateLocationExitImage(entity, options);
                        resolvedType = 'location-exit';
                        break;
                    }

                    case 'thing':
                    case 'item':
                    case 'scenery': {
                        entity = things.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Thing with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateThingImage(entity, options);
                        resolvedType = entity.thingType || normalizedType;
                        break;
                    }

                    default:
                        return res.status(400).json({
                            success: false,
                            error: `Unsupported entityType '${entityType}'`
                        });
                }

                if (typeof generator !== 'function') {
                    return res.status(500).json({
                        success: false,
                        error: 'Image generator not available for requested entity type'
                    });
                }

                const generationResult = await generator({ force: Boolean(force), clientId });

                if (!generationResult) {
                    return res.status(500).json({
                        success: false,
                        error: 'Image generation did not return a result'
                    });
                }

                const {
                    success: generationSuccess = false,
                    jobId = null,
                    job: jobSnapshot = null,
                    imageId = null,
                    skipped = false,
                    reason = null,
                    existingJob = false,
                    message = null
                } = generationResult;

                const responsePayload = {
                    success: Boolean(generationSuccess),
                    entityType: resolvedType,
                    entityId,
                    skipped: Boolean(skipped),
                    reason,
                    message,
                    existingJob: Boolean(existingJob)
                };

                if (jobId) {
                    responsePayload.jobId = jobId;
                    responsePayload.job = jobSnapshot || getJobSnapshot(jobId);
                }

                if (imageId) {
                    responsePayload.imageId = imageId;
                }

                if (!generationSuccess && skipped) {
                    return res.status(202).json(responsePayload);
                }

                if (!generationSuccess && !existingJob) {
                    return res.status(409).json(responsePayload);
                }

                return res.json(responsePayload);

            } catch (error) {
                console.error('Image request error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // API endpoint for async image generation
        app.post('/api/generate-image', async (req, res) => {
            try {
                // Check if image generation is enabled
                if (!config.imagegen || !config.imagegen.enabled) {
                    return res.status(503).json({
                        success: false,
                        error: 'Image generation is not enabled'
                    });
                }

                if (!comfyUIClient) {
                    return res.status(503).json({
                        success: false,
                        error: 'ComfyUI client not initialized or unavailable'
                    });
                }

                const { prompt, width, height, seed, negative_prompt, async: isAsync, clientId = null } = req.body || {};

                // Enhanced parameter validation
                if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Prompt is required and must be a non-empty string'
                    });
                }

                if (prompt.trim().length > 1000) {
                    return res.status(400).json({
                        success: false,
                        error: 'Prompt must be less than 1000 characters'
                    });
                }

                // Validate dimensions
                const validatedWidth = width ? parseInt(width) : config.imagegen.default_settings.image.width || 1024;
                const validatedHeight = height ? parseInt(height) : config.imagegen.default_settings.image.height || 1024;

                if (validatedWidth < 64 || validatedWidth > 4096 || validatedHeight < 64 || validatedHeight > 4096) {
                    return res.status(400).json({
                        success: false,
                        error: 'Image dimensions must be between 64 and 4096 pixels'
                    });
                }

                // Validate seed
                const validatedSeed = seed !== undefined ? parseInt(seed) : Math.floor(Math.random() * 1000000);
                if (validatedSeed < 0 || validatedSeed > 1000000) {
                    return res.status(400).json({
                        success: false,
                        error: 'Seed must be between 0 and 1000000'
                    });
                }

                const jobId = generateImageId();
                const payload = {
                    prompt: prompt.trim(),
                    width: validatedWidth,
                    height: validatedHeight,
                    seed: validatedSeed,
                    negative_prompt: negative_prompt || 'blurry, low quality, distorted',
                    entityType: 'custom',
                    entityId: null,
                    isCustomImage: true,
                    clientId
                };

                // Create and queue the job
                const job = createImageJob(jobId, payload);
                jobQueue.push(jobId);

                // Start processing if not already running
                setTimeout(() => processJobQueue(), 0);

                // Return job ID for async tracking, or wait for completion if sync
                if (isAsync !== false) {
                    return res.json({
                        success: true,
                        jobId: jobId,
                        status: job.status,
                        message: 'Image generation job queued. Use /api/jobs/:jobId to track progress.',
                        estimatedTime: '30-90 seconds'
                    });
                } else {
                    // Legacy sync mode - wait for completion
                    return new Promise((resolve) => {
                        const checkJob = () => {
                            const currentJob = imageJobs.get(jobId);

                            if (currentJob.status === JOB_STATUS.COMPLETED) {
                                resolve(res.json({
                                    success: true,
                                    imageId: currentJob.result.imageId,
                                    images: currentJob.result.images,
                                    metadata: currentJob.result.metadata,
                                    processingTime: new Date(currentJob.completedAt) - new Date(currentJob.createdAt)
                                }));
                            } else if (currentJob.status === JOB_STATUS.FAILED || currentJob.status === JOB_STATUS.TIMEOUT) {
                                resolve(res.status(500).json({
                                    success: false,
                                    error: currentJob.error || 'Image generation failed'
                                }));
                            } else {
                                setTimeout(checkJob, 1000);
                            }
                        };

                        checkJob();
                    });
                }

            } catch (error) {
                console.error('Image generation request error:', {
                    message: error?.message,
                    stack: error?.stack
                });
                return res.status(500).json({
                    success: false,
                    error: `Request failed: ${error.message}`
                });
            }
        });

        // API endpoint for job status tracking
        app.get('/api/jobs/:jobId', (req, res) => {
            const jobId = req.params.jobId;
            const job = imageJobs.get(jobId);

            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found'
                });
            }

            const response = {
                success: true,
                job: {
                    id: job.id,
                    status: job.status,
                    progress: job.progress,
                    message: job.message,
                    createdAt: job.createdAt,
                    startedAt: job.startedAt,
                    completedAt: job.completedAt
                }
            };

            // Include result if completed
            if (job.status === JOB_STATUS.COMPLETED && job.result) {
                response.result = {
                    imageId: job.result.imageId,
                    images: job.result.images,
                    metadata: job.result.metadata
                };
            }

            // Include error if failed
            if (job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
                response.error = job.error;
            }

            res.json(response);
        });

        // API endpoint to cancel a job
        app.delete('/api/jobs/:jobId', (req, res) => {
            const jobId = req.params.jobId;
            const job = imageJobs.get(jobId);

            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found'
                });
            }

            if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot cancel completed job'
                });
            }

            // Remove from queue if queued
            const queueIndex = jobQueue.indexOf(jobId);
            if (queueIndex > -1) {
                jobQueue.splice(queueIndex, 1);
            }

            // Mark as failed
            job.status = JOB_STATUS.FAILED;
            job.error = 'Job cancelled by user';
            job.completedAt = new Date().toISOString();

            res.json({
                success: true,
                message: 'Job cancelled successfully'
            });
        });

        // API endpoint to list all jobs
        app.get('/api/jobs', (req, res) => {
            const jobs = Array.from(imageJobs.values()).map(job => ({
                id: job.id,
                status: job.status,
                progress: job.progress,
                message: job.message,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                prompt: job.payload.prompt.substring(0, 50) + (job.payload.prompt.length > 50 ? '...' : '')
            })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            res.json({
                success: true,
                jobs: jobs,
                queue: {
                    pending: jobQueue.length,
                    processing: isProcessingJob ? 1 : 0
                }
            });
        });

        // API endpoint to get image metadata
        app.get('/api/images/:imageId', (req, res) => {
            const imageId = req.params.imageId;
            const metadata = generatedImages.get(imageId);

            if (!metadata) {
                console.log('Image not found in metadata map:', imageId);
                return res.status(404).json({
                    success: false,
                    error: 'Image not found'
                });
            }

            console.log('Retrieved image metadata for:', imageId);
            console.log(metadata);
            res.json({
                success: true,
                metadata: metadata
            });
        });

        // API endpoint to list all generated images
        app.get('/api/images', (req, res) => {
            const allImages = Array.from(generatedImages.values());
            res.json({
                success: true,
                images: allImages,
                count: allImages.length
            });
        });

    }
};
