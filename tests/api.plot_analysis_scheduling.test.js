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

test('player-action scheduling starts plot analysis before awaiting the player-action LLM response', () => {
    const requestOptionsIndex = apiSource.indexOf('const requestOptions = {', apiSource.indexOf("const promptMetadataLabel = promptType === 'question'"));
    const scheduleIndex = apiSource.indexOf('schedulePlotAnalysisPrompt({', requestOptionsIndex);
    const toolLoopIndex = apiSource.indexOf('await runChatCompletionWithToolLoop({', requestOptionsIndex);
    const directCompletionIndex = apiSource.indexOf('aiResponse = await LLMClient.chatCompletion(requestOptions);', requestOptionsIndex);

    assert.notEqual(scheduleIndex, -1, 'Unable to locate plot-analysis scheduling call.');
    assert.notEqual(toolLoopIndex, -1, 'Unable to locate player-action tool-loop request.');
    assert.notEqual(directCompletionIndex, -1, 'Unable to locate direct player-action completion request.');
    assert.ok(scheduleIndex < toolLoopIndex, 'plot analysis must be scheduled before tool-loop player-action await.');
    assert.ok(scheduleIndex < directCompletionIndex, 'plot analysis must be scheduled before direct player-action await.');
});

test('tiny-brain player action delegates shared queue and progress lifecycle to the runner', () => {
    const tinyBrainBranchStart = apiSource.indexOf('if (useTinyBrainPlayerAction) {');
    const regularToolLoopBranch = apiSource.indexOf('} else if (Array.isArray(enabledChatTools)', tinyBrainBranchStart);
    assert.notEqual(tinyBrainBranchStart, -1, 'Unable to locate tiny-brain player-action branch.');
    assert.notEqual(regularToolLoopBranch, -1, 'Unable to locate the end of the tiny-brain player-action branch.');

    const tinyBrainBranch = apiSource.slice(tinyBrainBranchStart, regularToolLoopBranch);
    assert.match(tinyBrainBranch, /configureTinyBrainPromptContext\(/);
    assert.match(
        tinyBrainBranch,
        /complete: async \(\{[\s\S]*?queueReservation[\s\S]*?\}\) => \{/
    );
    assert.match(
        tinyBrainBranch,
        /const stageRequestOptions = \{[\s\S]*?messages,[\s\S]*?queueReservation[\s\S]*?\};/
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
    const scheduleEnd = apiSource.indexOf('\n        async function runSupplementalStoryInfo', scheduleStart);
    assert.notEqual(scheduleStart, -1, 'Unable to locate plot-analysis scheduler.');
    assert.notEqual(scheduleEnd, -1, 'Unable to locate plot-analysis scheduler boundary.');
    const scheduleSource = apiSource.slice(scheduleStart, scheduleEnd);

    assert.match(
        scheduleSource,
        /if \(!isPlotAnalysisPromptEnabled\(\)\) \{\s*return false;\s*\}/
    );
});

test('plot analysis runner rechecks the config gate before doing background work', () => {
    const runStart = apiSource.indexOf('async function runPlotAnalysisPrompt(');
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
    const runStart = apiSource.indexOf('async function runPlotAnalysisPrompt(');
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
    const toolSetStart = apiSource.indexOf('const INFORMATION_GATHERING_CHAT_TOOL_NAMES = new Set([');
    const toolSetEnd = apiSource.indexOf(']);', toolSetStart);
    assert.notEqual(toolSetStart, -1, 'Unable to locate regular prose chat tool set.');
    assert.notEqual(toolSetEnd, -1, 'Unable to locate regular prose chat tool set end.');

    const toolSetSource = apiSource.slice(toolSetStart, toolSetEnd);
    assert.match(toolSetSource, /'addTracker'/);
    assert.match(toolSetSource, /'scheduleEvent'/);
    assert.match(toolSetSource, /'setRelationship'/);
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
