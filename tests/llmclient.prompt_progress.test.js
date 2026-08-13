const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { load } = require('js-yaml');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function makeTempBaseDir(label) {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, `${label}-`));
}

function installPromptProgressConfig(baseDir) {
    Globals.baseDir = baseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        },
        prompt_progress: {
            character_targets: {
                region_generation: 20000,
                'location_*': 10000,
                'npc_generation_*': 10000,
                'inventory_generation_*': 5000,
                'npc_memories*': 5000,
                'npc_progression_assignments*': 10000,
                'npc_ability_assignments*': 10000,
                'npc_alias_assignments*': 10000,
                player_action: 5000,
                player_action_tinybrain: 5000,
                config_test: 5000
            }
        }
    };
}

test('prompt progress formula advances 75 percent to target then asymptotically', () => {
    assert.equal(LLMClient.calculatePromptProgressFraction(0, 5000), 0);
    assert.equal(LLMClient.calculatePromptProgressFraction(5000, 5000), 0.75);
    assert.equal(LLMClient.calculatePromptProgressFraction(10000, 5000), 0.875);
    assert.ok(LLMClient.calculatePromptProgressFraction(6250, 5000) < 0.875);
    assert.ok(LLMClient.calculatePromptProgressFraction(50000, 5000) < 1);
    assert.throws(() => LLMClient.calculatePromptProgressFraction(-1, 5000), /received characters/i);
    assert.throws(() => LLMClient.calculatePromptProgressFraction(1, 0), /target characters/i);
});

test('prompt progress character targets resolve exact and prefix labels without wildcard fallback', () => {
    const config = {
        prompt_progress: {
            character_targets: {
                region_generation: 20000,
                'location_*': 10000,
                'npc_generation_*': 10000,
                player_action: 5000
            }
        }
    };

    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('region-generation', config), 20000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('location_generation', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('npc_generation_single', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('player_action', config), 5000);
    let missingTargetError = null;
    try {
        LLMClient.resolvePromptProgressCharacterTarget('new_unconfigured_prompt', config);
    } catch (error) {
        missingTargetError = error;
    }
    assert.match(missingTargetError?.message || '', /character target.*new_unconfigured_prompt/i);
    assert.equal(missingTargetError.isConfigurationError, true);
});

test('missing prompt progress coverage aborts before transport without entering request retries', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const baseDir = makeTempBaseDir('prompt-progress-missing-target');
    let transportCalls = 0;
    installPromptProgressConfig(baseDir);
    Globals.realtimeHub = { emit() {} };
    LLMClient.resetPromptOutputCharacterStatsForTests();
    axios.post = async () => {
        transportCalls += 1;
        throw new Error('Transport must not be reached for an invalid prompt-progress configuration.');
    };

    try {
        await assert.rejects(
            LLMClient.withPromptProgressGroup({
                progressGroupId: 'missing-target-test-run',
                progressGroupTargetLabel: 'need_bar_event_checks_tinybrain'
            }, () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'This label is intentionally missing.' }],
                metadataLabel: 'need_bar_event_checks',
                retryAttempts: 6,
                validateXML: false,
                stream: true,
                output: 'stdout'
            })),
            error => {
                assert.equal(error?.isConfigurationError, true);
                assert.match(error?.message || '', /need_bar_event_checks_tinybrain/);
                return true;
            }
        );
        assert.equal(transportCalls, 0);
    } finally {
        LLMClient.clearPromptProgressGroup('missing-target-test-run');
        axios.post = originalAxiosPost;
        Globals.realtimeHub = originalRealtimeHub;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('prompt progress message formatting preserves chronological conversation order', () => {
    const formatted = LLMClient.formatMessagesForPromptProgress([
        { role: 'system', content: 'System instructions.' },
        { role: 'user', content: 'First checkpoint prompt.' },
        { role: 'assistant', content: 'First checkpoint response.' },
        { role: 'tool', content: 'Tool result.' },
        { role: 'user', content: 'Second checkpoint prompt.' }
    ]);

    const expectedBlocks = [
        '=== SYSTEM PROMPT ===\nSystem instructions.',
        '=== USER PROMPT ===\nFirst checkpoint prompt.',
        '=== ASSISTANT RESPONSE ===\nFirst checkpoint response.',
        '=== TOOL RESPONSE ===\nTool result.',
        '=== USER PROMPT ===\nSecond checkpoint prompt.'
    ];
    let previousIndex = -1;
    expectedBlocks.forEach(block => {
        const currentIndex = formatted.indexOf(block);
        assert.ok(currentIndex > previousIndex, `expected chronological block after index ${previousIndex}: ${block}`);
        previousIndex = currentIndex;
    });
    assert.equal(formatted.endsWith(expectedBlocks.at(-1)), true);
    assert.doesNotMatch(formatted, /=== OTHER MESSAGES ===/);
});

test('default config prompt progress targets cover known prompt families', () => {
    const configPath = path.resolve(__dirname, '..', 'config.default.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('region_generation', config), 20000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('region_npc_generation', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('location_generation', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('location_modify_player_action', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('npc_generation_single', config), 10000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('player_action_tool_loop_round', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('creative_mode_action', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('creative_mode_action_tinybrain', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('event_checks_tinybrain', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('need_bar_event_checks', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('need_bar_event_checks_tinybrain', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('generic_prompt_tool_call_error', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('inventory_generation_Barkeep', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('scheduled_event_resolution', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('scheduled_event_resolution_tinybrain', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('scheduled_event_interruption_rewrite', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('scheduled_event_interruption_rewrite_tinybrain', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('scene_illustration_prompt', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('while_you_were_away', config), 5000);
    assert.equal(LLMClient.resolvePromptProgressCharacterTarget('while_you_were_away_tinybrain', config), 5000);
});

test('prompt output character stats persist globally and reject invalid stats files', () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('prompt-progress-stats');
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        assert.deepEqual(LLMClient.getPromptOutputCharacterStats('player_action'), {
            runs: 0,
            totalOutputCharacters: 0,
            averageOutputCharacters: null,
            lastOutputCharacters: null,
            updatedAt: null
        });

        LLMClient.recordPromptOutputCharacters('player_action', 5);
        LLMClient.recordPromptOutputCharacters('player_action', 7);

        assert.deepEqual(LLMClient.getPromptOutputCharacterStats('player_action'), {
            runs: 2,
            totalOutputCharacters: 12,
            averageOutputCharacters: 6,
            lastOutputCharacters: 7,
            updatedAt: LLMClient.getPromptOutputCharacterStats('player_action').updatedAt
        });

        LLMClient.resetPromptOutputCharacterStatsForTests();
        const persisted = LLMClient.getPromptOutputCharacterStats('player_action');
        assert.equal(persisted.runs, 2);
        assert.equal(persisted.averageOutputCharacters, 6);

        const statsPath = path.join(baseDir, 'logs', 'prompt-output-character-stats.json');
        fs.writeFileSync(statsPath, '{not json', 'utf8');
        LLMClient.resetPromptOutputCharacterStatsForTests();
        assert.throws(
            () => LLMClient.getPromptOutputCharacterStats('player_action'),
            /prompt output character stats.*invalid JSON/i
        );
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('prompt output character stats use base label for character-appended prompt labels', () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('prompt-progress-base-label');
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        LLMClient.recordPromptOutputCharacters('inventory_generation_Barkeep', 100);
        LLMClient.recordPromptOutputCharacters('inventory_generation_Captain Vael', 300);

        assert.deepEqual(LLMClient.getPromptOutputCharacterStats('inventory_generation'), {
            runs: 2,
            totalOutputCharacters: 400,
            averageOutputCharacters: 200,
            lastOutputCharacters: 300,
            updatedAt: LLMClient.getPromptOutputCharacterStats('inventory_generation').updatedAt
        });
        assert.equal(
            LLMClient.getPromptOutputCharacterStats('inventory_generation_New Guard').averageOutputCharacters,
            200
        );

        LLMClient.recordPromptOutputCharacters('npc_memories_Mara Voss', 60);
        LLMClient.recordPromptOutputCharacters('npc_memories_Jon Reed', 140);
        assert.equal(LLMClient.getPromptOutputCharacterStats('npc_memories').averageOutputCharacters, 100);

        const rows = LLMClient.listPromptOutputCharacterStats();
        assert.ok(rows.some(row => row.prompt === 'inventory_generation' && row.averageOutputCharacters === 200));
        assert.ok(!rows.some(row => row.prompt === 'inventory_generation_barkeep'));
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('legacy character-appended stats file entries are aggregated under their base label', () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('prompt-progress-legacy-base-label');
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        const statsPath = path.join(baseDir, 'logs', 'prompt-output-character-stats.json');
        fs.mkdirSync(path.dirname(statsPath), { recursive: true });
        fs.writeFileSync(statsPath, JSON.stringify({
            version: 1,
            updatedAt: '2026-05-16T00:00:00.000Z',
            prompts: {
                inventory_generation_barkeep: {
                    runs: 1,
                    totalOutputCharacters: 100,
                    averageOutputCharacters: 100,
                    lastOutputCharacters: 100,
                    updatedAt: '2026-05-16T00:00:00.000Z'
                },
                inventory_generation_guard_captain: {
                    runs: 1,
                    totalOutputCharacters: 300,
                    averageOutputCharacters: 300,
                    lastOutputCharacters: 300,
                    updatedAt: '2026-05-16T00:01:00.000Z'
                }
            }
        }, null, 2), 'utf8');

        const stats = LLMClient.getPromptOutputCharacterStats('inventory_generation_New Guard');
        assert.equal(stats.runs, 2);
        assert.equal(stats.totalOutputCharacters, 400);
        assert.equal(stats.averageOutputCharacters, 200);
        assert.equal(stats.lastOutputCharacters, 300);
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('prompt logs include output character stats header', () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('prompt-progress-log-header');
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        LLMClient.recordPromptOutputCharacters('player_action', 12);
        LLMClient.logPrompt({
            prefix: 'player_action',
            metadataLabel: 'player_action',
            systemPrompt: 'System.',
            generationPrompt: 'Prompt.',
            response: 'Response.',
            output: 'silent'
        });

        const logDir = path.join(baseDir, 'logs');
        const logFile = fs.readdirSync(logDir)
            .find(filename => filename.endsWith('_player_action_player_action.log'));
        assert.ok(logFile, 'expected prompt log file to be written');
        const logText = fs.readFileSync(path.join(logDir, logFile), 'utf8');
        assert.match(logText, /^=== PROMPT OUTPUT CHARACTER STATS ===/);
        assert.match(logText, /Prompt: player_action/);
        assert.match(logText, /Runs: 1/);
        assert.match(logText, /Average Output Characters: 12/);
        assert.match(logText, /Latest Output Characters: 12/);
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('tool-call-only completions do not update output character averages', async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('prompt-progress-tool-call-average');
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        LLMClient.recordPromptOutputCharacters('player_action', 100);

        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Call a tool.' }],
            metadataLabel: 'player_action',
            forceOutput: {
                finish_reason: 'tool_calls',
                content: '',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'moreInfo',
                            arguments: JSON.stringify({ name: 'Ancient Library' })
                        }
                    }
                ]
            },
            validateXML: false,
            retryAttempts: 0,
            output: 'silent'
        });

        assert.equal(result, '');
        const stats = LLMClient.getPromptOutputCharacterStats('player_action');
        assert.equal(stats.runs, 1);
        assert.equal(stats.totalOutputCharacters, 100);
        assert.equal(stats.averageOutputCharacters, 100);
        assert.equal(stats.lastOutputCharacters, 100);
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('grouped prompt progress reuses one entry across stages and waits until group clear', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const baseDir = makeTempBaseDir('prompt-progress-average-target');
    const emittedEvents = [];
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    axios.post = async () => {
        const responseStream = new Readable({ read() {} });
        process.nextTick(() => {
            responseStream.push('data: {"choices":[{"delta":{"content":"abcd"}}]}\n\n');
            responseStream.push('data: [DONE]\n\n');
            responseStream.push(null);
        });
        return {
            status: 200,
            statusText: 'OK',
            data: responseStream
        };
    };

    try {
        LLMClient.recordPromptOutputCharacters('player_action_tinybrain', 120);

        await LLMClient.withPromptProgressGroup({
            progressGroupId: 'tinybrain-test-run',
            progressGroupTargetLabel: 'player_action_tinybrain'
        }, async () => {
            const result = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Use inherited average progress target.' }],
                metadataLabel: 'player_action',
                validateXML: false,
                retryAttempts: 0,
                output: 'stdout'
            });

            assert.equal(result, 'abcd');
            LLMClient.recordPromptProgressGroupFailure('tinybrain-test-run', 'Malformed prior answer.');

            const secondResult = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Use the same inherited grouped progress entry.' }],
                metadataLabel: 'player_action',
                validateXML: false,
                retryAttempts: 0,
                output: 'stdout'
            });
            assert.equal(secondResult, 'abcd');
        });

        const entriesBeforeClear = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .flatMap(event => Array.isArray(event.payload?.entries) ? event.payload.entries : []);
        const groupedEntriesBeforeClear = entriesBeforeClear
            .filter(entry => entry.progressGroupId === 'tinybrain-test-run');
        const groupedPromptIds = new Set(groupedEntriesBeforeClear.map(entry => entry.id));
        assert.equal(groupedPromptIds.size, 1, 'every stage should reuse one stable progress id');

        const preview = groupedEntriesBeforeClear.find(entry => entry.previewText === 'abcd');
        assert.ok(preview, 'expected a prompt_progress entry with streamed preview text');
        assert.equal(preview.targetCharacters, 120);
        assert.equal(preview.averageOutputCharacters, 120);
        assert.equal(preview.runCount, 1);
        assert.equal(preview.progressGroupId, 'tinybrain-test-run');
        assert.equal(preview.progressGroupTargetLabel, 'player_action_tinybrain');
        assert.equal(
            preview.progressFraction,
            LLMClient.calculatePromptProgressFraction(4, 120)
        );

        const waitingEntries = groupedEntriesBeforeClear
            .filter(entry => entry.previewText === 'abcd' && entry.isGroupWaiting === true);
        assert.ok(waitingEntries.length >= 2, 'expected one blue waiting state after each grouped stage');
        const firstWaitingEntry = waitingEntries[0];
        const finalWaitingEntry = waitingEntries.at(-1);
        assert.equal(firstWaitingEntry.receivedCount, 4);
        assert.equal(firstWaitingEntry.targetCharacters, 120);
        assert.equal(
            firstWaitingEntry.progressFraction,
            LLMClient.calculatePromptProgressFraction(4, 120)
        );
        const secondStageStartEntry = groupedEntriesBeforeClear.find(entry => (
            entry.isGroupWaiting === false
            && entry.previewText === ''
            && entry.receivedCount === 4
            && entry.targetCharacters === 120
        ));
        assert.ok(secondStageStartEntry, 'expected the next stage to retain the previous group totals');
        assert.equal(secondStageStartEntry.progressFraction, firstWaitingEntry.progressFraction);
        assert.equal(finalWaitingEntry.receivedCount, 8);
        assert.equal(finalWaitingEntry.targetCharacters, 120);
        assert.equal(
            finalWaitingEntry.progressFraction,
            LLMClient.calculatePromptProgressFraction(8, 120)
        );
        assert.ok(
            finalWaitingEntry.progressFraction > firstWaitingEntry.progressFraction,
            'grouped progress must remain monotonic when the next stage begins'
        );
        assert.equal(
            groupedEntriesBeforeClear.some(entry => entry.isComplete === true),
            false,
            'individual grouped stages should not complete or clear the shared entry'
        );

        const failed = groupedEntriesBeforeClear.find(entry => entry.responseFailed === true);
        assert.ok(failed, 'expected the waiting prompt entry to be marked as a failed response');
        assert.deepEqual(failed.failedResponses, ['Malformed prior answer.']);
        const failureEvent = emittedEvents.find(event => event.type === 'prompt_progress_group_failure');
        assert.ok(failureEvent, 'expected an immediate prompt-group failure event');
        assert.equal(failureEvent.payload.progressGroupId, 'tinybrain-test-run');
        assert.deepEqual(failureEvent.payload.failedResponses, ['Malformed prior answer.']);

        assert.equal(LLMClient.getPromptOutputCharacterStats('player_action').runs, 0);
        LLMClient.clearPromptProgressGroup('tinybrain-test-run', { recordOutputCharacters: true });
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });
        const entriesAfterClear = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .flatMap(event => Array.isArray(event.payload?.entries) ? event.payload.entries : []);
        const completed = entriesAfterClear.find(entry => (
            entry.progressGroupId === 'tinybrain-test-run'
            && entry.previewText === 'abcd'
            && entry.isComplete === true
        ));
        assert.ok(completed, 'expected the grouped prompt entry to complete only when the group clears');
        assert.equal(completed.progressFraction, 1);
        assert.equal(completed.receivedCount, 8);
        assert.equal(completed.targetCharacters, 120);
        assert.equal(completed.progressGroupId, 'tinybrain-test-run');
        assert.deepEqual(LLMClient.getPromptOutputCharacterStats('player_action_tinybrain'), {
            runs: 2,
            totalOutputCharacters: 128,
            averageOutputCharacters: 64,
            lastOutputCharacters: 8,
            updatedAt: LLMClient.getPromptOutputCharacterStats('player_action_tinybrain').updatedAt
        });
    } finally {
        LLMClient.clearPromptProgressGroup('tinybrain-test-run');
        axios.post = originalAxiosPost;
        Globals.realtimeHub = originalRealtimeHub;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('OpenAI-compatible stream progress counts decoded characters instead of UTF-8 bytes', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const baseDir = makeTempBaseDir('prompt-progress-stream-characters');
    const emittedEvents = [];
    installPromptProgressConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    axios.post = async () => {
        const responseStream = new Readable({ read() {} });
        process.nextTick(() => {
            responseStream.push('data: {"choices":[{"delta":{"content":"é"}}]}\n\n');
            responseStream.push('data: {"choices":[{"delta":{"content":"🙂"}}]}\n\n');
            responseStream.push('data: [DONE]\n\n');
            responseStream.push(null);
        });
        return {
            status: 200,
            statusText: 'OK',
            data: responseStream
        };
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Count streamed characters.' }],
            metadataLabel: 'player_action',
            validateXML: false,
            retryAttempts: 0,
            output: 'stdout'
        });

        assert.equal(result, 'é🙂');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });
        const activeEntries = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .flatMap(event => Array.isArray(event.payload?.entries) ? event.payload.entries : []);
        const finalPreview = activeEntries.find(entry => entry.previewText === 'é🙂');
        assert.ok(finalPreview, 'expected a prompt_progress entry with the decoded preview text');
        assert.equal(finalPreview.receivedUnit, 'characters');
        assert.equal(finalPreview.receivedCount, 2);
        assert.equal(finalPreview.bytes, 2);
        assert.equal(finalPreview.targetCharacters, 5000);
        assert.equal(finalPreview.runCount, 0);
        assert.equal(finalPreview.averageOutputCharacters, null);
        assert.ok(finalPreview.progressFraction > 0);
        assert.ok(finalPreview.progressFraction < 0.75);

        const stats = LLMClient.getPromptOutputCharacterStats('player_action');
        assert.equal(stats.runs, 1);
        assert.equal(stats.lastOutputCharacters, 2);
    } finally {
        axios.post = originalAxiosPost;
        Globals.realtimeHub = originalRealtimeHub;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});
