const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const lightboxSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'lightbox.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

test('the lightbox has a real close control and a shared action host above its media', () => {
    const actionsIndex = viewSource.indexOf('id="imageLightboxActions"');
    const mediaIndex = viewSource.indexOf('id="imageLightboxMedia"');
    assert.notEqual(actionsIndex, -1);
    assert.notEqual(mediaIndex, -1);
    assert.ok(actionsIndex < mediaIndex, 'actions must render above the item image on mobile');
    assert.match(viewSource, /id="imageLightboxClose"[^>]*aria-label="Close item viewer"/);
    assert.match(lightboxSource, /closeButton\.addEventListener\('click'/);
});

test('thing contexts use the shared explicit lightbox action descriptor contract', () => {
    assert.match(viewSource, /function createThingLightboxAction\(id, label, handler, options = \{\}\)/);
    assert.match(viewSource, /createThingLightboxAction\('character-inventory-drop', 'Drop'/);
    assert.match(viewSource, /createThingLightboxAction\('character-inventory-give-to', 'Give to\.\.\.'/);
    assert.match(viewSource, /createThingLightboxAction\('location-pick-up', 'Pick up'/);
    assert.match(viewSource, /createThingLightboxAction\('location-give-to', 'Give to\.\.\.'/);
    assert.match(viewSource, /shouldRemove \? 'Remove from trade' : 'Add to trade'/);
    assert.match(viewSource, /createThingLightboxAction\('crafting-add-item', 'Add item'/);
    assert.match(viewSource, /createThingLightboxAction\('module-install-item', 'Install item'/);
    assert.match(viewSource, /lightboxActions: \(\) => createBarterOfferLightboxActions/);
    assert.match(viewSource, /lightboxActions: \(\) => createCraftingItemLightboxActions/);
    assert.match(viewSource, /lightboxActions: \(\) => createModuleWorkbenchLightboxActions/);
    assert.match(viewSource, /lightboxActions: \(\) => createCharacterInventoryLightboxActions/);
});

test('nested selection actions close first while direct actions close only after success', () => {
    assert.match(viewSource, /'character-inventory-give-to'[\s\S]*?closeBeforeRun: true/);
    assert.match(viewSource, /'location-give-to'[\s\S]*?closeBeforeRun: true/);
    assert.match(viewSource, /shouldRemove \? 'barter-remove'[\s\S]*?closeBeforeRun: true/);
    assert.match(lightboxSource, /if \(action\.closeBeforeRun\) \{\s*hideLightbox\(\);/);
    assert.match(lightboxSource, /if \(!action\.closeBeforeRun && action\.closeOnSuccess\) \{\s*hideLightbox\(\);/);
});

test('character inventory lightbox actions reuse the three-dot transfer workflows and owner context', () => {
    assert.match(viewSource, /'character-inventory-drop'[\s\S]*?dropThingToCurrentLocation\([\s\S]*?context: 'npc-inventory',[\s\S]*?npcId: currentNpcInventoryNpcId/);
    assert.match(viewSource, /'character-inventory-give-to'[\s\S]*?showPutThingInInventoryModal\([\s\S]*?context: 'npc-inventory',[\s\S]*?npcId: currentNpcInventoryNpcId/);
});

test('deferred lightbox focus preserves immediate action focus and ignores stale opens', () => {
    assert.match(lightboxSource, /currentShowSequence !== showSequence \|\| lightbox\.hasAttribute\('hidden'\)/);
    assert.match(lightboxSource, /focusAlreadyInside[\s\S]*?lightbox\.contains\(focusedElement\)/);
    assert.match(lightboxSource, /if \(!focusAlreadyInside\) \{\s*lightbox\.focus/);
});

test('mobile action styling is breakpoint-only and the retired location mode toggle is gone', () => {
    assert.doesNotMatch(viewSource, /locationItemMobileActionToggle|locationItemMobileActionMode/);
    assert.doesNotMatch(scssSource, /location-item-mobile-action-toggle/);
    assert.match(scssSource, /&__actions \{\s*display: none;/);
    assert.match(scssSource, /@media \(max-width: 768px\)[\s\S]*?&__actions \{[\s\S]*?display: flex;/);
});
