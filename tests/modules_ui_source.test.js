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

test('module card drop target helper is shared before inventory renderers use it', () => {
    const source = read('views/index.njk');
    const helperIndex = source.indexOf('function registerThingModuleDropTarget(card, thing, options = {})');
    const inventoryIndex = source.indexOf('function renderNpcInventory(items = [])');
    const containerIndex = source.indexOf('function renderThingContainerModal()');
    const locationDragIndex = source.indexOf('let draggedLocationThing = null');

    assert.notEqual(helperIndex, -1, 'expected module card drop target helper');
    assert.notEqual(inventoryIndex, -1, 'expected NPC/player inventory renderer');
    assert.notEqual(containerIndex, -1, 'expected container modal renderer');
    assert.notEqual(locationDragIndex, -1, 'expected location drag/drop state');
    assert.ok(helperIndex < inventoryIndex, 'inventory renderers must not reference a later location-scoped module drop helper');
    assert.ok(helperIndex < containerIndex, 'container inventory renderers must not reference a later location-scoped module drop helper');
    assert.ok(helperIndex < locationDragIndex, 'module card drop helper must live in shared item-card code, not the location drag/drop section');
});

test('module context action refresh re-renders the open inventory modal for the player, not only NPCs', () => {
    const source = read('views/index.njk');
    const start = source.indexOf('async function refreshAfterModThingContextAction(result, options = {}, thing = {}) {');
    const end = source.indexOf('async function executeModThingContextAction(action, thing, options = {}) {', start);
    assert.notEqual(start, -1, 'expected refreshAfterModThingContextAction');
    assert.notEqual(end, -1, 'expected executeModThingContextAction boundary');
    const block = source.slice(start, end);

    // The player's inventory modal reuses the NPC inventory modal, so BOTH the NPC
    // branch and the player (else) branch must re-render it from the fresh actor
    // inventory when it is open for that actor. Otherwise an installed/removed
    // module does not appear until a manual inventory refresh.
    const renderCalls = block.match(/renderNpcInventory\(actor\.inventory\)/g) || [];
    assert.ok(renderCalls.length >= 2, 'both NPC and player branches should re-render the open inventory modal');
    const guards = block.match(/currentNpcInventoryNpcId === actor\.id/g) || [];
    assert.ok(guards.length >= 2, 'both branches should guard the modal re-render on the open actor');
    assert.match(block, /window\.currentPlayerData = cloneActorRecord\(actor\)/);
});

test('items output in full in base context embed mod-contributed detail, and modules mod supplies installed modules', () => {
    const baseContext = read('prompts/base-context.xml.njk');
    const serverSource = read('server.js');
    const modSource = read('mods/modules/mod.js');
    const systemSource = read('mods/modules/ItemModuleSystem.js');

    // Full <item> blocks render the mod-contributed XML fragment.
    const embeds = baseContext.match(/\{% if item\.modPromptXml %\}\n\{\{ item\.modPromptXml \| safe \}\}\{% endif %\}/g) || [];
    assert.ok(embeds.length >= 3, 'full item blocks should embed item.modPromptXml');

    // mapItemContext collects per-thing contributions and exposes them as modPromptXml.
    assert.match(serverSource, /collectThingPromptContributions\(/);
    assert.match(serverSource, /modPromptXml/);

    // The modules mod registers the contributor and builds installed-module XML.
    assert.match(modSource, /registerThingPromptContributor\(/);
    assert.match(systemSource, /getInstalledModulesPromptXml\(/);
    assert.match(systemSource, /<installedModules>/);
});
