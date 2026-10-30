'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const TechniqueService = require('../TechniqueService.js');
const Utils = require('../Utils.js');
const Skill = require('../Skill.js');
const ConfigLoader = require('../ConfigLoader.js');
const ModDiscovery = require('../ModDiscovery.js');
const { prepareRepair, writeRepair } = require('../scripts/rebalance-technique-save.js');

function hashTree(directory) {
    const files = {};
    const visit = (relative = '') => {
        for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = path.join(relative, entry.name);
            if (entry.isDirectory()) visit(child);
            else files[child] = fs.readFileSync(path.join(directory, child));
        }
    };
    visit();
    return files;
}

test('offline repair preview and sibling copy change only the exact catalogue and learned owner', async () => {
    const previous = { baseDir: Globals.baseDir, config: Globals.config, currentPlayer: Globals.currentPlayer, summaries: Globals.sceneSummaries };
    const parent = path.resolve(process.cwd(), 'tmp', `technique-rebalance-fixture-${process.pid}-${Date.now()}`);
    const sourceDir = path.join(parent, 'source-save');
    const outputDir = path.join(parent, 'repaired-copy');
    fs.mkdirSync(sourceDir, { recursive: true });
    try {
        Globals.baseDir = path.resolve(__dirname, '..');
        Globals.config = ConfigLoader.loadMergedConfig(Globals.baseDir);
        Globals.sceneSummaries = { serialize: () => ({}), load() {}, clear() {} };
        Player.clearRuntimeRegistries();
        Thing.clear();
        TechniqueService.reset();
        Player.reloadDefinitionCaches({ refreshInstances: false });
        Player.setAvailableSkills(new Map([['Spellcasting', new Skill({ name: 'Spellcasting', description: 'Fixture magic skill.', attribute: 'intelligence' })]]));

        const actor = new Player({ id: 'fixture-exis', name: 'Fixture Exis', description: 'Isolated repair target.', level: 3 });
        actor.setLevel(3);
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
        const other = new Player({ id: 'fixture-other', name: 'Fixture Other', description: 'Isolated unaffected owner.', isNPC: true });
        TechniqueService.addDiscipline({ id: 'discipline-repair-fixture', name: 'Fixture Discipline', description: 'Fixture only.', publicAccess: true });
        const techniqueId = 'technique-repair-fixture';
        const rawDefinition = {
            id: techniqueId, disciplineId: 'discipline-repair-fixture', name: 'Restorative Focus Fixture', description: 'Legacy custom healing fixture.',
            semanticKey: 'restorative-focus-fixture', aliases: [], provenance: { kind: 'editor', reason: 'Isolated repair fixture.' },
            revisions: [{ revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'restore', kind: 'healing', amount: 3 }] }]
        };
        TechniqueService.addDefinition(rawDefinition, { actor, origin: 'editor' });
        const provenance = { kind: 'training', reason: 'Fixture acquisition.' };
        TechniqueService.learn({ operationId: 'fixture-learn-target', actor, techniqueId, provenance });
        TechniqueService.learn({ operationId: 'fixture-learn-other', actor: other, techniqueId, provenance });
        const grantItem = new Thing({
            id: 'fixture-repair-pin-item', name: 'Pinned Fixture Item', description: 'Keeps its existing catalogue pin.', thingType: 'item',
            techniqueGrants: [{ id: 'fixture-repair-pin', sourceItemId: 'fixture-repair-pin-item', techniqueId, definitionRevision: 1, teaches: false, provenance: { kind: 'item', reason: 'Unchanged pin fixture.' } }]
        });
        const setting = { id: 'fixture-setting', name: 'Fixture setting' };
        Globals.currentPlayer = actor;
        const enabledMods = ModDiscovery.getEnabledModDirectoryNames(Globals.baseDir, { config: Globals.config });
        const skillMap = Player.getAvailableSkills();
        const serialized = Utils.serializeGameState({
            currentPlayer: actor, currentSetting: setting, players: new Map([[actor.id, actor], [other.id, other]]),
            things: new Map([[grantItem.id, grantItem]]), skills: skillMap, gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(),
            chatHistory: [], generatedImages: new Map(), factions: new Map(), pendingRegionStubs: new Map(), enabledMods
        });
        serialized.metadata.saveFileSaveVersion = Number(Globals.currentSaveVersion);
        await Utils.writeSerializedGameState(sourceDir, serialized);

        const originalSourceFiles = hashTree(sourceDir);
        const originalMetadata = JSON.parse(fs.readFileSync(path.join(sourceDir, 'metadata.json'), 'utf8'));
        const originalTechniqueState = JSON.parse(fs.readFileSync(path.join(sourceDir, 'techniques.json'), 'utf8'));
        const options = { 'save-dir': sourceDir, 'actor-id': actor.id, 'technique-id': techniqueId };
        const preview = prepareRepair(options);
        assert.equal(preview.summary.before.healing, 3);
        assert.equal(preview.summary.before.costs.length, 0);
        assert.equal(preview.summary.after.healing, 24);
        assert.equal(preview.summary.after.costs[0].amount, 83);
        assert.deepEqual(hashTree(sourceDir), originalSourceFiles, 'preview does not mutate the source save');
        assert.throws(() => prepareRepair({ ...options, 'expect-personal-sha256': '0'.repeat(64) }), /differs from the reviewed preview/);

        const copyOptions = {
            ...options, 'output-dir': outputDir,
            'expect-definition-sha256': preview.summary.guards.definitionSha256,
            'expect-personal-sha256': preview.summary.guards.personalSha256,
            'expect-policy-digest': preview.summary.guards.policyDigest,
            'expect-source-digest': preview.summary.guards.sourceDigest
        };
        const preparedCopy = prepareRepair(copyOptions);
        writeRepair(preparedCopy, outputDir);
        assert.deepEqual(hashTree(sourceDir), originalSourceFiles, 'writing the repaired copy leaves the source save unchanged');
        assert.throws(() => writeRepair(preparedCopy, outputDir), /already exists/);

        const repairedState = JSON.parse(fs.readFileSync(path.join(outputDir, 'techniques.json'), 'utf8'));
        const repairedPlayers = JSON.parse(fs.readFileSync(path.join(outputDir, 'allPlayers.json'), 'utf8'));
        const repairedThings = JSON.parse(fs.readFileSync(path.join(outputDir, 'things.json'), 'utf8'));
        const repairedDefinition = repairedState.definitions.find(entry => entry.id === techniqueId);
        const repairedOwner = repairedPlayers[actor.id].techniques.find(entry => entry.techniqueId === techniqueId);
        const unaffectedOwner = repairedPlayers[other.id].techniques.find(entry => entry.techniqueId === techniqueId);
        assert.equal(repairedDefinition.revisions.length, 2);
        assert.equal(repairedDefinition.revisions[0].effects[0].amount, 3);
        assert.equal(repairedDefinition.revisions[1].balance.recipeId, 'standard-healing');
        assert.equal(repairedOwner.personalRevision, 2);
        assert.equal(repairedOwner.definitionRevision, 2);
        assert.equal(repairedOwner.revisionHistory.length, 1);
        assert.equal(repairedOwner.revisionHistory[0].effects[0].amount, 3);
        assert.equal(repairedOwner.mechanics.effects[0].amount.formula, 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)');
        assert.equal(unaffectedOwner.definitionRevision, 1);
        assert.equal(unaffectedOwner.mechanics.effects[0].amount, 3);
        assert.deepEqual(repairedThings['fixture-repair-pin-item'].techniqueGrants, grantItem.techniqueGrants);
        assert.equal(repairedState.receipts.length, originalTechniqueState.receipts.length + 1);
        assert.deepEqual(repairedState.receipts.slice(0, originalTechniqueState.receipts.length), originalTechniqueState.receipts);
        assert.equal(repairedState.receipts.at(-1).operationId, preview.summary.operationId);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceDir, 'metadata.json'), 'utf8')), originalMetadata);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, 'metadata.json'), 'utf8')), { ...originalMetadata, saveName: 'repaired-copy' });
    } finally {
        TechniqueService.reset();
        Player.clearRuntimeRegistries();
        Thing.clear();
        Globals.baseDir = previous.baseDir;
        Globals.config = previous.config;
        Globals.currentPlayer = previous.currentPlayer;
        Globals.sceneSummaries = previous.summaries;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(parent, { recursive: true, force: true });
    }
});

