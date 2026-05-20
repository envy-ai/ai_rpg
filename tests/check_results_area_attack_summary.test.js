const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');
const commonDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'common.md'), 'utf8');
const chatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui', 'chat_interface.md'), 'utf8');
const apiChatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'chat.md'), 'utf8');
const serverDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'server_llm_notes.md'), 'utf8');

test('area attacks are grouped check-results records', () => {
    assert.match(apiSource, /toolName === 'resolveAreaAttack'[\s\S]*return 'area-attack'/);
    assert.match(apiSource, /summarizeAreaAttackCheck/);
    assert.match(apiSource, /record\.areaAttackSummary = metadata\.summary/);
    assert.match(chatSource, /generateAreaAttackInsight/);
    assert.match(chatSource, /record\.kind === 'area-attack' && record\.areaAttackSummary/);
});

test('area attack docs describe grouped tool and check-results output', () => {
    assert.match(apiChatDocs, /`resolveAreaAttack/);
    assert.match(commonDocs, /`kind` \(`skill`, `opposed-skill`, `attack`, or `area-attack`\)/);
    assert.match(commonDocs, /Area attack summaries use `💥` for hits and `💨` when no targets are hit/);
    assert.match(chatDocs, /`resolveAreaAttack` creates one grouped `area-attack` check-results row/);
    assert.match(serverDocs, /`resolveAreaAttack` resolves one shared area effect/);
});
