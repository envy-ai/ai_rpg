'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SequentialIdClient } = require('../public/js/sequential-ids.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('independently reserved browser tabs and reloads use distinct server ranges', () => {
    const reserve = async () => { throw new Error('unexpected refill'); };
    const create = (start, end) => new SequentialIdClient({ ranges: [{ category: 'request', start, end }], reserve });
    const clients = [create(1, 1024), create(1025, 2048), create(2049, 3072)];
    assert.deepEqual(clients.map(client => client.next('request')), ['request_1', 'request_1025', 'request_2049']);
});

test('refill is asynchronous, coalesced and does not block available IDs', async () => {
    let finish, calls = 0;
    const client = new SequentialIdClient({ ranges: [{ category: 'chat', start: 1, end: 129 }], reserve: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
    assert.equal(client.next('chat'), 'chat_1');
    assert.equal(client.next('chat'), 'chat_2');
    await tick();
    assert.equal(calls, 1);
    finish({ category: 'chat', start: 130, end: 258 });
    await tick();
    for (let n = 3; n <= 130; n++) assert.equal(client.next('chat'), `chat_${n}`);
});

test('invalid, overlapping and failed reservations fail visibly without alternate IDs', async () => {
    assert.throws(() => new SequentialIdClient({ ranges: [{ category: 'Bad', start: 1, end: 10 }], reserve: async () => {} }), /invalid/);
    const errors = [];
    const client = new SequentialIdClient({ ranges: [{ category: 'chat', start: 1, end: 3 }], reserve: async () => ({ category: 'chat', start: 2, end: 4 }), onError: error => errors.push(error) });
    assert.equal(client.next('chat'), 'chat_1');
    await tick();
    assert.match(errors[0].message, /overlaps/);
    assert.throws(() => client.next('chat'), /failed/);
    assert.throws(() => client.next('missing'), /bootstrap/);
});
