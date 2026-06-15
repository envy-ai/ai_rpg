const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function extractContainerOpenCheckRoute(source) {
    const startMarker = "app.post('/api/things/:id/container/open-check', async (req, res) => {";
    const endMarker = "app.get('/api/things/:id/container', async (req, res) => {";
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, 'Could not locate checked-container open route in api.js');
    assert.notEqual(end, -1, 'Could not locate route after checked-container open route in api.js');
    return source.slice(start, end);
}

test('checked container open-check sends skill-check tools through LLM additionalPayload', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const routeSource = extractContainerOpenCheckRoute(source);

    assert.match(
        routeSource,
        /const additionalPayload = \{\};[\s\S]*if \(enabledChatTools\.length > 0\) \{\s*additionalPayload\.tools = enabledChatTools;\s*additionalPayload\.tool_choice = 'auto';\s*\}/,
        'open-check route should put tool schemas in additionalPayload, because LLMClient forwards additionalPayload into the request body'
    );
    assert.match(
        routeSource,
        /if \(Object\.keys\(additionalPayload\)\.length\) \{\s*requestOptions\.additionalPayload = additionalPayload;\s*\}/,
        'open-check route should attach additionalPayload to requestOptions before the tool loop'
    );
    assert.doesNotMatch(
        routeSource,
        /validateXML: false,\s*tools: enabledChatTools,/,
        'open-check route should not rely on top-level requestOptions.tools'
    );
});
