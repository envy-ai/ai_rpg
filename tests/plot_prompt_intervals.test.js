const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const Globals = require('../Globals.js');
const api = require('../api.js');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));

test('default config sets plot-analysis interval to 3 and plot-summary frequency to 10', () => {
    assert.equal(defaultConfig.plot_analysis?.interval, 3);
    assert.equal(defaultConfig.plot_summary_prompt_frequency, 10);
});

test('plot_analysis.interval is validated at config load', () => {
    assert.match(serverSource, /plot_analysis\.interval must be an integer greater than or equal to 1 when provided/);
});

test('resolvePlotAnalysisPromptInterval defaults to 1 and validates values', () => {
    const previousConfig = Globals.config;
    try {
        Globals.config = {};
        assert.equal(api.resolvePlotAnalysisPromptInterval(), 1);

        Globals.config = { plot_analysis: {} };
        assert.equal(api.resolvePlotAnalysisPromptInterval(), 1);

        Globals.config = { plot_analysis: { interval: 3 } };
        assert.equal(api.resolvePlotAnalysisPromptInterval(), 3);

        Globals.config = { plot_analysis: { interval: '2' } };
        assert.equal(api.resolvePlotAnalysisPromptInterval(), 2);

        for (const bad of [0, -1, 1.5, 'soon']) {
            Globals.config = { plot_analysis: { interval: bad } };
            assert.throws(
                () => api.resolvePlotAnalysisPromptInterval(),
                /plot_analysis\.interval must be an integer greater than or equal to 1/,
                `expected interval ${JSON.stringify(bad)} to throw`
            );
        }
    } finally {
        Globals.config = previousConfig;
    }
});

test('plot-analysis scheduling is gated by the interval counter and persisted', () => {
    assert.match(apiSource, /let plotAnalysisTurnCounter = 0;/);
    assert.match(apiSource, /plotAnalysisTurnCounter \+= 1;/);
    assert.match(apiSource, /plotAnalysisTurnCounter % resolvePlotAnalysisPromptInterval\(\) !== 0/);
    assert.match(apiSource, /metadata\.plotAnalysisTurnCounter = Number\.isInteger\(plotAnalysisTurnCounter\)/);
    assert.match(apiSource, /plotAnalysisTurnCounter = parsedPlotAnalysisCounter;/);
    assert.match(apiSource, /function resetPlotAnalysisPromptRuntime\(\) \{\s*plotAnalysisTurnCounter = 0;/);
});

test('plot-summary frequency is configurable with a validated root key', () => {
    assert.match(apiSource, /function resolvePlotSummaryPromptFrequency\(\)/);
    assert.match(apiSource, /plot_summary_prompt_frequency must be an integer greater than or equal to 1\./);
    assert.match(apiSource, /plotSummaryTurnCounter % resolvePlotSummaryPromptFrequency\(\) === 0/);

    const resolverStart = apiSource.indexOf('function resolvePlotSummaryPromptFrequency()');
    assert.notEqual(resolverStart, -1);
    const resolverBlock = apiSource.slice(resolverStart, apiSource.indexOf('function shouldRunPlotSummaryThisTurn', resolverStart));
    assert.match(resolverBlock, /return PLOT_SUMMARY_PROMPT_FREQUENCY;/);
    assert.match(apiSource, /const PLOT_SUMMARY_PROMPT_FREQUENCY = 10;/);
});
