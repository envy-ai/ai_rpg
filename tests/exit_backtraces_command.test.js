const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const ExitBacktracesCommand = require('../slashcommands/exit_backtraces.js');

test('exit_backtraces command lists current location exits and their creation backtraces', async () => {
    const previousPlayer = Globals.currentPlayer;
    const previousConfig = Globals.config;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'exit-backtraces-region',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });

        const currentLocation = new Location({
            id: 'exit-backtraces-current-location',
            name: 'Docking Bay 7',
            description: 'A noisy salvage berth.',
            regionId: region.id
        });
        createdLocations.push(currentLocation);

        const destinationA = new Location({
            id: 'exit-backtraces-destination-a',
            name: 'Concourse',
            description: 'A busy station concourse.',
            regionId: region.id
        });
        createdLocations.push(destinationA);

        const destinationB = new Location({
            id: 'exit-backtraces-destination-b',
            name: 'Mourning Star',
            description: 'A compact shuttle on standby.',
            regionId: region.id
        });
        createdLocations.push(destinationB);

        currentLocation.addExit('north', new LocationExit({
            id: 'exit-backtraces-north',
            description: 'Concourse access',
            destination: destinationA.id,
            bidirectional: true
        }));

        currentLocation.addExit('dock', new LocationExit({
            id: 'exit-backtraces-dock',
            description: 'Board shuttle',
            destination: destinationB.id,
            bidirectional: true,
            isVehicle: true,
            vehicleType: 'shuttle'
        }));

        Globals.currentPlayer = new Player({
            id: 'exit-backtraces-player',
            name: 'Exis',
            location: currentLocation.id
        });

        let replyPayload = null;
        await ExitBacktracesCommand.execute({
            reply: async (payload) => {
                replyPayload = payload;
            }
        });

        assert.ok(replyPayload);
        assert.equal(replyPayload.ephemeral, false);
        assert.match(replyPayload.content, /## Exit Backtraces: Anchorpoint Station:Docking Bay 7/);
        assert.match(replyPayload.content, /### dock/);
        assert.match(replyPayload.content, /### north/);
        assert.match(replyPayload.content, /Exit id: `exit-backtraces-dock`/);
        assert.match(replyPayload.content, /Destination: Anchorpoint Station:Mourning Star \(`exit-backtraces-destination-b`\)/);
        assert.match(replyPayload.content, /Vehicle exit: \*\*Yes\*\*/);
        assert.match(replyPayload.content, /Vehicle type: shuttle/);
        assert.match(replyPayload.content, /LocationExit creation backtrace/);
        assert.match(replyPayload.content, /```text/);
    } finally {
        Globals.currentPlayer = previousPlayer;
        Globals.config = previousConfig;
        Player.clearRuntimeRegistries();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});
