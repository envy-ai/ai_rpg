'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const TechniqueService = require('./TechniqueService.js');

const turnContext = new AsyncLocalStorage();
const passContext = new AsyncLocalStorage();
const clone = value => JSON.parse(JSON.stringify(value));
const proseEntry = entry => entry && typeof entry.content === 'string' && entry.content.trim()
    && entry.role !== 'user' && entry.metadata?.npcTurnPending !== true
    && (entry.type === 'player-action' || entry.type === 'npc-action'
        || entry.isNpcTurn === true || entry.type === 'random-event');
const gameplayInput = entry => entry?.role === 'user'
    && !entry.type && typeof entry.content === 'string'
    && !/^\s*[\/#?@\\]/u.test(entry.content)
    && !['#', '?', '@', '@@', '@@@', '\\'].includes(entry.metadata?.inputPrefix);
const completed = pass => pass.state === 'applied';

class EventReprocessor {
    static runTurn({ getHistory, playerId }, callback) {
        return turnContext.run({ getHistory, playerId, entry: null }, callback);
    }

    static attachTurnEntry(entry) {
        const owner = turnContext.getStore();
        if (!owner || !gameplayInput(entry)) return;
        entry.metadata ||= {};
        entry.metadata.eventReplay = { version: 1, playerId: owner.playerId, passes: [] };
        owner.entry = entry;
    }

    static _anchor() {
        return turnContext.getStore()?.entry?.metadata?.eventReplay || null;
    }

    static beginPass(options = {}) {
        const owner = turnContext.getStore();
        const anchor = this._anchor();
        if (!anchor || options._depth > 0) return null;
        const history = Array.isArray(options.entryCollector) ? options.entryCollector : owner.getHistory();
        const source = history.filter(proseEntry).at(-1);
        if (!source) return null;
        const sectionKind = options.eventSectionKind || 'current';
        let pass = anchor.passes.find(candidate => candidate.state === 'pending'
            && candidate.sourceEntryId === source.id
            && candidate.eventSectionKind === sectionKind
            && candidate.textToCheck === options.textToCheck);
        const locationId = typeof options.locationOverride === 'string'
            ? options.locationOverride : options.locationOverride?.id || source.locationId;
        const descriptor = {
            sourceEntryId: source.id,
            sourceContent: source.content,
            textToCheck: options.textToCheck,
            actionText: options.actionText || null,
            locationId,
            eventSectionKind: sectionKind,
            eventMode: options.eventMode || 'events',
            options: {
                allowEnvironmentalEffects: options.allowEnvironmentalEffects !== false,
                isNpcTurn: Boolean(options.isNpcTurn),
                allowMoveTurnAppearances: Boolean(options.allowMoveTurnAppearances),
                suppressTrackerUpdates: Boolean(options.suppressTrackerUpdates),
                ignoredEventKeys: Array.from(options.ignoredEventKeys || []),
                protectedConsumptionThingIds: Array.from(options.protectedConsumptionThingIds || []),
                eventCheckIgnoreInstructions: options.eventCheckIgnoreInstructions || '',
                authoritativeMovementCompanionNames: options.authoritativeMovementCompanionNames || []
            },
            techniqueOperationIds: (options.committedTechniqueResults || []).map(receipt => receipt.operationId),
            preResolvedHiddenNpcChecks: options.preResolvedHiddenNpcChecks || []
        };
        if (!pass) {
            pass = {};
            anchor.passes.push(pass);
        }
        Object.assign(pass, clone(descriptor), { state: 'extracting', phase: 'extracting', applicationErrors: [] });
        return pass;
    }

    static planMovement({ originProse, betweenProse, destinationProse, originLocationId,
        destinationLocationId, destinationName, tinyBrain, split, entryCollector,
        actionText, committedTechniqueResults, preResolvedHiddenNpcChecks,
        authoritativeMovementCompanionNames }) {
        const anchor = this._anchor();
        if (!anchor) return;
        const source = entryCollector?.filter(proseEntry).at(-1);
        if (!source) return;
        const combined = [originProse, betweenProse, destinationProse].filter(Boolean).join('\n\n').trim();
        const specifications = tinyBrain || split ? [
            { text: originProse, kind: 'origin', locationId: originLocationId, actionText },
            ...(tinyBrain ? [{ text: betweenProse, kind: 'between', locationId: destinationLocationId }] : []),
            { text: destinationProse, kind: 'destination', locationId: destinationLocationId,
                actionText: originProse ? null : actionText },
            ...(tinyBrain ? [{ text: combined, kind: 'tracker', locationId: destinationLocationId }] : [])
        ] : [{ text: combined, kind: 'current', locationId: originLocationId, actionText }];
        for (const specification of specifications) {
            if (!specification.text) continue;
            const pass = this.beginPass({
                textToCheck: specification.text,
                actionText: specification.actionText,
                eventSectionKind: specification.kind,
                eventMode: specification.kind === 'tracker' ? 'trackers' : 'events',
                locationOverride: specification.locationId || originLocationId,
                suppressTrackerUpdates: tinyBrain && specification.kind !== 'tracker',
                allowMoveTurnAppearances: true,
                committedTechniqueResults,
                preResolvedHiddenNpcChecks: specification.kind === 'origin' || !originProse
                    ? preResolvedHiddenNpcChecks : [],
                authoritativeMovementCompanionNames,
                entryCollector
            });
            pass.state = 'pending';
            if (!specification.locationId && specification.kind !== 'origin') {
                pass.locationId = null;
                pass.locationName = destinationName || null;
            }
        }
    }

    static runPass(pass, callback, beforeMutation = null) {
        return passContext.run({ pass, beforeMutation }, callback);
    }

    static getCurrentPassIdentity() {
        const pass = passContext.getStore()?.pass;
        return pass?.sourceEntryId ? { sourceEntryId: pass.sourceEntryId, eventSectionKind: (pass.eventSectionKind || 'current').trim().toLowerCase() } : null;
    }

    static markApplying() {
        const context = passContext.getStore();
        context?.beforeMutation?.();
        const pass = context?.pass;
        if (pass) { pass.phase = 'applying'; pass.state = 'applying'; }
    }

    static recordApplicationFailure(error) {
        const pass = passContext.getStore()?.pass;
        if (!pass) return;
        pass.applicationErrors ||= [];
        pass.applicationErrors.push({ message: error?.message || String(error), stack: error?.stack || String(error) });
    }

    static completePass(pass, result) {
        if (!pass) return;
        if (!result) { pass.state = 'pending'; return; }
        const errors = [...(result.postProcessingErrors || []), ...(pass.applicationErrors || [])];
        pass.state = errors.length ? 'partial' : 'applied';
        pass.phase = 'complete';
        pass.acceptedXml = result.raw || '';
        pass.error = errors.length ? errors.map(error => error.message).join('\n') : null;
    }

    static failPass(pass, error) {
        if (!pass) return;
        if (pass.state !== 'partial' && pass.state !== 'applied') pass.state = 'failed';
        pass.error = error?.message || String(error);
    }

    static latestTurn(history) {
        if (!Array.isArray(history)) throw new Error('Chat history is unavailable for event reprocessing.');
        let start = -1;
        for (let index = history.length - 1; index >= 0; index--) {
            if (gameplayInput(history[index])) { start = index; break; }
        }
        if (start === -1) throw new Error('No stored gameplay turn is available to reprocess.');
        const endOffset = history.slice(start + 1).findIndex(entry => entry?.role === 'user'
            && !/^\s*\//u.test(entry.content || ''));
        const end = endOffset === -1 ? history.length : start + 1 + endOffset;
        const sources = history.slice(start + 1, end).filter(proseEntry);
        if (!sources.length) throw new Error('The latest gameplay turn has no stored prose to reprocess.');
        return { entry: history[start], sources, entries: history.slice(start + 1, end) };
    }

    static async replayLatest({ history, player, runEventChecks, resolveLocation,
        appendResult, stream = null, getRuntimeGeneration = () => null, isBusy = () => false }) {
        if (!player?.id) throw new Error('An active player is required to reprocess events.');
        if (isBusy()) throw new Error('Wait for the active gameplay work to finish before reprocessing events.');
        const generation = getRuntimeGeneration();
        const turn = this.latestTurn(history);
        let anchor = turn.entry.metadata?.eventReplay;
        const untracked = !anchor;
        const warnings = [];
        if (anchor && (anchor.version !== 1 || !Array.isArray(anchor.passes))) {
            throw new Error('The latest turn contains unsupported event replay tracking.');
        }
        if (anchor && anchor.playerId !== player.id) throw new Error('The latest turn belongs to another player.');
        if (!anchor || anchor.passes.length === 0) {
            if (untracked) warnings.push('This turn predates event replay tracking. Previously applied events may be applied again.');
            const turnId = turn.entry.metadata?.requestId || turn.entry.id;
            const receipts = TechniqueService.getReceiptsForTurn(turnId);
            const savedChecks = turn.entries.flatMap(entry => (entry.checkResults || [])
                .filter(record => record.status === 'completed' && record.skillCheck?.opponent)
                .map(record => ({
                    toolName: entry.metadata?.hiddenNpcCheck ? 'resolveOpposedSkillCheck' : record.toolName,
                    actorName: record.parameters?.actor || null,
                    opponentName: record.skillCheck.opponent.name || null,
                    actionResolution: record.skillCheck
                })));
            anchor = { version: 1, playerId: player.id, passes: turn.sources.map(source => ({
                sourceEntryId: source.id,
                sourceContent: source.content,
                textToCheck: source.content.replace(/<hidden\b[^>]*>[\s\S]*?<\/hidden\s*>/gi, '').trim(),
                actionText: source.type === 'player-action' ? turn.entry.content : null,
                locationId: source.locationId || source.metadata?.locationId,
                eventSectionKind: 'current', eventMode: 'events', options: {
                    isNpcTurn: source.isNpcTurn === true || source.type === 'npc-action',
                    allowEnvironmentalEffects: source.isNpcTurn !== true,
                    allowMoveTurnAppearances: true
                },
                techniqueOperationIds: receipts.map(receipt => receipt.operationId),
                preResolvedHiddenNpcChecks: clone(savedChecks), state: 'pending', phase: 'extracting'
            })) };
            turn.entry.metadata ||= {};
            turn.entry.metadata.eventReplay = anchor;
        }
        if (anchor.version !== 1 || !Array.isArray(anchor.passes)) {
            throw new Error('The latest turn contains unsupported event replay tracking.');
        }
        if (anchor.playerId !== player.id) throw new Error('The latest turn belongs to another player.');
        const results = [];
        let skippedPasses = 0;
        const acceptedFragments = anchor.passes.filter(completed).map(pass => pass.acceptedXml).filter(Boolean);
        for (const pass of anchor.passes) {
            if (completed(pass)) { skippedPasses++; continue; }
            if (generation !== getRuntimeGeneration()) throw new Error('The game changed during event reprocessing.');
            const source = turn.sources.find(entry => entry.id === pass.sourceEntryId);
            if (!source || source.content !== pass.sourceContent) {
                throw new Error('The stored prose changed after event processing; its replay context is no longer valid.');
            }
            const location = resolveLocation(pass.locationId || pass.locationName);
            if (!location) throw new Error(`Event replay location "${pass.locationId || pass.locationName || 'unset'}" is unavailable.`);
            if (pass.phase === 'applying' || pass.state === 'partial') {
                warnings.push('A previous event application stopped after mutations began. Retrying may repeat changes that were already applied.');
            }
            const committedTechniqueResults = (pass.techniqueOperationIds || []).map(id => {
                const receipt = TechniqueService.getReceipt(id);
                if (!receipt?.committed) throw new Error(`Committed technique receipt "${id}" is unavailable for event replay.`);
                return receipt;
            });
            pass.state = 'extracting';
            pass.phase = 'extracting';
            pass.applicationErrors = [];
            try {
                const result = await runEventChecks({
                    ...pass.options,
                    textToCheck: pass.textToCheck, actionText: pass.actionText,
                    locationOverride: location, eventSectionKind: pass.eventSectionKind,
                    eventMode: pass.eventMode, committedTechniqueResults,
                    preResolvedHiddenNpcChecks: clone(pass.preResolvedHiddenNpcChecks || []),
                    suppressMoveEvents: true, suppressTimeAdvance: true,
                    suppressNeedBarEventChecks: true, suppressHousekeeping: true,
                    suppressFollowupEventChecks: true,
                    ignoredEventKeys: Array.from(new Set([...(pass.options?.ignoredEventKeys || []), 'needbar_change', 'time_passed'])),
                    tinyBrainAcceptedEventXml: acceptedFragments.length
                        ? `<events>${acceptedFragments.map(xml => xml.replace(/^\s*<events\b[^>]*>|<\/events>\s*$/gi, '')).join('\n')}</events>` : '',
                    eventReplayPass: pass,
                    beforeEventMutation: () => {
                        if (generation !== getRuntimeGeneration()) throw new Error('The game changed during event reprocessing.');
                        if (source.content !== pass.sourceContent || !history.includes(turn.entry)) {
                            throw new Error('The stored turn changed during event reprocessing.');
                        }
                    },
                    stream
                });
                if (generation !== getRuntimeGeneration()) throw new Error('The game changed during event reprocessing.');
                if (!result) throw new Error('Event reprocessing did not produce a result. Check that event checks are enabled.');
                this.completePass(pass, result);
                if (completed(pass) && pass.acceptedXml) acceptedFragments.push(pass.acceptedXml);
                await appendResult(result, { source, pass, turnEntry: turn.entry });
                results.push(result);
                if (pass.state === 'partial') {
                    const errors = [...(result.postProcessingErrors || []), ...(pass.applicationErrors || [])];
                    const error = new Error(errors.map(entry => entry.message).join('\n'));
                    error.stack = errors.map(entry => entry.stack || entry.message).join('\n\n');
                    throw error;
                }
            } catch (error) {
                this.failPass(pass, error);
                error.eventReplayWarnings = warnings;
                throw error;
            }
        }
        return { processedPasses: results.length, skippedPasses, untracked, warnings: [...new Set(warnings)], results };
    }
}

module.exports = EventReprocessor;
