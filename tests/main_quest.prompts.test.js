const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const MainQuest = require('../MainQuest.js');
const Service = require('../MainQuestService.js');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });

const resolvers = {
    findNpcByName: name => ({ Vey: { id: 'char_vey', name: 'Vey', isNPC: true }, Ghost: { id: 'char_ghost', name: 'Ghost', isDead: true } })[name] || null,
    findFactionByName: name => (name === 'Ashen Guild' ? { id: 'faction_ashen', name: 'Ashen Guild' } : null)
};

test.afterEach(() => MainQuest.clear());

const stageXml = n => Array.from({ length: n }, (_, index) =>
    `<stage><title>S${index + 1}</title><outline>O${index + 1}</outline><exitCondition>E${index + 1}</exitCondition></stage>`).join('');

function generateXml({ stages = 3, endings = 2, mode = 'new', antagonist = '<factionName>Ashen Guild</factionName>', roles = '', pressure = '' } = {}) {
    return `Thinking first.\n<mainQuest><modeChosen>${mode}</modeChosen><title>The Drowned Choir</title><premise>Bells ring.</premise>
<hiddenTruth>The harbor master leads them.</hiddenTruth><antagonist><description>A cult.</description>${antagonist}</antagonist>
<roles>${roles}</roles><stages>${stageXml(stages)}</stages>
<endings>${'<ending><description>An end.</description></ending>'.repeat(endings)}</endings>${pressure}</mainQuest>`;
}

test('generate parser validates counts, names and auto mode', () => {
    const ctx = { stageCount: 3, mode: 'new', resolvers, pressureEnabled: true };
    const parsed = Service.parseGenerateResponse(generateXml({
        roles: '<role><key>informant</key><description>Knows things.</description><boundTo><type>npc</type><name>Vey</name></boundTo></role>',
        pressure: '<pressure><playerFacingText>The bells grow louder.</playerFacingText><deadline><in>3 days</in><event>The choir floods the docks.</event><region>Harbor</region><location>Docks</location></deadline></pressure>'
    }), ctx);
    assert.equal(parsed.antagonist.factionId, 'faction_ashen');
    assert.deepEqual(parsed.roles[0].boundTo, { type: 'npc', id: 'char_vey', name: 'Vey' });
    assert.equal(parsed.pressure.deadline.in, '3 days');
    assert.throws(() => Service.parseGenerateResponse(generateXml({ stages: 2 }), ctx), /exactly 3 <stage>/);
    assert.throws(() => Service.parseGenerateResponse(generateXml({ endings: 4 }), ctx), /2 or 3 <ending>/);
    assert.throws(() => Service.parseGenerateResponse(generateXml({ antagonist: '<factionName>Nobody</factionName>' }), ctx), /not an existing faction/);
    assert.throws(() => Service.parseGenerateResponse(generateXml({ roles: '<role><key>x</key><description>d</description><boundTo><type>npc</type><name>Ghost</name></boundTo></role>' }), ctx), /is dead/);
    assert.throws(() => Service.parseGenerateResponse(generateXml({ mode: 'whatever' }), { ...ctx, mode: 'auto' }), /<modeChosen> must be "new" or "sequel"/);
    assert.equal(Service.parseGenerateResponse(generateXml({ mode: 'sequel' }), { ...ctx, mode: 'auto' }).mode, 'sequel');
    assert.throws(() => Service.parseGenerateResponse(generateXml({
        pressure: '<pressure><deadline><in>soon</in><event>x</event><region>r</region><location>l</location></deadline></pressure>'
    }), ctx), /not a valid duration/);
    const noPressure = Service.parseGenerateResponse(generateXml({
        pressure: '<pressure><deadline><in>soon</in><event>x</event></deadline></pressure>'
    }), { ...ctx, pressureEnabled: false });
    assert.equal(noPressure.pressure.deadline, null, 'deadlines are ignored when the pressure clock is off');
});

function activeQuest() {
    return new MainQuest({
        title: 'The Drowned Choir', premise: 'p', hiddenTruth: 'h', antagonist: { description: 'a' },
        roles: [{ key: 'informant', description: 'd' }],
        stages: [1, 2, 3].map(n => ({ title: `S${n}`, outline: 'o', exitCondition: 'e' })),
        endings: [{ description: 'Silenced.' }, { description: 'Flooded.' }]
    });
}

test('stage parser requires next-stage detail only when a stage follows and checks role keys', () => {
    const mainQuest = activeQuest();
    const ctx = { hasNextStage: true, mainQuest, resolvers, pressureEnabled: true };
    const detail = tag => `<${tag}><objective>Find the bells.</objective><hiddenDirection>Under the pier.</hiddenDirection><hooks><hook>A drowned sailor.</hook></hooks></${tag}>`;
    const parsed = Service.parseStageResponse(`<mainQuestStage>${detail('currentStage')}${detail('nextStage')}
<roleBindings><binding><role>Informant</role><type>npc</type><name>Vey</name></binding></roleBindings>
<prose>A bell tolls.</prose><quest><summary>Find the bells.</summary><giver>Vey</giver></quest></mainQuestStage>`, ctx);
    assert.equal(parsed.prose, 'A bell tolls.');
    assert.equal(parsed.bindings[0].key, 'informant');
    assert.equal(parsed.quest.giver, 'Vey');
    assert.throws(() => Service.parseStageResponse(`<mainQuestStage>${detail('currentStage')}<quest><summary>x</summary></quest></mainQuestStage>`, ctx), /needs <nextStage>/);
    assert.throws(() => Service.parseStageResponse(`<mainQuestStage>${detail('currentStage')}${detail('nextStage')}<roleBindings><binding><role>traitor</role><type>npc</type><name>Vey</name></binding></roleBindings><quest><summary>x</summary></quest></mainQuestStage>`, ctx), /not a role of this main quest/);
});

test('check parser enforces the final-stage rule, replan counts and ending ids', () => {
    const mainQuest = activeQuest();
    const ctx = { mainQuest, resolvers, pressureEnabled: true };
    const none = Service.parseCheckResponse('<mainQuestCheck><progress>none</progress></mainQuestCheck>', ctx);
    assert.equal(none.progress, 'none');
    assert.throws(() => Service.parseCheckResponse('<mainQuestCheck><progress>stage-complete</progress></mainQuestCheck>', ctx), /<stageOutcome> is required/);
    assert.throws(() => Service.parseCheckResponse(`<mainQuestCheck><progress>none</progress><replan><stages>${stageXml(1)}</stages></replan></mainQuestCheck>`, ctx), /exactly 2 stages/);
    const replanned = Service.parseCheckResponse(`<mainQuestCheck><progress>none</progress><replan><stages>${stageXml(2)}</stages></replan></mainQuestCheck>`, ctx);
    assert.equal(replanned.replan.stages.length, 2);
    assert.throws(() => Service.parseCheckResponse('<mainQuestCheck><progress>ending-reached</progress><stageOutcome>Done.</stageOutcome><ending><endingId>ending_9</endingId><description>x</description></ending></mainQuestCheck>', ctx), /not a planned ending/);
    const unplanned = Service.parseCheckResponse('<mainQuestCheck><progress>ending-reached</progress><stageOutcome>Done.</stageOutcome><ending><endingId></endingId><description>The choir was bargained with.</description></ending></mainQuestCheck>', ctx);
    assert.deepEqual(unplanned.ending, { endingId: null, description: 'The choir was bargained with.' });
    mainQuest.currentStageIndex = 2;
    assert.throws(() => Service.parseCheckResponse('<mainQuestCheck><progress>stage-complete</progress><stageOutcome>x</stageOutcome></mainQuestCheck>', ctx), /use ending-reached/);
});

test('TinyBrain sections validate independently and assemble into parseable documents', () => {
    const genCtx = { stageCount: 2, mode: 'auto', resolvers, pressureEnabled: true };
    const concept = Service.parseTinyBrainSection('<mainQuestConcept><modeChosen>new</modeChosen><title>T</title><premise>P</premise><hiddenTruth>H</hiddenTruth><antagonist><description>A</description></antagonist></mainQuestConcept>', 'concept', genCtx);
    assert.throws(() => Service.parseTinyBrainSection(`<mainQuestPlan><stages>${stageXml(3)}</stages></mainQuestPlan>`, 'plan', genCtx), /exactly 2 <stage>/);
    const plan = Service.parseTinyBrainSection(`<mainQuestPlan><roles></roles><stages>${stageXml(2)}</stages></mainQuestPlan>`, 'plan', genCtx);
    const closure = Service.parseTinyBrainSection('<mainQuestClosure><endings><ending><description>a</description></ending><ending><description>b</description></ending></endings></mainQuestClosure>', 'closure', genCtx);
    const generated = Service.parseGenerateResponse(Service.buildTinyBrainGenerateResult({ assignments: { concept, plan, closure } }), genCtx);
    assert.equal(generated.stages.length, 2);

    const mainQuest = activeQuest();
    const checkCtx = { mainQuest, resolvers, pressureEnabled: true };
    const progress = Service.parseTinyBrainSection('<mainQuestProgress><progress>ending-reached</progress><stageOutcome>Over.</stageOutcome></mainQuestProgress>', 'progress', checkCtx);
    assert.equal(progress.progress, 'ending-reached');
    const updates = Service.parseTinyBrainSection('<mainQuestUpdates><newLockedFacts><fact>Bells are real.</fact></newLockedFacts></mainQuestUpdates>', 'updates', checkCtx);
    const ending = Service.parseTinyBrainSection('<mainQuestEnding><endingId>ending_1</endingId><description>Silenced.</description></mainQuestEnding>', 'ending', checkCtx);
    const checked = Service.parseCheckResponse(Service.buildTinyBrainCheckResult({ assignments: { progress, updates, ending } }), { ...checkCtx, mainQuest: Object.assign(activeQuestView(mainQuest)) });
    assert.equal(checked.ending.endingId, 'ending_1');
    assert.deepEqual(checked.newLockedFacts, ['Bells are real.']);
});

function activeQuestView(mainQuest) {
    return mainQuest;
}

test('prompt templates render main quest state, block and tasks', () => {
    const mainQuest = activeQuest();
    mainQuest.setStageDetail('stage_1', { objective: 'Find the bells.', hiddenDirection: 'Under the pier.', hooks: ['A sailor'] });
    const full = Service.buildFullPromptView(mainQuest);
    const stage = env.render('_includes/main-quest-stage.njk', { mainQuestFull: full, mainQuestStageNumber: 1, mainQuestHasNextStage: true, mainQuestPressureEnabled: true });
    assert.match(stage, /This is the first stage/);
    assert.match(stage, /<prose>/);
    const advanced = env.render('_includes/main-quest-stage.njk', { mainQuestFull: full, mainQuestStageNumber: 2, mainQuestHasNextStage: true, mainQuestPressureEnabled: true,
        mainQuestPreviousStage: { title: 'S1', outcome: 'Found the bells.', questCompleted: true } });
    assert.match(advanced, /"S1", just concluded and its quest was completed: Found the bells\. If the recent story does not already show that conclusion/);
    assert.match(stage, /<hiddenTruth>h<\/hiddenTruth>/);
    assert.match(stage, /<nextStage>/);
    assert.match(stage, /<deadline>/);
    const check = env.render('_includes/main-quest-check.njk', { mainQuestFull: full, mainQuestCheckReason: 'stage-quest-completed', mainQuestPressureEnabled: false });
    assert.match(check, /quest has just been completed/);
    assert.doesNotMatch(check, /<deadline>/);
    const generate = env.render('_includes/main-quest-generate.njk', {
        mainQuestGeneration: { playerGoal: 'Find my sister.', mode: 'auto', stageCount: 8, pressureEnabled: true, previous: full }
    });
    assert.match(generate, /Find my sister\./);
    assert.match(generate, /Exactly 8 stages/);
    assert.match(generate, /<modeChosen>new\|sequel<\/modeChosen>/);
    assert.match(generate, /Earlier main quest/);
    const block = env.render('_includes/main-quest-block.njk', { mainQuest: Service.buildBaseContextBlock(mainQuest) });
    assert.match(block, /prominence="low"/);
    assert.match(block, /<currentStage>Find the bells\.<\/currentStage>/);
    assert.doesNotMatch(block, /hiddenTruth|Flooded/);
    const wrapup = env.render('_includes/main-quest-wrapup.njk', { mainQuestFull: { ...full, reachedEnding: { description: 'Silenced.' } } });
    assert.match(wrapup, /has ended: Silenced\./);
});

async function runTinyBrainProgram(programTemplateName, variables, responses, sectionContext) {
    const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');
    const promptEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false });
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { ...variables, __tinyBrainState: renderState };
    const initial = promptEnv.renderString(`{{ __tinyBrainState.programStartMarker }}{% include "${programTemplateName}" %}`, templateContext);
    const seen = [];
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: program => ({ systemPrompt: 'system', generationPrompt: program }),
        retryAttempts: 0,
        toolDefinitions: [],
        metadataLabel: 'main_quest_test',
        logPrefix: 'main_quest_test',
        logPrompt: () => path.join(__dirname, '..', 'tmp', 'main-quest-tinybrain-test.log'),
        parsers: { main_quest_section: (response, name) => ({ value: Service.parseTinyBrainSection(response, name, sectionContext) }) },
        parserOutputContracts: { main_quest_section: name => ({ expectedXmlRootTag: Service.TINY_BRAIN_SECTIONS[name].root }) },
        resultBuilders: {
            main_quest_generate_result: Service.buildTinyBrainGenerateResult,
            main_quest_check_result: Service.buildTinyBrainCheckResult
        },
        complete: async ({ messages, checkpoint }) => {
            seen.push(checkpoint.parserName + (checkpoint.parserArgs?.[0] ? `:${checkpoint.parserArgs[0]}` : ''));
            const aiResponse = responses.shift();
            assert.ok(aiResponse, `unexpected extra stage ${seen.at(-1)}`);
            return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
        }
    });
    const result = await runner.run({ initialRenderedTemplate: initial, templateContext, renderState, programTemplateName });
    return { result, seen };
}

test('TinyBrain generate program runs three validated stages into a full main quest', async () => {
    const ctx = { stageCount: 2, mode: 'new', resolvers, pressureEnabled: true };
    const { result, seen } = await runTinyBrainProgram('_includes/main-quest-generate.tinybrain.njk', {
        mainQuestGeneration: { playerGoal: 'Find my sister.', mode: 'new', stageCount: 2, pressureEnabled: true, previous: null }
    }, [
        '<mainQuestConcept><modeChosen>new</modeChosen><title>T</title><premise>P</premise><hiddenTruth>H</hiddenTruth><antagonist><description>A</description></antagonist></mainQuestConcept>',
        `<mainQuestPlan><roles></roles><stages>${stageXml(2)}</stages></mainQuestPlan>`,
        '<mainQuestClosure><endings><ending><description>a</description></ending><ending><description>b</description></ending></endings><pressure><playerFacingText>Rumours spread.</playerFacingText></pressure></mainQuestClosure>'
    ], ctx);
    assert.deepEqual(seen, ['main_quest_section:concept', 'main_quest_section:plan', 'main_quest_section:closure']);
    const parsed = Service.parseGenerateResponse(result.aiResponse, ctx);
    assert.equal(parsed.title, 'T');
    assert.equal(parsed.pressure.playerFacingText, 'Rumours spread.');
});

test('TinyBrain check program branches on progress and replan answers', async () => {
    const mainQuest = activeQuest();
    const ctx = { mainQuest, resolvers, pressureEnabled: false };
    const variables = { mainQuestFull: Service.buildFullPromptView(mainQuest), mainQuestCheckReason: 'interval', mainQuestPressureEnabled: false };
    const replanned = await runTinyBrainProgram('_includes/main-quest-check.tinybrain.njk', variables, [
        '<mainQuestProgress><progress>none</progress><stageOutcome></stageOutcome></mainQuestProgress>',
        '<mainQuestUpdates><newLockedFacts></newLockedFacts><recast></recast></mainQuestUpdates>',
        'yes',
        `<mainQuestReplan><stages>${stageXml(2)}</stages></mainQuestReplan>`,
        '<mainQuestPressure><playerFacingText></playerFacingText></mainQuestPressure>'
    ], ctx);
    assert.deepEqual(replanned.seen, ['main_quest_section:progress', 'main_quest_section:updates', 'yes_no', 'main_quest_section:replan', 'main_quest_section:pressure']);
    assert.equal(Service.parseCheckResponse(replanned.result.aiResponse, ctx).replan.stages.length, 2);

    const ended = await runTinyBrainProgram('_includes/main-quest-check.tinybrain.njk', variables, [
        '<mainQuestProgress><progress>ending-reached</progress><stageOutcome>It ended early.</stageOutcome></mainQuestProgress>',
        '<mainQuestUpdates><newLockedFacts></newLockedFacts><recast></recast></mainQuestUpdates>',
        '<mainQuestEnding><endingId></endingId><description>A truce.</description></mainQuestEnding>',
        '<mainQuestPressure><playerFacingText></playerFacingText></mainQuestPressure>'
    ], ctx);
    assert.deepEqual(ended.seen, ['main_quest_section:progress', 'main_quest_section:updates', 'main_quest_section:ending', 'main_quest_section:pressure']);
    assert.deepEqual(Service.parseCheckResponse(ended.result.aiResponse, ctx).ending, { endingId: null, description: 'A truce.' });
});

test('prominence rises with turns since progress', () => {
    assert.equal(Service.prominenceFor(0), 'low');
    assert.equal(Service.prominenceFor(Service.PROMINENCE_THRESHOLDS.normal), 'normal');
    assert.equal(Service.prominenceFor(Service.PROMINENCE_THRESHOLDS.high), 'high');
});

test('plot analysis pin is inserted once and replaced when the model marks the thread', () => {
    const mainQuest = activeQuest();
    const state = Service.applyPlotAnalysisPin({ plotThreads: [{ description: 'A heist.', isCurrentFocus: true }] }, mainQuest);
    assert.equal(state.plotThreads.length, 2);
    assert.deepEqual(state.plotThreads[0].pinned, true);
    assert.match(state.plotThreads[0].description, /Main quest — The Drowned Choir/);
    const marked = Service.applyPlotAnalysisPin({ plotThreads: [{ description: 'Silence the choir.', isMainQuest: true, isCurrentFocus: true }, { description: 'A heist.' }] }, mainQuest);
    assert.equal(marked.plotThreads.length, 2);
    assert.equal(marked.plotThreads[0].description, 'Silence the choir.');
    assert.equal(marked.plotThreads[0].isCurrentFocus, true);
    const noQuest = Service.applyPlotAnalysisPin({ plotThreads: [{ description: 'A heist.', isMainQuest: true }] }, null);
    assert.deepEqual(noQuest.plotThreads, [{ description: 'A heist.', isCurrentFocus: false }]);
});

test('config and start request validation', () => {
    assert.deepEqual(Service.resolveConfig({}), { enabled: true, stageCount: 8, fullCheckInterval: 12, pressureClockEnabled: true });
    assert.throws(() => Service.resolveConfig({ main_quest: { full_check_interval: 0 } }), /full_check_interval must be a whole number of 1 or more/);
    assert.throws(() => Service.resolveConfig({ main_quest: { stage_count: 0 } }), /stage_count must be a whole number of 1 or more/);
    assert.throws(() => Service.resolveConfig({ main_quest: { enabled: 'yes' } }), /enabled must be true or false/);
    assert.deepEqual(Service.normalizeStartRequest({ goal: '  Find her. ', mode: 'auto' }), { goal: 'Find her.', mode: 'auto' });
    assert.throws(() => Service.normalizeStartRequest({ mode: 'epic' }), /mode must be one of: new, sequel, auto/);
    assert.throws(() => Service.normalizeStartRequest({ goal: 'x', extra: 1 }), /unknown field "extra"/);
});

test('main quest stage quests do not count toward the soft quest limit', () => {
    const rendered = env.renderString("{{ (currentPlayer.currentQuests or []) | rejectattr('questLineId') | length }}", {
        currentPlayer: { currentQuests: [{ name: 'Side' }, { name: 'Stage', questLineId: 'mquest_x' }] }
    });
    assert.equal(rendered, '1');
    const fs = require('node:fs');
    for (const template of ['base-context.xml.njk', '_includes/player-action.njk', '_includes/events-xml-schema.njk', '_includes/player-action.tinybrain.njk']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'prompts', template), 'utf8');
        assert.doesNotMatch(source, /currentPlayer\.currentQuests \| length/, `${template} must exclude main quest stages from the soft limit`);
    }
});

test('event-checker progress gate: parser, schema, and prompt wiring', () => {
    assert.deepEqual(Service.parseProgressSignal('{"value":"Stage-Complete","evidence":"The key was handed over."}'), { kind: 'stage-complete', evidence: 'The key was handed over.' });
    assert.throws(() => Service.parseProgressSignal('{"value":"partial","evidence":"x"}'), /must be one of: stage-complete, ending/);
    assert.throws(() => Service.parseProgressSignal('{"value":"ending"}'), /needs <evidence>/);
    assert.match(Service.PROGRESS_SIGNAL_SCHEMA.description, /exitCondition/);
    const mainQuest = activeQuest();
    const block = env.render('_includes/main-quest-block.njk', { mainQuest: Service.buildBaseContextBlock(mainQuest) });
    assert.match(block, /<stageExitCondition>e<\/stageExitCondition>/);
    const check = env.render('_includes/main-quest-check.njk', {
        mainQuestFull: Service.buildFullPromptView(mainQuest), mainQuestCheckReason: 'event-signal', mainQuestPressureEnabled: false,
        mainQuestCheckSignal: { kind: 'stage-complete', evidence: ['A key changed hands.'] }
    });
    assert.match(check, /current stage's exitCondition may have been met: A key changed hands\. Confirm this against the story/);
});
