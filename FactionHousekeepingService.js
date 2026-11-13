const Globals = require('./Globals.js');
const Faction = require('./Faction.js');
const IdGenerator = require('./IdGenerator.js');
const LLMClient = require('./LLMClient.js');
const { escape: escapeXml } = require('nunjucks').lib;
const { normalizeFactionHousekeepingState } = require('./FactionHousekeepingState.js');
const { shouldExcludeEntryFromPromptHistory } = require('./base_context_history.js');
const { HOUSEKEEPING_PROSE_ENTRY_TYPES, buildHousekeepingTurnHistory } = require('./housekeeping_history.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('./PromptRetryPolicy.js');
const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, resolveTinyBrainAiConfig, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');
const { parseFactionHousekeepingSection, parseFactionHousekeepingProposal, buildFactionHousekeepingProposal } = require('./FactionHousekeepingPrompt.js');

const clone = value => JSON.parse(JSON.stringify(value));
const FACTION_HISTORY_MAX_CHARACTERS = 96000;
const factionData = faction => clone(typeof faction.toJSON === 'function' ? faction.toJSON() : faction);
const rosterFingerprint = factions => JSON.stringify(Array.from(factions, ([id, faction]) => {
    const { imageId, imagePrompt, createdAt, lastUpdated, ...content } = factionData(faction);
    return [id, content];
}));

function buildFactionHousekeepingContext({
    baseContext, factions, chatHistory, previousState = null, currentPlayer,
    interval = 1, textToCheck = '', actionText = '', currentEventText = '', currentTurnId = null, scheduledEvents = [],
    isHiddenEntry = entry => entry.metadata?.hiddenFromClient === true,
    publicText = text => {
        if (/<hidden\b/i.test(text)) throw new Error('Faction public history requires the shared hidden-note projector.');
        return text;
    }
}) {
    if (!(factions instanceof Map) || !Array.isArray(chatHistory) || !baseContext) {
        throw new TypeError('Faction housekeeping requires base context, a faction map, and chat history.');
    }
    const state = normalizeFactionHousekeepingState(previousState);
    const history = chatHistory.filter(entry => !shouldExcludeEntryFromPromptHistory(entry));
    const review = buildHousekeepingTurnHistory(history, {
        lastRunTurnId: state.lastReviewedTurnId,
        lastRunTurnTimestamp: state.lastReviewedTurnTimestamp,
        interval, maxTurns: interval * 2, includeSourceEntries: true,
        currentActionText: actionText, currentProse: textToCheck, currentEventText, currentTurnId
    });
    const objectives = (currentPlayer?.currentQuests || []).flatMap(quest => (
        quest.paused ? [] : (quest.objectives || []).filter(objective => !objective.completed).map(objective => ({
            id: objective.id, description: `${quest.name}: ${objective.description || objective.summary || ''}`
        }))
    ));
    const knownFacts = (baseContext.trackers || []).map(tracker => ({
        reference: tracker.id,
        visibility: tracker.hidden ? 'private' : 'public',
        description: `${tracker.name}; type=${tracker.type}; current value=${tracker.value}; current guidance=${tracker.guidance || ''}; note=${tracker.note || ''}. Tracker visibility alone does not establish communication of a deadline.`
    }));
    for (const thread of baseContext.activeMysteryThreads || []) {
        for (const box of thread.mysteryBoxes || []) knownFacts.push({
            reference: box.id, visibility: 'private', description: box.text || box.name
        });
    }
    const referenceSources = JSON.stringify({
        plans: state.factionPlans, objectives, threads: baseContext.activeMysteryThreads || [],
        facts: knownFacts, plots: baseContext.plotAnalysis?.plotThreads || [], scheduledEvents
    });
    const hasExplicitReference = id => {
        if (typeof id !== 'string' || !id.trim()) return false;
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(referenceSources);
    };
    const isPublicPassage = entry => !isHiddenEntry(entry)
        && typeof entry.role === 'string' && !['user', 'system', 'tool'].includes(entry.role.trim().toLowerCase())
        && HOUSEKEEPING_PROSE_ENTRY_TYPES.has(typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '')
        && typeof entry.id === 'string' && entry.id.trim();
    const isPrivateNote = entry => isHiddenEntry(entry)
        && typeof entry.type === 'string' && entry.type.trim().toLowerCase() === 'supplemental-story-info' && entry.id && entry.content;
    const referencedEntries = history.filter(entry => (isPublicPassage(entry) || isPrivateNote(entry)) && hasExplicitReference(entry.id));
    const firstPlayerIndex = history.findIndex(entry => entry.id === review.batchTurns[0]?.turnId);
    const hasEarlierPlayerTurn = history.slice(0, firstPlayerIndex).some(entry => (
        typeof entry.role === 'string' && entry.role.trim().toLowerCase() === 'user'
        && ['', 'player-action'].includes(typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '')
    ));
    const openingEntries = !state.lastReviewedTurnId && !hasEarlierPlayerTurn
        ? history.slice(0, firstPlayerIndex < 0 ? history.length : firstPlayerIndex).filter(entry => isPublicPassage(entry) || isPrivateNote(entry)) : [];
    const selectedEntries = new Set([...referencedEntries, ...openingEntries, ...(review.currentTurn?.sourceEntries || [])]);
    const historyCharacters = text => escapeXml(String(text || '')).length;
    const entryCharacters = entry => historyCharacters(entry.content);
    const supplementCharacters = turn => {
        const stored = new Set((turn.sourceEntries || []).map(entry => String(entry.content || '').trim()));
        return [turn.playerAction, ...turn.prose, ...turn.eventText]
            .filter(text => text && !stored.has(text.trim())).reduce((total, text) => total + historyCharacters(text), 0);
    };
    let characters = Array.from(selectedEntries).reduce((total, entry) => total + entryCharacters(entry), 0)
        + (review.currentTurn ? supplementCharacters(review.currentTurn) : 0);
    if (characters > FACTION_HISTORY_MAX_CHARACTERS) {
        throw new Error(`Faction housekeeping required current-turn and explicitly referenced history exceeds the ${FACTION_HISTORY_MAX_CHARACTERS}-character history budget (${characters} characters). Shorten the oversized source passages or reduce obsolete exact passage references in saved plans; source text has not been truncated.`);
    }
    const batchTurns = [];
    for (const turn of review.batchTurns) {
        const entries = (turn.sourceEntries || []).filter(entry => !selectedEntries.has(entry));
        const additional = entries.reduce((total, entry) => total + entryCharacters(entry), 0)
            + (turn === review.currentTurn ? 0 : supplementCharacters(turn));
        if (characters + additional > FACTION_HISTORY_MAX_CHARACTERS) {
            if (!batchTurns.length) throw new Error(`Faction housekeeping turn ${turn.turnId} cannot fit the ${FACTION_HISTORY_MAX_CHARACTERS}-character history budget with required current-turn and referenced evidence. Shorten the oversized source turn or obsolete saved passage references; the review boundary has not advanced.`);
            break;
        }
        batchTurns.push(turn);
        entries.forEach(entry => selectedEntries.add(entry));
        characters += additional;
    }
    const turns = review.currentTurn && !batchTurns.includes(review.currentTurn) ? [...batchTurns, review.currentTurn] : batchTurns;
    const projectedEntries = history.filter(entry => selectedEntries.has(entry));
    const publicSourceTexts = new Set(projectedEntries.filter(isPublicPassage).map(entry => String(entry.content || '').trim()));
    const publicPassages = projectedEntries.filter(isPublicPassage)
        .map(entry => {
            let remaining = String(entry.content || '');
            const privateNotes = [];
            const text = publicText(remaining, (start, end, replacementLength) => {
                const removed = remaining.slice(start, end);
                if (/<hidden\b/i.test(removed)) privateNotes.push(removed);
                remaining = remaining.slice(0, start) + ' '.repeat(replacementLength) + remaining.slice(end);
            });
            if (/<hidden\b/i.test(String(entry.content || '')) && !privateNotes.length) {
                throw new Error(`Faction history passage ${entry.id} requires a hidden-note projector with replacement callbacks to preserve private continuity.`);
            }
            if (privateNotes.length) knownFacts.push({ reference: entry.id, visibility: 'private', description: privateNotes.join('\n') });
            return { reference: entry.id, text };
        })
        .filter(entry => entry.text.trim());
    for (const entry of projectedEntries.filter(isPrivateNote)) {
        knownFacts.push({ reference: entry.id, visibility: 'private', description: String(entry.content) });
    }
    const context = {
        intendedTone: String(baseContext.setting?.tone || baseContext.setting?.unifiedTonalScalePrompt || baseContext.setting?.description || 'Follow the current setting and established story tone.'),
        currentSituation: [
            `Current location: ${baseContext.currentLocation?.name || currentPlayer?.location?.name || 'not specified'}.`,
            ...(baseContext.plotAnalysis?.plotThreads || []).map(thread => `Current plot thread: ${thread.description}`),
            `Historical review: ${batchTurns.length} persisted turns in chronological order. ${review.deferredTurnCount + review.batchTurns.length - batchTurns.length} later turns await a future review; the current turn is supplied separately when outside this batch. Public history is selective: missing evidence is unknown, not proof that communication or a deadline never occurred.`,
            ...turns.map(turn => [
                `Turn ${turn.turnId || '(not yet stored)'}${turn.timestamp ? ` at ${turn.timestamp}` : ''}${turn === review.currentTurn && !batchTurns.includes(turn) ? ' (current supplement; does not advance historical review)' : ''}:`,
                turn.playerAction,
                ...turn.prose.filter(text => !publicSourceTexts.has(text.trim())),
                ...turn.eventText,
                ...(turn.sourceEntries || []).filter(entry => publicPassages.some(passage => passage.reference === entry.id)).map(entry => `Public prose: see passage ${entry.id}.`)
            ].filter(Boolean).join('\n'))
        ].join('\n\n'),
        objectives,
        threads: (baseContext.activeMysteryThreads || []).map(thread => ({ id: thread.id, description: `${thread.name}: ${thread.summary || ''}` })),
        factions: Array.from(factions.values(), faction => ({
            id: faction.id,
            description: [faction.name, faction.description, faction.shortDescription,
                `Goals: ${(faction.goals || []).join('; ')}`,
                `Home region: ${faction.homeRegionName || 'not recorded'}`,
                `Means: ${(faction.assets || []).map(asset => `${asset.name}: ${asset.description || ''}`).join('; ')}`,
                `Directed ties: ${Array.from(faction.relations instanceof Map ? faction.relations : new Map(Object.entries(faction.relations || {})),
                    ([id, relation]) => `${id}: ${relation.status}; ${relation.notes || ''}`).join('; ')}`
            ].filter(Boolean).join('\n')
        })),
        pendingDevelopments: [...state.factionPlans.map(plan => ({
            reference: plan.factionRef, threadId: '', commitment: 'tentative', exposure: 'pending',
            description: `${plan.role}; intention: ${plan.plan}; next steps: ${plan.nextSteps.join('; ')}; awareness constraints: ${plan.awarenessConstraints}. This saved intention is not evidence that an action happened.`
        })), ...scheduledEvents.filter(event => event.status === 'pending').map(event => ({
            reference: event.id, threadId: '', commitment: 'committed', exposure: 'pending',
            description: `Recorded scheduled attempt: ${event.event}; place: ${event.locationName || event.regionName || 'unspecified'}; internal target world minute: ${event.targetWorldMinute}. An internal target time does not establish player awareness or authorize an awareness-gate exception.`
        }))],
        publicPassages, deadlines: [], knownFacts
    };
    const lastTurn = batchTurns.at(-1);
    return { context, boundary: {
        lastReviewedTurnId: lastTurn?.turnId || state.lastReviewedTurnId,
        lastReviewedTurnTimestamp: lastTurn ? lastTurn.timestamp : state.lastReviewedTurnTimestamp
    } };
}

async function stageFactionHousekeepingProposal({ proposal, factions, generateFactionsList, settingDescription }) {
    if (!(factions instanceof Map) || typeof generateFactionsList !== 'function') {
        throw new TypeError('Faction staging requires the active map and shared faction generator.');
    }
    const sourceFingerprint = rosterFingerprint(factions);
    const existing = Array.from(factions.values(), factionData);
    const sourceIds = new Set(existing.map(faction => faction.id));
    let generated = [];
    if (proposal.newFactions.length) {
        generated = await generateFactionsList({
            count: proposal.newFactions.length, asDraft: true, existingFactions: existing,
            settingDescription,
            generationNotes: 'Author exactly these proposed factions, preserving each name exactly. Expand each concept into a complete reusable faction. Establish only meaningful sparse directed relationships touching a new faction; omitted pairs remain absent. Do not overwrite existing edges.\n'
                + proposal.newFactions.map(faction => `${faction.localRef}: ${faction.name}\n${faction.concept}`).join('\n\n'),
            requiredNames: proposal.newFactions.map(faction => faction.name)
        });
    }
    if (!Array.isArray(generated) || generated.length !== proposal.newFactions.length) {
        throw new Error('Faction authoring must return exactly the proposed number of new factions.');
    }
    const names = new Set(Array.from(factions.values(), faction => faction.name.toLowerCase()));
    const draftIds = new Set();
    const newFactionDTOs = proposal.newFactions.map(concept => {
        const matches = generated.filter(faction => faction.name === concept.name);
        if (matches.length !== 1 || names.has(concept.name.toLowerCase())) {
            throw new Error(`Faction authoring must preserve a unique proposed name: ${concept.name}`);
        }
        const data = matches[0];
        if (typeof data.id !== 'string' || !data.id || sourceIds.has(data.id) || draftIds.has(data.id)) {
            throw new Error('Faction authoring requires unique temporary draft IDs.');
        }
        names.add(concept.name.toLowerCase());
        draftIds.add(data.id);
        return { localRef: concept.localRef, data: new Faction({ ...data, register: false }).toJSON() };
    });
    const validIds = new Set([...sourceIds, ...draftIds]);
    for (const { data } of newFactionDTOs) {
        for (const target of Object.keys(data.relations)) {
            if (!validIds.has(target) || target === data.id) throw new Error(`Invalid generated faction relation target: ${target}`);
        }
    }
    const existingRelations = existing.map(data => {
        const incoming = Object.fromEntries(Object.entries(data.relations || {}).filter(([target]) => draftIds.has(target)));
        const normalized = new Faction({ ...data, relations: incoming, register: false }).toJSON();
        return { id: data.id, relations: normalized.relations };
    }).filter(entry => Object.keys(entry.relations).length);
    return { proposal: clone(proposal), newFactionDTOs, existingRelations, sourceFingerprint };
}

function commitFactionHousekeepingProposal({ staged, factions, boundary, assertCurrent = () => {}, setState = value => Globals.setFactionHousekeepingState(value) }) {
    assertCurrent();
    if (rosterFingerprint(factions) !== staged.sourceFingerprint) {
        throw new Error('Faction roster changed while housekeeping was being prepared.');
    }
    const ids = new Map(staged.newFactionDTOs.map(({ data }) => [data.id, IdGenerator.next('faction', data.name)]));
    const localRefs = new Map(staged.newFactionDTOs.map(({ localRef, data }) => [localRef, ids.get(data.id)]));
    const resolveTextRefs = text => text.replace(/draft:[A-Za-z0-9][A-Za-z0-9_-]*/g, ref => localRefs.get(ref) || ref);
    const state = normalizeFactionHousekeepingState({
        factionPlans: staged.proposal.factionPlans.map(plan => ({
            factionRef: localRefs.get(plan.factionRef) || plan.factionRef,
            role: resolveTextRefs(plan.role), plan: resolveTextRefs(plan.plan),
            nextSteps: plan.nextSteps.map(resolveTextRefs), awarenessConstraints: resolveTextRefs(plan.awarenessConstraints)
        })),
        ...boundary
    });
    const remap = relations => Object.fromEntries(Object.entries(relations).map(([id, relation]) => [ids.get(id) || id, relation]));
    const originalRelations = new Map();
    const createdFactions = [];
    try {
        for (const { data } of staged.newFactionDTOs) {
            const faction = new Faction({ ...data, id: ids.get(data.id), relations: remap(data.relations) });
            createdFactions.push(faction);
            factions.set(faction.id, faction);
        }
        for (const { id, relations } of staged.existingRelations) {
            const faction = factions.get(id);
            originalRelations.set(id, faction.relations);
            const merged = faction.relations;
            for (const [target, relation] of Object.entries(remap(relations))) {
                if (!merged.has(target)) merged.set(target, relation);
            }
            faction.relations = merged;
        }
        setState(state);
    } catch (error) {
        for (const [id, relations] of originalRelations) factions.get(id).relations = relations;
        for (const faction of createdFactions) { factions.delete(faction.id); Faction.delete(faction.id); }
        throw error;
    }
    return { state, createdFactions };
}

async function runFactionHousekeeping({
    promptEnv, parseXMLTemplate, config, factions, chatHistory, baseContext, currentPlayer,
    generateFactionsList, interval, textToCheck = '', actionText = '', currentEventText = '', currentTurnId = null, scheduledEvents = [],
    assertCurrent = () => {}, isHiddenEntry, publicText,
    complete = options => LLMClient.chatCompletion(options), logPrompt = options => LLMClient.logPrompt(options)
}) {
    const initialRoster = rosterFingerprint(factions);
    const previousState = Globals.getFactionHousekeepingState();
    const { context, boundary } = buildFactionHousekeepingContext({
        baseContext, factions, chatHistory, previousState, currentPlayer, interval,
        textToCheck, actionText, currentEventText, currentTurnId, scheduledEvents, isHiddenEntry, publicText
    });
    const useTinyBrain = isTinyBrainPromptEnabled(config, 'faction_housekeeping');
    const mainQuest = baseContext?.mainQuest || null;
    const templateContext = {
        factionHousekeeping: context,
        factionHousekeepingTinyBrain: useTinyBrain,
        // Factions cast in the active main quest plan in line with that storyline.
        mainQuestStoryline: mainQuest && Array.isArray(mainQuest.factionRoles) && mainQuest.factionRoles.length
            ? {
                title: mainQuest.title,
                currentStage: mainQuest.currentStage,
                direction: mainQuest.hiddenDirection,
                pressure: mainQuest.pressure,
                factionRoles: mainQuest.factionRoles
            }
            : null
    };
    const aiConfig = resolveTinyBrainAiConfig(config, 'faction_housekeeping');
    const maxAttempts = resolveConfiguredPromptMaxAttempts(aiConfig);
    const tinyBrain = useTinyBrain ? configureTinyBrainPromptContext(templateContext, 'faction_housekeeping') : null;
    const outer = parseXMLTemplate(promptEnv.render('faction-housekeeping.xml.njk', templateContext));
    let lastMessages;
    const request = (messages, queueReservation) => {
        lastMessages = messages;
        return complete({
            messages, queueReservation, metadataLabel: 'faction_housekeeping', validateXML: false,
            ...(!useTinyBrain ? { expectedXmlRootTag: 'factionHousekeepingProposal' } : {}),
            temperature: outer.temperature,
            throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' }
        });
    };
    let response;
    if (useTinyBrain) {
        const result = await runTinyBrainPromptProgram({
            initialRenderedTemplate: outer.generationPrompt, templateContext, tinyBrain,
            runnerOptions: {
                promptEnv, parseXMLTemplate: program => ({ systemPrompt: outer.systemPrompt, generationPrompt: program }),
                retryAttempts: maxAttempts - 1, metadataLabel: 'faction_housekeeping', logPrefix: 'faction_housekeeping', toolDefinitions: [], logPrompt,
                complete: async ({ messages, queueReservation }) => {
                    assertCurrent();
                    const aiResponse = await request(messages, queueReservation);
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                },
                parserOutputContracts: {
                    faction_housekeeping_section: sectionName => ({ xmlOutput: true, expectedXmlRootTag: sectionName }),
                    faction_housekeeping_proposal: { xmlOutput: true, expectedXmlRootTag: 'factionHousekeepingProposal' }
                },
                parsers: { faction_housekeeping_section: parseFactionHousekeepingSection, faction_housekeeping_proposal: parseFactionHousekeepingProposal },
                resultBuilders: { faction_housekeeping_proposal: buildFactionHousekeepingProposal }
            }
        });
        response = result.aiResponse;
    } else {
        const result = await runPromptWithParseRetries({
            metadataLabel: 'faction_housekeeping',
            messages: [{ role: 'system', content: outer.systemPrompt }, { role: 'user', content: outer.generationPrompt }],
            maxAttempts,
            complete: ({ messages }) => { assertCurrent(); return request(messages); },
            parse: text => parseFactionHousekeepingProposal(text, context.factions),
            buildRetryInstruction: error => `Correct the compact faction proposal XML and its references: ${error.message}. Return the complete <factionHousekeepingProposal> root only.`,
            onAttempt: ({ response: text, error, attempt }) => logPrompt({
                prefix: 'faction_housekeeping', metadataLabel: 'faction_housekeeping',
                systemPrompt: outer.systemPrompt,
                generationPrompt: lastMessages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n'), response: text,
                sections: [{ title: `Attempt ${attempt} validation`, content: error?.stack || 'accepted' }]
            })
        });
        response = result.response;
    }
    assertCurrent();
    if (rosterFingerprint(factions) !== initialRoster) throw new Error('Faction roster changed during housekeeping review.');
    const { proposal } = parseFactionHousekeepingProposal(response, context.factions);
    const staged = await stageFactionHousekeepingProposal({
        proposal, factions, generateFactionsList, settingDescription: baseContext.setting?.description
    });
    assertCurrent();
    return { ...commitFactionHousekeepingProposal({ staged, factions, boundary, assertCurrent }), response };
}

module.exports = { FACTION_HISTORY_MAX_CHARACTERS, buildFactionHousekeepingContext, stageFactionHousekeepingProposal, commitFactionHousekeepingProposal, runFactionHousekeeping };
