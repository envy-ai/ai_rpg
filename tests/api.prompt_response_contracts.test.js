const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');

function getPrimaryPromptRequestBlock() {
    const promptTypeStart = apiSource.indexOf("const promptMetadataLabel = promptType === 'question'");
    const requestStart = apiSource.indexOf('const requestOptions = {', promptTypeStart);
    const requestEnd = apiSource.indexOf('\n                const liveTokenStreamFallbackDiagnostics = [];', requestStart);
    const contractEnd = apiSource.indexOf('\n                if (Object.keys(additionalPayload).length)', requestEnd);
    assert.notEqual(promptTypeStart, -1, 'Unable to locate the primary prompt type branch.');
    assert.notEqual(requestStart, -1, 'Unable to locate the primary prompt request options.');
    assert.notEqual(requestEnd, -1, 'Unable to locate the primary prompt request boundary.');
    assert.notEqual(contractEnd, -1, 'Unable to locate the primary prompt response contract boundary.');
    return {
        requestLiteral: apiSource.slice(requestStart, requestEnd),
        responseContract: apiSource.slice(requestEnd, contractEnd),
        promptTypeLogic: apiSource.slice(promptTypeStart, requestStart)
    };
}

test('generic and question prompts do not inherit player-action XML roots', () => {
    const { requestLiteral, responseContract, promptTypeLogic } = getPrimaryPromptRequestBlock();

    assert.doesNotMatch(requestLiteral, /expectedXmlRootTags/);
    assert.match(
        promptTypeLogic,
        /const usesActionXmlResponse = promptType === 'player-action'\s*\|\| promptType === 'creative-mode-action';/
    );
    assert.match(
        promptTypeLogic,
        /const shouldUseRepetitionBusterXml = usesActionXmlResponse\s*&&/
    );
    assert.match(
        responseContract,
        /if \(shouldUseRepetitionBusterXml\) \{\s*requestOptions\.expectedXmlRootTags = playerActionXmlRootTags;\s*requestOptions\.requiredRegex = playerActionProseRegex;\s*\}/
    );
    assert.match(
        requestLiteral,
        /responseValidationRetryFeedback:\s*promptMetadataLabel === 'player_action'\s*&& !useTinyBrainPlayerAction/
    );
});
