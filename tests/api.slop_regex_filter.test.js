const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadGetFilteredSlopRegexes() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        const getFilteredSlopRegexes = async (prose) => {');
    const end = source.indexOf('\n        const containsNormalizedNgram = (tokens, ngramTokens) => {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate getFilteredSlopRegexes in api.js');
    }

    const functionSource = source.slice(start, end);
    const calls = [];
    const context = {
        calls,
        chatHistory: [
            { role: 'assistant', type: 'player-action', content: 'History contains Zero Regex and Positive Regex.' }
        ],
        Globals: {
            analyzeSlopRegexesForText: async (text, options = {}) => {
                calls.push({ helper: 'analyze', text, options });
                if (options.includeZeroPpm === false && String(text).includes('Positive Regex')) {
                    return ['Positive Regex'];
                }
                if (options.includePositivePpm === false && String(text).includes('Zero Regex')) {
                    return ['Zero Regex'];
                }
                return [];
            },
            findSlopRegexesInText: async (text, options = {}) => {
                calls.push({ helper: 'find', text, options });
                const names = Array.isArray(options.names) ? options.names : null;
                const results = [];
                if (options.includePositivePpm === false && String(text).includes('Zero Regex')) {
                    results.push('Zero Regex');
                }
                if ((!names || names.includes('Positive Regex')) && String(text).includes('Positive Regex')) {
                    results.push('Positive Regex');
                }
                return results;
            }
        },
        isAssistantProseLikeEntry(entry) {
            return entry?.role === 'assistant';
        },
        getSlopHistorySegments() {
            return ['History contains Zero Regex and Positive Regex.'];
        },
        Error
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.getFilteredSlopRegexes = getFilteredSlopRegexes;`,
        context
    );

    return {
        getFilteredSlopRegexes: context.getFilteredSlopRegexes,
        calls
    };
}

test('zero-ppm regex filtering checks only current prose instead of full slop history', async () => {
    const runtime = loadGetFilteredSlopRegexes();

    const result = await runtime.getFilteredSlopRegexes('Current prose has Zero Regex and Positive Regex.');

    assert.deepEqual(Array.from(result).sort(), ['Positive Regex', 'Zero Regex']);
    assert.ok(runtime.calls.some(call => (
        call.helper === 'find'
        && call.text === 'Current prose has Zero Regex and Positive Regex.'
        && call.options.includePositivePpm === false
    )));
    assert.ok(runtime.calls.some(call => (
        call.helper === 'analyze'
        && call.text.includes('History contains Zero Regex')
        && call.options.includeZeroPpm === false
    )));
    assert.equal(
        runtime.calls.some(call => (
            call.helper === 'analyze'
            && call.text.includes('History contains Zero Regex')
            && call.options.includePositivePpm === false
        )),
        false,
        'zero-ppm regexes should not analyze combined slop-history text'
    );
});
