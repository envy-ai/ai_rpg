const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { filterNeedBarChangesForHistory } = require('../api.js');

test('history filtering omits only explicitly hidden need-bar changes', () => {
    const visibleChange = { needBarId: 'hunger', hideFromHistory: false };
    const hiddenChange = { needBarId: 'stamina', hideFromHistory: true };

    assert.deepEqual(
        filterNeedBarChangesForHistory([visibleChange, hiddenChange, null]),
        [visibleChange]
    );
});

test('chat need-bar rendering filters explicitly hidden changes', () => {
    const chatSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'chat.js'),
        'utf8'
    );

    assert.match(
        chatSource,
        /changes\.filter\(change => change && change\.hideFromHistory !== true\)/
    );
});
