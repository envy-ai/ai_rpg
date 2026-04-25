const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(repoRoot, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public', 'js', 'chat.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(repoRoot, 'api.js'), 'utf8');

test('chat UI exposes an empty-action confirmation modal', () => {
    assert.match(viewSource, /id="emptyActionConfirmModal"/);
    assert.match(viewSource, /aria-labelledby="emptyActionConfirmTitle"/);
    assert.match(viewSource, /id="emptyActionConfirmCloseBtn"/);
    assert.match(viewSource, /id="emptyActionConfirmCancelBtn"/);
    assert.match(viewSource, /id="emptyActionConfirmSubmitBtn"/);
    assert.match(viewSource, /Continue scene without input\?/);
});

test('empty input opens confirmation and confirmed empty action submits intentionally', () => {
    assert.match(chatSource, /this\.emptyActionConfirmModal\s*=\s*document\.getElementById\('emptyActionConfirmModal'\)/);
    assert.match(chatSource, /this\.setupEmptyActionConfirmModal\(\)/);
    assert.match(chatSource, /async sendMessage\(\{\s*allowEmptyAction\s*=\s*false\s*}\s*=\s*\{\}\)/);
    assert.match(chatSource, /if\s*\(\s*!hasInputText\s*&&\s*!allowEmptyAction\s*\)\s*\{[\s\S]*?this\.openEmptyActionConfirmModal\(\);[\s\S]*?return;/);
    assert.match(chatSource, /this\.sendMessage\(\{\s*allowEmptyAction:\s*true\s*}\)/);
    assert.match(chatSource, /async submitChatMessage\(rawContent,\s*\{[\s\S]*?allowEmptyAction\s*=\s*false/);
    assert.match(chatSource, /if\s*\(\s*!trimmed\s*&&\s*!allowEmptyAction\s*\)\s*\{\s*return;\s*}/);
    assert.match(chatSource, /const messageToSubmit\s*=\s*hasInputText\s*\?\s*rawInput\s*:\s*'';/);
    assert.match(chatSource, /await this\.submitChatMessage\(messageToSubmit,\s*\{[\s\S]*?setButtonLoading:\s*true,[\s\S]*?travel:\s*false,[\s\S]*?allowEmptyAction:\s*!hasInputText[\s\S]*?}\)/);
});

test('empty player actions skip attack and plausibility checks before prompt rendering', () => {
    assert.match(apiSource, /const isEmptyPlayerAction\s*=\s*!isPromptOnlyAction[\s\S]*?sanitizedUserContent\.trim\(\)\.length === 0/);
    assert.match(apiSource, /emptyPlayerAction(?:\s*:|\s*=)\s*Boolean\(isEmptyPlayerAction\)/);
    assert.match(apiSource, /if\s*\(\s*!isEmptyPlayerAction\s*&&\s*!isCreativeModeAction\s*&&\s*!isForcedEventAction\s*&&\s*plausibilityChecksEnabled\s*\)/);
    assert.doesNotMatch(apiSource, /runAttackCheckPrompt\(\{[\s\S]{0,500}?isEmptyPlayerAction[\s\S]{0,500}?runPlausibilityCheck/);
});
