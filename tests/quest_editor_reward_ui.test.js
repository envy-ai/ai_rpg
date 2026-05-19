const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

test('quest editor reward sections use row editors instead of multiline reward textareas', () => {
    assert.doesNotMatch(viewSource, /<textarea id="questEditRewardItems"/);
    assert.doesNotMatch(viewSource, /<textarea id="questEditRewardFactionReputation"/);
    assert.doesNotMatch(viewSource, /<textarea id="questEditRewardNpcDispositions"/);

    assert.match(viewSource, /id="questEditRewardItemsRows"/);
    assert.match(viewSource, /id="questEditAddRewardItem"/);
    assert.match(viewSource, /id="questEditRewardFactionRows"/);
    assert.match(viewSource, /id="questEditAddFactionReward"/);
    assert.match(viewSource, /id="questEditRewardNpcDispositionRows"/);
    assert.match(viewSource, /id="questEditAddNpcDispositionReward"/);
});

test('quest editor gathers structured reward payloads from row editors', () => {
    assert.match(viewSource, /function addQuestRewardItemRow/);
    assert.match(viewSource, /function addQuestFactionRewardRow/);
    assert.match(viewSource, /function addQuestNpcDispositionRewardRow/);
    assert.match(viewSource, /const gatherQuestRewardItems = \(\) =>/);
    assert.match(viewSource, /const gatherQuestFactionRewards = \(\) =>/);
    assert.match(viewSource, /const gatherQuestNpcDispositionRewards = \(\) =>/);
    assert.match(viewSource, /rewardItems: gatherQuestRewardItems\(\)/);
    assert.match(viewSource, /rewardFactionReputation: gatherQuestFactionRewards\(\)/);
    assert.match(viewSource, /rewardNpcDispositions: gatherQuestNpcDispositionRewards\(\)/);
});

test('quest editor reward rows have dedicated styling hooks', () => {
    assert.match(scssSource, /\.quest-edit-reward-list/);
    assert.match(scssSource, /\.quest-edit-reward-row/);
    assert.match(scssSource, /\.quest-edit-reward-row--npc-disposition/);
});

test('NPC disposition reward rows reserve the second row for the reason field', () => {
    assert.match(
        scssSource,
        /\.quest-edit-reward-row--npc-disposition\s*\{[\s\S]*grid-template-areas:\s*"npc type intensity remove"\s*"reason reason reason reason"/,
    );
    assert.match(scssSource, /\.quest-edit-reward-npc-select\s*\{[\s\S]*grid-area:\s*npc/);
    assert.match(scssSource, /\.quest-edit-reward-disposition-reason\s*\{[\s\S]*grid-area:\s*reason/);
});

test('NPC disposition reward type uses a configured disposition dropdown', () => {
    assert.match(viewSource, /function populateQuestDispositionTypeSelect\(selectEl, selectedType = ''\)/);
    assert.match(viewSource, /const typeSelect = document\.createElement\('select'\);/);
    assert.match(viewSource, /typeSelect\.className = 'quest-edit-reward-disposition-type';/);
    assert.match(viewSource, /populateQuestDispositionTypeSelect\(typeSelect, typeof reward\.type === 'string' \? reward\.type : ''\);/);
    assert.match(viewSource, /unknownOption\.textContent = `\$\{selectedType\} \(custom\)`;/);
    assert.doesNotMatch(viewSource, /const typeInput = document\.createElement\('input'\);[\s\S]*typeInput\.type = 'text';[\s\S]*typeInput\.className = 'quest-edit-reward-disposition-type';/);
});
