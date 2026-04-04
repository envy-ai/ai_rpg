const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Events = require('../Events.js');
const LLMClient = require('../LLMClient.js');

function createTempNeedBarEnvironment() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-event-need-bars-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  strength:
    label: Strength
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', `
need_values:
  small: 10
  medium: 25
  large: 50
  all: 100
need_bars:
  stamina:
    name: Stamina
    icon: ⚡
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    small_increase:
      - catching breath
    medium_increase:
      - resting
    large_increase:
      - sleeping
    fill_completely:
      - magically restored
    small_decrease:
      - swinging a weapon
    medium_decrease:
      - extended combat
    large_decrease:
      - extreme exertion
    empty_completely:
      - total collapse
    effect_thresholds:
      0:
        name: Exhausted
        effect: Can barely move.
        sentence: "%CHARACTER% is exhausted."
      50:
        name: Ready
        effect: No effect.
        sentence: "%CHARACTER% is ready."
      100:
        name: Energized
        effect: Feels great.
        sentence: "%CHARACTER% is energized."
`);

    return tempBaseDir;
}

test('runEventChecks applies dedicated need-bar prompt changes with reason and icon metadata', async () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const tempBaseDir = createTempNeedBarEnvironment();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {},
        event_checks: { enabled: true },
        quest_checks: { enabled: false },
        quests: { enabled: false },
        omit_npc_generation: true,
        baseHealthPerLevel: 10
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    const player = new Player({
        id: 'event-need-player',
        name: 'Wanderer'
    });
    Globals.currentPlayer = player;

    const loggedPrefixes = [];
    const capturedPromptTypes = [];

    try {
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
        };
        LLMClient.chatCompletion = async (options = {}) => {
            const message = Array.isArray(options.messages) ? options.messages[1]?.content : null;
            const payload = typeof message === 'string' ? JSON.parse(message) : {};
            capturedPromptTypes.push(payload.promptType || null);

            if (payload.promptType === 'need-bars') {
                return `Planning:
- Wanderer: stamina decreases from swinging a weapon.

<characters>
  <character>
    <name>Wanderer</name>
    <affectedNeedBars>
      <needBar>
        <id>stamina</id>
        <changeDirection>decrease</changeDirection>
        <change>small</change>
        <reason>swung a weapon</reason>
      </needBar>
    </affectedNeedBars>
  </character>
</characters>`;
            }

            const questionCount = Array.isArray(payload.eventQuestions)
                ? payload.eventQuestions.length
                : 0;
            const answers = Array.from({ length: questionCount }, (_, index) => `${index + 1}. N/A`).join('\n');
            return `<final>\n${answers}\n</final>`;
        };

        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({
                    promptType: context.promptType,
                    eventQuestions: context.eventQuestions || [],
                    needBarDefinitions: context.needBarDefinitions || []
                })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: Player.getNeedBarDefinitionsForContext(),
                npcs: [],
                party: []
            }),
            Location: {
                get: () => null
            },
            findRegionByLocationId: () => null,
            currentPlayer: player,
            findActorByName: (name) => {
                if (typeof name === 'string' && name.trim() === 'Wanderer') {
                    return player;
                }
                return null;
            },
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer swings a weapon at a skeleton and misses.'
        });

        assert.equal(Array.isArray(result?.needBarChanges), true);
        assert.equal(result.needBarChanges.length, 1);
        assert.equal(result.needBarChanges[0].actorName, 'Wanderer');
        assert.equal(result.needBarChanges[0].needBarId, 'stamina');
        assert.equal(result.needBarChanges[0].needBarIcon, '⚡');
        assert.equal(result.needBarChanges[0].reason, 'swung a weapon');
        assert.equal(result.needBarChanges[0].delta, -10);
        assert.equal(player.getNeedBarValue('stamina'), 90);
        assert.deepEqual(capturedPromptTypes.sort(), ['event-checks', 'event-checks', 'event-checks', 'event-checks', 'need-bars'].sort());
        assert.equal(loggedPrefixes.includes('need_bar_event_checks'), true);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('Player need-bar prompt context preserves icons plus medium and empty trigger buckets', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempNeedBarEnvironment();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const definitions = Player.getNeedBarDefinitionsForContext();
        const stamina = definitions.find((definition) => definition.id === 'stamina');
        assert.ok(stamina);
        assert.equal(stamina.icon, '⚡');
        assert.deepEqual(stamina.increases.medium, ['resting']);
        assert.deepEqual(stamina.decreases.medium, ['extended combat']);
        assert.deepEqual(stamina.decreases.empty, ['total collapse']);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});
