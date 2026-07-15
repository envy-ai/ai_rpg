const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Utils = require('../Utils.js');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-atomic-write-'));
}

test('writeFileAtomic creates a new file with the given contents', async (t) => {
    const dir = makeTempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const target = path.join(dir, 'metadata.json');
    await Utils.writeFileAtomic(target, JSON.stringify({ a: 1 }));

    assert.equal(fs.readFileSync(target, 'utf8'), '{"a":1}');
});

test('writeFileAtomic replaces an existing file and leaves no temp files', async (t) => {
    const dir = makeTempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const target = path.join(dir, 'metadata.json');
    fs.writeFileSync(target, 'old contents');

    await Utils.writeFileAtomic(target, 'new contents');

    assert.equal(fs.readFileSync(target, 'utf8'), 'new contents');
    assert.deepEqual(fs.readdirSync(dir), ['metadata.json']);
});

test('writeFileAtomic rejects when the target directory does not exist', async (t) => {
    const dir = makeTempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const target = path.join(dir, 'missing-subdir', 'metadata.json');
    await assert.rejects(() => Utils.writeFileAtomic(target, 'contents'));
    assert.deepEqual(fs.readdirSync(dir), []);
});

test('writeFileAtomic rejects invalid file paths', async () => {
    for (const value of ['', null, undefined, 42]) {
        await assert.rejects(
            () => Utils.writeFileAtomic(value, 'contents'),
            /requires a target file path/
        );
    }
});
