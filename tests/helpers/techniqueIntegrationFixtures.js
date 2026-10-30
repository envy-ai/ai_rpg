'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Globals = require('../../Globals.js');
const Player = require('../../Player.js');
const Thing = require('../../Thing.js');
const TechniqueService = require('../../TechniqueService.js');
const Location = require('../../Location.js');
const Region = require('../../Region.js');
const { createTempDefsDir, withStandardTestConfig } = require('./needBarFixtures.js');

const provenance = { kind: 'training', reason: 'Technique integration test fixture.' };

function mechanics({ target = 'self', costs = [], failureCosts, check = { kind: 'automatic' }, effects }) {
    return {
        revision: 1,
        target: { kind: target },
        check,
        costs,
        ...(failureCosts ? { failureCosts } : {}),
        effects
    };
}

function definition(id, revisionMechanics, overrides = {}) {
    return {
        id,
        disciplineId: overrides.disciplineId || 'discipline-integration',
        name: overrides.name || `Technique ${id}`,
        description: 'A technique integration fixture.',
        semanticKey: overrides.semanticKey || id,
        aliases: [],
        provenance,
        revisions: [revisionMechanics],
        ...overrides
    };
}

function withTechniqueWorld(run, { retryAttempts = 1, includeMana = false } = {}) {
    const previousPlayer = Globals.currentPlayer;
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempDefsDir({
        prefix: 'ai-rpg-technique-integration-',
        ...(includeMana ? {
            attributes: [{ id: 'strength', label: 'Strength', default: 5 }, { id: 'intelligence', label: 'Intelligence', default: 10 }],
            needBarsYaml: fs.readFileSync(path.join(__dirname, '../../defs/need_bars.yaml'), 'utf8')
        } : {})
    });
    Player.clearRuntimeRegistries();
    Thing.clear();
    Location.clear();
    Region.clear();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...withStandardTestConfig(previousConfig),
        ai: { ...(previousConfig?.ai || {}), retryAttempts }
    };
    TechniqueService.reset();
    Player.reloadDefinitionCaches({ refreshInstances: false });
    const region = new Region({ id: 'region-technique-integration', name: 'Integration Region', description: 'Fixture.' });
    const location = new Location({ id: 'location-technique-integration', name: 'Integration Room', description: 'Fixture.', regionId: region.id });
    const player = new Player({ id: 'char-technique-integration-player', name: 'Integration Player', description: 'Fixture.' });
    const npc = new Player({ id: 'char-technique-integration-npc', name: 'Integration NPC', description: 'Fixture.', isNPC: true });
    const target = new Player({ id: 'char-technique-integration-target', name: 'Integration Target', description: 'Fixture.', isNPC: true });
    if (includeMana) {
        player.setLevel(3);
        player.setSkillValue('Spellcasting', 3);
        player.setAttribute('intelligence', 18);
    }
    for (const actor of [player, npc, target]) actor.setLocation(location);
    Globals.currentPlayer = player;
    TechniqueService.addDiscipline({
        id: 'discipline-integration', name: 'Integration Discipline', description: 'Fixture.', publicAccess: true
    });
    const actors = new Map([player, npc, target].map(actor => [actor.id, actor]));
    const world = { region, location, player, npc, target, actors };

    const cleanup = () => {
        TechniqueService.reset();
        Player.clearRuntimeRegistries();
        Thing.clear();
        Location.clear();
        Region.clear();
        Globals.currentPlayer = previousPlayer;
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    };
    try {
        return Promise.resolve(run(world)).finally(cleanup);
    } catch (error) {
        cleanup();
        throw error;
    }
}

function addDefinition(id, revisionMechanics, overrides) {
    return TechniqueService.addDefinition(definition(id, revisionMechanics, overrides), { origin: 'editor' });
}

function learn(actor, id) {
    return TechniqueService.learn({
        operationId: `integration-learn:${actor.id}:${id}`,
        actor,
        techniqueId: id,
        provenance
    });
}

module.exports = { provenance, mechanics, definition, withTechniqueWorld, addDefinition, learn };
