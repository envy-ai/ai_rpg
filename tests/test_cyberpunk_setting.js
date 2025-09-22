const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const DESIRED_PORT = 3000;
const FALLBACK_PORTS = [DESIRED_PORT, 7777];
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTING_FILE = path.join(ROOT_DIR, 'saves', 'settings', 'Cyberpunk_setting_1758055084940_187692209420.json');

const SETTING_PAYLOAD = JSON.parse(fs.readFileSync(SETTING_FILE, 'utf8'));
const SETTING_ID = SETTING_PAYLOAD.id;

let activePort = DESIRED_PORT;
let client = createClient(activePort);

function createClient(port) {
    return axios.create({
        baseURL: `http://localhost:${port}`,
        timeout: 120000
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    const start = Date.now();
    const timeout = 60000;
    while (Date.now() - start < timeout) {
        for (const port of FALLBACK_PORTS) {
            try {
                const response = await axios.get(`http://localhost:${port}/api/hello`, { timeout: 2000 });
                if (response.status === 200) {
                    if (activePort !== port) {
                        activePort = port;
                        client = createClient(port);
                    }
                    return;
                }
            } catch (_) {
                // retry
            }
        }
        await delay(500);
    }
    throw new Error(`Server failed to respond on ports ${FALLBACK_PORTS.join(', ')} within timeout`);
}

async function main() {
    const server = spawn('node', ['server.js', '--port', String(DESIRED_PORT)], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
    server.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

    const cleanup = () => {
        if (!server.killed) {
            server.kill();
        }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
        cleanup();
        process.exit(1);
    });

    try {
        console.log('Waiting for server to be ready...');
        await waitForServer();
        console.log(`Server available on port ${activePort}`);

        console.log('Loading settings from disk...');
        const loadSettingsResponse = await client.post('/api/settings/load');
        if (!loadSettingsResponse.data?.success) {
            throw new Error(`Failed to load settings: ${loadSettingsResponse.data?.error || 'unknown error'}`);
        }

        console.log('Fetching loaded settings...');
        const listSettingsResponse = await client.get('/api/settings');
        const settings = listSettingsResponse.data?.settings || [];
        const targetSetting = settings.find(setting => setting.id === SETTING_ID || setting.name === SETTING_PAYLOAD.name);
        if (!targetSetting) {
            throw new Error(`Setting ${SETTING_ID} not found after load`);
        }

        console.log(`Applying setting ${SETTING_ID} (${targetSetting.name})...`);
        const applyResponse = await client.post(`/api/settings/${targetSetting.id}/apply`);
        if (!applyResponse.data?.success) {
            throw new Error(`Failed to apply setting: ${applyResponse.data?.error || 'unknown error'}`);
        }

        console.log('Starting new game with Cyberpunk defaults...');
        const newGamePayload = {
            playerName: (SETTING_PAYLOAD.defaultPlayerName || '').trim(),
            playerDescription: (SETTING_PAYLOAD.defaultPlayerDescription || '').trim(),
            startingLocation: (SETTING_PAYLOAD.defaultStartingLocation || '').trim(),
            numSkills: SETTING_PAYLOAD.defaultNumSkills,
            existingSkills: Array.isArray(SETTING_PAYLOAD.defaultExistingSkills)
                ? SETTING_PAYLOAD.defaultExistingSkills
                : []
        };

        const newGameResponse = await client.post('/api/new-game', newGamePayload);
        if (!newGameResponse.data?.success) {
            throw new Error(`Failed to start new game: ${newGameResponse.data?.error || 'unknown error'}`);
        }

        const { player, startingLocation } = newGameResponse.data;
        if (!startingLocation || !Array.isArray(startingLocation.npcs) || startingLocation.npcs.length === 0) {
            throw new Error('Starting location is missing NPCs after new game');
        }

        if (!player || !Array.isArray(player.inventory) || player.inventory.length === 0) {
            throw new Error('Player inventory is empty after new game');
        }

        console.log('Fetching current player status for verification...');
        const playerStatusResp = await client.get('/api/player');
        const playerStatus = playerStatusResp.data?.player;
        if (!playerStatus) {
            throw new Error('Failed to retrieve player status after new game');
        }

        if (!Array.isArray(playerStatus.inventory) || playerStatus.inventory.length === 0) {
            throw new Error('Player status indicates empty inventory');
        }

        if (!playerStatus.currentLocation) {
            throw new Error('Player current location is missing');
        }

        console.log(`Verifying starting location ${playerStatus.currentLocation} has NPCs...`);
        const locationResponse = await client.get(`/api/locations/${playerStatus.currentLocation}`);
        if (!locationResponse.data?.success) {
            throw new Error(`Failed to fetch starting location: ${locationResponse.data?.error || 'unknown error'}`);
        }

        const locationData = locationResponse.data.location;
        if (!locationData || !Array.isArray(locationData.npcs) || locationData.npcs.length === 0) {
            throw new Error('Starting location fetched via API does not list any NPCs');
        }

        console.log('✅ Cyberpunk setting sanity check passed.');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exitCode = 1;
    } finally {
        cleanup();
    }
}

if (require.main === module) {
    main();
}
