const test = require('node:test');
const assert = require('node:assert/strict');

const { assertSafeSaveDirectoryName } = require('../api.js');

test('assertSafeSaveDirectoryName accepts normal save names', () => {
    assert.equal(
        assertSafeSaveDirectoryName('2026-07-06T12-00-00-000Z_Setting-Player-Location-abc123'),
        '2026-07-06T12-00-00-000Z_Setting-Player-Location-abc123'
    );
    assert.equal(assertSafeSaveDirectoryName('  My_Save-1  '), 'My_Save-1');
});

test('assertSafeSaveDirectoryName rejects empty or non-string names', () => {
    for (const value of ['', '   ', null, undefined, 42]) {
        assert.throws(
            () => assertSafeSaveDirectoryName(value),
            (error) => error.code === 'SAVE_NAME_REQUIRED'
        );
    }
});

test('assertSafeSaveDirectoryName rejects path traversal attempts', () => {
    const hostile = [
        '..',
        '../other-save',
        '..\\other-save',
        'nested/save',
        'nested\\save',
        '../../etc/passwd',
        'foo/../bar',
        '..%2Fescaped'.replace('%2F', '/')
    ];
    for (const value of hostile) {
        assert.throws(
            () => assertSafeSaveDirectoryName(value),
            (error) => error.code === 'INVALID_SAVE_NAME',
            `expected INVALID_SAVE_NAME for ${JSON.stringify(value)}`
        );
    }
});
