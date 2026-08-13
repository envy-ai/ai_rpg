const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { load: loadYaml } = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

async function benchmarkModules() {
    const [manifest, config, report, server, scenario, assertions, resume] = await Promise.all([
        import('../scripts/lib/model_benchmark/manifest.mjs'),
        import('../scripts/lib/model_benchmark/config.mjs'),
        import('../scripts/lib/model_benchmark/report.mjs'),
        import('../scripts/lib/model_benchmark/server.mjs'),
        import('../scripts/lib/followup_api_playtest/scenario.mjs'),
        import('../scripts/lib/followup_api_playtest/assertions.mjs'),
        import('../scripts/lib/model_benchmark/resume.mjs')
    ]);
    return { manifest, config, report, server, scenario, assertions, resume };
}

test('benchmark manifest covers all 148 logical cases with validated immutable fixtures', async () => {
    const { manifest } = await benchmarkModules();
    const inventory = await manifest.loadBenchmarkManifest(ROOT);
    assert.equal(inventory.expectedCases.length, 148);
    assert.equal(inventory.runnableCaseIds.length, 148);
    assert.equal(inventory.scenarios.length, 152);
    assert.deepEqual(inventory.missingCaseIds, []);
    assert.equal(inventory.setupScenarios.length, 8);
    assert.ok(Object.keys(inventory.fixtureManifests).length > 0);
    for (const fixture of Object.values(inventory.fixtureManifests)) {
        assert.match(fixture.integrity, /^sha256:[a-f0-9]{64}$/);
    }
    assert.ok(inventory.scenarios.some(entry => entry.definition.case === 'NEED-7-invalid-tinybrain-response'));
    assert.ok(inventory.scenarios.some(entry => entry.definition.case === 'REL-7-housekeeping-lifecycle'));
    const preHarness = inventory.scenarios.filter(entry => entry.file.startsWith(
        'tests/followup_api_playtest/model_benchmark_legacy_scenarios.mjs#'
    ));
    assert.equal(preHarness.length, 69);
    assert.equal(new Set(preHarness.map(entry => entry.caseId)).size, 69);
});

test('benchmark filters accept logical cases, exact variants, and families', async () => {
    const { manifest } = await benchmarkModules();
    const inventory = await manifest.loadBenchmarkManifest(ROOT);
    const eventTwo = manifest.filterBenchmarkScenarios(inventory, { caseFilters: ['EVENT-2'] });
    assert.equal(eventTwo.length, 3);
    assert.ok(eventTwo.every(entry => entry.caseId === 'EVENT-2'));
    const exact = manifest.filterBenchmarkScenarios(inventory, { caseFilters: ['ALT-7-interactive-roll-low'] });
    assert.deepEqual(exact.map(entry => entry.definition.case), ['ALT-7-interactive-roll-low']);
    const quests = manifest.filterBenchmarkScenarios(inventory, { familyFilters: ['quest'] });
    assert.equal(quests.length, 9);
    assert.ok(quests.every(entry => entry.family === 'QUEST'));
    assert.throws(() => manifest.filterBenchmarkScenarios(inventory, { caseFilters: ['NOPE-1'] }), /selected no runnable scenarios/);
});

test('nodeTest steps are constrained to explicit source-controlled Node test paths', async () => {
    const { scenario } = await benchmarkModules();
    const valid = {
        version: 1,
        scenario: 'deterministic',
        case: 'TEST-1-node',
        configProfile: 'isolated-base',
        steps: [{ type: 'nodeTest', name: 'suite', files: ['tests/rel7.housekeeping_relationship_lifecycle.test.js'] }]
    };
    assert.equal(scenario.validateScenarioDefinition(valid), valid);
    assert.throws(() => scenario.validateScenarioDefinition({
        ...valid,
        steps: [{ type: 'nodeTest', name: 'suite', files: ['../outside.test.js'] }]
    }), /source-controlled tests/);
});

test('benchmark-specific mechanical assertions count unique prompts, realtime events, and entity array values', async () => {
    const { assertions, scenario } = await benchmarkModules();
    const definition = {
        version: 1,
        scenario: 'assertion-validation',
        case: 'TEST-2-assertions',
        steps: [{
            type: 'assert',
            assertions: [
                { type: 'realtimeEventCount', where: { type: 'player_input_request' }, equals: 1 },
                { type: 'promptRunCount', labelIncludes: 'quest_check', equals: 1 },
                { type: 'entityArrayUnique', collection: 'things', id: 'thing_1', path: 'values' },
                { type: 'arrayObjectCountBetween', source: 'responses.offers', path: 'payload.rows', where: { source: 'generated' }, minimum: 1, maximum: 2 },
                { type: 'arrayNumericFieldBounds', source: 'responses.offers', path: 'payload.rows', field: 'price', minimumExclusive: 0, maximum: 10 },
                { type: 'nullish', source: 'after', path: 'player.payload.player.gear.Head.itemId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: 'quest_2' }, field: 'objectives.0.completed', equals: true },
                { type: 'arrayObjectFieldCount', source: 'after', path: 'player.payload.player.quests', where: { id: 'quest_2' }, field: 'objectives', equals: 1 }
            ]
        }]
    };
    assert.equal(scenario.validateScenarioDefinition(definition), definition);
    const context = {
        after: {
            things: { payload: { things: [{ id: 'thing_1', values: ['a', 'b'] }] } },
            player: { payload: { player: { quests: [{ id: 'quest_2', objectives: [{ completed: true }] }] } } }
        },
        realtime: [
            { type: 'player_input_request' },
            { type: 'prompt_progress', entries: [{ id: 'quest_1', label: 'quest_check[1]' }] },
            { type: 'prompt_progress', entries: [{ id: 'quest_1', label: 'quest_check[1]', isComplete: true }] }
        ],
        responses: { offers: { payload: { rows: [{ source: 'generated', price: 2 }, { source: 'canonical', price: 10 }] } } }
    };
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[0], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[1], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[2], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[3], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[4], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[5], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[6], context).passed, true);
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[7], context).passed, true);
    context.after.things.payload.things[0].values.push('a');
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[2], context).passed, false);
    context.responses.offers.payload.rows[1].price = 11;
    assert.equal(assertions.evaluateAssertion(definition.steps[0].assertions[4], context).passed, false);
});

test('benchmark resume helpers preserve unaffected results and select only requested or unfinished scenarios', async () => {
    const { resume } = await benchmarkModules();
    const first = { file: 'first.json', caseId: 'TEST-1', definition: { steps: [] } };
    const second = {
        file: 'second.json',
        caseId: 'TEST-2',
        definition: { steps: [{ type: 'request', method: 'PUT', route: '/api/game-config-override' }] }
    };
    const inventory = { scenarios: [first, second] };
    assert.deepEqual(
        resume.materializeStoredSelection(inventory, [{ file: 'first.json' }, { file: 'second.json' }]),
        [first, second]
    );
    assert.deepEqual(
        resume.selectUnfinishedScenarios([first, second], [{ scenarioFile: 'first.json', status: 'failed' }]),
        [second]
    );
    const retained = { scenarioFile: 'first.json', status: 'passed' };
    const oldSecond = { scenarioFile: 'second.json', status: 'failed' };
    const newSecond = { scenarioFile: 'second.json', status: 'passed' };
    assert.deepEqual(resume.replaceScenarioResult([retained, oldSecond], newSecond), [retained, newSecond]);
    assert.deepEqual(resume.mergeScenarioSelections([first], [first, second]), [first, second]);
    assert.equal(resume.scenarioMutatesRuntimeConfig(first.definition), false);
    assert.equal(resume.scenarioMutatesRuntimeConfig(second.definition), true);
});

test('benchmark config pins every routed prompt to the requested model and disables images', async t => {
    const { config } = await benchmarkModules();
    const directory = await fs.mkdtemp(path.join(ROOT, 'tmp', 'model-benchmark-config-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const outputPath = path.join(directory, 'override.yaml');
    const result = await config.writeBenchmarkConfig(ROOT, {
        profileName: 'vehicle-mechanics',
        model: 'qa/model-under-test',
        baseOverridePath: 'config.yaml.qwen-combo-router',
        outputPath,
        endpoint: 'http://127.0.0.1:9999/v1'
    });
    const generated = loadYaml(await fs.readFile(outputPath, 'utf8'));
    assert.equal(result.model, 'qa/model-under-test');
    assert.equal(generated.ai.model, 'qa/model-under-test');
    assert.equal(generated.ai.endpoint, 'http://127.0.0.1:9999/v1');
    assert.equal(generated.ai.local_startup_script_path, '');
    assert.equal(generated.ai.record_outputs_file, '');
    assert.equal(generated.ai.force_outputs_file, '');
    assert.equal(generated.imagegen.enabled, false);
    assert.equal(generated.router_preload_model, 'qa/model-under-test');
    assert.ok(Object.keys(generated.ai_model_overrides).length > 0);
    for (const override of Object.values(generated.ai_model_overrides)) {
        assert.equal(override.model, 'qa/model-under-test');
        assert.equal(override.endpoint, 'http://127.0.0.1:9999/v1');
    }
    const rejectionPath = path.join(directory, 'rejection.yaml');
    await config.writeBenchmarkConfig(ROOT, {
        profileName: 'alternative-prompts-rejection',
        model: 'qa/model-under-test',
        baseOverridePath: 'config.yaml.qwen-combo-router',
        outputPath: rejectionPath
    });
    const rejection = loadYaml(await fs.readFile(rejectionPath, 'utf8'));
    assert.equal(rejection.plausibility_checks.enabled, true);
});

test('benchmark server helper derives isolated endpoints and safely stops before startup', async () => {
    const { server } = await benchmarkModules();
    const managed = new server.ManagedBenchmarkServer({
        root: ROOT,
        port: 7654,
        configPath: path.join(ROOT, 'tmp', 'not-started.yaml'),
        logPath: path.join(ROOT, 'tmp', 'not-started.log')
    });
    assert.equal(managed.baseUrl, 'http://127.0.0.1:7654');
    assert.equal(managed.wsUrl, 'ws://127.0.0.1:7654/ws');
    assert.equal(managed.running, false);
    await managed.stop();
});

test('logical pass totals require all selected variants to execute and pass', async () => {
    const { report } = await benchmarkModules();
    const selectedScenarioEntries = [
        { caseId: 'EVENT-2' },
        { caseId: 'EVENT-2' },
        { caseId: 'QUEST-1' }
    ];
    const partial = report.summarizeBenchmark({
        expectedCases: ['EVENT-2', 'QUEST-1'],
        selectedScenarioEntries,
        results: [{ caseId: 'EVENT-2', status: 'passed', prompts: [] }]
    });
    assert.equal(partial.passingLogicalCases, 0);
    const complete = report.summarizeBenchmark({
        expectedCases: ['EVENT-2', 'QUEST-1'],
        selectedScenarioEntries,
        results: [
            { caseId: 'EVENT-2', status: 'passed', prompts: [] },
            { caseId: 'EVENT-2', status: 'passed', prompts: [] },
            { caseId: 'QUEST-1', status: 'passed', prompts: [] }
        ]
    });
    assert.equal(complete.passingLogicalCases, 2);
});

test('report generation escapes prose, exposes review controls, and records model mismatches', async t => {
    const { report } = await benchmarkModules();
    assert.equal(
        report.benchmarkReportFilename('Qwen Model/35B'),
        'airpgbench-Qwen-Model-35B.html'
    );
    assert.equal(report.inspectPromptModels([{ label: 'player-action', model: 'wrong' }], 'wanted').valid, false);
    const directory = await fs.mkdtemp(path.join(ROOT, 'tmp', 'model-benchmark-report-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const result = {
        caseId: 'ALT-1',
        case: 'ALT-1-question',
        family: 'ALT',
        profile: 'isolated-base',
        description: '<unsafe description>',
        status: 'passed',
        durationMs: 10,
        attemptDirectory: null,
        assertions: { total: 1, passed: 1, failed: [] },
        prompts: [{ label: 'question', model: 'wanted', seconds: 1, retries: 0 }],
        modelInspection: report.inspectPromptModels([{ label: 'question', model: 'wanted' }], 'wanted'),
        playerInputs: ['<script>bad()</script>'],
        narrative: [{ type: 'assistant', content: '<b>not markup</b>' }],
        directResponseText: [],
        humanReview: ['Review natural prose.'],
        knownAuditedModelFailure: null,
        changedLogs: [{ name: 'ERROR_tool_call_failed_<unsafe>_123.log', size: 456 }]
    };
    const selected = [{ caseId: 'ALT-1' }];
    const run = {
        version: 1,
        runId: 'unit-report',
        projectRoot: ROOT,
        model: 'wanted',
        startedAt: '2026-08-12T00:00:00.000Z',
        finishedAt: '2026-08-12T00:00:01.000Z',
        interrupted: false,
        coverage: { expectedCases: ['ALT-1'], runnableCaseIds: ['ALT-1'], missingCaseIds: [] },
        notRunCaseIds: [],
        results: [result],
        summary: report.summarizeBenchmark({ expectedCases: ['ALT-1'], selectedScenarioEntries: selected, results: [result] })
    };
    await report.writeBenchmarkReports(directory, run);
    const reportFilename = 'airpgbench-wanted.html';
    const html = await fs.readFile(path.join(directory, reportFilename), 'utf8');
    assert.match(html, /&lt;unsafe description&gt;/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
    assert.match(html, /Export review JSON/);
    assert.match(html, /localStorage/);
    assert.match(html, /Diagnostic error logs \(1\)/);
    assert.match(html, /ERROR_tool_call_failed_&lt;unsafe&gt;_123\.log/);
    assert.match(html, /not a pass\/fail signal/);
    assert.equal((await fs.stat(path.join(directory, 'progress.json'))).isFile(), true);
    assert.equal((await fs.stat(path.join(directory, 'results.json'))).isFile(), true);
    const progress = JSON.parse(await fs.readFile(path.join(directory, 'progress.json'), 'utf8'));
    assert.equal(progress.reportFilename, reportFilename);
});
