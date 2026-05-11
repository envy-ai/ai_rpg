const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadNameEnforcement() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function enforceBannedNpcNameForPlayer(');
    const end = source.indexOf('\n// Redundant', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate NPC name enforcement helper in server.js');
    }

    const context = {
        console,
        collected: false,
        getNpcNameBlockedWords() {
            return ['crimson'];
        },
        isNpcNameAllowed(name) {
            return !String(name || '').toLowerCase().includes('crimson');
        },
        hasConfiguredAiBackend() {
            return true;
        },
        Player: {
            getAll() {
                return [];
            }
        },
        summarizeNpcForNameRegen() {
            return null;
        },
        async enforceBannedNpcNames({ npcDataList }) {
            assert.equal(npcDataList.length, 1);
            return [{
                ...npcDataList[0],
                name: 'Red Scar Flanker',
                shortDescription: 'Renamed after blocked-word enforcement.',
                description: 'A renamed raider.'
            }];
        }
    };
    context.collectNpcSummariesForNameEnforcement = () => {
        context.collected = true;
        return [{ name: 'Existing Dockhand', shortDescription: 'A known NPC.' }];
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.enforceBannedNpcNameForPlayer = enforceBannedNpcNameForPlayer;`,
        context
    );
    return context;
}

test('single NPC name enforcement can collect summaries when generated name is blocked', async () => {
    const context = loadNameEnforcement();
    const npc = {
        id: 'char_test',
        name: 'Crimson Scar Flanker',
        shortDescription: 'A blocked-name test NPC.',
        description: 'A test NPC with a blocked generated name.',
        class: 'Raider',
        race: 'Rat Girl',
        isNPC: true,
        setName(name) {
            this.name = name;
        }
    };

    const result = await context.enforceBannedNpcNameForPlayer({
        npc,
        location: { id: 'loc_test' },
        region: { id: 'region_test' },
        existingNames: new Set()
    });

    assert.equal(result, npc);
    assert.equal(context.collected, true);
    assert.equal(npc.name, 'Red Scar Flanker');
    assert.equal(npc.shortDescription, 'Renamed after blocked-word enforcement.');
    assert.equal(npc.description, 'A renamed raider.');
});
