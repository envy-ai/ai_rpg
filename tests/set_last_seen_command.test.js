const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const SetLastSeenCommand = require('../slashcommands/set_last_seen.js');

function withCommandTestState(callback) {
    const previousConfig = Globals.config;
    const previousGameLoaded = Globals.gameLoaded;
    const previousWorldTime = Globals.worldTime;
    const previousCalendarDefinition = Globals.calendarDefinition;
    const previousCurrentPlayer = Globals.currentPlayer;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Globals.currentPlayer = null;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        time: {
            cycleLengthMinutes: 1440,
            tickMinutes: 15
        }
    };
    Globals.gameLoaded = true;

    const registerLocation = (location) => {
        createdLocations.push(location);
        return location;
    };

    return Promise.resolve()
        .then(() => callback({ registerLocation }))
        .finally(() => {
            Player.clearRuntimeRegistries();
            Region.clear();
            for (const location of createdLocations) {
                Location.removeFromIndex(location);
            }
            Globals.currentPlayer = previousCurrentPlayer;
            Globals.config = previousConfig;
            Globals.gameLoaded = previousGameLoaded;
            Globals.worldTime = previousWorldTime;
            Globals.calendarDefinition = previousCalendarDefinition;
        });
}

test('set_last_seen resolves earlier exact times on the current day and only updates NPCs at that location', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-1',
        name: 'North Quarter',
        description: 'A clustered district.'
    });

    const townSquare = registerLocation(new Location({
        id: 'set-last-seen-town-square',
        name: 'Town Square',
        description: 'A broad central plaza.',
        regionId: region.id
    }));
    const oldRoad = registerLocation(new Location({
        id: 'set-last-seen-old-road',
        name: 'Old Road',
        description: 'A weathered path.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 2,
            timeMinutes: (2 * 60) + 30
        }
    });

    const player = new Player({
        id: 'set-last-seen-player',
        name: 'Baato',
        location: townSquare.id
    });
    const mira = new Player({
        id: 'set-last-seen-mira',
        name: 'Mira',
        isNPC: true,
        location: townSquare.id
    });
    const orrin = new Player({
        id: 'set-last-seen-orrin',
        name: 'Orrin',
        isNPC: true,
        location: townSquare.id
    });
    const kess = new Player({
        id: 'set-last-seen-kess',
        name: 'Kess',
        isNPC: true,
        location: oldRoad.id
    });

    Globals.currentPlayer = player;

    const replies = [];
    await SetLastSeenCommand.execute({
        argsText: 'Town Square 1:15 AM',
        reply: async (payload) => {
            replies.push(payload);
        }
    });

    const expectedTimestamp = (2 * 1440) + 75;
    assert.equal(mira.last_seen_time, expectedTimestamp);
    assert.equal(mira.last_seen_location, townSquare.id);
    assert.equal(mira.was_in_player_location_previous_round, false);
    assert.equal(orrin.last_seen_time, expectedTimestamp);
    assert.equal(orrin.last_seen_location, townSquare.id);
    assert.equal(orrin.was_in_player_location_previous_round, false);
    assert.equal(kess.last_seen_time, null);
    assert.equal(kess.last_seen_location, null);
    assert.equal(player.last_seen_time, null);
    assert.equal(player.last_seen_location, null);

    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Set last-seen data for 2 NPCs at Town Square \(set-last-seen-town-square\)\./);
    assert.match(replies[0].content, /Resolved "1:15 AM" to 1:15 AM on .*January 3, Common Era 1\./);
    assert.match(replies[0].content, /Marked them as not continuously present from the previous round\./);
}));

test('set_last_seen rolls later exact times back to the previous day', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-2',
        name: 'South Quarter',
        description: 'A lantern-lit district.'
    });

    const nightMarket = registerLocation(new Location({
        id: 'set-last-seen-night-market',
        name: 'Night Market',
        description: 'A crowded evening bazaar.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 3,
            timeMinutes: 11 * 60
        }
    });

    const rhea = new Player({
        id: 'set-last-seen-rhea',
        name: 'Rhea',
        isNPC: true,
        location: nightMarket.id
    });

    const replies = [];
    await SetLastSeenCommand.execute({
        argsText: 'Night Market 11:30 PM',
        reply: async (payload) => {
            replies.push(payload);
        }
    });

    assert.equal(rhea.last_seen_time, (2 * 1440) + 1410);
    assert.equal(rhea.last_seen_location, nightMarket.id);
    assert.equal(rhea.was_in_player_location_previous_round, false);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Resolved "11:30 PM" to 11:30 PM on .*January 3, Common Era 1\./);
}));

test('set_last_seen parses trailing relative durations with numbered location names', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-3',
        name: 'Restricted Zone',
        description: 'A controlled perimeter.'
    });

    const area51 = registerLocation(new Location({
        id: 'set-last-seen-area-51',
        name: 'Area 51',
        description: 'A fenced test compound.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 5,
            timeMinutes: 9 * 60
        }
    });

    const sentinel = new Player({
        id: 'set-last-seen-sentinel',
        name: 'Sentinel',
        isNPC: true,
        location: area51.id
    });

    const replies = [];
    await SetLastSeenCommand.execute({
        argsText: 'Area 51 1 day 2 hours ago',
        reply: async (payload) => {
            replies.push(payload);
        }
    });

    assert.equal(sentinel.last_seen_time, (5 * 1440) + 540 - 1560);
    assert.equal(sentinel.last_seen_location, area51.id);
    assert.equal(sentinel.was_in_player_location_previous_round, false);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Set last-seen data for 1 NPC at Area 51 \(set-last-seen-area-51\)\./);
    assert.match(replies[0].content, /Resolved "1 day 2 hours ago" to 7:00 AM on .*January 5, Common Era 1\./);
}));

test('set_last_seen accepts exact times without minutes and treats them as top-of-hour', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-4',
        name: 'Clocktower Ward',
        description: 'A district of bells and narrow alleys.'
    });

    const bellSquare = registerLocation(new Location({
        id: 'set-last-seen-bell-square',
        name: 'Bell Square',
        description: 'A plaza under a clocktower.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 4,
            timeMinutes: (4 * 60) + 20
        }
    });

    const sella = new Player({
        id: 'set-last-seen-sella',
        name: 'Sella',
        isNPC: true,
        location: bellSquare.id
    });

    const replies = [];
    await SetLastSeenCommand.execute({
        argsText: 'Bell Square 3 PM',
        reply: async (payload) => {
            replies.push(payload);
        }
    });

    assert.equal(sella.last_seen_time, (3 * 1440) + (15 * 60));
    assert.equal(sella.last_seen_location, bellSquare.id);
    assert.equal(sella.was_in_player_location_previous_round, false);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Set last-seen data for 1 NPC at Bell Square \(set-last-seen-bell-square\)\./);
    assert.match(replies[0].content, /Resolved "3 PM" to 3:00 PM on .*January 4, Common Era 1\./);
}));

test('set_last_seen supports "all" and skips the current location', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-5',
        name: 'Broad Vale',
        description: 'A spread of connected hamlets.'
    });

    const currentCamp = registerLocation(new Location({
        id: 'set-last-seen-current-camp',
        name: 'Current Camp',
        description: 'The player camp.',
        regionId: region.id
    }));
    const northRoad = registerLocation(new Location({
        id: 'set-last-seen-north-road',
        name: 'North Road',
        description: 'A dusty trade road.',
        regionId: region.id
    }));
    const southGate = registerLocation(new Location({
        id: 'set-last-seen-south-gate',
        name: 'South Gate',
        description: 'A guarded stone gate.',
        regionId: region.id
    }));
    registerLocation(new Location({
        id: 'set-last-seen-empty-barn',
        name: 'Empty Barn',
        description: 'A quiet, empty outbuilding.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 6,
            timeMinutes: 10 * 60
        }
    });

    const player = new Player({
        id: 'set-last-seen-player-all',
        name: 'Baato',
        location: currentCamp.id
    });
    const mira = new Player({
        id: 'set-last-seen-all-mira',
        name: 'Mira',
        isNPC: true,
        location: currentCamp.id
    });
    const orrin = new Player({
        id: 'set-last-seen-all-orrin',
        name: 'Orrin',
        isNPC: true,
        location: northRoad.id
    });
    const kess = new Player({
        id: 'set-last-seen-all-kess',
        name: 'Kess',
        isNPC: true,
        location: southGate.id
    });

    Globals.currentPlayer = player;

    const replies = [];
    await SetLastSeenCommand.execute({
        argsText: 'all 8 PM',
        reply: async (payload) => {
            replies.push(payload);
        }
    });

    assert.equal(mira.last_seen_time, null);
    assert.equal(mira.last_seen_location, null);
    assert.equal(orrin.last_seen_time, (5 * 1440) + (20 * 60));
    assert.equal(orrin.last_seen_location, northRoad.id);
    assert.equal(orrin.was_in_player_location_previous_round, false);
    assert.equal(kess.last_seen_time, (5 * 1440) + (20 * 60));
    assert.equal(kess.last_seen_location, southGate.id);
    assert.equal(kess.was_in_player_location_previous_round, false);

    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Set last-seen data for 2 NPCs across 2 locations \(all locations except the current one\)\./);
    assert.match(replies[0].content, /Resolved "8 PM" to 8:00 PM on .*January 6, Common Era 1\./);
}));

test('set_last_seen fails loudly when the target location has no NPCs', async () => withCommandTestState(async ({ registerLocation }) => {
    const region = new Region({
        id: 'set-last-seen-region-6',
        name: 'Harbor Ward',
        description: 'A dockside neighborhood.'
    });

    const emptyDock = registerLocation(new Location({
        id: 'set-last-seen-empty-dock',
        name: 'Empty Dock',
        description: 'A quiet wharf.',
        regionId: region.id
    }));

    Globals.hydrateWorldTime({
        worldTime: {
            dayIndex: 1,
            timeMinutes: 8 * 60
        }
    });

    await assert.rejects(
        () => SetLastSeenCommand.execute({
            argsText: 'Empty Dock 7:00 AM',
            reply: async () => {}
        }),
        new RegExp(`No NPCs are currently at Empty Dock \\(${emptyDock.id}\\)\\.`)
    );
}));
