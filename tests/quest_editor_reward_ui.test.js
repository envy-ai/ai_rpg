const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

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
    assert.match(viewSource, /quest-edit-reward-item-name/);
    assert.match(viewSource, /quest-edit-reward-item-description/);
    assert.match(viewSource, /const gatherQuestFactionRewards = \(\) =>/);
    assert.match(viewSource, /const gatherQuestNpcDispositionRewards = \(\) =>/);
    assert.match(viewSource, /rewardItems: gatherQuestRewardItems\(\)/);
    assert.match(viewSource, /rewardFactionReputation: gatherQuestFactionRewards\(\)/);
    assert.match(viewSource, /rewardNpcDispositions: gatherQuestNpcDispositionRewards\(\)/);
});

test('quest editor exposes persisted quest metadata fields in the modal payload', () => {
    assert.match(viewSource, /id="questEditGiverName"[^>]*name="giverName"/);
    assert.match(viewSource, /id="questEditPaused"[^>]*name="paused"/);
    assert.match(viewSource, /id="questEditRewardClaimed"[^>]*name="rewardClaimed"/);

    assert.match(viewSource, /const questEditGiverName = document\.getElementById\('questEditGiverName'\);/);
    assert.match(viewSource, /const questEditPaused = document\.getElementById\('questEditPaused'\);/);
    assert.match(viewSource, /const questEditRewardClaimed = document\.getElementById\('questEditRewardClaimed'\);/);

    assert.match(viewSource, /questEditGiverName\.value = quest\.giverName \|\| quest\.giver \|\| '';/);
    assert.match(viewSource, /questEditPaused\.checked = Boolean\(quest\.paused\);/);
    assert.match(viewSource, /questEditRewardClaimed\.checked = Boolean\(quest\.rewardClaimed\);/);

    assert.match(viewSource, /giverName: questEditGiverName \? questEditGiverName\.value\.trim\(\) : \(questBeingEdited\.giverName \|\| questBeingEdited\.giver \|\| ''\)/);
    assert.match(viewSource, /paused: questEditPaused \? questEditPaused\.checked : Boolean\(questBeingEdited\.paused\)/);
    assert.match(viewSource, /rewardClaimed: questEditRewardClaimed \? questEditRewardClaimed\.checked : Boolean\(questBeingEdited\.rewardClaimed\)/);
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

test('current player payload exposes disposition definitions for quest reward dropdowns', () => {
    assert.match(serverSource, /serialized\.dispositionDefinitions = dispositionDefinitions;/);
    assert.match(viewSource, /rememberQuestDispositionDefinitions\(data\.player\);/);
});
