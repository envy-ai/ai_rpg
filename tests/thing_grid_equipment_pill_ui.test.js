const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

test('grid equipment pills render slot labels with equipped and available states', () => {
    assert.match(viewSource, /function isThingGridEquipmentPillViewMode\(viewMode\)/);
    assert.match(viewSource, /function getThingGridEquipmentPillText\(thing = \{\}, slotInfo = getThingSlotInfo\(thing\)\)/);
    assert.match(viewSource, /equipToggle\.className = 'thing-grid-equipment-pill'/);
    assert.match(viewSource, /thing-grid-equipment-pill--equipped/);
    assert.match(viewSource, /thing-grid-equipment-pill--available/);
    assert.match(viewSource, /equipToggle\.textContent = getThingGridEquipmentPillText\(thing, slotInfo\)/);
    assert.match(viewSource, /equipToggle\.setAttribute\('aria-pressed', equipped \? 'true' : 'false'\)/);
});

test('grid equipment pills toggle equipment and show centered transient feedback', () => {
    assert.match(viewSource, /function showThingGridEquipmentFeedback\(\{/);
    assert.match(viewSource, /feedback\.className = 'thing-grid-equipment-feedback'/);
    assert.match(viewSource, /feedback\.textContent = equipped \? 'Equipped' : 'Unequipped'/);
    assert.match(viewSource, /setNpcItemEquipped\(actorId, thing, shouldEquip,[\s\S]+\.then\(\(\) => \{[\s\S]+showThingGridEquipmentFeedback\(\{[\s\S]+equipped: shouldEquip/);

    assert.match(scssSource, /\.thing-grid-equipment-pill/);
    assert.match(scssSource, /\.thing-grid-equipment-pill--equipped/);
    assert.match(scssSource, /\.thing-grid-equipment-pill--available/);
    assert.match(scssSource, /\.thing-grid-equipment-feedback/);
    assert.match(scssSource, /transform:\s*translate\(-50%, -50%\)/);
});

test('inventory-style grid views append the equipment pill only where equipment actions already exist', () => {
    assert.match(viewSource, /if \(isThingGridEquipmentPillViewMode\(activeViewMode\)\) \{[\s\S]+appendThingEquipToggle\(\{[\s\S]+host:\s*controlsHost \|\| card,[\s\S]+actorId: currentNpcInventoryNpcId,[\s\S]+activeViewMode[\s\S]+\}\);[\s\S]+return;/);
    assert.match(viewSource, /if \(activeViewMode === 'table' \|\| isThingGridEquipmentPillViewMode\(activeViewMode\)\) \{[\s\S]+appendThingEquipToggle\(\{[\s\S]+host:\s*\(activeViewMode === 'table' && equipmentControlsHost\)[\s\S]+actorId: typeof window\.currentPlayerData\?\.id === 'string'/);
});

test('chat interface docs mention grid equipment pills', () => {
    assert.match(chatDocSource, /grid equipment pill/i);
    assert.match(chatDocSource, /Equipped`\/`Unequipped/i);
});
