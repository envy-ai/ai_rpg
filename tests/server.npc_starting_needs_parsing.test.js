const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Utils = require('../Utils.js');

function loadNpcParsers() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseNpcStartingNeeds(node) {');
    const end = source.indexOf('\nfunction buildNpcAttributePromptEntries() {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate NPC starting-needs parsers in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Utils,
        Player,
        console,
        parseIntegerFromText(value) {
            const match = String(value ?? '').match(/-?\d+/);
            return match ? Number.parseInt(match[0], 10) : null;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}\nthis.parseLocationNpcs = parseLocationNpcs;\nthis.parseRegionNpcs = parseRegionNpcs;\nthis.resolveGeneratedNpcStartingNeedBars = resolveGeneratedNpcStartingNeedBars;\nthis.resolveGeneratedNpcStartingHealth = resolveGeneratedNpcStartingHealth;`,
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
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    const { parseLocationNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <name>Dockhand Pell</name>
      <description>A tired dockhand.</description>
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
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionNpcs captures starting need levels and applicability', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    const { parseRegionNpcs } = loadNpcParsers();
    try {
        const xml = `
<response>
  <npcs>
    <npc>
      <name>Archivist Nera</name>
      <location>Archive Hall</location>
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
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionNpcs captures deceased starting health state', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
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
