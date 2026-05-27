const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('settings page renders a row editor for configurable module slot types', () => {
    const source = read('views/settings.njk');

    assert.match(source, /modules-slot-types-editor/);
    assert.match(source, /renderModulesSlotTypesEditor/);
    assert.match(source, /collectModulesSlotTypesEditorValue/);
    assert.match(source, /Modules slot types must include at least one entry/);
});

test('item edit modal exposes module-specific slot and module type controls', () => {
    const source = read('views/index.njk');

    assert.match(source, /renderModulesThingEditFields/);
    assert.match(source, /collectModulesThingEditFieldValues/);
    assert.match(source, /getActiveModuleSlotTypes/);
    assert.match(source, /thing-edit-module-slots/);
    assert.match(source, /thing-edit-module-type/);
    assert.doesNotMatch(source, /thing-edit-module-slot-label/);
});

test('thing cards omit installed module strips while tooltips render module icons and details', () => {
    const source = read('views/index.njk');

    assert.match(source, /resolveInstalledModulesForThing/);
    assert.doesNotMatch(source, /renderInstalledModuleStrip/);
    assert.doesNotMatch(source, /thing-installed-modules-strip/);
    assert.match(source, /formatInstalledModulesTooltipSection/);
    assert.match(source, /getInstalledModuleTooltipIconUrl/);
    assert.match(source, /modules-tooltip-module__icon/);
    assert.match(source, /modules-tooltip-module__title/);
    assert.match(source, /Installed Modules/);
});

test('module context actions can pass selected base and module ids to server-backed handlers', () => {
    const source = read('views/index.njk');

    assert.match(source, /prepareModulesContextActionRequest/);
    assert.match(source, /moduleItemId/);
    assert.match(source, /baseItemId/);
    assert.match(source, /\/api\/mod-thing-context-actions\/\$\{encodeURIComponent\(fullId\)\}/);
});

test('installed modules are hidden from standalone inventory panels', () => {
    const source = read('views/index.njk');

    assert.match(source, /function isInstalledModuleThing/);
    assert.match(source, /function getStandaloneInventoryItems/);
    assert.match(source, /rawItems\.forEach\(cacheThingData\);[\s\S]*?const safeItems = getStandaloneInventoryItems\(rawItems\);/);
    assert.match(source, /items: getStandaloneInventoryItems\(currentThingContainerPlayerInventory\)/);
    assert.match(source, /if \(isInstalledModuleThing\(item\)\) \{[\s\S]*?return;/);
    assert.match(source, /visibleOwnOffers = offers\.filter\(offer => \([\s\S]*?!isInstalledModuleThing\(offer\.item\)/);
});

test('modules mod ships namespaced public assets and styles', () => {
    const modSource = read('mods/modules/mod.js');
    const jsSource = read('mods/modules/public/js/modules-ui.js');
    const scssSource = read('mods/modules/public/css/modules.scss');

    assert.match(modSource, /modular\.svg/);
    assert.match(modSource, /module\.svg/);
    assert.match(jsSource, /window\.AIRPGModules/);
    assert.match(jsSource, /openInstallModulePicker/);
    assert.match(scssSource, /\.modules-tooltip-module/);
    assert.match(scssSource, /\.modules-tooltip-module__icon/);
    assert.match(scssSource, /\.modules-slot-types-editor/);
});

test('module workbench modal supports drag-install and removal from base item badge', () => {
    const source = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(source, /id="moduleWorkbenchModal"/);
    assert.match(source, /id="moduleWorkbenchInventoryGrid"/);
    assert.match(source, /id="moduleWorkbenchSlots"/);
    assert.match(source, /function openModuleWorkbenchModal/);
    assert.match(source, /function renderModuleWorkbenchInventory/);
    assert.match(source, /function renderModuleWorkbenchSlots/);
    assert.match(source, /function installModuleFromWorkbench/);
    assert.match(source, /function removeModuleFromWorkbench/);
    assert.match(source, /function updateModuleWorkbenchDragHighlights/);
    assert.match(source, /module-workbench__slot--drop-valid/);
    assert.match(source, /module-workbench__installed-image/);
    assert.match(source, /module-workbench__module-card--disabled/);
    assert.match(source, /badge\.key === 'mod:modules:module-compatible'/);
    assert.match(source, /openModuleWorkbenchModal\(thingDataCache\.get\(thing\.id\) \|\| thing, options\)/);
    assert.match(source, /getLooseModuleWorkbenchModules/);
    assert.match(source, /filter\(item => getThingModuleType\(item\) && !isInstalledModuleThing\(item\)\)/);

    assert.match(scssSource, /\.module-workbench__/);
    assert.match(scssSource, /\.module-workbench__slot--drop-valid/);
    assert.match(scssSource, /\.module-workbench__installed-image img\s*\{[\s\S]*?object-fit:\s*contain;/);
    assert.match(scssSource, /\.module-workbench__module-card--disabled/);
});

test('module workbench can source loose modules from current location items', () => {
    const source = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(source, /function getCurrentLocationModuleWorkbenchItems/);
    assert.match(source, /function annotateModuleWorkbenchItemSource/);
    assert.match(source, /moduleWorkbenchSourceType/);
    assert.match(source, /moduleItemSource:/);
    assert.match(source, /baseItemSource:/);
    assert.match(source, /currentLocationThingCollections\.allItems/);
    assert.match(source, /items: itemThings/);
    assert.match(source, /allItems: allItemThings/);
    assert.match(source, /filter\(thing => !isInstalledModuleThing\(thing\)\)/);
    assert.doesNotMatch(source, /moduleWorkbenchSourceLabel/);
    assert.doesNotMatch(source, /module-workbench__source/);

    assert.doesNotMatch(scssSource, /\.module-workbench__source/);
});

test('module-compatible badge renders occupied and total slot count', () => {
    const source = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(source, /function getModuleBadgeSlotCountText/);
    assert.match(source, /getThingInstalledModuleIds\(thing\)\.length/);
    assert.match(source, /\$\{occupiedSlots\}\/\$\{totalSlots\}/);
    assert.match(source, /slotCountText:/);
    assert.match(source, /badge\.slotCountText/);
    assert.match(source, /entity-image-badge__slot-count/);

    const slotCountRuleMatch = scssSource.match(/\.entity-image-badge__slot-count\s*\{[\s\S]*?\n\}/);
    assert.ok(slotCountRuleMatch, 'expected slot count badge style rule');
    assert.doesNotMatch(slotCountRuleMatch[0], /text-stroke/);
    assert.match(slotCountRuleMatch[0], /text-shadow:[\s\S]*#000000/);
});

test('module items can be dropped directly onto modular item cards with open slots', () => {
    const source = read('views/index.njk');
    const scssSource = read('public/css/main.scss');
    const chatDocs = read('docs/ui/chat_interface.md');
    const moduleDocs = read('docs/mods/modules.md');

    assert.match(source, /function registerThingModuleDropTarget\(card, thing, options = \{\}\)/);
    assert.match(source, /function resolveThingModuleDropSource\(baseItem, options = \{\}\)/);
    assert.match(source, /function canDropModuleIntoBaseItem\(moduleItem, baseItem, options = \{\}\)/);
    assert.match(source, /async function installModuleFromCardDrop\(\{ baseItem, moduleItem, moduleItemSource, options = \{\} \} = \{\}\)/);
    assert.match(source, /\/api\/mod-thing-context-actions\/\$\{encodeURIComponent\('modules:install-module'\)\}/);
    assert.match(source, /baseItemSource:/);
    assert.match(source, /moduleItemSource/);
    assert.match(source, /slotType: getThingModuleType\(moduleItem\)/);
    assert.match(source, /card\.classList\.add\('thing-module-drop-target'\)/);
    assert.match(source, /event\.stopImmediatePropagation\?\.\(\)/);
    assert.match(source, /closest\('\.thing-container-drop-target, \.thing-module-drop-target'\)/);
    assert.match(source, /registerThingModuleDropTarget\(card, thing, \{ context: 'location'/);
    assert.match(source, /registerThingModuleDropTarget\(card, thing, \{ context: 'npc-inventory'/);
    assert.match(source, /registerThingModuleDropTarget\(card, thing, \{ context: 'container-player-inventory'/);

    assert.match(scssSource, /\.thing-module-drop-target\.is-drop-hover/);
    assert.match(chatDocs, /Dropping a loose module item card onto a modular item card/i);
    assert.match(moduleDocs, /Loose module item cards can also be dropped directly onto compatible modular item cards/i);
});
