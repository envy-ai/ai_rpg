#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import {
    findChangedLogs,
    FollowupApiClient,
    getLogManifest,
    nextAttemptDirectory,
    parseBooleanChoice,
    readJsonFile,
    RealtimeSession,
    requireText,
    writeJson
} from './lib/followup_api_playtest/core.mjs';
import {
    buildCassetteConfigValues,
    loadConfigProfile,
    writeConfigProfileOverride
} from './lib/followup_api_playtest/config_profiles.mjs';
import { promoteFixture } from './lib/followup_api_playtest/fixtures.mjs';
import { readScenarioFile, runScenario } from './lib/followup_api_playtest/scenario.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE_URL = process.env.AI_RPG_TEST_BASE_URL || 'http://127.0.0.1:7777';
const WS_URL = process.env.AI_RPG_TEST_WS_URL || 'ws://127.0.0.1:7777/ws';

function parseArgs(argv) {
    const result = { _: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            result._.push(token);
            continue;
        }
        const equalsIndex = token.indexOf('=');
        if (equalsIndex !== -1) {
            result[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
            continue;
        }
        const key = token.slice(2);
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
            result[key] = next;
            index += 1;
        } else {
            result[key] = true;
        }
    }
    return result;
}

function buildInteractivePolicy(options) {
    return {
        roll: options.roll === undefined ? null : Number(options.roll),
        questAccepted: parseBooleanChoice(options.quest, false),
        confirmed: parseBooleanChoice(options.confirm, false),
        answer: options.answer
    };
}

async function runRecordedRequest(options, request) {
    const scenario = requireText(options.scenario, '--scenario');
    const caseName = requireText(options.case, '--case');
    const attemptDir = await nextAttemptDirectory(ROOT, scenario, caseName);
    const apiClient = new FollowupApiClient({ baseUrl: BASE_URL });
    const startedAt = new Date().toISOString();
    const beforeLogs = await getLogManifest(ROOT);
    const before = await apiClient.captureState();
    await writeJson(attemptDir, 'before.json', before);
    await writeJson(attemptDir, 'request.json', request);

    const result = await apiClient.fetchJson(request.method, request.route, request.body);
    const after = await apiClient.captureState();
    const afterLogs = await getLogManifest(ROOT);
    const changedLogs = findChangedLogs(beforeLogs, afterLogs);

    await writeJson(attemptDir, 'response.json', result);
    await writeJson(attemptDir, 'after.json', after);
    await writeJson(attemptDir, 'logs.json', { startedAt, finishedAt: new Date().toISOString(), changedLogs });
    return { attemptDir, result };
}

async function runInteractiveRequest(options, request) {
    const scenario = requireText(options.scenario, '--scenario');
    const caseName = requireText(options.case, '--case');
    const attemptDir = await nextAttemptDirectory(ROOT, scenario, caseName);
    const apiClient = new FollowupApiClient({ baseUrl: BASE_URL });
    const realtime = new RealtimeSession({
        apiClient,
        wsUrl: WS_URL,
        clientId: options['client-id']
    });
    await realtime.connect();
    const identifiers = realtime.beginRequest(
        buildInteractivePolicy(options),
        options['request-id']
    );
    request.body = request.body && typeof request.body === 'object'
        ? { ...request.body, ...identifiers }
        : { ...identifiers };

    const startedAt = new Date().toISOString();
    const beforeLogs = await getLogManifest(ROOT);
    const before = await apiClient.captureState();
    await writeJson(attemptDir, 'before.json', before);
    await writeJson(attemptDir, 'request.json', request);
    let result;
    try {
        result = await apiClient.fetchJson(request.method, request.route, request.body);
    } finally {
        realtime.endRequest(identifiers.requestId);
        await new Promise(resolve => setTimeout(resolve, 100));
        await realtime.close();
    }
    const after = await apiClient.captureState();
    const afterLogs = await getLogManifest(ROOT);
    const changedLogs = findChangedLogs(beforeLogs, afterLogs);

    await writeJson(attemptDir, 'response.json', result);
    await writeJson(attemptDir, 'realtime.json', realtime.events);
    await writeJson(attemptDir, 'after.json', after);
    await writeJson(attemptDir, 'logs.json', { startedAt, finishedAt: new Date().toISOString(), changedLogs });
    return { attemptDir, result };
}

async function runChat(options) {
    const text = options['text-file']
        ? await import('node:fs/promises').then(fs => fs.readFile(path.resolve(ROOT, options['text-file']), 'utf8'))
        : requireText(options.text, '--text or --text-file');
    const request = {
        method: 'POST',
        route: '/api/chat',
        body: {
            messages: [{ role: 'user', content: text }],
            travel: parseBooleanChoice(options.travel, false)
        }
    };
    if (options['travel-metadata-file']) {
        request.body.travelMetadata = await readJsonFile(ROOT, options['travel-metadata-file']);
    }
    return await runInteractiveRequest(options, request);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const command = options._[0];
    let output;
    if (command === 'chat') {
        output = await runChat(options);
    } else if (command === 'interactive-request') {
        const method = requireText(options.method, '--method').toUpperCase();
        const route = requireText(options.route, '--route');
        const body = options['body-file'] ? await readJsonFile(ROOT, options['body-file']) : undefined;
        output = await runInteractiveRequest(options, { method, route, body });
    } else if (command === 'request') {
        const method = requireText(options.method, '--method').toUpperCase();
        const route = requireText(options.route, '--route');
        const body = options['body-file'] ? await readJsonFile(ROOT, options['body-file']) : undefined;
        output = await runRecordedRequest(options, { method, route, body });
    } else if (command === 'snapshot') {
        const scenario = requireText(options.scenario, '--scenario');
        const caseName = requireText(options.case, '--case');
        const attemptDir = await nextAttemptDirectory(ROOT, scenario, caseName);
        const apiClient = new FollowupApiClient({ baseUrl: BASE_URL });
        await writeJson(attemptDir, 'snapshot.json', await apiClient.captureState());
        output = { attemptDir, result: { ok: true, status: 200 } };
    } else if (command === 'scenario') {
        const definition = await readScenarioFile(ROOT, requireText(options.file, '--file'));
        output = await runScenario({
            root: ROOT,
            definition,
            mode: requireText(options.mode, '--mode'),
            baseUrl: BASE_URL,
            wsUrl: WS_URL,
            cassettePath: options.cassette || null,
            keepRuntimeFixture: parseBooleanChoice(options['keep-runtime-fixture'], false)
        });
    } else if (command === 'prepare-config') {
        const profile = await loadConfigProfile(ROOT, requireText(options.profile, '--profile'));
        const additionalValues = options.mode
            ? buildCassetteConfigValues(
                requireText(options.mode, '--mode'),
                options.cassette || null
            )
            : {};
        const outputPath = await writeConfigProfileOverride(ROOT, profile, options.output || null, {
            additionalValues,
            baseOverridePath: options['base-override'] || null
        });
        output = {
            attemptDir: path.dirname(outputPath),
            result: { ok: true, status: 200, payload: { profile: profile.name, outputPath } }
        };
    } else if (command === 'promote-fixture') {
        const manifestInput = await readJsonFile(ROOT, requireText(options['manifest-file'], '--manifest-file'));
        const promoted = await promoteFixture(ROOT, {
            name: requireText(options.name, '--name'),
            sourceSaveName: requireText(options['source-save'], '--source-save'),
            sourceSaveType: options['source-type'] || 'saves',
            manifestInput,
            replace: parseBooleanChoice(options.replace, false)
        });
        output = {
            attemptDir: promoted.fixtureRoot,
            result: { ok: true, status: 200, payload: promoted.manifest }
        };
    } else {
        throw new Error(
            'Usage: followup_api_playtest.mjs '
            + '<chat|interactive-request|request|snapshot|scenario|prepare-config|promote-fixture> ...'
        );
    }
    console.log(JSON.stringify({
        artifactDirectory: path.relative(ROOT, output.attemptDir),
        status: output.result.status,
        ok: output.result.ok,
        error: output.result.payload?.error || null,
        payload: ['prepare-config', 'promote-fixture'].includes(command) ? output.result.payload : undefined
    }, null, 2));
    if (!output.result.ok) process.exitCode = 1;
}

main().catch((error) => {
    console.error(JSON.stringify({
        error: error.message,
        artifactDirectory: error.attemptDir ? path.relative(ROOT, error.attemptDir) : null,
        stack: error.stack || null
    }, null, 2));
    process.exitCode = 1;
});
