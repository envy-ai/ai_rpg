const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('barter NPC resolver treats party members as eligible presence', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const block = extractBlock(
        source,
        'function resolveBarterNpc',
        'function refreshNpcBarterStockIfNeeded'
    );

    assert.match(block, /const isPartyMember = isNpcInCurrentPlayerParty\(npc\);/);
    assert.match(block, /if \(!isPartyMember && npc\.currentLocation !== currentPlayer\.currentLocation\)/);
    assert.doesNotMatch(block, /in the party and cannot use the barter interface/);
});

test('barter trade buttons can render on party cards', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const canShowBlock = extractBlock(source, 'function canShowNpcTradeButton', 'function registerNpcTradeButton');
    const registerBlock = extractBlock(source, 'function registerNpcTradeButton', 'window.openBarterModal');
    const chatPartyBlock = extractBlock(source, 'function renderChatPartyPanel', 'window.updateChatPlayerPanel');
    const partyTabBlock = extractBlock(source, 'function renderParty', 'window.updatePartyDisplay');

    assert.doesNotMatch(canShowBlock, /!npc\.isInPlayerParty/);
    assert.match(registerBlock, /card\.querySelector\('\.party-portrait'\)/);
    assert.match(chatPartyBlock, /registerNpcTradeButton\(card, member\)/);
    assert.match(partyTabBlock, /registerNpcTradeButton\(card, member\)/);
});

test('barter NPC resolver uses client-visible disposition hostility heuristic', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const helperBlock = extractBlock(
        apiSource,
        'function isNpcHostileToCurrentPlayer',
        'function isNpcInCurrentPlayerParty'
    );

    assert.match(helperBlock, /def\.hostileThreshold/);
    assert.match(helperBlock, /npc\.getDisposition\(currentPlayer\.id, key\)/);
    assert.doesNotMatch(helperBlock, /Boolean\(npc\.isHostile\)/);
});

test('concluded barter sessions force the merchant through NPC turns', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const executeBlock = extractBlock(
        source,
        'async function executeNpcTurnsAfterPlayer',
        'async function processRandomEvents'
    );
    const conclusionBlock = extractBlock(
        source,
        'async function runBarterConclusionNpcTurn',
        'function normalizeBarterTransferEntries'
    );

    assert.match(executeBlock, /forcedNpcs = null/);
    assert.match(executeBlock, /hasForcedNpcQueue/);
    assert.match(executeBlock, /forcedNpcId/);
    assert.match(conclusionBlock, /executeNpcTurnsAfterPlayer\(/);
    assert.match(conclusionBlock, /forcedNpcs: \[\{ id: npc\.id, name: npc\.name \|\| null \}\]/);
    assert.match(source, /app\.post\('\/api\/npcs\/:id\/trade\/conclude'/);
});

test('barter commit queues merchant NPC turn instead of awaiting it', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const commitBlock = extractBlock(
        source,
        "app.post('/api/npcs/:id/trade/commit'",
        "app.post('/api/npcs/:id/trade/conclude'"
    );

    assert.match(commitBlock, /queueBarterConclusionNpcTurn\(\{/);
    assert.doesNotMatch(commitBlock, /await runBarterConclusionNpcTurn\(/);
    assert.match(commitBlock, /npcTurnPending: true/);
});

test('barter commit records a trade event summary with items and currency', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const summaryBlock = extractBlock(
        source,
        'function buildBarterTradeSummaryEvents',
        'function buildBarterNpcActionContext'
    );
    const commitBlock = extractBlock(
        source,
        "app.post('/api/npcs/:id/trade/commit'",
        "app.post('/api/npcs/:id/trade/conclude'"
    );

    assert.match(summaryBlock, /receivedByMerchant/);
    assert.match(summaryBlock, /receivedByPlayer/);
    assert.match(summaryBlock, /currencyTransferred/);
    assert.match(summaryBlock, /merchantCurrencyShortfallAccepted/);
    assert.match(summaryBlock, /sourceType: 'barter_trade'/);
    assert.match(summaryBlock, /sourceType: 'barter_currency'/);
    assert.match(commitBlock, /recordEventSummaryEntry\(\{/);
    assert.match(commitBlock, /label: '⚖️ Trade'/);
    assert.match(commitBlock, /tradeSummary: tradeSummary\?\.entry \|\| null/);
});

test('barter modal refreshes chat history after completed trade summary is recorded', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const submitBlock = extractBlock(
        source,
        'async function submitBarterTransaction',
        'async function submitBarterHaggle'
    );
    const closeIndex = submitBlock.indexOf('closeBarterModal({ conclude: false })');
    const refreshIndex = submitBlock.indexOf('await window.AIRPG_CHAT?.refreshChatHistory?.()');
    const processIndex = submitBlock.indexOf('await processBarterNpcTurnPayload(payload, requestId)');

    assert.notEqual(closeIndex, -1);
    assert.notEqual(refreshIndex, -1);
    assert.notEqual(processIndex, -1);
    assert.ok(closeIndex < refreshIndex);
    assert.ok(refreshIndex < processIndex);
});

test('barter modal concludes haggled sessions on close', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const closeBlock = extractBlock(
        source,
        'function closeBarterModal',
        'async function submitBarterTransaction'
    );
    const concludeBlock = extractBlock(
        source,
        'async function concludeBarterSession',
        'function closeBarterModal'
    );

    assert.match(closeBlock, /shouldConcludeBarterSessionOnClose\(\)/);
    assert.match(closeBlock, /concludeBarterSession\(/);
    assert.match(concludeBlock, /\/trade\/conclude/);
    assert.match(concludeBlock, /processBarterNpcTurnPayload/);
});

test('barter modal closes completed trades before processing merchant NPC turn payload', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const submitBlock = extractBlock(
        source,
        'async function submitBarterTransaction',
        'async function submitBarterHaggle'
    );
    const closeIndex = submitBlock.indexOf('closeBarterModal({ conclude: false })');
    const processIndex = submitBlock.indexOf('await processBarterNpcTurnPayload(payload, requestId)');

    assert.notEqual(closeIndex, -1);
    assert.notEqual(processIndex, -1);
    assert.ok(closeIndex < processIndex);
});

test('barter stock refresh lets pricing prompt update merchant currency', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts/_includes/barter-prices.njk'), 'utf8');
    const pricingBlock = extractBlock(
        apiSource,
        'async function runBarterPricingPrompt',
        'function createBarterSession'
    );
    const sessionRouteBlock = extractBlock(
        apiSource,
        "app.post('/api/npcs/:id/trade/session'",
        "app.post('/api/npcs/:id/trade/haggle'"
    );

    assert.match(promptSource, /<refreshingStock>/);
    assert.match(promptSource, /<merchantCurrency>/);
    assert.match(pricingBlock, /refreshMerchantCurrency = allowGeneratedStock/);
    assert.match(pricingBlock, /refreshingStock: Boolean\(refreshMerchantCurrency\)/);
    assert.match(pricingBlock, /parsed\.merchantCurrency/);
    assert.match(pricingBlock, /npc\.setCurrency\(parsed\.merchantCurrency\)/);
    assert.match(sessionRouteBlock, /refreshMerchantCurrency: refreshResult\.shouldGenerateStock/);
});

test('barter pricing retries strict parsing before applying any accepted-state mutations', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const pricingBlock = extractBlock(
        apiSource,
        'async function runBarterPricingPrompt',
        'function createBarterSession'
    );
    const retryIndex = pricingBlock.indexOf('runPromptWithParseRetries({');
    const parseIndex = pricingBlock.indexOf('parseBarterPricesResponse(response');
    const currencyIndex = pricingBlock.indexOf('npc.setCurrency(parsed.merchantCurrency)');
    const stockIndex = pricingBlock.indexOf('applyGeneratedBarterStock(npc, parsed.newStock)');

    assert.notEqual(retryIndex, -1);
    assert.ok(parseIndex > retryIndex);
    assert.ok(currencyIndex > parseIndex);
    assert.ok(stockIndex > parseIndex);
    assert.match(pricingBlock, /resolveConfiguredPromptMaxAttempts\(config\?\.ai/);
    assert.match(pricingBlock, /Barter pricing response attempt \$\{attempt\}\/\$\{maxAttempts\} failed validation/);
    assert.match(pricingBlock, /generatedStockMinimum: allowGeneratedStock \? barterConfig\.generatedStockMin : 0/);
    assert.match(pricingBlock, /generatedStockMaximum: allowGeneratedStock \? barterConfig\.generatedStockMax : 0/);
});

test('haggle chat entries are recorded only after pricing passes structured validation', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const haggleBlock = extractBlock(
        apiSource,
        "app.post('/api/npcs/:id/trade/haggle'",
        "app.post('/api/npcs/:id/trade/commit'"
    );
    const pricingIndex = haggleBlock.indexOf('const pricing = await runBarterPricingPrompt({');
    const playerEntryIndex = haggleBlock.indexOf('const playerEntry = pushChatEntry({');
    const responseEntryIndex = haggleBlock.indexOf('const responseEntry = pushChatEntry({');

    assert.notEqual(pricingIndex, -1);
    assert.ok(playerEntryIndex > pricingIndex);
    assert.ok(responseEntryIndex > playerEntryIndex);
});

test('barter generated stock uses batched inventory generator prompts', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts/_includes/inventory-generator.njk'), 'utf8');
    const configSource = fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8');
    const applyBlock = extractBlock(
        apiSource,
        'async function applyGeneratedBarterStock',
        'async function runBarterPricingPrompt'
    );
    const inventoryBlock = extractBlock(
        serverSource,
        'async function generateInventoryForCharacter',
        'function restoreCharacterHealthToMaximum'
    );

    assert.match(configSource, /max_items_per_prompt:\s*8/);
    assert.match(applyBlock, /generatedStockMaxItemsPerPrompt/);
    assert.match(applyBlock, /generateInventoryForCharacter\(/);
    assert.match(applyBlock, /attachToInventory: false/);
    assert.match(applyBlock, /mode: 'barterStock'/);
    assert.doesNotMatch(applyBlock, /generateItemsByNames\(/);
    assert.match(inventoryBlock, /Inventory generator returned \$\{items\.length\} barter stock item/);
    assert.match(promptSource, /inventoryMode == "barterStock"/);
    assert.match(promptSource, /requestedBarterStock/);
    assert.match(promptSource, /Generate an <items> block containing exactly \{\{ requestedItems \| length \}\}/);
});
