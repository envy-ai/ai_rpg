const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const DESIRED_PORT = 3000;
const FALLBACK_PORTS = [DESIRED_PORT, 7777];
const SAVE_NAME = '2025-09-21T13-13-37-677Z_Baato';
const SERVER_START_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;
const ROOT_DIR = path.resolve(__dirname, '..');

let activePort = DESIRED_PORT;
let client = createClient(activePort);

function createClient(port) {
    return axios.create({
        baseURL: `http://localhost:${port}`,
        timeout: 300000
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    const start = Date.now();
    while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
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
                // retry on next port / iteration
            }
        }
        await delay(POLL_INTERVAL_MS);
    }
    throw new Error(`Server failed to respond on ports ${FALLBACK_PORTS.join(', ')}`);
}

async function loadSave(expectedName = SAVE_NAME) {
    const response = await client.post('/api/load', { saveName: expectedName });
    if (!response.data?.success) {
        throw new Error(`Load failed: ${response.data?.error || 'unknown error'}`);
    }
    return response.data;
}

async function getCurrentPlayer() {
    const response = await client.get('/api/player');
    if (!response.data?.player) {
        throw new Error('Missing player payload');
    }
    return response.data.player;
}

async function getParty() {
    const response = await client.get('/api/player/party');
    if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch party');
    }
    return response.data;
}

async function getLocation(locationId) {
    const response = await client.get(`/api/locations/${locationId}`);
    if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch location');
    }
    return response.data.location;
}

async function sendForcedEvent(commandText) {
    const response = await client.post('/api/chat', {
        messages: [
            {
                role: 'user',
                content: `!!${commandText}`
            }
        ]
    });
    return response.data;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function extractItemNames(things = []) {
    return things.filter(t => t?.thingType === 'item').map(t => t.name);
}

function extractSceneryNames(things = []) {
    return things.filter(t => t?.thingType === 'scenery').map(t => t.name);
}

async function verifyLocationState(player) {
    const location = await getLocation(player.currentLocation);
    assert(location.name === 'Docking Bay Alpha', 'Unexpected location name');

    const itemNames = extractItemNames(location.things);
    const sceneryNames = extractSceneryNames(location.things);

    assert(itemNames.includes("Smuggler's Data Chip"), 'Missing expected item in location');
    assert(itemNames.length >= 3, 'Expected multiple items present');
    assert(sceneryNames.includes('Holographic Manifest Display'), 'Missing expected scenery feature');
    assert(sceneryNames.length >= 1, 'Expected at least one scenery element');

    const npcs = (location.npcs || []).map(npc => npc.name);
    assert(npcs.includes('Marcus "Steelhand" Johnson'), 'Expected NPC not present');

    return { location, itemNames, sceneryNames, npcs };
}

async function runEventTests() {
    const tests = [
        {
            key: 'attack_damage',
            description: 'Attack damage event detection',
            command: 'Baato fires the Kraken Model 7 Plasma Pistol at Marcus "Steelhand" Johnson, scorching his shoulder.',
            validate(structured) {
                const entries = structured.parsed.attack_damage || [];
                assert(Array.isArray(entries) && entries.length > 0, 'No attack_damage entries parsed');
                const hit = entries.find(entry =>
                    `${entry.attacker}`.toLowerCase().includes('baato') &&
                    `${entry.target}`.toLowerCase().includes('marcus'));
                assert(hit, 'Expected attacker/target pair not detected');
            }
        },
        {
            key: 'consume_item',
            description: 'Consume item event detection',
            command: 'Jax "Starlight" Novak slams a combat stimpack, consuming the single-use cartridge immediately.',
            validate(structured) {
                const entries = structured.parsed.consume_item || [];
                assert(Array.isArray(entries) && entries.length > 0, 'No consume_item entries parsed');
                const match = entries.find(entry =>
                    `${entry.user}`.toLowerCase().includes('jax') &&
                    `${entry.item}`.toLowerCase().includes('stim'));
                assert(match, 'Expected consume_item data missing');
            }
        },
        {
            key: 'death_incapacitation',
            description: 'Death or incapacitation detection',
            command: 'Unit 734 takes a plasma burst and crashes to the deck, completely incapacitated.',
            validate(structured) {
                const entries = structured.parsed.death_incapacitation || [];
                assert(Array.isArray(entries) && entries.includes('Unit 734'), 'Unit 734 incapacitation not detected');
            }
        },
        {
            key: 'drop_item',
            description: 'Drop item detection',
            command: 'Inspector Valeria Kross drops the NebulaCorp Security Disruptor onto the deck plating.',
            validate(structured) {
                const entries = structured.parsed.drop_item || [];
                assert(Array.isArray(entries) && entries.length > 0, 'No drop_item entries parsed');
                const match = entries.find(entry =>
                    `${entry.character}`.toLowerCase().includes('valeria') &&
                    `${entry.item}`.toLowerCase().includes('disruptor'));
                assert(match, 'Expected drop_item data missing');
            }
        },
        {
            key: 'heal_recover',
            description: 'Heal or recover detection',
            command: 'Marcus "Steelhand" Johnson applies a med-gel patch to Baato, restoring his focus.',
            validate(structured) {
                const entries = structured.parsed.heal_recover || [];
                assert(Array.isArray(entries) && entries.length > 0, 'No heal_recover entries parsed');
                const match = entries.find(entry =>
                    `${entry.healer}`.toLowerCase().includes('marcus') &&
                    `${entry.recipient}`.toLowerCase().includes('baato'));
                assert(match, 'Expected heal_recover data missing');
            }
        },
        {
            key: 'item_appear',
            description: 'Item appear detection',
            command: 'A hidden crate pops open, revealing a Prototype Warp Beacon on the deck.',
            validate(structured) {
                const entries = structured.parsed.item_appear || [];
                assert(Array.isArray(entries) && entries.some(name => `${name}`.toLowerCase().includes('warp beacon')), 'New item appearance not detected');
            }
        },
        {
            key: 'move_location',
            description: 'Move location detection',
            command: 'Baato strides through the northern archway into the Security Checkpoint.',
            validate(structured) {
                const entries = structured.parsed.move_location || [];
                assert(Array.isArray(entries) && entries.some(name => `${name}`.toLowerCase().includes('security checkpoint')), 'Move location event not detected');
            }
        },
        {
            key: 'new_exit_discovered',
            description: 'New exit discovery detection',
            command: 'A blinking maintenance panel slides aside, revealing a hidden service hatch to the reactor levels.',
            validate(structured) {
                const entries = structured.parsed.new_exit_discovered || [];
                assert(Array.isArray(entries) && entries.length > 0, 'New exit discovery not detected');
            }
        },
        {
            key: 'npc_arrival_departure',
            description: 'NPC arrival/departure detection',
            command: 'Inspector Valeria Kross nods to Baato and leaves for the Central Hub.',
            validate(structured) {
                const entries = structured.parsed.npc_arrival_departure || [];
                assert(Array.isArray(entries) && entries.length > 0, 'NPC departure not detected');
                const match = entries.find(entry =>
                    `${entry.name}`.toLowerCase().includes('valeria') &&
                    entry.action === 'left');
                assert(match, 'Expected NPC departure entry missing');
            }
        },
        {
            key: 'party_change',
            description: 'Party membership change detection',
            command: 'Marcus "Steelhand" Johnson joins the party.',
            validate(structured) {
                const entries = structured.parsed.party_change || [];
                assert(Array.isArray(entries) && entries.length > 0, 'Party change not detected');
                const match = entries.find(entry =>
                    `${entry.name}`.toLowerCase().includes('marcus') &&
                    entry.action === 'joined');
                assert(match, 'Expected party join entry missing');
            }
        },
        {
            key: 'pick_up_item',
            description: 'Pick up item detection',
            command: 'Baato scoops up the Smuggler\'s Data Chip from the workstation.',
            validate(structured) {
                const entries = structured.parsed.pick_up_item || [];
                assert(Array.isArray(entries) && entries.some(name => `${name}`.toLowerCase().includes('data chip')), 'Pick up item event not detected');
            }
        },
        {
            key: 'status_effect_change',
            description: 'Status effect change detection',
            command: 'Baato gains the Overwatch Focus status effect, sharpening his perception for the next skirmish.',
            validate(structured) {
                const entries = structured.parsed.status_effect_change || [];
                assert(Array.isArray(entries) && entries.length > 0, 'Status effect change not detected');
                const match = entries.find(entry =>
                    `${entry.entity}`.toLowerCase().includes('baato') &&
                    `${entry.action}`.toLowerCase() === 'gained');
                assert(match, 'Expected status effect gain missing');
            }
        },
        {
            key: 'transfer_item',
            description: 'Transfer item detection',
            command: 'Marcus "Steelhand" Johnson hands the Sparking Multitool to Baato.',
            validate(structured) {
                const entries = structured.parsed.transfer_item || [];
                assert(Array.isArray(entries) && entries.length > 0, 'Transfer item not detected');
                const match = entries.find(entry =>
                    `${entry.giver}`.toLowerCase().includes('marcus') &&
                    `${entry.receiver}`.toLowerCase().includes('baato'));
                assert(match, 'Expected item transfer entry missing');
            }
        }
    ];

    for (const test of tests) {
        await loadSave();
        const response = await sendForcedEvent(test.command);
        const structured = response.events;
        assert(structured, `No structured events returned for ${test.key}`);
        const rawValue = structured.rawEntries?.[test.key];
        assert(rawValue && rawValue.trim().toLowerCase() !== 'n/a', `Event ${test.key} reported as N/A`);
        test.validate(structured);
        console.log(`✅ ${test.description}`);
    }
}

async function main() {
    const server = spawn('node', ['server.js', '--port', String(DESIRED_PORT)], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stdout.on('data', chunk => {
        process.stdout.write(`[server] ${chunk}`);
    });
    server.stderr.on('data', chunk => {
        process.stderr.write(`[server] ${chunk}`);
    });

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
        console.log(`Starting server on port ${DESIRED_PORT}...`);
        await waitForServer();
        console.log(`Server responded on port ${activePort}.`);
        if (activePort !== DESIRED_PORT) {
            console.warn(`⚠️ Port override fallback in effect (expected ${DESIRED_PORT}).`);
        }

        await loadSave();

        const player = await getCurrentPlayer();
        assert(player.name === 'Baato', 'Unexpected player loaded');

        const party = await getParty();
        assert(Array.isArray(party.members), 'Party members payload missing');
        console.log(`Current party count: ${party.count}`);

        const { location, itemNames, sceneryNames, npcs } = await verifyLocationState(player);
        console.log('Location:', location.name);
        console.log('Items:', itemNames.join(', '));
        console.log('Scenery:', sceneryNames.join(', '));
        console.log('NPCs:', npcs.join(', '));

        console.log('\nRunning forced event checks...');
        await runEventTests();
        console.log('\nAll event checks passed.');
    } catch (error) {
        console.error('\nTest run failed:', error.message);
        process.exitCode = 1;
    } finally {
        cleanup();
    }
}

if (require.main === module) {
    main();
}
