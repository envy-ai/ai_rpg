const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');
const path = require('path');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

function createPromptEnv() {
    const env = nunjucks.configure(PROMPTS_DIR, { autoescape: false });
    env.addGlobal('randomword', () => 'test');
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function parseXMLTemplate(rendered) {
    const system = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generation = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    return {
        systemPrompt: system ? system[1] : null,
        generationPrompt: generation ? generation[1] : null
    };
}

test('need-bar TinyBrain prompt asks for planning and characters in separate completions', async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const requests = [];
    const logCalls = [];
    const logPath = path.join(process.cwd(), 'logs', 'need-bar-tinybrain-test.log');

    Globals.config = {
        ai: {
            tinybrain: true,
            tinybrain_prompts: { need_bar_event_checks: true },
            retryAttempts: 1
        }
    };

    try {
        LLMClient.logPrompt = (entry = {}) => {
            logCalls.push(entry);
            return entry.filePath || logPath;
        };
        LLMClient.chatCompletion = async (options = {}) => {
            requests.push(options.messages.map(message => ({ ...message })));
            if (requests.length === 1) {
                return 'Wanderer loses a small amount of stamina after swinging a weapon.';
            }
            if (requests.length === 2) {
                return 'characters><character><name>Wanderer</name></character></characters>';
            }
            return '<characters><character><name>Wanderer</name><affectedNeedBars>'
                + '<needBar><id>stamina</id><changeDirection>decrease</changeDirection>'
                + '<change>small</change><reason>swung a weapon</reason></needBar>'
                + '</affectedNeedBars></character></characters>';
        };

        const baseContext = {
            ...buildBaseRenderContext({}),
            needBarDefinitions: [{
                id: 'stamina',
                name: 'Stamina',
                description: 'Short-term physical energy.',
                increases: { small: [], medium: [], large: ['resting'], fill: ['sleeping'] },
                decreases: { small: ['swinging a weapon'], medium: [], large: [], empty: [] }
            }],
            npcs: [],
            party: []
        };
        const result = await Events._runNeedBarEventChecks({
            baseContext,
            textToCheck: 'Wanderer swings a weapon.',
            actionText: '',
            includePlayerActionBlock: false,
            promptEnv: createPromptEnv(),
            parseXMLTemplate
        });

        assert.equal(requests.length, 3);
        const planningPrompt = requests[0].at(-1).content;
        const charactersPrompt = requests[1].at(-1).content;
        assert.match(planningPrompt, /Planning phase:/);
        assert.match(planningPrompt, /Do not write XML yet/);
        assert.doesNotMatch(planningPrompt, /Characters phase:/);
        assert.match(charactersPrompt, /Characters phase:/);
        assert.match(charactersPrompt, /Output only one `<characters>/);
        assert.match(charactersPrompt, /10 words or less/);
        assert.equal(
            requests[1].some(message => message.role === 'assistant' && /loses a small amount/.test(message.content)),
            true
        );
        assert.equal(requests[2].at(-1).content, charactersPrompt);
        assert.equal(
            requests[2].some(message => message.role === 'assistant' && /^characters>/.test(message.content)),
            false
        );
        assert.deepEqual(result.entries, [{
            character: 'Wanderer',
            bar: 'stamina',
            direction: 'decrease',
            magnitude: 'small',
            reason: 'swung a weapon'
        }]);
        assert.equal(logCalls[0].prefix, 'need_bar_event_checks_tinybrain');
        assert.equal(logCalls.some(entry => entry.prefix === 'need_bar_event_checks'), false);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
    }
});
