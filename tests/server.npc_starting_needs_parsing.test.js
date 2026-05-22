const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Utils = require('../Utils.js');

const TEST_CONFIG = {
    strictXMLParsing: true,
    baseHealthPerLevel: 15,
    formulas: {
        character_creation: {
            attribute_pool_formula: 'ceil(level * (number_of_attributes / 2))',
            skill_pool_formula: 'level * ceil(number_of_skills / 5)',
            max_attribute: 'infinity',
            max_skill: 'infinity'
        }
    }
};

function loadNpcParsers() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function getGeneratedNpcQuantityLimit() {');
    const end = source.indexOf('\nfunction buildNpcAttributePromptEntries() {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate NPC starting-needs parsers in server.js');
    }

    const functionSource = source.slice(start, end);
    const players = new Map();
    const things = new Map();
    const context = {
        Utils,
        Player,
        Thing: require('../Thing.js'),
        console,
        config: {
            npc_generation: {
                max_quantity: 3
            }
        },
        players,
        things,
        parseIntegerFromText(value) {
            const match = String(value ?? '').match(/-?\d+/);
            return match ? Number.parseInt(match[0], 10) : null;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}\nthis.parseLocationNpcs = parseLocationNpcs;\nthis.parseRegionNpcs = parseRegionNpcs;\nthis.resolveGeneratedNpcStartingNeedBars = resolveGeneratedNpcStartingNeedBars;\nthis.resolveGeneratedNpcStartingHealth = resolveGeneratedNpcStartingHealth;\nthis.expandGeneratedNpcQuantityGroup = expandGeneratedNpcQuantityGroup;`,
        context
    );
    return context;
}

function createTempNeedBarDefs(needBarsYaml) {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-npc-starting-needs-'));
    const defsDir = path.join(tempBaseDir, 'defs');
    fs.mkdirSync(defsDir, { recursive: true });
    fs.writeFileSync(path.join(defsDir, 'need_bars.yaml'), needBarsYaml, 'utf8');
    return tempBaseDir;
}

function withTempNeedBarDefinitions(needBarsYaml, run) {
    const previousBaseDir = Globals.baseDir;
    const tempBaseDir = createTempNeedBarDefs(needBarsYaml);

    Globals.baseDir = tempBaseDir;
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        run();
    } finally {
        Globals.baseDir = previousBaseDir;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
}

test('parseLocationNpcs captures starting need levels and applicability', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), ...TEST_CONFIG };
    const { parseLocationNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <name>Dockhand Pell</name>
      <description>A tired dockhand.</description>
      <aiNotes>Pell warns dockworkers before a storm hits.</aiNotes>
      <hiddenFromPlayer>true</hiddenFromPlayer>
      <startingNeeds>
        <needBar>
          <id>food</id>
          <isApplicable>false</isApplicable>
        </needBar>
        <needBar>
          <id>rest</id>
          <isApplicable>true</isApplicable>
          <startingLevel>45%</startingLevel>
        </needBar>
        <needBar>
          <id>mana</id>
          <startingLevel>60</startingLevel>
        </needBar>
      </startingNeeds>
      <startingHealthPercentage>55%</startingHealthPercentage>
    </npc>
  </npcs>
</response>`;

        const result = parseLocationNpcs(xml);
        assert.equal(result.npcs.length, 1);
        const npc = result.npcs[0];
        assert.deepEqual(JSON.parse(JSON.stringify(npc.needBarApplicability)), {
            food: false,
            rest: true,
            mana: true
        });
        assert.deepEqual(JSON.parse(JSON.stringify(npc.needBars)), [
            { id: 'rest', percentage: 45 },
            { id: 'mana', percentage: 60 }
        ]);
        assert.deepEqual(JSON.parse(JSON.stringify(npc.startingHealth)), {
            percentage: 55,
            deceased: false
        });
        assert.equal(npc.aiNotes, 'Pell warns dockworkers before a storm hits.');
        assert.equal(npc.hiddenFromPlayer, true);
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionNpcs captures starting need levels and applicability', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), ...TEST_CONFIG };
    const { parseRegionNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <name>Archivist Nera</name>
      <location>Archive Hall</location>
      <aiNotes>Nera seals the stacks if fire is mentioned.</aiNotes>
      <hiddenFromPlayer>false</hiddenFromPlayer>
      <startingNeeds>
        <needBar>
          <id>focus</id>
          <isApplicable>true</isApplicable>
          <startingLevel>72</startingLevel>
        </needBar>
        <needBar>
          <id>lust</id>
          <isApplicable>no</isApplicable>
        </needBar>
      </startingNeeds>
    </npc>
  </npcs>
</response>`;

        const result = parseRegionNpcs(xml);
        assert.equal(result.npcs.length, 1);
        const npc = result.npcs[0];
        assert.deepEqual(JSON.parse(JSON.stringify(npc.needBarApplicability)), {
            focus: true,
            lust: false
        });
        assert.deepEqual(JSON.parse(JSON.stringify(npc.needBars)), [
            { id: 'focus', percentage: 72 }
        ]);
        assert.equal(npc.aiNotes, 'Nera seals the stacks if fire is mentioned.');
        assert.equal(npc.hiddenFromPlayer, false);
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionNpcs captures deceased starting health state', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), ...TEST_CONFIG };
    const { parseRegionNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <name>Corpse-Lantern Warden</name>
      <location>Archive Hall</location>
      <startingHealthPercentage>deceased</startingHealthPercentage>
    </npc>
  </npcs>
</response>`;

        const result = parseRegionNpcs(xml);
        assert.equal(result.npcs.length, 1);
        const npc = result.npcs[0];
        assert.deepEqual(JSON.parse(JSON.stringify(npc.startingHealth)), {
            deceased: true
        });
    } finally {
        Globals.config = previousConfig;
    }
});

test('NPC XML quantity defaults to one, strips non-numbers with warning, and clamps to config maximum', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), ...TEST_CONFIG };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    const { parseLocationNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <quantity>4 guards</quantity>
      <name>Meridian Grunt</name>
    </npc>
    <npc>
      <name>Plain Clerk</name>
    </npc>
    <npc>
      <quantity>N/A</quantity>
      <name>Confused Scout</name>
    </npc>
  </npcs>
</response>`;

        const result = parseLocationNpcs(xml);

        assert.equal(result.npcs.length, 3);
        assert.equal(result.npcs[0].quantity, 3);
        assert.equal(result.npcs[1].quantity, 1);
        assert.equal(result.npcs[2].quantity, 1);
        assert.equal(warnings.some(line => /quantity.*Meridian Grunt.*4 guards/i.test(line)), true);
        assert.equal(warnings.some(line => /quantity.*Confused Scout.*N\/A/i.test(line)), true);
    } finally {
        console.warn = originalWarn;
        Globals.config = previousConfig;
    }
});

test('generated NPC quantity expansion numbers NPCs and copies numbered equipped gear per NPC', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), ...TEST_CONFIG };
    const { expandGeneratedNpcQuantityGroup, players, things, Thing } = loadNpcParsers();
    try {
        const location = {
            id: 'loc_quantity_test',
            npcIds: [],
            addNpcId(id) {
                if (!this.npcIds.includes(id)) {
                    this.npcIds.push(id);
                }
            }
        };
        const sourceNpc = new Player({
            name: 'Meridian Grunt',
            description: 'Meridian Grunt keeps watch.',
            shortDescription: 'Meridian Grunt on guard.',
            isNPC: true,
            location: location.id
        });
        const rifle = new Thing({
            name: 'Heavy Pulse Rifle',
            description: 'A heavy pulse rifle.',
            thingType: 'item',
            slot: 'hands'
        });
        const armor = new Thing({
            name: 'Patrol Armor',
            description: 'A suit of patrol armor.',
            thingType: 'item',
            slot: 'body'
        });
        things.set(rifle.id, rifle);
        things.set(armor.id, armor);
        sourceNpc.addInventoryItem(rifle, { suppressNpcEquip: true });
        sourceNpc.addInventoryItem(armor, { suppressNpcEquip: true });
        assert.equal(sourceNpc.equipItem(rifle), true);
        players.set(sourceNpc.id, sourceNpc);
        location.addNpcId(sourceNpc.id);
        const created = [sourceNpc];
        const npcContexts = [{ npc: sourceNpc, name: sourceNpc.name }];

        const expanded = expandGeneratedNpcQuantityGroup({
            npc: sourceNpc,
            npcData: { quantity: 3 },
            targetLocation: location,
            created,
            npcContexts
        });

        assert.equal(expanded.length, 3);
        assert.deepEqual(JSON.parse(JSON.stringify(expanded.map(npc => npc.name))), [
            'Meridian Grunt 1',
            'Meridian Grunt 2',
            'Meridian Grunt 3'
        ]);
        assert.deepEqual(JSON.parse(JSON.stringify(location.npcIds)), JSON.parse(JSON.stringify(expanded.map(npc => npc.id))));
        assert.deepEqual(JSON.parse(JSON.stringify(created.map(npc => npc.name))), JSON.parse(JSON.stringify(expanded.map(npc => npc.name))));
        assert.equal(npcContexts.length, 3);

        const inventoryNames = expanded.map(npc => npc.getInventoryItems().map(item => item.name).sort());
        assert.deepEqual(JSON.parse(JSON.stringify(inventoryNames)), [
            ['Heavy Pulse Rifle 1', 'Patrol Armor 1'],
            ['Heavy Pulse Rifle 2', 'Patrol Armor 2'],
            ['Heavy Pulse Rifle 3', 'Patrol Armor 3']
        ]);

        const equippedWeaponIds = expanded.map(npc => npc.getEquippedItemIdForType('hands'));
        assert.equal(new Set(equippedWeaponIds).size, 3);
        assert.deepEqual(JSON.parse(JSON.stringify(equippedWeaponIds.map(id => things.get(id)?.name))), [
            'Heavy Pulse Rifle 1',
            'Heavy Pulse Rifle 2',
            'Heavy Pulse Rifle 3'
        ]);
    } finally {
        Globals.config = previousConfig;
    }
});

test('generated NPC starting need percentages resolve against each bar max before Player creation', () => {
    const { resolveGeneratedNpcStartingNeedBars } = loadNpcParsers();

    withTempNeedBarDefinitions(`
need_bars:
  rest:
    name: Rest
    player: true
    party: true
    non_party: true
    min: 0
    max: 1000
    initial: 1000
  mana:
    name: Mana
    player: true
    party: true
    non_party: true
    min: 0
    max: 500
    initial: 500
`, () => {
        const resolved = resolveGeneratedNpcStartingNeedBars([
            { id: 'rest', percentage: 45 },
            { id: 'mana', percentage: 60 }
        ]);

        assert.deepEqual(JSON.parse(JSON.stringify(resolved)), [
            { id: 'rest', value: 450 },
            { id: 'mana', value: 300 }
        ]);
    });
});

test('generated NPC starting health resolves percentages and deceased state', () => {
    const { resolveGeneratedNpcStartingHealth } = loadNpcParsers();

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveGeneratedNpcStartingHealth({ percentage: 45, deceased: false }, 1000))),
        {
            health: 450,
            isDead: false,
            persistWhenDead: false
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveGeneratedNpcStartingHealth({ deceased: true }, 1000))),
        {
            health: 0,
            isDead: true,
            persistWhenDead: true
        }
    );
});
