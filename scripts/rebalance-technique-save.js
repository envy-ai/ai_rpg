#!/usr/bin/env node
'use strict';

// Offline only: this module never imports server.js or opens a listening socket.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const IdGenerator = require('../IdGenerator.js');
const { isDeepStrictEqual } = require('util');
const Technique = require('../Technique.js');
const TechniqueService = require('../TechniqueService.js');
const Balance = require('../TechniqueBalancePolicy.js');
const Globals = require('../Globals.js');

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));

function snapshot(directory) {
    const result = {};
    function visit(relative = '') {
        for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const child = path.join(relative, entry.name);
            assert(!entry.isSymbolicLink(), `Save copy does not permit symbolic links: ${child}.`);
            if (entry.isDirectory()) visit(child);
            else {
                assert(entry.isFile(), `Save copy requires ordinary files: ${child}.`);
                result[child] = hash(fs.readFileSync(path.join(directory, child)));
            }
        }
    }
    visit();
    return result;
}

function parseArguments(argv) {
    const allowed = new Set(['save-dir', 'output-dir', 'actor-id', 'technique-id', 'skill', 'attribute', 'resource-profile', 'effect-id', 'expect-definition-revision', 'expect-personal-revision', 'expect-definition-sha256', 'expect-personal-sha256', 'expect-policy-digest', 'expect-source-digest', 'config-override', 'session-config-override']);
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--preview') { assert(!options.preview, 'Duplicate --preview.'); options.preview = true; continue; }
        assert(arg.startsWith('--') && allowed.has(arg.slice(2)), `Unknown argument ${arg}.`);
        const key = arg.slice(2);
        assert(!Object.hasOwn(options, key), `Duplicate --${key}.`);
        const value = argv[++index];
        assert(typeof value === 'string' && value.trim() && !value.startsWith('--'), `--${key} requires a value.`);
        options[key] = value;
    }
    assert(!(options.preview && options['output-dir']), '--preview and --output-dir are mutually exclusive.');
    for (const key of ['save-dir', 'actor-id', 'technique-id']) assert(options[key], `--${key} is required.`);
    return options;
}

/** Restore only the domain runtime needed for authoritative formula and repair validation. */
function hydrateOffline({ baseDir, saveDir, metadata, players, things, state, configOverride, sessionConfigOverride }) {
    const { loadMergedConfig } = require('../ConfigLoader.js');
    const { getEnabledModDirectoryNames } = require('../ModDiscovery.js');
    Globals.baseDir = baseDir;
    Globals.config = loadMergedConfig(baseDir, configOverride, {
        runtimeOverrideYaml: fs.readFileSync(path.join(saveDir, 'gameConfigOverride.yaml'), 'utf8'),
        sessionOverridePath: sessionConfigOverride
    });
    Balance.resolvePolicy(Globals.config);
    assert(Array.isArray(metadata.enabledMods), 'Repair requires an explicit saved enabledMods manifest.');
    const enabled = getEnabledModDirectoryNames(baseDir, { config: Globals.config }).sort();
    assert(isDeepStrictEqual([...metadata.enabledMods].sort(), enabled), 'Saved enabledMods differs from the effective configuration; use the exact original configuration before repair.');
    Globals.modExtensionRegistry = new (require('../ModExtensionRegistry.js'))();
    const Player = require('../Player.js');
    const Thing = require('../Thing.js');
    const Location = require('../Location.js');
    const Skill = require('../Skill.js');
    const playerMap = new Map(), thingMap = new Map(), locationMap = new Map();
    const loader = new (require('../ModLoader.js'))(baseDir, { config: Globals.config });
    const setting = readJson(saveDir, 'setting.json');
    const scope = {
        app: require('express')(), nunjucks: require('nunjucks'), config: Globals.config, Globals, Player, Thing, Location,
        modExtensionRegistry: Globals.modExtensionRegistry, players: playerMap, things: thingMap,
        gameLocations: locationMap, regions: new Map(), currentSetting: setting,
        getActiveSettingSnapshot: () => setting, getCurrentPlayer: () => Globals.currentPlayer
    };
    // Registration restores installed-module/implant contributions without running a turn or any prompt.
    const loaded = loader.loadMods(scope);
    assert(!loaded.failed.length, `Offline mod registration failed: ${loaded.failed.map(item => `${item.name}: ${item.error}`).join('; ')}`);
    // Preflight merged definitions before Player's historical definition recovery paths can run.
    const { loadMergedDefinitionFile } = require('../DefinitionLoader.js');
    for (const filename of ['attributes.yaml', 'need_bars.yaml', 'gear_slots.yaml', 'dispositions.yaml']) loadMergedDefinitionFile({ baseDir, filename });
    const skills = readJson(saveDir, 'skills.json');
    assert(Array.isArray(skills), 'skills.json requires an array.');
    Player.setAvailableSkills(new Map(skills.map(raw => { const skill = Skill.fromJSON(raw); return [skill.name, skill]; })));
    Globals.hydrateWorldTime({ worldTime: readJson(saveDir, 'worldTime.json'), calendarDefinition: readJson(saveDir, 'calendarDefinition.json') });
    TechniqueService.validateState(state, { actors: Object.values(players), things: Object.values(things) });
    TechniqueService.hydrate(state);
    Thing.clear();
    Player.clearRuntimeRegistries();
    for (const [id, raw] of Object.entries(things)) { assert(raw.id === id, `Thing map identity mismatch ${id}.`); thingMap.set(id, Thing.fromJSON(raw)); }
    const world = readJson(saveDir, 'gameWorld.json');
    Location.clear();
    for (const [id, raw] of Object.entries(world.locations)) { assert(raw.id === id, `Location map identity mismatch ${id}.`); locationMap.set(id, new Location({ ...raw, checkRegionId: false })); }
    for (const [id, raw] of Object.entries(players)) { assert(raw.id === id, `Actor map identity mismatch ${id}.`); playerMap.set(id, Player.fromJSON(raw)); }
    assert(playerMap.has(metadata.playerId), 'Saved current player is absent.');
    Globals.currentPlayer = playerMap.get(metadata.playerId);
    TechniqueService.validateReferences({ actors: playerMap, things: thingMap });
    return playerMap;
}

function prepareRepair(options) {
    const baseDir = path.resolve(__dirname, '..');
    const saveDir = fs.realpathSync(path.resolve(options['save-dir']));
    assert(fs.statSync(saveDir).isDirectory(), 'save-dir must be a directory.');
    const files = snapshot(saveDir), sourceDigest = hash(files);
    const players = readJson(saveDir, 'allPlayers.json');
    const things = readJson(saveDir, 'things.json');
    const state = readJson(saveDir, 'techniques.json');
    const metadata = readJson(saveDir, 'metadata.json');
    assert(Number(metadata.saveFileSaveVersion) >= 1.2, 'Repair requires a current save; legacy migration is a separate operation.');
    const actorId = Technique.text(options['actor-id'], 'actor-id');
    const techniqueId = Technique.text(options['technique-id'], 'technique-id');
    const actorRaw = players[actorId];
    assert(actorRaw && actorRaw.id === actorId, `Exact actor ${actorId} is absent.`);
    const definition = state.definitions.find(entry => entry.id === techniqueId);
    const learned = actorRaw.techniques?.find(entry => entry.techniqueId === techniqueId);
    assert(definition && learned, `Exact learned catalogue technique ${techniqueId} is absent for ${actorId}.`);
    const definitionRevision = Number(options['expect-definition-revision'] ?? 1);
    const personalRevision = Number(options['expect-personal-revision'] ?? 1);
    assert(Number.isSafeInteger(definitionRevision) && Number.isSafeInteger(personalRevision), 'Expected revision pins must be integers.');
    assert(definition.revisions.length === definitionRevision && learned.definitionRevision === definitionRevision && learned.personalRevision === personalRevision, 'Catalogue or owner revision differs from the reviewed repair pins.');
    const previous = learned.mechanics;
    assert(previous.effects.length === 1 && previous.effects[0].kind === 'healing' && ['self', 'single'].includes(previous.target.kind), 'Targeted repair supports one ordinary healing effect only.');
    const guards = { definitionRevision, personalRevision, definitionSha256: hash(definition), personalSha256: hash(learned), sourceDigest };
    const actors = hydrateOffline({ baseDir, saveDir, metadata, players, things, state, configOverride: options['config-override'], sessionConfigOverride: options['session-config-override'] });
    const actor = actors.get(actorId);
    const policy = Balance.resolvePolicy();
    guards.policyDigest = Balance.digest(policy);
    for (const [flag, key] of [['expect-definition-sha256', 'definitionSha256'], ['expect-personal-sha256', 'personalSha256'], ['expect-policy-digest', 'policyDigest'], ['expect-source-digest', 'sourceDigest']]) {
        if (options['output-dir']) assert(options[flag], `Writing a repaired copy requires --${flag} from a reviewed preview.`);
        if (options[flag]) assert(options[flag] === guards[key], `${flag} differs from the reviewed preview; prepare a new preview.`);
    }
    const recipe = { recipeId: 'standard-healing', skillName: options.skill ?? 'Spellcasting', attributeName: options.attribute ?? 'intelligence', resourceProfileId: options['resource-profile'] ?? 'mana', effectId: options['effect-id'] ?? previous.effects[0].id };
    const operationId = `reviewed-rebalance:${actorId}:${techniqueId}:${hash({ guards, recipe })}`;
    const receipt = TechniqueService.rebalance({ operationId, actor, techniqueId, expectedDefinitionRevision: definitionRevision, expectedPersonalRevision: personalRevision, expectedPolicyDigest: guards.policyDigest, recipe, provenance: { kind: 'editor', reason: 'Reviewed offline ordinary-healing recipe repair; original save preserved.' } });
    const repairedState = TechniqueService.toJSON();
    const nextLearned = actor.techniques.find(entry => entry.techniqueId === techniqueId);
    // Patch the raw save only. Hydration must never rewrite unrelated owner/mod/world data.
    const repairedPlayers = structuredClone(players);
    repairedPlayers[actorId].techniques[actorRaw.techniques.findIndex(entry => entry.techniqueId === techniqueId)] = nextLearned;
    TechniqueService.validateState(repairedState, { actors: Object.values(repairedPlayers), things: Object.values(things) });
    const outputState = structuredClone(state);
    outputState.definitions[state.definitions.findIndex(entry => entry.id === techniqueId)] = repairedState.definitions.find(entry => entry.id === techniqueId);
    outputState.receipts.push(receipt);
    // Prove that the service introduced only the explicitly requested catalogue/owner/receipt patch.
    assert(isDeepStrictEqual(canonical(outputState), canonical(repairedState)), 'Rebalance changed unrelated saved catalogue or receipt data.');
    const previewRevision = revision => ({ healing: Technique.evaluateAmount(revision.effects[0].amount, actor).amount, costs: revision.costs.map(cost => ({ resource: cost.resource, needId: cost.needId, direction: cost.direction, amount: Technique.evaluateAmount(cost.amount, actor).amount })), healingFormula: revision.effects[0].amount, costFormulas: revision.costs.map(cost => cost.amount) });
    const summary = { mode: options['output-dir'] ? 'copy' : 'preview', saveDir, actor: { id: actorId, name: actor.name }, technique: { id: techniqueId, name: definition.name }, guards, recipe, before: previewRevision(previous), after: previewRevision(nextLearned.mechanics), operationId };
    assert(hash(snapshot(saveDir)) === sourceDigest, 'Source save changed during repair preparation.');
    return { saveDir, files, sourceDigest, players: repairedPlayers, state: outputState, metadata, summary };
}

function writeRepair(prepared, requestedOutputDir) {
    const outputDir = path.resolve(requestedOutputDir);
    const parent = fs.realpathSync(path.dirname(outputDir));
    assert(parent === path.dirname(prepared.saveDir) && outputDir !== prepared.saveDir, 'output-dir must be a distinct sibling of the source save.');
    assert(!fs.existsSync(outputDir), 'output-dir already exists; repair never overwrites a save.');
    assert(hash(snapshot(prepared.saveDir)) === prepared.sourceDigest, 'Source save changed since preview preparation.');
    const staging = path.join(parent, `.technique-rebalance-${IdGenerator.nextSequential('rebalance_tmp')}`);
    assert(!fs.existsSync(staging), `Staging directory ${staging} already exists.`);
    try {
        // cpSync creates the staging directory; with errorOnExist it refuses an existing destination.
        fs.cpSync(prepared.saveDir, staging, { recursive: true, force: false, errorOnExist: true });
        assert(isDeepStrictEqual(snapshot(staging), prepared.files), 'Staged copy differs from the reviewed source save.');
        fs.writeFileSync(path.join(staging, 'allPlayers.json'), JSON.stringify(prepared.players, null, 2));
        fs.writeFileSync(path.join(staging, 'techniques.json'), JSON.stringify(prepared.state, null, 2));
        fs.writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify({ ...prepared.metadata, saveName: path.basename(outputDir) }, null, 2));
        TechniqueService.validateState(readJson(staging, 'techniques.json'), { actors: Object.values(readJson(staging, 'allPlayers.json')), things: Object.values(readJson(staging, 'things.json')) });
        assert(hash(snapshot(prepared.saveDir)) === prepared.sourceDigest, 'Source save changed before repaired-copy commit.');
        assert(!fs.existsSync(outputDir), 'output-dir appeared before commit; refusing overwrite.');
        // Reserve this absent destination exclusively, then replace our own empty
        // directory atomically so a pre-existing save can never be overwritten.
        fs.mkdirSync(outputDir);
        try { fs.renameSync(staging, outputDir); } catch (cause) {
            throw new Error(`Final repaired-copy rename failed; destination reservation retained at ${outputDir}.`, { cause });
        }
    } catch (cause) {
        // Retain staging for diagnosis; never remove logs or an existing save.
        throw new Error(`Repaired save copy failed; staging retained at ${staging}: ${cause.message}`, { cause });
    }
    return outputDir;
}

function main(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    const originalLog = console.log;
    let prepared;
    try {
        console.log = (...args) => console.error(...args);
        prepared = prepareRepair(options);
    } finally { console.log = originalLog; }
    if (options['output-dir']) prepared.summary.outputDir = writeRepair(prepared, options['output-dir']);
    process.stdout.write(`${JSON.stringify(prepared.summary, null, 2)}\n`);
}
if (require.main === module) {
    try { main(); } catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
}
module.exports = { parseArguments, prepareRepair, writeRepair, main };
