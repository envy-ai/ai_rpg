const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const SHOULD_RUN = process.env.PLAYWRIGHT_PLAYTHROUGH_REGRESSION === '1';
const PLAYTHROUGH_MODE = (process.env.PLAYWRIGHT_PLAYTHROUGH_MODE || 'attack').trim().toLowerCase();
const RUN_ATTACK_MODE = PLAYTHROUGH_MODE === 'attack' || PLAYTHROUGH_MODE === 'all';
const RUN_REGION_MODE = PLAYTHROUGH_MODE === 'region' || PLAYTHROUGH_MODE === 'all';
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_SAVE_DIR = path.join(ROOT_DIR, 'tests', 'e2e', 'fixtures', 'playthrough_save_start');
const FIXTURE_FORCED_OUTPUTS_PATH = path.join(
    ROOT_DIR,
    'tests',
    'e2e',
    'fixtures',
    'playthrough_regression_forced_outputs.json'
);
const AUTOSAVE_ROOT = path.join(ROOT_DIR, 'autosaves');
const TMP_ROOT = path.join(ROOT_DIR, 'tmp');

let runtimeSaveName = '';
let runtimeSaveDir = '';
let runtimeForcedOutputsPath = '';

function requireFixture(pathToCheck, label) {
    if (!fs.existsSync(pathToCheck)) {
        throw new Error(`${label} not found at ${pathToCheck}`);
    }
}

async function runSlashCommand(request, command, args = {}) {
    const response = await request.post('/api/slash-command', {
        data: { command, args }
    });
    const payload = await response.json();
    if (!response.ok()) {
        throw new Error(`Slash command "${command}" failed (${response.status()}): ${JSON.stringify(payload)}`);
    }
    if (!payload?.success) {
        throw new Error(`Slash command "${command}" returned unsuccessful payload: ${JSON.stringify(payload)}`);
    }
    return payload;
}

async function setConfigValue(request, configPath, value) {
    await runSlashCommand(request, 'set', {
        path: configPath,
        value
    });
}

async function getJson(request, url, method = 'GET', data = undefined) {
    const response = method === 'GET'
        ? await request.get(url)
        : await request.post(url, { data });
    const payload = await response.json();
    if (!response.ok() || payload?.success === false) {
        throw new Error(`${method} ${url} failed (${response.status()}): ${JSON.stringify(payload)}`);
    }
    return payload;
}

async function configureDeterministicRuntime(request) {
    await setConfigValue(request, 'ai.force_outputs_file', runtimeForcedOutputsPath);
    await setConfigValue(request, 'random_event_frequency.enabled', 'false');
    await setConfigValue(request, 'supplemental_story_info_prompt_frequency', '0');
    await setConfigValue(request, 'offscreen_npc_activity_prompt_count', '0');
    await setConfigValue(request, 'offscreen_npc_activity_daily_max_turns_between_prompts', '0');
    await setConfigValue(request, 'offscreen_npc_activity_weekly_max_turns_between_prompts', '0');
    await setConfigValue(request, 'plot_expander_prompt_frequency', '0');
    await setConfigValue(request, 'npc_turns.enabled', 'false');
    await setConfigValue(request, 'combat_npc_turns.enabled', 'false');
    await setConfigValue(request, 'imagegen.enabled', 'false');
}

async function loadRuntimeSave(request) {
    const payload = await getJson(request, '/api/load', 'POST', {
        saveName: runtimeSaveName,
        saveType: 'autosaves'
    });
    expect(payload?.success).toBeTruthy();
}

async function listLocations(request) {
    const payload = await getJson(request, '/api/locations');
    return Array.isArray(payload?.locations) ? payload.locations : [];
}

async function getCurrentLocation(request) {
    const payload = await getJson(request, '/api/locations?scope=current');
    return payload.location;
}

async function getCurrentPlayer(request) {
    const payload = await getJson(request, '/api/player');
    return payload.player;
}

async function movePlayer(request, { destinationId, expectedOriginLocationId }) {
    const payload = await getJson(request, '/api/player/move', 'POST', {
        destinationId,
        expectedOriginLocationId
    });
    expect(payload?.success).toBeTruthy();
    return payload;
}

function normalizeExits(location) {
    if (!location || typeof location !== 'object' || !location.exits || typeof location.exits !== 'object') {
        return [];
    }
    return Object.entries(location.exits).map(([direction, exit]) => ({ direction, ...(exit || {}) }));
}

function findLocationByName(locations, targetName) {
    const needle = typeof targetName === 'string' ? targetName.trim().toLowerCase() : '';
    return locations.find(location => (
        typeof location?.name === 'string' && location.name.trim().toLowerCase() === needle
    )) || null;
}

test.describe('playthrough regression', () => {
    test.describe.configure({ mode: 'serial' });

    test.skip(
        !SHOULD_RUN,
        'Set PLAYWRIGHT_PLAYTHROUGH_REGRESSION=1 to run the deterministic playthrough regression.'
    );

    test.beforeAll(async () => {
        requireFixture(FIXTURE_SAVE_DIR, 'Playthrough save fixture');
        requireFixture(FIXTURE_FORCED_OUTPUTS_PATH, 'Forced outputs fixture');

        fs.mkdirSync(AUTOSAVE_ROOT, { recursive: true });
        fs.mkdirSync(TMP_ROOT, { recursive: true });

        const runSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        runtimeSaveName = `playthrough_regression_${runSuffix}`;
        runtimeSaveDir = path.join(AUTOSAVE_ROOT, runtimeSaveName);
        runtimeForcedOutputsPath = path.join(TMP_ROOT, `${runtimeSaveName}_forced_outputs.json`);

        fs.cpSync(FIXTURE_SAVE_DIR, runtimeSaveDir, { recursive: true });
        fs.copyFileSync(FIXTURE_FORCED_OUTPUTS_PATH, runtimeForcedOutputsPath);

        const metadataPath = path.join(runtimeSaveDir, 'metadata.json');
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        metadata.saveName = runtimeSaveName;
        metadata.source = 'autosaves';
        metadata.timestamp = new Date().toISOString();
        fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    });

    test.afterAll(async () => {
        if (runtimeSaveDir && fs.existsSync(runtimeSaveDir)) {
            fs.rmSync(runtimeSaveDir, { recursive: true, force: true });
        }
        if (runtimeForcedOutputsPath && fs.existsSync(runtimeForcedOutputsPath)) {
            fs.rmSync(runtimeForcedOutputsPath, { force: true });
        }
    });

    test('replays captured attack turn deterministically from autosave fixture', async ({ page, request }) => {
        test.skip(!RUN_ATTACK_MODE, `Set PLAYWRIGHT_PLAYTHROUGH_MODE=attack (or all); current mode=${PLAYTHROUGH_MODE}`);

        await page.goto('/');
        await expect(page.locator('#messageInput')).toBeVisible();

        await configureDeterministicRuntime(request);
        await loadRuntimeSave(request);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#locationName')).toContainText('The Sinking Stairs');

        await page.fill('#messageInput', 'I attack Hollow Sentinel Valdrus. <1>');
        const chatResponsePromise = page.waitForResponse((response) => {
            if (response.request().method() !== 'POST') {
                return false;
            }
            return response.url().includes('/api/chat');
        });
        await page.click('#sendButton');
        const chatResponse = await chatResponsePromise;

        expect(chatResponse.ok()).toBeTruthy();
        const chatPayload = await chatResponse.json();
        expect(typeof chatPayload?.response).toBe('string');
        expect(chatPayload.response).toContain('You draw your worn iron longsword');
        expect(chatPayload.response).toContain('Hollow Sentinel Valdrus');
    });

    test('validates cross-region round-trip exits are unique and no double-travel occurs', async ({ page, request }) => {
        test.skip(!RUN_REGION_MODE, `Set PLAYWRIGHT_PLAYTHROUGH_MODE=region (or all); current mode=${PLAYTHROUGH_MODE}`);

        await page.goto('/');
        await expect(page.locator('#messageInput')).toBeVisible();

        await configureDeterministicRuntime(request);
        await loadRuntimeSave(request);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#locationName')).toContainText('The Sinking Stairs');

        const locations = await listLocations(request);
        const locationRegionById = new Map(locations.map(location => [location.id, location.regionId || null]));
        const sinkingStairs = findLocationByName(locations, 'The Sinking Stairs');
        const warningPost = findLocationByName(locations, 'Warning Post');
        const memorialWalk = findLocationByName(locations, 'Memorial Walk');
        const lastChanceMarket = findLocationByName(locations, 'Last Chance Market');
        const guildhallExterior = findLocationByName(locations, 'Guildhall Exterior');

        expect(sinkingStairs).toBeTruthy();
        expect(warningPost).toBeTruthy();
        expect(memorialWalk).toBeTruthy();
        expect(lastChanceMarket).toBeTruthy();
        expect(guildhallExterior).toBeTruthy();
        expect(sinkingStairs.regionId).toBeTruthy();
        expect(warningPost.regionId).toBe(sinkingStairs.regionId);
        expect(memorialWalk.regionId).toBe(sinkingStairs.regionId);
        expect(lastChanceMarket.regionId).toBe(sinkingStairs.regionId);
        expect(guildhallExterior.regionId).not.toBe(sinkingStairs.regionId);

        const currentLocation = await getCurrentLocation(request);
        expect(currentLocation?.id).toBe(sinkingStairs.id);

        const moveToWarningPost = await movePlayer(request, {
            destinationId: warningPost.id,
            expectedOriginLocationId: sinkingStairs.id
        });
        expect(moveToWarningPost?.location?.id).toBe(warningPost.id);

        const moveToMemorialWalk = await movePlayer(request, {
            destinationId: memorialWalk.id,
            expectedOriginLocationId: warningPost.id
        });
        expect(moveToMemorialWalk?.location?.id).toBe(memorialWalk.id);

        const moveToLastChanceMarket = await movePlayer(request, {
            destinationId: lastChanceMarket.id,
            expectedOriginLocationId: memorialWalk.id
        });
        expect(moveToLastChanceMarket?.location?.id).toBe(lastChanceMarket.id);

        const previousRegionId = lastChanceMarket.regionId;
        const newRegionId = guildhallExterior.regionId;

        const moveToNewRegion = await movePlayer(request, {
            destinationId: guildhallExterior.id,
            expectedOriginLocationId: lastChanceMarket.id
        });
        expect(moveToNewRegion?.location?.id).toBe(guildhallExterior.id);
        expect(moveToNewRegion?.location?.regionId).toBe(newRegionId);

        const playerAfterCrossRegionMove = await getCurrentPlayer(request);
        const playerLocationAfterCross = playerAfterCrossRegionMove?.locationId || playerAfterCrossRegionMove?.currentLocation || null;
        expect(playerLocationAfterCross).toBe(guildhallExterior.id);

        const exitsFromNewRegionLocation = normalizeExits(moveToNewRegion.location);
        const exitsBackToPreviousRegion = exitsFromNewRegionLocation.filter((exit) => {
            const destinationRegionId = exit.destinationRegion || locationRegionById.get(exit.destination) || null;
            return destinationRegionId === previousRegionId;
        });

        const issues = [];
        if (exitsBackToPreviousRegion.length !== 1) {
            issues.push(
                `Expected exactly 1 exit from "${guildhallExterior.name}" to previous region `
                + `(${previousRegionId}), found ${exitsBackToPreviousRegion.length}.`
            );
        }

        const returnExit = exitsBackToPreviousRegion[0] || null;
        if (!returnExit?.destination) {
            issues.push('Unable to resolve a return exit destination to the previous region.');
        } else {
            const moveBackToPreviousRegion = await movePlayer(request, {
                destinationId: returnExit.destination,
                expectedOriginLocationId: guildhallExterior.id
            });
            expect(moveBackToPreviousRegion?.location?.id).toBe(returnExit.destination);
            expect(moveBackToPreviousRegion?.location?.regionId).toBe(previousRegionId);

            const exitsFromReturnedLocation = normalizeExits(moveBackToPreviousRegion.location);
            const exitsBackToNewRegion = exitsFromReturnedLocation.filter((exit) => {
                const destinationRegionId = exit.destinationRegion || locationRegionById.get(exit.destination) || null;
                return destinationRegionId === newRegionId;
            });
            if (exitsBackToNewRegion.length !== 1) {
                issues.push(
                    `Expected exactly 1 exit back to new region (${newRegionId}) from "${moveBackToPreviousRegion.location?.name}", `
                    + `found ${exitsBackToNewRegion.length}.`
                );
            }
            if (exitsBackToNewRegion[0]?.destination !== guildhallExterior.id) {
                issues.push('Return path did not point back to the same new-region location.');
            }
        }

        if (issues.length) {
            throw new Error(issues.join('\n'));
        }
    });
});
