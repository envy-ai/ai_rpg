const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sanitizeSlopHistorySegments } = require('../api.js');

test('completed slop history sanitation excludes hidden notes and XML markup', () => {
    const sanitized = sanitizeSlopHistorySegments([
        '<turnResult><prose>Visible vial.</prose>'
            + '<hidden><![CDATA[Secret vial and hidden phrase.]]></hidden></turnResult>',
        '<hidden>Only an internal note.</hidden>',
        '  Plain visible history.  '
    ]);

    assert.deepEqual(sanitized, [
        'Visible vial.',
        'Plain visible history.'
    ]);
    assert.doesNotMatch(sanitized.join('\n'), /secret|hidden phrase|internal note/i);
});

test('completed slop history sanitation rejects invalid segment values', () => {
    assert.throws(
        () => sanitizeSlopHistorySegments('not an array'),
        /requires an array of strings/i
    );
    assert.throws(
        () => sanitizeSlopHistorySegments(['valid', null]),
        /segment 1 must be a string/i
    );
});

test('all completed slop history consumers use sanitized history', () => {
    const apiSource = fs.readFileSync(path.resolve(__dirname, '..', 'api.js'), 'utf8');
    const combinedAnalysisUses = apiSource.match(
        /\.\.\.sanitizeSlopHistorySegments\(resolveSlopHistorySegments\(historySegments\)\)/g
    ) || [];

    assert.equal(combinedAnalysisUses.length, 3, 'word, regex, and configured-ngram analysis must sanitize history');
    assert.match(
        apiSource,
        /const segments = sanitizeSlopHistorySegments\(getSlopHistorySegments\(\)\);/,
        'base repeated-ngram history must be sanitized'
    );
    assert.match(
        apiSource,
        /const segments = sanitizeSlopHistorySegments\(getAssistantProseHistorySegments\(\)\);/,
        'supplemental repeated-ngram history must be sanitized'
    );
    assert.match(
        apiSource,
        /const content = rawContent\s*\? sanitizeSlopHistorySegments\(\[rawContent\]\)\[0\] \|\| ''/,
        'slop-remover supporting context must be sanitized'
    );
});
