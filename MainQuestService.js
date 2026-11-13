'use strict';

const MainQuest = require('./MainQuest.js');

const MODES = Object.freeze(['new', 'sequel', 'auto']);
const PROMINENCE_THRESHOLDS = Object.freeze({ normal: 6, high: 15 });
const MAX_GOAL_LENGTH = 500;

const text = value => (typeof value === 'string' ? value.trim() : '');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function resolveConfig(config = {}) {
    const section = config?.main_quest;
    const defaults = { enabled: true, stageCount: 8, fullCheckInterval: 12, pressureClockEnabled: true };
    if (section === undefined || section === null) return defaults;
    if (typeof section !== 'object' || Array.isArray(section)) {
        throw new Error('main_quest must be a mapping with enabled, stage_count, full_check_interval and pressure_clock_enabled.');
    }
    const bool = (key, fallback) => {
        const value = section[key] === undefined ? fallback : section[key];
        if (typeof value !== 'boolean') throw new Error(`main_quest.${key} must be true or false.`);
        return value;
    };
    const positiveInt = (key, fallback) => {
        const value = section[key] === undefined ? fallback : section[key];
        if (!Number.isSafeInteger(value) || value < 1) throw new Error(`main_quest.${key} must be a whole number of 1 or more.`);
        return value;
    };
    return {
        enabled: bool('enabled', defaults.enabled),
        stageCount: positiveInt('stage_count', defaults.stageCount),
        fullCheckInterval: positiveInt('full_check_interval', defaults.fullCheckInterval),
        pressureClockEnabled: bool('pressure_clock_enabled', defaults.pressureClockEnabled)
    };
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function parseRoot(raw, rootTag) {
    const Utils = require('./Utils.js');
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Response was empty; return a <${rootTag}> element.`);
    const block = Utils.extractFinalXmlRootBlock(raw, [rootTag]);
    if (!block) throw new Error(`Response is missing the <${rootTag}> element.`);
    const doc = Utils.parseXmlDocumentStrict(block, 'text/xml');
    const root = doc.documentElement;
    if (!root || root.tagName !== rootTag) throw new Error(`Response root must be <${rootTag}>.`);
    return root;
}

const children = (node, tag) => Array.from(node?.childNodes || [])
    .filter(child => child.nodeType === 1 && (!tag || child.tagName === tag));

function child(node, tag) {
    const matches = children(node, tag);
    if (matches.length > 1) throw new Error(`<${node.tagName}> has more than one <${tag}>.`);
    return matches[0] || null;
}

function childText(node, tag) {
    const found = child(node, tag);
    return found ? found.textContent.trim() : '';
}

function requiredChildText(node, tag, label) {
    const value = childText(node, tag);
    if (!value) throw new Error(`${label} needs a non-empty <${tag}>.`);
    return value;
}

function listTexts(node, containerTag, itemTag) {
    const container = child(node, containerTag);
    return container ? children(container, itemTag).map(entry => entry.textContent.trim()).filter(Boolean) : [];
}

function parseStageOutlines(container, label) {
    return children(container, 'stage').map((stageNode, index) => ({
        title: requiredChildText(stageNode, 'title', `${label} ${index + 1}`),
        outline: requiredChildText(stageNode, 'outline', `${label} ${index + 1}`),
        exitCondition: requiredChildText(stageNode, 'exitCondition', `${label} ${index + 1}`)
    }));
}

function parseEndings(container) {
    return children(container, 'ending').map((node, index) => ({
        id: `ending_${index + 1}`,
        description: requiredChildText(node, 'description', `Ending ${index + 1}`)
    }));
}

/** Resolves an optional <type>/<name> binding to an existing NPC or faction. */
function resolveBinding(node, label, resolvers) {
    const type = childText(node, 'type').toLowerCase();
    const name = childText(node, 'name');
    if (!type && !name) return null;
    if (!['npc', 'faction'].includes(type)) {
        throw new Error(`${label} <type> must be npc or faction, not "${type}".`);
    }
    if (!name) throw new Error(`${label} needs a <name> of an existing ${type}.`);
    const resolved = type === 'npc' ? resolvers.findNpcByName(name) : resolvers.findFactionByName(name);
    if (!resolved) {
        throw new Error(`${label} names ${type} "${name}", which does not exist. Use an exact existing ${type} name, or leave the binding empty until one exists.`);
    }
    if (type === 'npc' && resolved.isDead === true) {
        throw new Error(`${label} names NPC "${name}", who is dead. Choose a living NPC or leave the binding empty.`);
    }
    return { type, id: resolved.id, name: resolved.name || name };
}

function parsePressure(node, { pressureEnabled }) {
    if (!node) return null;
    const playerFacingText = childText(node, 'playerFacingText');
    const deadlineNode = child(node, 'deadline');
    let deadline = null;
    if (deadlineNode && pressureEnabled) {
        const inText = childText(deadlineNode, 'in');
        const event = childText(deadlineNode, 'event');
        if (inText || event) {
            if (!inText || !event) throw new Error('<pressure><deadline> needs both <in> (a duration such as "3 days") and <event>.');
            const Utils = require('./Utils.js');
            try {
                Utils.parseDurationToMinutes(inText, { fieldName: 'pressure deadline in' });
            } catch (error) {
                throw new Error(`<pressure><deadline><in> "${inText}" is not a valid duration. Use hours or days, such as "36 hours" or "4 days".`, { cause: error });
            }
            deadline = {
                in: inText,
                event,
                region: requiredChildText(deadlineNode, 'region', '<pressure><deadline>'),
                location: requiredChildText(deadlineNode, 'location', '<pressure><deadline>')
            };
        }
    }
    return { playerFacingText, deadline };
}

function parseStageDetailNode(node, label) {
    if (!node) return null;
    return {
        objective: requiredChildText(node, 'objective', label),
        hiddenDirection: requiredChildText(node, 'hiddenDirection', label),
        hooks: listTexts(node, 'hooks', 'hook')
    };
}

// ---------------------------------------------------------------------------
// Prompt parsers
// ---------------------------------------------------------------------------

function parseGenerateResponse(raw, { stageCount, mode, resolvers, pressureEnabled }) {
    const root = parseRoot(raw, 'mainQuest');
    let chosenMode = childText(root, 'modeChosen').toLowerCase();
    if (mode === 'auto') {
        if (!['new', 'sequel'].includes(chosenMode)) {
            throw new Error('<modeChosen> must be "new" or "sequel" when the mode is auto; say which one you chose.');
        }
    } else {
        chosenMode = mode;
    }
    const stagesNode = child(root, 'stages');
    if (!stagesNode) throw new Error('<mainQuest> needs <stages>.');
    const stages = parseStageOutlines(stagesNode, 'Stage');
    if (stages.length !== stageCount) {
        throw new Error(`<stages> must contain exactly ${stageCount} <stage> entries; got ${stages.length}.`);
    }
    const endingsNode = child(root, 'endings');
    const endings = endingsNode ? parseEndings(endingsNode) : [];
    if (endings.length < 2 || endings.length > 3) {
        throw new Error(`<endings> must contain 2 or 3 <ending> entries; got ${endings.length}.`);
    }
    const antagonistNode = child(root, 'antagonist');
    if (!antagonistNode) throw new Error('<mainQuest> needs <antagonist>.');
    const factionName = childText(antagonistNode, 'factionName');
    const npcName = childText(antagonistNode, 'npcName');
    const faction = factionName ? resolvers.findFactionByName(factionName) : null;
    if (factionName && !faction) throw new Error(`<antagonist><factionName> "${factionName}" is not an existing faction. Use an exact name or leave it empty.`);
    const npc = npcName ? resolvers.findNpcByName(npcName) : null;
    if (npcName && !npc) throw new Error(`<antagonist><npcName> "${npcName}" is not an existing NPC. Use an exact name or leave it empty.`);

    const rolesNode = child(root, 'roles');
    const roles = rolesNode ? children(rolesNode, 'role').map((roleNode, index) => {
        const key = requiredChildText(roleNode, 'key', `Role ${index + 1}`);
        const bindingNode = child(roleNode, 'boundTo');
        return {
            key,
            description: requiredChildText(roleNode, 'description', `Role "${key}"`),
            boundTo: bindingNode ? resolveBinding(bindingNode, `Role "${key}" <boundTo>`, resolvers) : null
        };
    }) : [];
    const roleKeys = new Set();
    for (const role of roles) {
        if (roleKeys.has(role.key.toLowerCase())) throw new Error(`Role key "${role.key}" is listed more than once.`);
        roleKeys.add(role.key.toLowerCase());
    }

    return {
        mode: chosenMode,
        title: requiredChildText(root, 'title', '<mainQuest>'),
        premise: requiredChildText(root, 'premise', '<mainQuest>'),
        hiddenTruth: requiredChildText(root, 'hiddenTruth', '<mainQuest>'),
        antagonist: {
            description: requiredChildText(antagonistNode, 'description', '<antagonist>'),
            factionId: faction?.id || null,
            npcId: npc?.id || null
        },
        roles,
        stages,
        endings,
        pressure: parsePressure(child(root, 'pressure'), { pressureEnabled })
    };
}

function parseStageResponse(raw, { hasNextStage, mainQuest, resolvers, pressureEnabled }) {
    const root = parseRoot(raw, 'mainQuestStage');
    const current = parseStageDetailNode(child(root, 'currentStage'), '<currentStage>');
    if (!current) throw new Error('<mainQuestStage> needs <currentStage>.');
    const nextNode = child(root, 'nextStage');
    if (hasNextStage && !nextNode) throw new Error('<mainQuestStage> needs <nextStage> because another stage follows.');
    const next = hasNextStage ? parseStageDetailNode(nextNode, '<nextStage>') : null;
    const questNode = child(root, 'quest');
    if (!questNode) throw new Error('<mainQuestStage> needs <quest> with a <summary>.');
    const roleKeys = new Map(mainQuest.roles.map(role => [role.key.toLowerCase(), role.key]));
    const bindingsNode = child(root, 'roleBindings');
    const bindings = bindingsNode ? children(bindingsNode, 'binding').map((node, index) => {
        const roleName = requiredChildText(node, 'role', `Binding ${index + 1}`);
        const key = roleKeys.get(roleName.toLowerCase());
        if (!key) throw new Error(`Binding role "${roleName}" is not a role of this main quest. Roles: ${[...roleKeys.values()].join(', ') || 'none'}.`);
        const boundTo = resolveBinding(node, `Binding for role "${key}"`, resolvers);
        return boundTo ? { key, boundTo } : null;
    }).filter(Boolean) : [];
    return {
        current,
        next,
        prose: requiredChildText(root, 'prose', '<mainQuestStage>'),
        quest: { summary: requiredChildText(questNode, 'summary', '<quest>'), giver: childText(questNode, 'giver') },
        bindings,
        pressure: parsePressure(child(root, 'pressure'), { pressureEnabled })
    };
}

const CHECK_PROGRESS = Object.freeze(['none', 'stage-complete', 'ending-reached']);

function parseCheckResponse(raw, { mainQuest, resolvers, pressureEnabled }) {
    const root = parseRoot(raw, 'mainQuestCheck');
    const progress = childText(root, 'progress').toLowerCase();
    if (!CHECK_PROGRESS.includes(progress)) {
        throw new Error(`<progress> must be one of: ${CHECK_PROGRESS.join(', ')}.`);
    }
    const isLastStage = mainQuest.currentStageIndex === mainQuest.stages.length - 1;
    if (progress === 'stage-complete' && isLastStage) {
        throw new Error('The current stage is the last one; when it is complete, use ending-reached and describe the ending.');
    }
    const stageOutcome = childText(root, 'stageOutcome');
    if (progress !== 'none' && !stageOutcome) {
        throw new Error('<stageOutcome> is required when progress is stage-complete or ending-reached; summarise what actually happened.');
    }
    const roleKeys = new Map(mainQuest.roles.map(role => [role.key.toLowerCase(), role.key]));
    const recastNode = child(root, 'recast');
    const recasts = recastNode ? children(recastNode, 'binding').map((node, index) => {
        const roleName = requiredChildText(node, 'role', `Recast ${index + 1}`);
        const key = roleKeys.get(roleName.toLowerCase());
        if (!key) throw new Error(`Recast role "${roleName}" is not a role of this main quest. Roles: ${[...roleKeys.values()].join(', ') || 'none'}.`);
        const boundTo = resolveBinding(node, `Recast for role "${key}"`, resolvers);
        if (!boundTo) throw new Error(`Recast for role "${key}" needs a <type> and <name>.`);
        return { key, boundTo, reason: childText(node, 'reason') };
    }) : [];

    let replan = null;
    const replanNode = child(root, 'replan');
    if (replanNode) {
        const remainingAfterChange = mainQuest.stages.length - mainQuest.currentStageIndex - 1;
        const stagesNode = child(replanNode, 'stages');
        const stages = stagesNode ? parseStageOutlines(stagesNode, 'Replanned stage') : null;
        if (stages && stages.length !== remainingAfterChange) {
            throw new Error(`<replan><stages> must contain exactly ${remainingAfterChange} stages (the stages after the current one); got ${stages.length}.`);
        }
        const endingsNode = child(replanNode, 'endings');
        const endings = endingsNode ? parseEndings(endingsNode) : null;
        if (endings && (endings.length < 2 || endings.length > 3)) {
            throw new Error(`<replan><endings> must contain 2 or 3 endings; got ${endings.length}.`);
        }
        if (stages || endings) replan = { stages, endings };
    }

    let ending = null;
    if (progress === 'ending-reached') {
        const endingNode = child(root, 'ending');
        if (!endingNode) throw new Error('<ending> is required when progress is ending-reached.');
        const endingId = childText(endingNode, 'endingId');
        if (endingId && !mainQuest.endings.some(entry => entry.id === endingId)) {
            throw new Error(`<endingId> "${endingId}" is not a planned ending. Use one of ${mainQuest.endings.map(entry => entry.id).join(', ')}, or leave it empty for a new ending.`);
        }
        ending = { endingId: endingId || null, description: requiredChildText(endingNode, 'description', '<ending>') };
    }

    return {
        progress,
        stageOutcome,
        newLockedFacts: listTexts(root, 'newLockedFacts', 'fact'),
        recasts,
        replan,
        ending,
        pressure: parsePressure(child(root, 'pressure'), { pressureEnabled })
    };
}

const PROGRESS_SIGNAL_KINDS = Object.freeze(['stage-complete', 'ending']);

/** Parser for the event checker's <mainQuestProgress> element (raw is the registry's JSON payload). */
function parseProgressSignal(raw) {
    let payload;
    try {
        payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
        throw new Error('<mainQuestProgress> must contain <value> and <evidence> child elements.', { cause: error });
    }
    const value = text(payload?.value).toLowerCase();
    if (!PROGRESS_SIGNAL_KINDS.includes(value)) {
        throw new Error(`<mainQuestProgress><value> must be one of: ${PROGRESS_SIGNAL_KINDS.join(', ')}. Omit the element when the main quest did not progress.`);
    }
    const evidence = text(payload?.evidence);
    if (!evidence) throw new Error('<mainQuestProgress> needs <evidence>: one sentence quoting or summarising what happened in the text.');
    return { kind: value, evidence };
}

const PROGRESS_SIGNAL_SCHEMA = Object.freeze({
    name: 'mainQuestProgress',
    description: 'Only when the text shows the current main quest stage\'s exitCondition (from the <mainQuest> context) becoming true by any route, or the main quest storyline concluding. Omit it otherwise, including for partial progress, plans, or talk about the goal. value is stage-complete or ending.',
    xml: '<mainQuestProgress><value>stage-complete|ending</value><evidence>One sentence on what happened in the text.</evidence></mainQuestProgress>'
});

function parseWrapupResponse(raw) {
    const root = parseRoot(raw, 'mainQuestWrapUp');
    return { prose: requiredChildText(root, 'prose', '<mainQuestWrapUp>') };
}

// ---------------------------------------------------------------------------
// TinyBrain staged sections
// ---------------------------------------------------------------------------

const TINY_BRAIN_SECTIONS = Object.freeze({
    concept: { root: 'mainQuestConcept', target: null },
    plan: { root: 'mainQuestPlan', target: null },
    closure: { root: 'mainQuestClosure', target: null },
    progress: { root: 'mainQuestProgress', target: null },
    updates: { root: 'mainQuestUpdates', target: null },
    replan: { root: 'mainQuestReplan', target: 'replan' },
    ending: { root: 'mainQuestEnding', target: 'ending' },
    pressure: { root: 'mainQuestPressure', target: 'pressure' }
});

function innerXml(node) {
    return children(node).map(entry => entry.toString()).join('\n');
}

/**
 * Validates one staged TinyBrain section with the same rules as the full
 * parsers and returns { xml, progress? } for the result builder.
 * ctx: { stageCount, mode, mainQuest, resolvers, pressureEnabled }
 */
function parseTinyBrainSection(raw, sectionName, ctx) {
    const section = TINY_BRAIN_SECTIONS[sectionName];
    if (!section) throw new Error(`Unknown main quest TinyBrain section "${sectionName}".`);
    const root = parseRoot(raw, section.root);
    const wrap = tag => `<${tag}>${innerXml(root)}</${tag}>`;
    switch (sectionName) {
        case 'concept': {
            parseGenerateResponse(`<mainQuest>${innerXml(root)}${placeholderPlan(ctx.stageCount)}${PLACEHOLDER_CLOSURE}</mainQuest>`, ctx);
            return { xml: innerXml(root) };
        }
        case 'plan': {
            parseGenerateResponse(`<mainQuest>${placeholderConcept(ctx.mode)}${innerXml(root)}${PLACEHOLDER_CLOSURE}</mainQuest>`, ctx);
            return { xml: innerXml(root) };
        }
        case 'closure': {
            parseGenerateResponse(`<mainQuest>${placeholderConcept(ctx.mode)}${placeholderPlan(ctx.stageCount)}${innerXml(root)}</mainQuest>`, ctx);
            return { xml: innerXml(root) };
        }
        case 'progress': {
            const progress = childText(root, 'progress').toLowerCase();
            parseCheckResponse(`<mainQuestCheck>${innerXml(root)}${progress === 'ending-reached' ? '<ending><endingId></endingId><description>pending</description></ending>' : ''}</mainQuestCheck>`, ctx);
            return { xml: innerXml(root), progress };
        }
        case 'updates':
            parseCheckResponse(`<mainQuestCheck><progress>none</progress>${innerXml(root)}</mainQuestCheck>`, ctx);
            return { xml: innerXml(root) };
        case 'replan':
            parseCheckResponse(`<mainQuestCheck><progress>none</progress>${wrap('replan')}</mainQuestCheck>`, ctx);
            return { xml: wrap('replan') };
        case 'ending':
            parseCheckResponse(`<mainQuestCheck><progress>ending-reached</progress><stageOutcome>pending</stageOutcome>${wrap('ending')}</mainQuestCheck>`, { ...ctx, mainQuest: lastStageView(ctx.mainQuest) });
            return { xml: wrap('ending') };
        case 'pressure':
            parsePressure(root, ctx);
            return { xml: wrap('pressure') };
        default:
            throw new Error(`Unhandled main quest TinyBrain section "${sectionName}".`);
    }
}

const PLACEHOLDER_CLOSURE = '<endings><ending><description>a</description></ending><ending><description>b</description></ending></endings>';

function placeholderConcept(mode) {
    return `<modeChosen>${mode === 'auto' ? 'new' : mode}</modeChosen><title>t</title><premise>p</premise><hiddenTruth>h</hiddenTruth><antagonist><description>a</description></antagonist>`;
}

function placeholderPlan(stageCount) {
    return `<stages>${'<stage><title>t</title><outline>o</outline><exitCondition>e</exitCondition></stage>'.repeat(stageCount)}</stages>`;
}

function lastStageView(mainQuest) {
    // An ending is allowed from any stage; validate it as if on the last stage.
    return Object.assign(Object.create(Object.getPrototypeOf(mainQuest)), mainQuest, { currentStageIndex: mainQuest.stages.length - 1 });
}

function buildTinyBrainGenerateResult({ assignments }) {
    const parts = ['concept', 'plan', 'closure'].map(key => {
        const value = assignments?.[key];
        if (!value?.xml) throw new Error(`Main quest TinyBrain generation is missing its ${key} section.`);
        return value.xml;
    });
    return `<mainQuest>\n${parts.join('\n')}\n</mainQuest>`;
}

function buildTinyBrainCheckResult({ assignments }) {
    const progress = assignments?.progress;
    const updates = assignments?.updates;
    if (!progress?.xml || !updates?.xml) throw new Error('Main quest TinyBrain check is missing its progress or updates section.');
    const parts = [progress.xml, updates.xml];
    for (const key of ['replan', 'ending', 'pressure']) {
        if (assignments?.[key]?.xml) parts.push(assignments[key].xml);
    }
    return `<mainQuestCheck>\n${parts.join('\n')}\n</mainQuestCheck>`;
}

// ---------------------------------------------------------------------------
// Prompt views
// ---------------------------------------------------------------------------

function prominenceFor(turnsSinceProgress) {
    if (turnsSinceProgress >= PROMINENCE_THRESHOLDS.high) return 'high';
    if (turnsSinceProgress >= PROMINENCE_THRESHOLDS.normal) return 'normal';
    return 'low';
}

/** Compact block for ordinary base-context prompts: no hidden truth, future stages or endings. */
function buildBaseContextBlock(mainQuest) {
    if (!mainQuest || mainQuest.status !== 'active') return null;
    const stage = mainQuest.currentStage;
    return {
        title: mainQuest.title,
        premise: mainQuest.premise,
        prominence: prominenceFor(mainQuest.turnsSinceProgress),
        currentStage: stage?.detail?.objective || stage?.title || '',
        exitCondition: stage?.exitCondition || '',
        hiddenDirection: stage?.detail?.hiddenDirection || stage?.outline || '',
        hooks: stage?.detail?.hooks || [],
        lockedFacts: mainQuest.lockedFacts.slice(),
        pressure: mainQuest.pressure.playerFacingText || '',
        roles: mainQuest.roles.filter(role => role.boundTo).map(role => ({ key: role.key, name: role.boundTo.name || role.boundTo.id, type: role.boundTo.type })),
        factionRoles: [
            ...(mainQuest.antagonist.factionId ? [{ factionId: mainQuest.antagonist.factionId, role: `antagonist: ${mainQuest.antagonist.description}` }] : []),
            ...mainQuest.roles.filter(role => role.boundTo?.type === 'faction')
                .map(role => ({ factionId: role.boundTo.id, role: `${role.key}: ${role.description}` }))
        ]
    };
}

/** Full GM view for main-quest prompts. */
function buildFullPromptView(mainQuest, { getQuestById = () => null } = {}) {
    if (!mainQuest) return null;
    return {
        ...mainQuest.toJSON(),
        stageCount: mainQuest.stages.length,
        stages: mainQuest.stages.map((stage, index) => {
            const quest = stage.questId ? getQuestById(stage.questId) : null;
            return {
                ...stage,
                number: index + 1,
                isCurrent: index === mainQuest.currentStageIndex,
                questName: quest?.name || null,
                questCompleted: quest ? Boolean(quest.completed) : null
            };
        })
    };
}

/** Ensures plot analysis always lists the active main quest as a pinned thread. */
function applyPlotAnalysisPin(state, mainQuest) {
    if (!state || typeof state !== 'object') return state;
    const threads = Array.isArray(state.plotThreads) ? state.plotThreads : [];
    if (!mainQuest || mainQuest.status !== 'active') {
        state.plotThreads = threads.map(thread => ({ description: thread.description, isCurrentFocus: thread.isCurrentFocus === true }));
        return state;
    }
    const stage = mainQuest.currentStage;
    const pinned = threads.find(thread => thread.isMainQuest === true || thread.source === 'main-quest');
    const others = threads.filter(thread => thread !== pinned);
    const description = pinned?.description
        || `Main quest — ${mainQuest.title}: ${stage?.detail?.objective || stage?.title || mainQuest.premise}`;
    state.plotThreads = [
        { description, isCurrentFocus: pinned?.isCurrentFocus === true, pinned: true, source: 'main-quest' },
        ...others.map(thread => ({ description: thread.description, isCurrentFocus: thread.isCurrentFocus === true }))
    ];
    return state;
}

function normalizeStartRequest(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Start request must be an object with optional goal and mode.');
    for (const key of Object.keys(raw)) {
        if (!['goal', 'mode'].includes(key)) throw new Error(`Start request has unknown field "${key}". Valid fields: goal, mode.`);
    }
    if (raw.goal !== undefined && raw.goal !== null && typeof raw.goal !== 'string') throw new Error('goal must be a string when provided.');
    const goal = text(raw.goal);
    if (goal.length > MAX_GOAL_LENGTH) throw new Error(`goal must be ${MAX_GOAL_LENGTH} characters or fewer.`);
    const mode = raw.mode === undefined || raw.mode === null || raw.mode === '' ? null : text(raw.mode);
    if (mode !== null && !MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}.`);
    return { goal, mode };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Lifecycle orchestration. Every dependency is injected so tests can drive it
 * without a server:
 *  getConfig(), getPlayer(), getWorldMinute(), getWorldTime(),
 *  runPrompt({ promptType, label, variables, parse }) -> parsed result,
 *  resolvers: { findNpcByName, findFactionByName },
 *  createStageQuest({ mainQuest, stage, summary, giver }) -> Quest,
 *  getQuestById(id), removePlayerQuest(questId),
 *  scheduleEvent({ event, region, location, in }) -> { id },
 *  ScheduledEvent, Tracker,
 *  storeWrapUp({ mainQuest, prose }), storeStageProse({ mainQuest, stage, quest, prose }),
 *  emitUpdate(reason)
 * The runtime never writes saves; all changes, including a declined offer,
 * are saved with the game's next ordinary save or autosave.
 */
function createMainQuestRuntime(deps) {
    let chain = Promise.resolve();
    const exclusive = (operation) => {
        const run = chain.then(operation, operation);
        chain = run.catch(() => {});
        return run;
    };

    const settings = () => resolveConfig(deps.getConfig());
    const requirePlayer = () => {
        const player = deps.getPlayer();
        if (!player) throw new Error('A loaded game with a current player is required for the main quest.');
        return player;
    };

    async function applyPressure(mainQuest, pressure) {
        if (!pressure) return;
        if (pressure.playerFacingText) mainQuest.pressure.playerFacingText = pressure.playerFacingText;
        if (!pressure.deadline || !settings().pressureClockEnabled) {
            mainQuest.touch();
            return;
        }
        const worldMinute = deps.getWorldMinute();
        const worldTime = deps.getWorldTime();
        for (const eventId of mainQuest.pressure.scheduledEventIds) {
            const existing = deps.ScheduledEvent.getById(eventId);
            if (existing && existing.status === 'pending') existing.markSkipped({ worldMinute, worldTime });
        }
        const scheduled = await deps.scheduleEvent({
            event: pressure.deadline.event,
            region: pressure.deadline.region,
            location: pressure.deadline.location,
            in: pressure.deadline.in
        });
        const scheduledEvent = deps.ScheduledEvent.getById(scheduled.id);
        if (scheduledEvent) scheduledEvent.sourceMainQuestId = mainQuest.id;
        mainQuest.pressure.scheduledEventIds = [...mainQuest.pressure.scheduledEventIds, scheduled.id];

        const description = `Hidden main-quest deadline for "${mainQuest.title}". When it runs out: ${pressure.deadline.event}`;
        const trackerId = mainQuest.pressure.trackerIds[0];
        const tracker = trackerId ? deps.Tracker.getById(trackerId) : null;
        if (tracker) {
            tracker.description = description;
            tracker.updateValue(pressure.deadline.in, { worldMinute });
        } else {
            const created = new deps.Tracker({
                name: `${mainQuest.title} deadline`,
                type: 'countdown',
                value: pressure.deadline.in,
                hiddenFromPlayer: true,
                description,
                lastUpdatedWorldMinute: worldMinute,
                deriveCountdownUntilWorldMinute: true,
                sourceMainQuestId: mainQuest.id
            });
            mainQuest.pressure.trackerIds = [created.id];
        }
        mainQuest.touch();
    }

    function stopPressure(mainQuest) {
        const worldMinute = deps.getWorldMinute();
        const worldTime = deps.getWorldTime();
        for (const eventId of mainQuest.pressure.scheduledEventIds) {
            const event = deps.ScheduledEvent.getById(eventId);
            if (event && event.status === 'pending' && event.sourceMainQuestId === mainQuest.id) {
                event.markSkipped({ worldMinute, worldTime });
            }
        }
        for (const trackerId of mainQuest.pressure.trackerIds) {
            const tracker = deps.Tracker.getById(trackerId);
            if (tracker && tracker.sourceMainQuestId === mainQuest.id) deps.Tracker.removeById(trackerId);
        }
        mainQuest.pressure.trackerIds = [];
        mainQuest.touch();
    }

    /** previousStage: { title, outcome, questCompleted } when advancing from an earlier stage, else null. */
    async function startStage(mainQuest, { previousStage = null } = {}) {
        const stage = mainQuest.currentStage;
        const next = mainQuest.nextStage;
        const result = await deps.runPrompt({
            promptType: 'main-quest-stage',
            label: 'main_quest_stage',
            variables: {
                mainQuestFull: buildFullPromptView(mainQuest, deps),
                mainQuestStageNumber: mainQuest.currentStageIndex + 1,
                mainQuestHasNextStage: Boolean(next),
                mainQuestPreviousStage: previousStage,
                mainQuestPressureEnabled: settings().pressureClockEnabled
            },
            parse: raw => parseStageResponse(raw, {
                hasNextStage: Boolean(next),
                mainQuest,
                resolvers: deps.resolvers,
                pressureEnabled: settings().pressureClockEnabled
            })
        });
        mainQuest.setStageDetail(stage.id, result.current);
        if (next && result.next) mainQuest.setStageDetail(next.id, result.next);
        for (const binding of result.bindings) mainQuest.bindRole(binding.key, binding.boundTo, `Bound when stage ${mainQuest.currentStageIndex + 1} began.`);
        await applyPressure(mainQuest, result.pressure);
        const quest = await deps.createStageQuest({ mainQuest, stage, summary: result.quest.summary, giver: result.quest.giver });
        if (!quest?.id) throw new Error(`Stage ${mainQuest.currentStageIndex + 1} quest was not created.`);
        stage.questId = quest.id;
        stage.status = 'active';
        mainQuest.turnsSinceProgress = 0;
        mainQuest.touch();
        await deps.storeStageProse({ mainQuest, stage, quest, prose: result.prose });
        return quest;
    }

    async function start(request = {}) {
        const { goal, mode: requestedMode } = normalizeStartRequest(request);
        return exclusive(async () => {
            const config = settings();
            if (!config.enabled) throw new Error('The main quest is disabled (main_quest.enabled is false).');
            requirePlayer();
            const active = MainQuest.getActive();
            if (active) throw new Error(`Main quest "${active.title}" is already active. Abandon it before starting another.`);
            const offer = MainQuest.getOffer();
            const previous = offer.followUpOf ? MainQuest.getById(offer.followUpOf)
                : (MainQuest.getAll().filter(entry => entry.status !== 'active').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0] || null);
            const requested = requestedMode || 'new';
            if (requested === 'sequel' && !previous) throw new Error('A sequel needs an earlier main quest; there is none in this save.');
            const mode = requested === 'auto' && !previous ? 'new' : requested;

            const generated = await deps.runPrompt({
                promptType: 'main-quest-generate',
                label: 'main_quest_generate',
                variables: {
                    mainQuestGeneration: {
                        playerGoal: goal,
                        mode,
                        stageCount: config.stageCount,
                        pressureEnabled: config.pressureClockEnabled,
                        previous: mode === 'new' ? null : (previous ? buildFullPromptView(previous, deps) : null)
                    }
                },
                parse: raw => parseGenerateResponse(raw, {
                    stageCount: config.stageCount,
                    mode,
                    resolvers: deps.resolvers,
                    pressureEnabled: config.pressureClockEnabled
                })
            });
            if (MainQuest.getActive()) throw new Error('Another main quest became active while this one was generated; nothing was changed.');
            const mainQuest = new MainQuest({
                title: generated.title,
                playerGoal: goal || null,
                premise: generated.premise,
                hiddenTruth: generated.hiddenTruth,
                antagonist: generated.antagonist,
                roles: generated.roles,
                stages: generated.stages,
                endings: generated.endings,
                mode: generated.mode,
                previousMainQuestId: generated.mode === 'sequel' ? previous?.id || null : null
            });
            try {
                await applyPressure(mainQuest, generated.pressure);
                await startStage(mainQuest);
            } catch (error) {
                stopPressure(mainQuest);
                mainQuest.status = 'abandoned';
                mainQuest.completedAt = new Date().toISOString();
                MainQuest.removeById(mainQuest.id);
                throw error;
            }
            MainQuest.setOffer({ state: 'started' });
            deps.emitUpdate('started');
            return mainQuest;
        });
    }

    async function finish(mainQuest, ending) {
        mainQuest.status = 'completed';
        mainQuest.reachedEnding = ending;
        mainQuest.completedAt = new Date().toISOString();
        stopPressure(mainQuest);
        const wrapUp = await deps.runPrompt({
            promptType: 'main-quest-wrapup',
            label: 'main_quest_wrapup',
            variables: { mainQuestFull: buildFullPromptView(mainQuest, deps) },
            parse: parseWrapupResponse
        });
        await deps.storeWrapUp({ mainQuest, prose: wrapUp.prose });
        MainQuest.setOffer({ state: 'pending', followUpOf: mainQuest.id });
    }

    async function runCheck({ reason = 'interval', signal = null } = {}) {
        return exclusive(async () => {
            if (!settings().enabled) return null;
            const mainQuest = MainQuest.getActive();
            if (!mainQuest) return null;
            requirePlayer();
            const config = settings();
            const result = await deps.runPrompt({
                promptType: 'main-quest-check',
                label: 'main_quest_check',
                variables: {
                    mainQuestFull: buildFullPromptView(mainQuest, deps),
                    mainQuestCheckReason: reason,
                    mainQuestCheckSignal: signal ? { kind: signal.kind, evidence: signal.evidence } : null,
                    mainQuestPressureEnabled: config.pressureClockEnabled
                },
                parse: raw => parseCheckResponse(raw, { mainQuest, resolvers: deps.resolvers, pressureEnabled: config.pressureClockEnabled })
            });
            if (MainQuest.getActive() !== mainQuest) return null;

            if (result.newLockedFacts.length) mainQuest.addLockedFacts(result.newLockedFacts);
            for (const recast of result.recasts) mainQuest.bindRole(recast.key, recast.boundTo, recast.reason);
            if (result.replan?.stages) mainQuest.replanFutureStages(result.replan.stages);
            if (result.replan?.endings) mainQuest.replaceEndings(result.replan.endings);
            await applyPressure(mainQuest, result.pressure);

            let previousStage = null;
            if (result.progress !== 'none') {
                const stage = mainQuest.currentStage;
                const stageQuest = stage.questId ? deps.getQuestById(stage.questId) : null;
                previousStage = { title: stage.title, outcome: result.stageOutcome, questCompleted: Boolean(stageQuest?.completed) };
                stage.status = 'completed';
                stage.outcome = result.stageOutcome;
                mainQuest.recordOutcome(stage.id, result.stageOutcome, deps.getWorldMinute());
                if (stage.questId) {
                    // The stage was resolved another way; its unfinished quest no longer applies.
                    const quest = deps.getQuestById(stage.questId);
                    if (quest && !quest.completed) deps.removePlayerQuest(stage.questId);
                }
            }
            if (result.progress === 'stage-complete') {
                mainQuest.currentStageIndex += 1;
                await startStage(mainQuest, { previousStage });
            } else if (result.progress === 'ending-reached') {
                for (const stage of mainQuest.stages) {
                    if (stage.status === 'pending' || stage.status === 'active') stage.status = 'skipped';
                }
                await finish(mainQuest, result.ending);
            }
            mainQuest.touch();
            deps.emitUpdate(result.progress === 'none' ? 'checked' : result.progress);
            return result;
        });
    }

    async function abandon() {
        return exclusive(async () => {
            const mainQuest = MainQuest.getActive();
            if (!mainQuest) throw new Error('There is no active main quest to abandon.');
            const stage = mainQuest.currentStage;
            if (stage?.questId) {
                const quest = deps.getQuestById(stage.questId);
                if (quest && !quest.completed) deps.removePlayerQuest(stage.questId);
            }
            for (const entry of mainQuest.stages) {
                if (entry.status === 'pending' || entry.status === 'active') entry.status = 'skipped';
            }
            stopPressure(mainQuest);
            mainQuest.status = 'abandoned';
            mainQuest.completedAt = new Date().toISOString();
            MainQuest.setOffer({ state: 'declined' });
            mainQuest.touch();
            deps.emitUpdate('abandoned');
            return mainQuest;
        });
    }

    async function declineOffer() {
        return exclusive(async () => {
            if (MainQuest.getOffer().state !== 'pending') return MainQuest.getOffer();
            MainQuest.setOffer({ state: 'declined' });
            deps.emitUpdate('declined');
            return MainQuest.getOffer();
        });
    }

    let pendingSignal = null;

    /**
     * Records the event checker's cheap <mainQuestProgress> gate. The full
     * check runs at the end of the turn; several signals in one turn merge.
     */
    function noteProgressSignal({ kind, evidence }) {
        const mainQuest = MainQuest.getActive();
        if (!settings().enabled || !mainQuest) return false;
        const evidenceList = pendingSignal?.mainQuestId === mainQuest.id ? pendingSignal.evidence : [];
        pendingSignal = {
            mainQuestId: mainQuest.id,
            kind: kind === 'ending' || pendingSignal?.kind === 'ending' ? 'ending' : 'stage-complete',
            evidence: [...evidenceList, text(evidence)].filter(Boolean)
        };
        return true;
    }

    /**
     * Called once per completed player-action turn. Returns { reason, signal }
     * for the full check to run, or null. A completed stage quest needs no
     * model call to detect; an event-checker signal or the full-check interval
     * triggers the rest.
     */
    function noteCompletedTurn() {
        const config = settings();
        const mainQuest = MainQuest.getActive();
        const signal = pendingSignal?.mainQuestId === mainQuest?.id ? pendingSignal : null;
        pendingSignal = null;
        if (!config.enabled || !mainQuest) return null;
        mainQuest.turnsSinceProgress += 1;
        const stage = mainQuest.currentStage;
        const quest = stage?.questId ? deps.getQuestById(stage.questId) : null;
        if (quest && quest.completed) return { reason: 'stage-quest-completed', signal };
        if (signal) return { reason: 'event-signal', signal };
        return mainQuest.turnsSinceProgress % config.fullCheckInterval === 0 ? { reason: 'interval', signal: null } : null;
    }

    return { start, runCheck, abandon, declineOffer, noteCompletedTurn, noteProgressSignal, applyPressure, stopPressure };
}

module.exports = {
    MODES,
    PROMINENCE_THRESHOLDS,
    resolveConfig,
    parseGenerateResponse,
    parseStageResponse,
    parseCheckResponse,
    parseWrapupResponse,
    parseProgressSignal,
    PROGRESS_SIGNAL_SCHEMA,
    prominenceFor,
    buildBaseContextBlock,
    buildFullPromptView,
    applyPlotAnalysisPin,
    normalizeStartRequest,
    TINY_BRAIN_SECTIONS,
    parseTinyBrainSection,
    buildTinyBrainGenerateResult,
    buildTinyBrainCheckResult,
    createMainQuestRuntime
};
