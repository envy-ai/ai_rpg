const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadSlopRuntime(slopConfig) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function loadSlopwordConfig');
    const end = source.indexOf('\nfunction shouldGenerateNpcImage', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate slop analysis helpers in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        __dirname: '/tmp/ai-rpg-test',
        Number,
        Object,
        Set,
        Map,
        RegExp,
        String,
        TypeError,
        Error,
        console,
        Globals: {
            baseDir: '/tmp/ai-rpg-test'
        },
        loadMergedDefinitionFile() {
            return { value: slopConfig };
        },
        getActiveSettingSnapshot() {
            return {};
        },
        normalizeSettingList(value) {
            return Array.isArray(value) ? value : [];
        },
        Utils: {
            normalizeKgramTokens(text) {
                return String(text || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(functionSource, context);
    return context.Globals;
}

test('regex slop analysis matches raw regexes by name without ngram normalization', async () => {
    const Globals = loadSlopRuntime({
        default: 200,
        ngram_default: 5,
        slopwords: {},
        ngrams: {},
        regexes: [
            {
                pattern: "/\\bdon't you dare stop\\b/i",
                name: "Don't you dare stop",
                ppm: 0
            }
        ]
    });

    assert.equal(typeof Globals.analyzeSlopRegexesForText, 'function');
    const flagged = await Globals.analyzeSlopRegexesForText("Please don't you dare stop now.");

    assert.deepEqual(Array.from(flagged), ["Don't you dare stop"]);
});

test('regex slop analysis treats YAML double-quoted word-boundary escapes as regex word boundaries', async () => {
    const Globals = loadSlopRuntime({
        default: 200,
        ngram_default: 5,
        slopwords: {},
        ngrams: {},
        regexes: [
            {
                pattern: "/\bElara\b/i",
                name: 'Elara',
                ppm: 0
            }
        ]
    });

    const flagged = await Globals.analyzeSlopRegexesForText('Elara stood near the gate.');

    assert.deepEqual(Array.from(flagged), ['Elara']);
});

test('regex slop analysis removes asterisks before matching', async () => {
    const Globals = loadSlopRuntime({
        default: 200,
        ngram_default: 5,
        slopwords: {},
        ngrams: {},
        regexes: [
            {
                pattern: "/\\bdon't you dare stop\\b/i",
                name: "Don't you dare stop",
                ppm: 0
            }
        ]
    });

    const text = "Please don't you **dare** stop now.";

    const directMatches = await Globals.findSlopRegexesInText(text);
    const analyzedMatches = await Globals.analyzeSlopRegexesForText(text);

    assert.deepEqual(Array.from(directMatches), ["Don't you dare stop"]);
    assert.deepEqual(Array.from(analyzedMatches), ["Don't you dare stop"]);
});
