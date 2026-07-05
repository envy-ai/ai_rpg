const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const Player = require('../Player.js');

test('/list_npcs renders NPC location and short-description markdown table', async () => {
    const ListNpcsCommand = require('../slashcommands/list_npcs.js');
    const originalPlayerGetAll = Player.getAll;
    const originalLocationGetAll = Location.getAll;
    let replyPayload = null;

    Player.getAll = () => [
        {
            id: 'player_1',
            name: 'Aria',
            isNPC: false,
            currentLocation: 'loc_1',
            shortDescription: 'A decisive explorer.'
        },
        {
            id: 'npc_zed',
            name: 'Zed',
            isNPC: true,
            currentLocation: 'loc_2',
            shortDescription: 'A quiet sentry.'
        },
        {
            id: 'npc_mira',
            name: 'Mira',
            isNPC: true,
            currentLocation: 'loc_1',
            description: 'A careful negotiator. She keeps ledgers.'
        }
    ];
    Location.getAll = () => [
        { id: 'loc_1', name: 'Atrium' },
        { id: 'loc_2', name: 'Vault' }
    ];

    try {
        await ListNpcsCommand.execute({
            reply: async (payload) => {
                replyPayload = payload;
            }
        });
    } finally {
        Player.getAll = originalPlayerGetAll;
        Location.getAll = originalLocationGetAll;
    }

    assert.equal(ListNpcsCommand.name, 'list_npcs');
    assert.equal(replyPayload?.ephemeral, false);
    assert.match(replyPayload.content, /^\| NPC \| Location \| Short Description \|/m);
    assert.match(replyPayload.content, /\| Mira \| Atrium \| A careful negotiator\. \|[\s\S]*\| Zed \| Vault \| A quiet sentry\. \|/);
    assert.doesNotMatch(replyPayload.content, /Aria/);
});
