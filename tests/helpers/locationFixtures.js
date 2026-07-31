const Location = require('../../Location.js');
const Player = require('../../Player.js');
const Region = require('../../Region.js');

function resetWorldState({ clearPlayers = false } = {}) {
    if (clearPlayers) {
        Player.clearRuntimeRegistries();
    }
    Region.clear();
}

function removeLocationsFromIndex(locations) {
    for (const location of locations) {
        if (location) {
            Location.removeFromIndex(location);
        }
    }
}

function createSceneSummariesStub() {
    return {
        serialize() {
            return {};
        },
        load() {}
    };
}

function createSerializationContext({ gameLocations, gameLocationExits, regions } = {}) {
    return {
        gameLocations: gameLocations || new Map(),
        gameLocationExits: gameLocationExits || new Map(),
        regions: regions || new Map(),
        chatHistory: [],
        generatedImages: new Map(),
        things: new Map(),
        players: new Map(),
        skills: new Map(),
        factions: new Map(),
        pendingRegionStubs: new Map()
    };
}

function createHydrationContext({ gameLocations, gameLocationExits, regions } = {}) {
    return {
        gameLocations: gameLocations || new Map(),
        gameLocationExits: gameLocationExits || new Map(),
        regions: regions || new Map(),
        chatHistoryRef: [],
        generatedImages: new Map(),
        things: new Map(),
        players: new Map(),
        skills: new Map(),
        factions: new Map(),
        jobQueue: [],
        imageJobs: new Map(),
        pendingLocationImages: new Map(),
        npcGenerationPromises: new Map(),
        pendingRegionStubs: new Map()
    };
}

module.exports = {
    resetWorldState,
    removeLocationsFromIndex,
    createSceneSummariesStub,
    createSerializationContext,
    createHydrationContext
};
