'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { OperationalIdAllocator } = require('../OperationalIdAllocator.js');

function isolatedStore() {
    const root = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(root, { recursive: true });
    return fs.mkdtempSync(path.join(root, 'operational-id-test-'));
}
function childIds(directory) {
    const code = `const { OperationalIdAllocator } = require('./OperationalIdAllocator.js');
        const allocator = new OperationalIdAllocator({directory: process.env.AIRPG_ID_STORE_DIR});
        process.stdout.write(JSON.stringify(Array.from({length: 1100}, () => allocator.next('request'))));`;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, AIRPG_ID_STORE_DIR: directory } });
        let output = '', errors = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { errors += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
    });
}

test('concurrent processes allocate distinct IDs and restart never reuses a claimed range', async () => {
    const directory = isolatedStore();
    const [first, second] = await Promise.all([childIds(directory), childIds(directory)]);
    const combined = [...first, ...second];
    assert.equal(new Set(combined).size, combined.length);
    assert.ok(combined.every(id => /^request_[1-9]\d*$/.test(id)));
    const restarted = new OperationalIdAllocator({ directory });
    assert.ok(!combined.includes(restarted.next('request')));
    assert.equal(restarted.next('image'), 'image_1');
});

test('imported numeric IDs advance their category and active lease without changing other categories', () => {
    const allocator = new OperationalIdAllocator({ directory: isolatedStore() });
    assert.equal(allocator.next('chat'), 'chat_1');
    allocator.register('chat_5');
    assert.equal(allocator.next('chat'), 'chat_6');
    allocator.register('chat_5000');
    assert.ok(Number(allocator.next('chat').split('_').pop()) > 5000);
    assert.equal(allocator.next('other'), 'other_1');
    allocator.register('legacy-uuid-not-a-numeric-id');
});

test('invalid categories, corrupt leases and exhausted counters fail explicitly', () => {
    const directory = isolatedStore();
    const allocator = new OperationalIdAllocator({ directory });
    for (const category of ['', 'Upper', '../bad', 'bad category']) assert.throws(() => allocator.next(category), /category/i);
    assert.throws(() => allocator.reserve('chat', 0), /count/);
    fs.writeFileSync(path.join(directory, 'malformed.lease'), '');
    assert.throws(() => allocator.next('chat'), /Invalid sequential ID lease/);
    const exhausted = new OperationalIdAllocator({ directory: isolatedStore() });
    assert.throws(() => exhausted.register('chat_9007199254740992'), /safe integer|exhausted/);
});

test('allocated range serves subsequent IDs without opening additional lease files', () => {
    const allocator = new OperationalIdAllocator({ directory: isolatedStore() });
    assert.equal(allocator.next('event'), 'event_1');
    const originalOpen = fs.openSync;
    fs.openSync = () => { throw new Error('unexpected per-ID I/O'); };
    try { for (let i = 2; i <= 50; i++) assert.equal(allocator.next('event'), `event_${i}`); }
    finally { fs.openSync = originalOpen; }
});
