const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPromptEnv,
    buildBaseRenderContext
} = require('./helpers/baseContextFixtures.js');

const PLOT_ANALYSIS = {
    updatedAt: '2026-05-20T12:00:00.000Z',
    plotThreads: [
        {
            description: 'Find the missing courier before the trail goes cold.',
            isCurrentFocus: true
        },
        {
            description: 'Track the smugglers working the river gate.',
            isCurrentFocus: false
        }
    ],
    currentPlotComplications: [
        { description: 'Find the missing courier.' },
        { description: 'Get access to the locked customs ledger.' }
    ],
    raw: '<response><plotThreads></plotThreads><currentPlotComplications></currentPlotComplications></response>'
};

function buildRenderContext(overrides = {}) {
    return buildBaseRenderContext({
        question: 'What is happening?',
        currencyName: 'Gold',
        regionName: '',
        overrides: {
            plotAnalysis: PLOT_ANALYSIS,
            plotAnalysisHasContent: true,
            ...overrides
        }
    });
}

test('base-context includes stored plot analysis for ordinary prompt types', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext());

    assert.match(rendered, /<plotAnalysis>/);
    assert.match(rendered, /- \[CURRENT\] Find the missing courier before the trail goes cold\./);
    assert.match(rendered, /- Get access to the locked customs ledger\./);
});

test('base-context omits stored plot analysis when it has no thread or complication content', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        plotAnalysis: {
            updatedAt: '2026-05-20T12:00:00.000Z',
            plotThreads: [],
            currentPlotComplications: [],
            raw: '<response><plotThreads></plotThreads><currentPlotComplications></currentPlotComplications></response>'
        },
        plotAnalysisHasContent: false
    }));

    assert.doesNotMatch(rendered, /<plotAnalysis\b/);
    assert.doesNotMatch(rendered, /<rawOutput>/);
});

test('base-context omits previous plot analysis when rendering the plot-analysis prompt itself', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptType: 'plot-analysis'
    }));

    assert.doesNotMatch(rendered, /<plotAnalysis updatedAt=/);
    assert.doesNotMatch(rendered, /Find the missing courier before the trail goes cold/);
});
