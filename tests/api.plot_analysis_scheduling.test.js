const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));

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
