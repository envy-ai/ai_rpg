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

const REGION_STUB_FORCED_OUTPUT = [
    '<region>',
    '  <regionName>Luminara\'s Sigh</regionName>',
    '  <regionDescription>The elven vessel opens into a quiet crystalline interior threaded with living light.</regionDescription>',
    '  <shortDescription>A serene crystal-lined starship interior.</shortDescription>',
    '  <relativeLevel>0</relativeLevel>',
    '  <numImportantNPCs>0</numImportantNPCs>',
    '  <weather>',
    '    <hasDynamicWeather>false</hasDynamicWeather>',
    '  </weather>',
    '  <locations>',
    '    <location>',
    '      <name>Starlight Vestibule</name>',
    '      <description>A luminous arrival deck of curved crystal and soft starlight, with an obvious route back to Docking Bay 17.</description>',
    '      <shortDescription>A quiet crystalline entry deck.</shortDescription>',
    '      <hasWeather>false</hasWeather>',
    '      <controllingFaction>None</controllingFaction>',
    '      <relativeLevel>0</relativeLevel>',
    '      <notesAboutExits>Connects back to Docking Bay 17.</notesAboutExits>',
    '      <numNPCs>0</numNPCs>',
    '      <numHostiles>0</numHostiles>',
    '      <exits>',
    '        <exit>Docking Bay 17</exit>',
    '      </exits>',
    '    </location>',
    '  </locations>',
    '  <randomStoryEvents />',
    '  <characterConcepts />',
    '  <enemyConcepts />',
    '  <secrets />',
    '</region>'
].join('\n');

const LOCATION_GENERATION_FORCED_OUTPUT = [
    '<location>',
    '  <name>Deterministic Expanded Location</name>',
    '  <description>A deterministic expanded location used by the vehicle regression fixture.</description>',
    '  <shortDescription>A deterministic expanded location.</shortDescription>',
    '  <relativeLevel>0</relativeLevel>',
    '  <numItems>0</numItems>',
    '  <numScenery>0</numScenery>',
    '  <numNpcs>0</numNpcs>',
    '  <numHostiles>0</numHostiles>',
    '  <hasWeather>false</hasWeather>',
    '  <notesAboutExits>Connects back to the source area.</notesAboutExits>',
    '  <exits></exits>',
    '</location>'
].join('\n');

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

async function updateVehicleIcon(request, locationId, icon) {
    const normalizedLocationId = typeof locationId === 'string' ? locationId.trim() : '';
    const normalizedIcon = typeof icon === 'string' ? icon.trim() : '';
    if (!normalizedLocationId) {
        throw new Error('updateVehicleIcon requires a locationId.');
    }
    if (!normalizedIcon) {
        throw new Error('updateVehicleIcon requires a non-empty icon.');
    }

    const detailPayload = await getJson(request, `/api/locations/${normalizedLocationId}?expandStubs=false`);
    const location = detailPayload?.location;
    if (!location) {
        throw new Error(`Unable to load vehicle location "${normalizedLocationId}" for icon update.`);
    }
    if (!location.isVehicle || !location.vehicleInfo) {
        throw new Error(`Location "${normalizedLocationId}" is not a vehicle with vehicleInfo.`);
    }

    const level = Number.isFinite(location.baseLevel)
        ? Number(location.baseLevel)
        : (Number.isFinite(location.level) ? Number(location.level) : 1);
    const name = typeof location.name === 'string' ? location.name : null;
    const description = typeof location.description === 'string' ? location.description : '';

    const updateBody = {
        name,
        description,
        level,
        isVehicle: true,
        vehicleInfo: {
            ...location.vehicleInfo,
            icon: normalizedIcon
        }
    };

    if (Object.prototype.hasOwnProperty.call(location, 'shortDescription')) {
        updateBody.shortDescription = location.shortDescription;
    }

    const response = await request.put(`/api/locations/${normalizedLocationId}`, {
        data: updateBody
    });
    const payload = await response.json();
    if (!response.ok() || payload?.success === false) {
        throw new Error(`Failed to update vehicle icon for "${normalizedLocationId}" (${response.status()}): ${JSON.stringify(payload)}`);
    }
    return payload.location;
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

function injectRegionStubForcedOutput(pathToForcedOutputs) {
    const raw = fs.readFileSync(pathToForcedOutputs, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Forced outputs fixture must be an object.');
    }
    if (!parsed.byMetadataLabel || typeof parsed.byMetadataLabel !== 'object' || Array.isArray(parsed.byMetadataLabel)) {
        parsed.byMetadataLabel = {};
    }
    const existing = parsed.byMetadataLabel.region_stub_locations;
    const normalizedExisting = Array.isArray(existing) ? existing : [];
    parsed.byMetadataLabel.region_stub_locations = [...normalizedExisting, REGION_STUB_FORCED_OUTPUT];

    const locationGenerationExisting = parsed.byMetadataLabel.location_generation;
    const normalizedLocationGenerationExisting = Array.isArray(locationGenerationExisting) ? locationGenerationExisting : [];
    parsed.byMetadataLabel.location_generation = [
        ...normalizedLocationGenerationExisting,
        LOCATION_GENERATION_FORCED_OUTPUT,
        LOCATION_GENERATION_FORCED_OUTPUT,
        LOCATION_GENERATION_FORCED_OUTPUT,
        LOCATION_GENERATION_FORCED_OUTPUT,
        LOCATION_GENERATION_FORCED_OUTPUT,
        LOCATION_GENERATION_FORCED_OUTPUT
    ];

    const entranceExisting = parsed.byMetadataLabel.region_entrance_selection;
    const normalizedEntranceExisting = Array.isArray(entranceExisting) ? entranceExisting : [];
    if (normalizedEntranceExisting.length > 0) {
        parsed.byMetadataLabel.region_entrance_selection = [
            ...normalizedEntranceExisting,
            normalizedEntranceExisting[0],
            normalizedEntranceExisting[0],
            normalizedEntranceExisting[0]
        ];
    }

    fs.writeFileSync(pathToForcedOutputs, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
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
        injectRegionStubForcedOutput(runtimeForcedOutputsPath);
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
            { name: 'Small Shuttle for Hire', expectsFixedDestinations: false, icon: '🚁' },
            { name: "Luminara's Sigh", expectsFixedDestinations: false, icon: '🛸' },
            { name: 'Starfall Ring Monorail', expectsFixedDestinations: true, icon: '🚈' }
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

            const updatedVehicle = await updateVehicleIcon(request, summary.id, expectedVehicle.icon);
            expect(updatedVehicle?.vehicleInfo?.icon).toBe(expectedVehicle.icon);
        }

        const dockingBay17 = locationByName.get('docking bay 17');
        const luminarasSigh = locationByName.get("luminara's sigh");
        expect(dockingBay17).toBeTruthy();
        expect(luminarasSigh).toBeTruthy();

        let currentBeforeMovePayload = await getJson(request, '/api/locations?scope=current');
        let currentBeforeMove = currentBeforeMovePayload?.location;
        expect(currentBeforeMove?.id).toBeTruthy();

        if (currentBeforeMove.id !== dockingBay17.id) {
            const repositionPayload = await getJson(request, '/api/player/move', 'POST', {
                destinationId: dockingBay17.id,
                expectedOriginLocationId: currentBeforeMove.id
            });
            expect(repositionPayload?.success).toBeTruthy();
            currentBeforeMove = repositionPayload?.location;
        }

        expect(currentBeforeMove?.id).toBe(dockingBay17.id);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#locationName')).toContainText('Docking Bay 17');

        const inboundLuminaraButton = page.locator('#locationExitsList .exit-button', { hasText: "Luminara's Sigh" }).first();
        const inboundShuttleButton = page.locator('#locationExitsList .exit-button', { hasText: 'Small Shuttle for Hire' }).first();

        await expect(inboundLuminaraButton).toBeVisible();
        await expect(inboundLuminaraButton.locator('.exit-button-icon')).toHaveText('🛸');
        await expect(inboundLuminaraButton.locator('.exit-button-label')).not.toContainText('⬅️ Exit Vehicle:');

        await expect(inboundShuttleButton).toBeVisible();
        await expect(inboundShuttleButton.locator('.exit-button-icon')).toHaveText('🚁');
        await expect(inboundShuttleButton.locator('.exit-button-label')).not.toContainText('⬅️ Exit Vehicle:');

        const movePayload = await getJson(request, '/api/player/move', 'POST', {
            destinationId: luminarasSigh.id,
            expectedOriginLocationId: currentBeforeMove.id
        });
        expect(movePayload?.success).toBeTruthy();

        const currentAfterMovePayload = await getJson(request, '/api/locations?scope=current');
        const currentAfterMove = currentAfterMovePayload?.location;
        expect(currentAfterMove?.id).toBeTruthy();
        expect(typeof currentAfterMove?.vehicleCurrentLocationName).toBe('string');
        expect(currentAfterMove.vehicleCurrentLocationName.trim().length).toBeGreaterThan(0);

        const expandedVehicleRegionLocationPayload = await getJson(request, `/api/locations/${currentAfterMove.id}`);
        const expandedVehicleRegionLocation = expandedVehicleRegionLocationPayload?.location;
        expect(expandedVehicleRegionLocation?.region?.isVehicle).toBe(true);

        const regionVehicleInfo = expandedVehicleRegionLocation?.region?.vehicleInfo;
        expect(regionVehicleInfo).toBeTruthy();
        expect(typeof regionVehicleInfo.vehicleExitId).toBe('string');
        expect(regionVehicleInfo.vehicleExitId.length).toBeGreaterThan(0);

        const expandedExits = (expandedVehicleRegionLocation?.exits && typeof expandedVehicleRegionLocation.exits === 'object')
            ? Object.values(expandedVehicleRegionLocation.exits)
            : [];
        const remappedVehicleExit = expandedExits.find(exit => exit && exit.id === regionVehicleInfo.vehicleExitId);
        expect(remappedVehicleExit, 'Region vehicleExitId should resolve after region-entry stub expansion').toBeTruthy();

        const outboundVehicleExitName = 'Vehicle Outbound Regression Target';
        const createOutboundVehicleExitPayload = await getJson(
            request,
            `/api/locations/${expandedVehicleRegionLocation.id}/exits`,
            'POST',
            {
                type: 'location',
                name: outboundVehicleExitName,
                description: 'Deterministic outbound vehicle-exit regression target.',
                vehicleType: 'airlock'
            }
        );
        expect(createOutboundVehicleExitPayload?.success).toBeTruthy();
        expect(createOutboundVehicleExitPayload?.location?.id).toBe(expandedVehicleRegionLocation.id);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#locationName')).toContainText("Luminara's Sigh");

        const outboundVehicleButton = page.locator(
            '#locationExitsList .exit-button',
            { hasText: outboundVehicleExitName }
        ).first();
        await expect(outboundVehicleButton).toBeVisible();
        await expect(outboundVehicleButton.locator('.exit-button-label')).toContainText('Exit Vehicle:');
        await expect(outboundVehicleButton.locator('.exit-button-icon')).toHaveText(/⬅/);

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
