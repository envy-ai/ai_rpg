const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const playerActionPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'player-action.njk'), 'utf8');
const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));
const localConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.yaml'), 'utf8'));

test('plot analysis is scheduled once after turn resolution and finalization', () => {
    const chatStart = apiSource.indexOf("const promptMetadataLabel = promptType === 'question'");
    const responseIndex = apiSource.indexOf('const aiResponseEntryType = isQuestionAction', chatStart);
    const eventIndex = apiSource.indexOf("stream.status('player_action:event_checks'", responseIndex);
    const npcIndex = apiSource.indexOf('await executeNpcTurnsAfterPlayer({', eventIndex);
    const randomIndex = apiSource.indexOf('await withProcessedMoveSuspended(() => processRandomEvents({', npcIndex);
    const finalizeIndex = apiSource.indexOf('player.finalizeTurn();', randomIndex);
    const scheduleIndex = apiSource.indexOf('schedulePlotAnalysisPrompt({', chatStart);
    const completeIndex = apiSource.indexOf("stream.status('player_action:complete'", finalizeIndex);
    assert.ok(chatStart >= 0 && responseIndex > chatStart && eventIndex > responseIndex && npcIndex > eventIndex && randomIndex > npcIndex && finalizeIndex > randomIndex);
    assert.ok(scheduleIndex > finalizeIndex && scheduleIndex < completeIndex, 'schedule only after resolved events and final turn state');
    assert.equal((apiSource.slice(chatStart, completeIndex).match(/schedulePlotAnalysisPrompt\(\{/g) || []).length, 1);
    const block = apiSource.slice(finalizeIndex, completeIndex);
    assert.match(block, /promptMetadataLabel === 'player_action'/);
    assert.match(block, /Globals\.location/);
    assert.match(block, /locationOverride:/);
    assert.match(block, /locationId:/);
});

test('plot scheduler observes interval and starts background work without awaiting it', async () => {
    const vm = require('node:vm');
    const start = apiSource.indexOf('function schedulePlotAnalysisPrompt(');
    const end = apiSource.indexOf('\n        function runSupplementalStoryInfo', start);
    assert.ok(start >= 0 && end > start);
    const pending = [], calls = [];
    let enabled = true, finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const context = { isPlotAnalysisPromptEnabled: () => enabled, plotAnalysisTurnCounter: 0, resolvePlotAnalysisPromptInterval: () => 2, plotAnalysisPromptSequence: 0, plotAnalysisPromptToken: 'token',
        PromptAuditLog: { reserveWork: () => ({ run: callback => callback(), release() {} }), recordFailure() {} },
        setImmediate: callback => pending.push(callback), runPlotAnalysisPrompt: options => { calls.push(options); return gate; } };
    vm.runInNewContext(`${apiSource.slice(start, end)}\nthis.schedule = schedulePlotAnalysisPrompt;`, context);
    enabled = false; assert.equal(context.schedule({ locationId: 'ignored' }), false);
    enabled = true; assert.equal(context.schedule({ locationId: 'origin' }), false);
    assert.equal(context.schedule({ locationOverride: { id: 'destination' }, locationId: 'destination', sourceRequestId: 'turn-1' }), true);
    assert.equal(calls.length, 0); assert.equal(pending.length, 1);
    pending[0]();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].locationId, 'destination');
    assert.equal(calls[0].locationOverride.id, 'destination');
    assert.equal(calls[0].sourceRequestId, 'turn-1');
    finish(); await gate;
});

test('tiny-brain player action delegates shared queue and progress lifecycle to the runner', () => {
    const promptAwaitIndex = apiSource.indexOf("stream.status('player_action:prompt', 'Awaiting response from AI...');");
    const tinyBrainBranchStart = apiSource.indexOf('if (useTinyBrainPlayerAction) {', promptAwaitIndex);
    const regularToolLoopBranch = apiSource.indexOf('} else if (Array.isArray(promptChatTools)', tinyBrainBranchStart);
    assert.notEqual(tinyBrainBranchStart, -1, 'Unable to locate tiny-brain player-action branch.');
    assert.notEqual(regularToolLoopBranch, -1, 'Unable to locate the end of the tiny-brain player-action branch.');

    const tinyBrainBranch = apiSource.slice(tinyBrainBranchStart, regularToolLoopBranch);
    const configureIndex = apiSource.indexOf('tinyBrainPromptConfig = configureTinyBrainPromptContext(');
    assert.notEqual(configureIndex, -1, 'Unable to locate tiny-brain player-action context configuration.');
    assert.ok(configureIndex < tinyBrainBranchStart, 'tiny-brain context must be configured while rendering, before execution.');
    assert.match(
        tinyBrainBranch,
        /complete: async \(\{[\s\S]*?queueReservation[\s\S]*?\}\) => \{/
    );
    assert.match(
        tinyBrainBranch,
        /let stageRequestOptions = \{[\s\S]*?messages,[\s\S]*?queueReservation[\s\S]*?\};/
    );
    assert.match(tinyBrainBranch, /const tinyBrainResult = await runTinyBrainPromptProgram\(\{/);
    assert.doesNotMatch(tinyBrainBranch, /clearPromptProgressGroup|recordPromptProgressGroupFailure/);
});

test('plot analysis scheduling is enabled by default and gated by config', () => {
    assert.equal(defaultConfig.plot_analysis?.enabled, true);
    assert.ok(Number.isInteger(defaultConfig.plot_analysis?.max_plot_threads));
    assert.ok(Number.isInteger(defaultConfig.plot_analysis?.max_plot_complications));
    assert.match(serverSource, /plot_analysis must be an object when provided/);
    assert.match(serverSource, /plot_analysis\.enabled must be a boolean when provided/);
    assert.match(apiSource, /function isPlotAnalysisPromptEnabled\(\)/);
    assert.match(apiSource, /Globals\.config\?\.plot_analysis\?\.enabled !== false/);

    const scheduleStart = apiSource.indexOf('function schedulePlotAnalysisPrompt(');
    const scheduleEnd = apiSource.indexOf('\n        function runSupplementalStoryInfo', scheduleStart);
    assert.notEqual(scheduleStart, -1, 'Unable to locate plot-analysis scheduler.');
    assert.notEqual(scheduleEnd, -1, 'Unable to locate plot-analysis scheduler boundary.');
    const scheduleSource = apiSource.slice(scheduleStart, scheduleEnd);

    assert.match(
        scheduleSource,
        /if \(!isPlotAnalysisPromptEnabled\(\)\) \{\s*return false;\s*\}/
    );
});

test('plot analysis runner rechecks the config gate before doing background work', () => {
    const runStart = apiSource.indexOf('async function perform_runPlotAnalysisPrompt(');
    const runEnd = apiSource.indexOf('\n        function schedulePlotAnalysisPrompt', runStart);

    assert.notEqual(runStart, -1, 'Unable to locate plot-analysis prompt runner.');
    assert.notEqual(runEnd, -1, 'Unable to locate plot-analysis prompt runner boundary.');

    const runSource = apiSource.slice(runStart, runEnd);

    assert.match(
        runSource,
        /if \(!isPlotAnalysisPromptEnabled\(\)\) \{\s*return null;\s*\}/
    );
});

test('plot analysis prompt runs through a narrow tracker and timed-event tool loop', () => {
    const runStart = apiSource.indexOf('async function perform_runPlotAnalysisPrompt(');
    const runEnd = apiSource.indexOf('\n        function schedulePlotAnalysisPrompt', runStart);

    assert.notEqual(runStart, -1, 'Unable to locate plot-analysis prompt runner.');
    assert.notEqual(runEnd, -1, 'Unable to locate plot-analysis prompt runner boundary.');

    const runSource = apiSource.slice(runStart, runEnd);

    assert.match(
        apiSource,
        /const PLOT_ANALYSIS_CHAT_TOOL_NAMES = new Set\(\[\s*'addTracker',\s*'scheduleEvent',\s*'setRelationship'\s*\]\);/
    );
    assert.match(apiSource, /function getPlotAnalysisChatToolDefinitions\(\{/);
    assert.match(runSource, /const plotAnalysisTools = getPlotAnalysisChatToolDefinitions\(\{\s*modExtensionRegistry\s*\}\);/);
    assert.match(runSource, /tools:\s*plotAnalysisTools/);
    assert.match(runSource, /await runChatCompletionWithToolLoop\(\{/);
    assert.doesNotMatch(runSource, /await LLMClient\.chatCompletion\(requestOptions\)/);
});

test('regular player-action prompts can create trackers, scheduled events, and relationship labels', () => {
    const toolSetSource = fs.readFileSync(path.join(rootDir, 'ChatToolPolicy.js'), 'utf8');
    const { getEnabledProseChatToolDefinitions } = require('../ChatToolPolicy.js');
    const tools = getEnabledProseChatToolDefinitions({ config: defaultConfig, allowWorldMutationTools: true });
    const toolNames = new Set(tools.map(tool => tool.function.name));
    for (const name of ['addTracker', 'scheduleEvent', 'setRelationship']) assert.ok(toolNames.has(name), `missing ${name}`);
    const toolSetStart = toolSetSource.indexOf('function getEnabledProseChatToolDefinitions(');
    const toolSetEnd = toolSetSource.indexOf('function getPlayerActionToolDefinitions(', toolSetStart);
    assert.notEqual(toolSetStart, -1, 'Unable to locate regular prose chat tool set.');
    assert.notEqual(toolSetEnd, -1, 'Unable to locate regular prose chat tool set end.');

    assert.match(playerActionPrompt, /`addTracker`/);
    assert.match(playerActionPrompt, /`scheduleEvent`/);
    assert.match(playerActionPrompt, /`setRelationship`/);
});

test('improvement prompt defaults disabled, local config uses a boolean, and config is validated', () => {
    assert.equal(defaultConfig.improvement_prompt?.enabled, false);
    assert.equal(defaultConfig.improvement_prompt?.interval, 10);
    assert.equal(typeof localConfig.improvement_prompt?.enabled, 'boolean');

    assert.match(serverSource, /improvement_prompt must be an object when provided/);
    assert.match(serverSource, /improvement_prompt\.enabled must be a boolean when provided/);
    assert.match(serverSource, /improvement_prompt\.interval must be an integer greater than or equal to 1 when provided/);
});

test('player-action scheduling starts improvement prompt before awaiting event checks', () => {
    const responseEntryIndex = apiSource.indexOf('const aiResponseEntryType = isQuestionAction');
    const scheduleIndex = apiSource.indexOf('scheduleImprovementPrompt({', responseEntryIndex);
    const eventChecksIndex = apiSource.indexOf("stream.status('player_action:event_checks'", responseEntryIndex);

    assert.notEqual(responseEntryIndex, -1, 'Unable to locate player-action response entry block.');
    assert.notEqual(scheduleIndex, -1, 'Unable to locate improvement prompt scheduling call.');
    assert.notEqual(eventChecksIndex, -1, 'Unable to locate player-action event-check await block.');
    assert.ok(scheduleIndex < eventChecksIndex, 'improvement prompt must be scheduled before event checks are awaited.');
});

test('improvement prompt scheduler uses interval gate and visible prompt-excluded entry type', () => {
    assert.match(apiSource, /function isImprovementPromptEnabled\(\)/);
    assert.match(apiSource, /function resolveImprovementPromptInterval\(\)/);
    assert.match(apiSource, /function shouldRunImprovementPromptThisTurn\(\)/);
    assert.match(apiSource, /improvementPromptTurnCounter\s*\+=\s*1/);
    assert.match(apiSource, /improvementPromptTurnCounter\s*%\s*interval\s*===\s*0/);
    assert.match(apiSource, /type:\s*'game-improvement-suggestions'/);
    assert.match(apiSource, /Game improvement suggestions/);
    assert.match(apiSource, /excludeFromBaseContextHistory:\s*true/);
    assert.doesNotMatch(
        serverSource,
        /HIDDEN_CHAT_ENTRY_TYPES[\s\S]*'game-improvement-suggestions'/,
        'game improvement suggestions should stay visible to the client'
    );
});
