const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const SHOULD_RUN = process.env.PLAYWRIGHT_NEW_GAME_VEHICLE_REGRESSION === '1';
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_FORCED_OUTPUTS_PATH = path.join(
    ROOT_DIR,
    'tests',
    'e2e',
    'fixtures',
    'new_game_vehicle_region_forced_outputs.json'
);
const TMP_ROOT = path.join(ROOT_DIR, 'tmp');

let runtimeForcedOutputsPath = '';
let runtimeSettingId = '';
let runtimeSavedGameName = '';

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
    await setConfigValue(request, 'omit_npc_generation', 'true');
    await setConfigValue(request, 'omit_item_generation', 'true');
    await setConfigValue(request, 'slop_buster', 'false');
    await setConfigValue(request, 'factions.count', '0');
}

async function createAndApplyDeterministicSetting(request) {
    const settingName = `Vehicle Regression Setting ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createResponse = await request.post('/api/settings', {
        data: {
            name: settingName,
            description: 'Deterministic setting for vehicle region regression testing.',
            theme: 'Exploration and trade',
            genre: 'Science Fantasy',
            startingLocationType: 'Space Station',
            magicLevel: 'Medium',
            techLevel: 'Futuristic',
            tone: 'Dramatic',
            difficulty: 'Medium',
            currencyName: 'Credit',
            currencyNamePlural: 'Credits',
            defaultStartingLocation: 'Starfall Station',
            defaultFactionCount: 0,
            defaultExistingSkills: []
        }
    });
    const createPayload = await createResponse.json();
    if (!createResponse.ok() || !createPayload?.success || !createPayload?.setting?.id) {
        throw new Error(`Failed to create deterministic setting: status=${createResponse.status()} payload=${JSON.stringify(createPayload)}`);
    }

    runtimeSettingId = createPayload.setting.id;

    const applyResponse = await request.post(`/api/settings/${runtimeSettingId}/apply`);
    const applyPayload = await applyResponse.json();
    if (!applyResponse.ok() || !applyPayload?.success) {
        throw new Error(`Failed to apply deterministic setting: status=${applyResponse.status()} payload=${JSON.stringify(applyPayload)}`);
    }
}

test.describe('new game vehicle region regression', () => {
    test.skip(
        !SHOULD_RUN,
        'Set PLAYWRIGHT_NEW_GAME_VEHICLE_REGRESSION=1 to run the deterministic vehicle region regression.'
    );

    test.beforeAll(async ({ request }) => {
        requireFixture(FIXTURE_FORCED_OUTPUTS_PATH, 'Vehicle region forced outputs fixture');
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        const runSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        runtimeForcedOutputsPath = path.join(TMP_ROOT, `new_game_vehicle_regression_${runSuffix}_forced_outputs.json`);
        fs.copyFileSync(FIXTURE_FORCED_OUTPUTS_PATH, runtimeForcedOutputsPath);
        await createAndApplyDeterministicSetting(request);
    });

    test.afterAll(async ({ request }) => {
        if (runtimeSettingId) {
            const deleteResponse = await request.delete(`/api/settings/${runtimeSettingId}`);
            if (!deleteResponse.ok() && deleteResponse.status() !== 404) {
                const deletePayload = await deleteResponse.json();
                throw new Error(`Failed to clean up deterministic setting: status=${deleteResponse.status()} payload=${JSON.stringify(deletePayload)}`);
            }
        }
        if (runtimeForcedOutputsPath && fs.existsSync(runtimeForcedOutputsPath)) {
            fs.rmSync(runtimeForcedOutputsPath, { force: true });
        }
        if (runtimeSavedGameName) {
            console.log(`[new-game.vehicles.spec] Saved game retained for inspection: ${runtimeSavedGameName}`);
        }
    });

    test('creates a new game and region with vehicle stubs from captured logs', async ({ page, request }) => {
        await page.goto('/');
        await expect(page.locator('#messageInput')).toBeVisible();

        await configureDeterministicRuntime(request);

        const newGameResponse = await request.post('/api/new-game', {
            data: {
                playerName: 'Vehicle Regression Hero',
                playerDescription: 'A deterministic test pilot.',
                playerClass: 'Pilot',
                playerRace: 'Human',
                playerLevel: 1,
                startTime: 9,
                startingLocation: 'Starfall Station',
                startingCurrency: 50
            }
        });

        const newGamePayload = await newGameResponse.json();
        expect(newGameResponse.ok()).toBeTruthy();
        expect(newGamePayload?.success).toBeTruthy();
        expect(newGamePayload?.region?.name).toBe('Starfall Station');

        const locationsPayload = await getJson(request, '/api/locations');
        const locationSummaries = Array.isArray(locationsPayload?.locations) ? locationsPayload.locations : [];
        expect(locationSummaries.length).toBeGreaterThan(0);

        const locationByName = new Map(
            locationSummaries
                .filter(location => typeof location?.name === 'string' && location.name.trim())
                .map(location => [location.name.trim().toLowerCase(), location])
        );

        const stationCommand = locationByName.get('station command');
        const medBayAlpha = locationByName.get('med-bay alpha');
        expect(stationCommand).toBeTruthy();
        expect(medBayAlpha).toBeTruthy();

        const expectedVehicles = [
            { name: 'Small Shuttle for Hire', expectsFixedDestinations: false },
            { name: "Luminara's Sigh", expectsFixedDestinations: false },
            { name: 'Starfall Ring Monorail', expectsFixedDestinations: true }
        ];

        for (const expectedVehicle of expectedVehicles) {
            const summary = locationByName.get(expectedVehicle.name.toLowerCase());
            expect(summary, `Missing vehicle location "${expectedVehicle.name}"`).toBeTruthy();

            const detailPayload = await getJson(request, `/api/locations/${summary.id}?expandStubs=false`);
            const location = detailPayload?.location;
            expect(location?.isVehicle, `"${expectedVehicle.name}" should be flagged as vehicle`).toBe(true);
            expect(location?.vehicleInfo).toBeTruthy();
            expect(typeof location.vehicleInfo.vehicleExitId).toBe('string');
            expect(location.vehicleInfo.vehicleExitId.length).toBeGreaterThan(0);

            if (expectedVehicle.expectsFixedDestinations) {
                expect(Array.isArray(location.vehicleInfo.destinations)).toBe(true);
                expect(location.vehicleInfo.destinations).toEqual(expect.arrayContaining([
                    stationCommand.id,
                    medBayAlpha.id
                ]));
            } else {
                expect(Array.isArray(location.vehicleInfo.destinations)).toBe(true);
                expect(location.vehicleInfo.destinations.length).toBe(0);
                expect(location.vehicleInfo.currentDestination).toBeNull();
            }

            const exits = (location?.exits && typeof location.exits === 'object')
                ? Object.values(location.exits)
                : [];
            const vehicleExit = exits.find(exit => exit && exit.id === location.vehicleInfo.vehicleExitId);
            expect(vehicleExit, `"${expectedVehicle.name}" vehicleExitId should map to an actual exit`).toBeTruthy();
        }

        const savePayload = await getJson(request, '/api/save', 'POST', {});
        expect(typeof savePayload?.saveName).toBe('string');
        expect(savePayload.saveName.length).toBeGreaterThan(0);
        runtimeSavedGameName = savePayload.saveName;

        const savesPayload = await getJson(request, '/api/saves?type=saves');
        const saves = Array.isArray(savesPayload?.saves) ? savesPayload.saves : [];
        const hasSavedGame = saves.some(save => save && save.saveName === runtimeSavedGameName);
        expect(hasSavedGame).toBe(true);
    });
});
