const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadCore() {
    return import('../scripts/lib/prose_benchmark/core.mjs');
}

async function loadJudge() {
    return import('../scripts/lib/prose_benchmark/judge.mjs');
}

test('prose benchmark resolves the newest valid manual save', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airpg-prose-save-'));
    await fs.mkdir(path.join(root, 'saves', 'older'), { recursive: true });
    await fs.mkdir(path.join(root, 'saves', 'newer'), { recursive: true });
    await fs.mkdir(path.join(root, 'autosaves', 'automatic'), { recursive: true });
    await fs.writeFile(path.join(root, 'saves', 'older', 'metadata.json'), JSON.stringify({ timestamp: '2026-01-01T00:00:00Z' }));
    await fs.writeFile(path.join(root, 'saves', 'newer', 'metadata.json'), JSON.stringify({ timestamp: '2026-01-02T00:00:00Z' }));
    await fs.writeFile(path.join(root, 'autosaves', 'automatic', 'metadata.json'), JSON.stringify({ timestamp: '2027-01-01T00:00:00Z' }));
    const { resolveSourceSave } = await loadCore();
    const resolved = await resolveSourceSave(root, 'latest-manual');
    assert.equal(resolved.saveName, 'newer');
    assert.equal(resolved.sourceType, 'saves');
});

test('source snapshot retains exact files and hashes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airpg-prose-snapshot-'));
    const source = path.join(root, 'source');
    const snapshot = path.join(root, 'run', 'source-save');
    await fs.mkdir(path.join(source, 'nested'), { recursive: true });
    await fs.writeFile(path.join(source, 'metadata.json'), '{"save":true}\n');
    await fs.writeFile(path.join(source, 'nested', 'state.json'), '{"turn":1}\n');
    const { snapshotSourceSave, createDirectoryManifest } = await loadCore();
    const manifest = await snapshotSourceSave(source, snapshot);
    assert.equal(manifest.fileCount, 2);
    assert.deepEqual(manifest, await createDirectoryManifest(snapshot));
    assert.equal(await fs.readFile(path.join(snapshot, 'nested', 'state.json'), 'utf8'), '{"turn":1}\n');
});

test('generated config pins every model route and selected TinyBrain mode', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airpg-prose-config-'));
    await fs.mkdir(path.join(root, 'benchmarks', 'prose', 'runs'), { recursive: true });
    await fs.writeFile(path.join(root, 'config.default.yaml'), 'ai_model_overrides:\n  prose:\n    prompts: [player_action]\n');
    await fs.writeFile(path.join(root, 'config.yaml'), 'ai_model_overrides:\n  utility:\n    prompts: [summary]\n');
    await fs.writeFile(path.join(root, 'base.yaml'), 'ai:\n  endpoint: http://localhost:5005/v1\n  local_startup_script_path: /tmp/start-router.sh\nimagegen:\n  enabled: true\n');
    const { writeProseBenchmarkConfig } = await loadCore();
    const output = path.join(root, 'benchmarks', 'prose', 'runs', 'generated.yaml');
    await writeProseBenchmarkConfig(root, {
        baseOverridePath: 'base.yaml',
        outputPath: 'benchmarks/prose/runs/generated.yaml',
        checkpoint: 'ridiculous-model-name',
        tinybrain: false
    });
    const yaml = await fs.readFile(output, 'utf8');
    assert.match(yaml, /model: ridiculous-model-name/);
    assert.match(yaml, /tinybrain: false/);
    assert.match(yaml, /enabled: false/);
    assert.match(yaml, /prose:/);
    assert.match(yaml, /utility:/);
    assert.match(yaml, /local_startup_script_path: ''/);
    assert.match(yaml, /unload_during_image_generation: false/);
    assert.match(yaml, /terminate_during_image_generation: false/);
    assert.match(yaml, /router_preload_model: ridiculous-model-name/);
});

test('generated config does not contact a remote endpoint as a llama.cpp router', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airpg-prose-remote-config-'));
    await fs.mkdir(path.join(root, 'benchmarks', 'prose', 'runs'), { recursive: true });
    await fs.writeFile(path.join(root, 'config.default.yaml'), '{}\n');
    await fs.writeFile(path.join(root, 'config.yaml'), '{}\n');
    await fs.writeFile(
        path.join(root, 'remote.yaml'),
        'ai:\n  endpoint: https://nano-gpt.com/api/v1/chat/completions\n  model: old-model\n  tinybrain: true\nai_model_overrides:\n  prose:\n    model: old-prose-model\n'
    );
    const { writeProseBenchmarkConfig } = await loadCore();
    const output = path.join(root, 'benchmarks', 'prose', 'runs', 'generated.yaml');
    await writeProseBenchmarkConfig(root, {
        baseOverridePath: 'remote.yaml',
        outputPath: 'benchmarks/prose/runs/generated.yaml',
        checkpoint: 'zai-org/glm-5.1',
        tinybrain: false
    });
    const yaml = await fs.readFile(output, 'utf8');
    assert.match(yaml, /endpoint: https:\/\/nano-gpt\.com\/api\/v1\/chat\/completions/);
    assert.match(yaml, /model: zai-org\/glm-5\.1/);
    assert.match(yaml, /tinybrain: false/);
    assert.match(yaml, /router_preload_model: ''/);
    assert.match(yaml, /local_startup_script_path: ''/);
});

test('final prose extraction accepts both prompt modes through the shared API field', async () => {
    const { extractFinalProse } = await loadCore();
    assert.equal(extractFinalProse({ ok: true, payload: { response: '  Final prose.  ' } }), 'Final prose.');
    assert.equal(extractFinalProse({ ok: false, payload: { response: 'Ignored' } }), null);
    assert.equal(extractFinalProse({ ok: true, payload: { error: 'failed' } }), null);
});

test('prose benchmark CLI exposes the optional player-action halt boundary', async () => {
    const source = await fs.readFile(path.join(__dirname, '..', 'scripts', 'prose_benchmark.mjs'), 'utf8');
    assert.match(source, /--halt-after-player-action/);
    assert.match(source, /haltAfterPlayerAction/);
    assert.match(source, /Chat response did not confirm the requested halt-after-player-action boundary/);
});

test('lamia shoes judge rubric keeps physical, humorous, and social-caution judgments separate', async () => {
    const { loadJudgeCriteria, buildProseJudgeMessages } = await loadJudge();
    const criteria = await loadJudgeCriteria(path.join(
        __dirname,
        '..',
        'benchmarks',
        'prose',
        'lamia-shoes.criteria.json'
    ));
    assert.deepEqual(
        criteria.criteria.map(criterion => criterion.id),
        ['lamia_does_not_wear_shoes', 'recognizes_deliberate_teasing', 'appropriate_social_caution']
    );
    const built = buildProseJudgeMessages({
        criteria,
        playerInput: 'I like your shoes.',
        attempts: [{ attempt: 1, finalProse: 'Her tail curls as she gives him a knowing look.' }]
    });
    assert.match(built.messages[0].content, /Allow implications, deadpan delivery, humor/);
    assert.match(built.messages[0].content, /Do not count facts stated only in the player input/);
    assert.match(built.messages[1].content, /recognizes_deliberate_teasing/);
    assert.match(built.messages[1].content, /Return every requested attempt and every criterion exactly once/);
});

test('Codex prose judge parser validates every attempt and criterion', async () => {
    const { loadJudgeCriteria, parseProseJudgeResponse } = await loadJudge();
    const criteria = await loadJudgeCriteria(path.join(
        __dirname,
        '..',
        'benchmarks',
        'prose',
        'lamia-shoes.criteria.json'
    ));
    const attempts = [{ attempt: 2 }];
    const parsed = parseProseJudgeResponse(JSON.stringify({
        attempts: [{
            attempt: 2,
            criteria: [
                {
                    id: 'lamia_does_not_wear_shoes',
                    verdict: 'pass',
                    confidence: 'high',
                    evidence: 'Her tail curls.',
                    rationale: 'The response grounds her serpentine lower body.'
                },
                {
                    id: 'recognizes_deliberate_teasing',
                    verdict: 'unclear',
                    confidence: 'medium',
                    evidence: 'a knowing look',
                    rationale: 'The look may be playful, but its meaning is not established.'
                },
                {
                    id: 'appropriate_social_caution',
                    verdict: 'unclear',
                    confidence: 'medium',
                    evidence: '',
                    rationale: 'The response does not reveal whether she accepts or rejects the invitation.'
                }
            ]
        }]
    }), { attempts, criteria });
    assert.equal(parsed[0].criteria[0].verdict, 'pass');
    assert.equal(parsed[0].criteria[1].verdict, 'unclear');
    assert.throws(() => parseProseJudgeResponse(JSON.stringify({
        attempts: [{ attempt: 2, criteria: [] }]
    }), { attempts, criteria }), /must return 3 criteria/);
});

test('resumable Codex prose judging updates JSON and HTML without changing prose success', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airpg-prose-judge-'));
    const runDirectory = path.join(root, 'benchmarks', 'prose', 'runs', 'run-one');
    const criteriaDirectory = path.join(root, 'benchmarks', 'prose');
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.mkdir(criteriaDirectory, { recursive: true });
    const criteriaSource = path.join(__dirname, '..', 'benchmarks', 'prose', 'lamia-shoes.criteria.json');
    await fs.copyFile(criteriaSource, path.join(criteriaDirectory, 'lamia-shoes.criteria.json'));
    const initial = {
        version: 1,
        runId: 'run-one',
        checkpoint: 'test-model',
        tinybrain: true,
        haltAfterPlayerAction: true,
        playerInput: 'I like your shoes.',
        tries: 2,
        sourceSaveName: 'source-save',
        reportFilename: 'airpg-prosebench-test-model-tinybrain.html',
        results: [
            {
                attempt: 1,
                durationSeconds: 1,
                finalProse: 'Mizuchi glances down her tail and smirks. “Very clever.”',
                failureReason: null,
                chatStatus: 200,
                dialogueRelativePath: 'dialogue/attempt-1.txt',
                finalSaveRelativePath: null
            },
            {
                attempt: 2,
                durationSeconds: 1,
                finalProse: null,
                failureReason: 'No final prose.',
                chatStatus: 500,
                dialogueRelativePath: 'dialogue/attempt-2.txt',
                finalSaveRelativePath: null
            }
        ]
    };
    await fs.writeFile(path.join(runDirectory, 'results.json'), JSON.stringify(initial));
    const { judgeProseBenchmarkRun } = await loadJudge();
    let judgeCalls = 0;
    const judgeBatch = async ({ attempts }) => {
        judgeCalls += 1;
        return {
            rawContent: '{}',
            usage: null,
            judgments: attempts.map(attempt => ({
                attempt: attempt.attempt,
                criteria: [
                    {
                        id: 'lamia_does_not_wear_shoes',
                        verdict: 'pass',
                        confidence: 'high',
                        evidence: 'glances down her tail',
                        rationale: 'The response explicitly grounds her tail instead of shoes.'
                    },
                    {
                        id: 'recognizes_deliberate_teasing',
                        verdict: 'pass',
                        confidence: 'high',
                        evidence: '“Very clever.”',
                        rationale: 'She identifies and plays along with the deliberate joke.'
                    },
                    {
                        id: 'appropriate_social_caution',
                        verdict: 'unclear',
                        confidence: 'medium',
                        evidence: '',
                        rationale: 'The excerpt does not include her answer to the invitation.'
                    }
                ]
            }))
        };
    };
    const state = await judgeProseBenchmarkRun(root, runDirectory, {
        criteriaPath: 'benchmarks/prose/lamia-shoes.criteria.json',
        model: 'test-codex-model',
        judgeBatch
    });
    assert.equal(judgeCalls, 1);
    assert.equal(state.results[0].judgment.criteria[1].verdict, 'pass');
    assert.equal(state.results[1].judgment, undefined);
    const aggregate = JSON.parse(await fs.readFile(path.join(runDirectory, 'results.json'), 'utf8'));
    assert.equal(aggregate.summary.finalProseCaptured, 1);
    assert.equal(aggregate.summary.judged, 1);
    assert.equal(aggregate.summary.criterionVerdicts.recognizes_deliberate_teasing.pass, 1);
    assert.equal(aggregate.summary.criterionVerdicts.appropriate_social_caution.unclear, 1);
    const html = await fs.readFile(path.join(runDirectory, initial.reportFilename), 'utf8');
    assert.match(html, /Lamia shoes joke and social judgment/);
    assert.match(html, /Social and humorous subtext/);
    assert.match(html, /Appropriate social caution/);
    assert.match(html, /pass · high confidence/);

    await judgeProseBenchmarkRun(root, runDirectory, {
        criteriaPath: 'benchmarks/prose/lamia-shoes.criteria.json',
        model: 'test-codex-model',
        judgeBatch
    });
    assert.equal(judgeCalls, 1);
});

test('prose benchmark CLIs expose optional Codex semantic judging', async () => {
    const benchmarkSource = await fs.readFile(path.join(__dirname, '..', 'scripts', 'prose_benchmark.mjs'), 'utf8');
    const judgeSource = await fs.readFile(path.join(__dirname, '..', 'scripts', 'judge_prose_benchmark.mjs'), 'utf8');
    assert.match(benchmarkSource, /--judge-criteria/);
    assert.match(benchmarkSource, /judgeProseBenchmarkRun/);
    assert.match(judgeSource, /benchmark:prose:judge/);
    assert.match(judgeSource, /--force/);
});
