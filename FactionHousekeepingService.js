const Globals = require('./Globals.js');
const Faction = require('./Faction.js');
const IdGenerator = require('./IdGenerator.js');
const LLMClient = require('./LLMClient.js');
const { normalizeFactionHousekeepingState } = require('./FactionHousekeepingState.js');
const { shouldExcludeEntryFromPromptHistory } = require('./base_context_history.js');
const { HOUSEKEEPING_PROSE_ENTRY_TYPES, buildHousekeepingTurnHistory } = require('./housekeeping_history.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('./PromptRetryPolicy.js');
const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, resolveTinyBrainAiConfig, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');
const { parseFactionHousekeepingSection, parseFactionHousekeepingProposal, buildFactionHousekeepingProposal } = require('./FactionHousekeepingPrompt.js');

const clone = value => JSON.parse(JSON.stringify(value));
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
        interval, currentActionText: actionText, currentProse: textToCheck, currentEventText, currentTurnId
    });
    const publicPassages = history.filter(entry => !isHiddenEntry(entry)
        && typeof entry.role === 'string' && !['user', 'system', 'tool'].includes(entry.role.toLowerCase())
        && HOUSEKEEPING_PROSE_ENTRY_TYPES.has(entry.type || ''))
        .filter(entry => typeof entry.id === 'string' && entry.id.trim())
        .map(entry => ({ reference: entry.id, text: publicText(String(entry.content || '')) }))
        .filter(entry => entry.text.trim());
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
    for (const entry of history.filter(entry => isHiddenEntry(entry)
        && entry.type === 'supplemental-story-info' && entry.id && entry.content)) {
        knownFacts.push({ reference: entry.id, visibility: 'private', description: String(entry.content) });
    }
    const context = {
        intendedTone: String(baseContext.setting?.tone || baseContext.setting?.unifiedTonalScalePrompt || baseContext.setting?.description || 'Follow the current setting and established story tone.'),
        currentSituation: [
            `Current location: ${baseContext.currentLocation?.name || currentPlayer?.location?.name || 'not specified'}.`,
            ...(baseContext.plotAnalysis?.plotThreads || []).map(thread => `Current plot thread: ${thread.description}`),
            ...review.turns.map(turn => [turn.playerAction, ...turn.prose, ...turn.eventText].filter(Boolean).join('\n'))
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
    return { context, boundary: { lastReviewedTurnId: review.lastIncludedTurnId, lastReviewedTurnTimestamp: review.lastIncludedTurnTimestamp } };
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
    const templateContext = { factionHousekeeping: context, factionHousekeepingTinyBrain: useTinyBrain };
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

module.exports = { buildFactionHousekeepingContext, stageFactionHousekeepingProposal, commitFactionHousekeepingProposal, runFactionHousekeeping };
