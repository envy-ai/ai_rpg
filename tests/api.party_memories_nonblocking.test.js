const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('chat respond schedules party memory prompts without awaiting them', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const respond = async (payload, statusCode = 200) => {');
    const endMatch = /try\s*\{\s*travelMetadata\s*=\s*normalizeTravelMetadata\(rawTravelMetadata\);/.exec(source.slice(start));
    const end = endMatch ? start + endMatch.index : -1;
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate /api/chat respond helper.');
    }

    const respondSource = source.slice(start, end);
    assert.doesNotMatch(respondSource, /await\s+processPartyMemoriesForCurrentTurn\s*\(/);
    assert.match(respondSource, /schedulePartyMemoriesForCurrentTurn\s*\(/);
});
