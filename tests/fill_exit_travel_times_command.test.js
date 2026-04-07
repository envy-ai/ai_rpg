const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const FillExitTravelTimesCommand = require('../slashcommands/fill_exit_travel_times.js');

function removeLocationsFromIndex(locations) {
    for (const location of locations) {
        if (location) {
            Location.removeFromIndex(location);
        }
    }
}

test('fill_exit_travel_times only processes regions with unpopulated exit travel times', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    const createdLocations = [];

    Region.clear();
    try {
        Globals.gameLoaded = true;

        const regionNeedingBackfill = new Region({
            id: 'fill-exit-times-region-a',
            name: 'Anchorpoint',
            description: 'A busy trade station.'
        });
        const regionComplete = new Region({
            id: 'fill-exit-times-region-b',
            name: 'Mosslight',
            description: 'A quiet forest hamlet.'
        });

        const a1 = new Location({
            id: 'fill-exit-times-a1',
            name: 'Docking Bay 7',
            description: 'A noisy docking berth.',
            regionId: regionNeedingBackfill.id
        });
        const a2 = new Location({
            id: 'fill-exit-times-a2',
            name: 'Customs Hall',
            description: 'A checkpoint filled with queues.',
            regionId: regionNeedingBackfill.id
        });
        const b1 = new Location({
            id: 'fill-exit-times-b1',
            name: 'Town Square',
            description: 'A mossy central square.',
            regionId: regionComplete.id
        });
        const b2 = new Location({
            id: 'fill-exit-times-b2',
            name: 'North Gate',
            description: 'A gate leading into the forest.',
            regionId: regionComplete.id
        });
        createdLocations.push(a1, a2, b1, b2);

        a1.addExit('east', new LocationExit({
            id: 'fill-exit-times-a1-east',
            description: 'To customs',
            destination: a2.id,
            travelTimeMinutes: 0,
            bidirectional: true
        }));
        b1.addExit('north', new LocationExit({
            id: 'fill-exit-times-b1-north',
            description: 'To gate',
            destination: b2.id,
            travelTimeMinutes: 6,
            bidirectional: true
        }));

        const calls = [];
        let replyPayload = null;

        await FillExitTravelTimesCommand.execute({
            backfillRegionExitTravelTimes: async ({ region }) => {
                calls.push(region.name);
                return {
                    regionId: region.id,
                    regionName: region.name,
                    promptedExitCount: 1,
                    generatedExitCount: 1,
                    mirroredReverseCount: 0,
                    copiedFromReverseCount: 0
                };
            },
            reply: async (payload) => {
                replyPayload = payload;
            }
        });

        assert.deepEqual(calls, ['Anchorpoint']);
        assert.ok(replyPayload);
        assert.match(replyPayload.content, /Regions processed: 1/);
        assert.match(replyPayload.content, /Prompted exits: 1/);
        assert.match(replyPayload.content, /- Anchorpoint: prompted 1, generated 1, mirrored 0, copied 0/);
    } finally {
        Globals.gameLoaded = previousGameLoaded;
        removeLocationsFromIndex(createdLocations);
        Region.clear();
    }
});

test('fill_exit_travel_times reports when no regions need backfill', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    const createdLocations = [];

    Region.clear();
    try {
        Globals.gameLoaded = true;

        const region = new Region({
            id: 'fill-exit-times-region-complete',
            name: 'Anchorpoint',
            description: 'A busy trade station.'
        });

        const origin = new Location({
            id: 'fill-exit-times-complete-origin',
            name: 'Docking Bay 7',
            description: 'A noisy docking berth.',
            regionId: region.id
        });
        const destination = new Location({
            id: 'fill-exit-times-complete-destination',
            name: 'Customs Hall',
            description: 'A checkpoint filled with queues.',
            regionId: region.id
        });
        createdLocations.push(origin, destination);

        origin.addExit('east', new LocationExit({
            id: 'fill-exit-times-complete-east',
            description: 'To customs',
            destination: destination.id,
            travelTimeMinutes: 4,
            bidirectional: true
        }));

        let replyPayload = null;
        await FillExitTravelTimesCommand.execute({
            backfillRegionExitTravelTimes: async () => {
                throw new Error('Backfill helper should not be called when nothing is missing.');
            },
            reply: async (payload) => {
                replyPayload = payload;
            }
        });

        assert.ok(replyPayload);
        assert.match(replyPayload.content, /All regions already have populated exit travel times/);
    } finally {
        Globals.gameLoaded = previousGameLoaded;
        removeLocationsFromIndex(createdLocations);
        Region.clear();
    }
});

test('fill_exit_travel_times force=true regenerates populated exit times', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    const createdLocations = [];

    Region.clear();
    try {
        Globals.gameLoaded = true;

        const region = new Region({
            id: 'fill-exit-times-force-region',
            name: 'Glass Harbor',
            description: 'A polished port full of mirrored bridges.'
        });

        const origin = new Location({
            id: 'fill-exit-times-force-origin',
            name: 'South Pier',
            description: 'A long pier lined with steel pylons.',
            regionId: region.id
        });
        const destination = new Location({
            id: 'fill-exit-times-force-destination',
            name: 'Customs Arch',
            description: 'An archway of scanners and guards.',
            regionId: region.id
        });
        createdLocations.push(origin, destination);

        origin.addExit('north', new LocationExit({
            id: 'fill-exit-times-force-north',
            description: 'To customs',
            destination: destination.id,
            travelTimeMinutes: 9,
            bidirectional: true
        }));

        const calls = [];
        let replyPayload = null;

        await FillExitTravelTimesCommand.execute({
            backfillRegionExitTravelTimes: async ({ region: passedRegion, force }) => {
                calls.push({ regionName: passedRegion.name, force });
                return {
                    regionId: passedRegion.id,
                    regionName: passedRegion.name,
                    force,
                    promptedExitCount: 1,
                    generatedExitCount: 1,
                    mirroredReverseCount: 1,
                    copiedFromReverseCount: 0
                };
            },
            reply: async (payload) => {
                replyPayload = payload;
            }
        }, {
            force: true
        });

        assert.deepEqual(calls, [{ regionName: 'Glass Harbor', force: true }]);
        assert.ok(replyPayload);
        assert.match(replyPayload.content, /Exit travel-time regeneration complete\./);
        assert.match(replyPayload.content, /Regions processed: 1/);
        assert.match(replyPayload.content, /Mirrored reverse exits: 1/);
        assert.match(replyPayload.content, /- Glass Harbor: prompted 1, generated 1, mirrored 1, copied 0/);
    } finally {
        Globals.gameLoaded = previousGameLoaded;
        removeLocationsFromIndex(createdLocations);
        Region.clear();
    }
});
