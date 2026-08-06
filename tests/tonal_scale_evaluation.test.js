const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {
    createPromptEnv,
    buildBaseRenderContext
} = require('./helpers/baseContextFixtures.js');

const rootDir = path.join(__dirname, '..');
const defaultConfigSource = fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8');
const defaultConfig = yaml.load(defaultConfigSource);
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const baseContextSource = fs.readFileSync(path.join(rootDir, 'prompts', 'base-context.xml.njk'), 'utf8');
const configViewSource = fs.readFileSync(path.join(rootDir, 'views', 'config.njk'), 'utf8');

function buildRenderContext(overrides = {}) {
    return buildBaseRenderContext({
        question: 'What is happening?',
        currencyName: 'Gold',
        regionName: '',
        overrides: {
            plotAnalysisHasContent: false,
            tonalScaleEvaluation: '',
            ...overrides
        }
    });
}

test('default config enables tonal scale evaluation every five turns and server validates it', () => {
    assert.equal(defaultConfig.tonal_scale_evaluation?.enabled, true);
    assert.equal(defaultConfig.tonal_scale_evaluation?.interval, 5);
    assert.match(defaultConfigSource, /tonal_scale_evaluation:[\s\S]*?enabled:\s*true\b/);
    assert.match(defaultConfigSource, /tonal_scale_evaluation:[\s\S]*?interval:\s*5\b/);
    assert.equal(defaultConfig.prompt_progress?.character_targets?.tonal_scale_evaluation, 5000);

    assert.match(serverSource, /tonal_scale_evaluation must be an object when provided/);
    assert.match(serverSource, /tonal_scale_evaluation\.enabled must be a boolean when provided/);
    assert.match(serverSource, /tonal_scale_evaluation\.interval must be an integer greater than or equal to 1 when provided/);
});

test('system configuration page exposes tonal scale evaluation enable and interval controls', () => {
    assert.match(
        configViewSource,
        /name="tonal_scale_evaluation\.enabled::boolean" value="false"/
    );
    assert.match(
        configViewSource,
        /id="tonal-scale-evaluation-enabled"[\s\S]*?name="tonal_scale_evaluation\.enabled::boolean"[\s\S]*?value="true"/
    );
    assert.match(
        configViewSource,
        /config\.tonal_scale_evaluation\.enabled is not defined or config\.tonal_scale_evaluation\.enabled/
    );
    assert.match(
        configViewSource,
        /id="tonal-scale-evaluation-interval"[\s\S]*?name="tonal_scale_evaluation\.interval::int"[\s\S]*?default\(5\)[\s\S]*?min="1"/
    );
});

test('base context includes stored tonal scale evaluation before current conditions and omits it from its own prompt', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        tonalScaleEvaluation: 'Idealism:\n  Current State: Hope is fragile.',
        tonalScaleEvaluationTurnsAgo: 2
    }));

    const evaluationIndex = rendered.indexOf('<tonalScaleEvaluation>');
    const currentConditionsIndex = rendered.indexOf('<currentConditions>');
    assert.notEqual(evaluationIndex, -1, 'tonalScaleEvaluation block should render.');
    assert.notEqual(currentConditionsIndex, -1, 'currentConditions block should render.');
    assert.ok(evaluationIndex < currentConditionsIndex, 'tonalScaleEvaluation must render before currentConditions.');
    assert.match(
        rendered,
        /This evaluation is current as of 2 turns ago, and the state of the story may have changed since then\. Use your judgement\./
    );
    assert.match(rendered, /Current State: Hope is fragile\./);

    const ownPromptRendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptType: 'tonal-scale-evaluation',
        tonalScaleEvaluation: 'This previous result should not appear.'
    }));
    assert.doesNotMatch(ownPromptRendered, /This previous result should not appear/);
});

test('tonal scale evaluation scheduler, parser, persistence, and slash command hooks are wired', () => {
    assert.match(apiSource, /function isTonalScaleEvaluationEnabled\(\)/);
    assert.match(apiSource, /function resolveTonalScaleEvaluationInterval\(\)/);
    assert.match(apiSource, /function shouldRunTonalScaleEvaluationThisTurn\(\)/);
    assert.match(apiSource, /tonalScaleEvaluationTurnCounter\s*\+=\s*1/);
    assert.match(apiSource, /tonalScaleEvaluationTurnCounter\s*%\s*interval\s*===\s*0/);
    assert.match(apiSource, /extractTonalScaleEvaluationResponse/);
    assert.match(apiSource, /promptType:\s*'tonal-scale-evaluation'/);
    assert.match(apiSource, /metadataLabel:\s*'tonal_scale_evaluation'/);
    assert.match(apiSource, /metadata\.tonalScaleEvaluationTurnCounter/);
    assert.match(apiSource, /metadata\.tonalScaleEvaluationResult/);
    assert.match(apiSource, /runTonalScaleEvaluationPrompt/);
    assert.match(apiSource, /runTonalScaleEvaluationPrompt:\s*async \(\{ storeChatEntry = false \} = \{\}\) => runTonalScaleEvaluationPrompt\(\{/);
    assert.match(apiSource, /storeChatEntry,\s*clientId:\s*normalizedClientId/);
});

test('tonal scale evaluation scheduling happens after end-of-turn finalization', () => {
    const finalizationIndex = apiSource.indexOf('player.finalizeTurn();');
    const scheduleIndex = apiSource.indexOf('scheduleTonalScaleEvaluationPrompt({', finalizationIndex);
    const responseIndex = apiSource.indexOf('responseData.messages = getClientMessages();', finalizationIndex);

    assert.notEqual(finalizationIndex, -1, 'Unable to locate turn finalization.');
    assert.notEqual(scheduleIndex, -1, 'Unable to locate tonal scale evaluation scheduling call after finalization.');
    assert.notEqual(responseIndex, -1, 'Unable to locate response assembly after finalization.');
    assert.ok(finalizationIndex < scheduleIndex, 'tonal scale evaluation must be scheduled after turn finalization.');
    assert.ok(scheduleIndex < responseIndex, 'tonal scale evaluation scheduling should happen before the response payload is built.');
});

test('base-context template guards tonal scale evaluation directly before current conditions', () => {
    const evaluationGuardIndex = baseContextSource.indexOf("promptType != 'tonal-scale-evaluation'");
    const evaluationTagIndex = baseContextSource.indexOf('<tonalScaleEvaluation>');
    const currentConditionsIndex = baseContextSource.indexOf('<currentConditions>');

    assert.notEqual(evaluationGuardIndex, -1, 'Template should guard against self-including tonal scale evaluation.');
    assert.notEqual(evaluationTagIndex, -1, 'Template should include tonalScaleEvaluation tag.');
    assert.notEqual(currentConditionsIndex, -1, 'Template should include currentConditions tag.');
    assert.ok(evaluationGuardIndex < evaluationTagIndex);
    assert.ok(evaluationTagIndex < currentConditionsIndex);
});
