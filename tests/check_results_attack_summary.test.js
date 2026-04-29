const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const commonDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'common.md'), 'utf8');
const chatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui', 'chat_interface.md'), 'utf8');

test('collapsed attack check summaries use sword and whiff icons with hit damage badge', () => {
    assert.match(apiSource, /const formatCollapsedAttackDamageText = \(value\) => \{/);
    assert.match(apiSource, /return `\(💥-\$\{displayValue\}hp\)`;/);
    assert.match(apiSource, /parts\.push\(damageText \? `Hit \$\{damageText\}` : 'Hit'\);/);
    assert.match(apiSource, /\? '⚔️'\s*:\s*\(hit === false\s*\?\s*'💨'/);
});

test('check-results docs describe collapsed attack icon and damage summary', () => {
    assert.match(commonDocs, /attack summaries map hits to `⚔️` with `\(💥-Nhp\)`/);
    assert.match(chatDocs, /attack summaries use `⚔️` for hit rows with `\(💥-Nhp\)`/);
});
