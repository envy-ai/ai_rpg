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

test('need-bar TinyBrain retries semantic parser failures only at characters phase with planning retained', { concurrency: false }, async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const requests = [];
    const logCalls = [];
    const logPath = path.join(process.cwd(), 'logs', 'need-bar-tinybrain-test.log');
    const forcedOutputPath = path.join(
        __dirname,
        'fixtures',
        'need_bar_tinybrain_invalid_outputs.json'
    );
    const invalidResponses = require(forcedOutputPath)
        .byMetadataLabel
        .need_bar_event_checks
        .slice(1, -1);

    Globals.config = {
        ai: {
            tinybrain: true,
            tinybrain_prompts: { need_bar_event_checks: true },
            retryAttempts: invalidResponses.length
        }
    };
    process.env.LLM_FORCE_OUTPUTS_FILE = forcedOutputPath;
    LLMClient.resetForcedOutputState();

    try {
        LLMClient.logPrompt = (entry = {}) => {
            logCalls.push(entry);
            return entry.filePath || logPath;
        };
        LLMClient.chatCompletion = async (options = {}) => {
            requests.push(options.messages.map(message => ({ ...message })));
            return await previousChatCompletion.call(LLMClient, {
                ...options,
                output: 'silent'
            });
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

        assert.equal(requests.length, 8);
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
        const characterPhaseRequests = requests.slice(1);
        for (const request of characterPhaseRequests) {
            assert.equal(
                request.filter(message => (
                    message.role === 'assistant'
                    && message.content === 'Wanderer loses a small amount of stamina after swinging a weapon.'
                )).length,
                1
            );
            assert.equal(
                request.filter(message => (
                    message.role === 'user'
                    && /Planning phase:/.test(message.content)
                )).length,
                1
            );
            for (const invalidResponse of invalidResponses) {
                assert.equal(
                    request.some(message => message.role === 'assistant' && message.content === invalidResponse),
                    false
                );
            }
        }
        const retryFeedback = requests.slice(2).map(request => request.at(-1).content);
        assert.equal(retryFeedback.every(text => /failed validation/.test(text)), true);
        assert.match(retryFeedback[0], /unknown need-bar id "hunger"/i);
        assert.match(retryFeedback[1], /duplicate character "wanderer"/i);
        assert.match(retryFeedback[2], /duplicate need bar "STAMINA"/i);
        assert.match(retryFeedback[3], /changeDirection.*increase or decrease/i);
        assert.match(retryFeedback[4], /<change>.*small, medium, large/i);
        assert.match(retryFeedback[5], /unexpected(?: direct child)? <commentary>/i);
        assert.deepEqual(result.entries, [{
            character: 'Wanderer',
            bar: 'stamina',
            direction: 'decrease',
            magnitude: 'small',
            reason: 'swung a weapon'
        }]);
        assert.equal(logCalls[0].prefix, 'need_bar_event_checks_tinybrain');
        assert.equal(logCalls.some(entry => entry.prefix === 'need_bar_event_checks'), false);
        assert.equal(
            logCalls.filter(entry => entry.sections?.some(section => /parse failure$/.test(section.title))).length,
            invalidResponses.length
        );
        const fixtureStatus = LLMClient.getCompletionCassetteStatus();
        assert.equal(fixtureStatus.replay.active, true);
        assert.equal(fixtureStatus.replay.version, 1);
        assert.equal(fixtureStatus.replay.total, 8);
        assert.equal(fixtureStatus.replay.consumed, 8);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        if (previousFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = previousFixtureEnv;
        }
        LLMClient.resetForcedOutputState();
    }
});
