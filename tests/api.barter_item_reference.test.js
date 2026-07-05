const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    buildBarterItemReferenceIndex,
    resolveBarterOfferItemReference,
    buildBarterCurrencySettlement,
    sanitizeBarterPricingXmlForParsing,
    parseGeneratedBarterStockCount
} = require('../api.js');

function resolve(items, reference) {
    const warnings = [];
    const result = resolveBarterOfferItemReference(buildBarterItemReferenceIndex(items), {
        ...reference,
        contextLabel: 'test item',
        warn: message => warnings.push(message)
    });
    return { result, warnings };
}

test('barter item reference uses unique exact name before returned id', () => {
    const { result, warnings } = resolve([
        { id: 'correct-id', name: 'Copper Knife' },
        { id: 'wrong-id', name: 'Tin Cup' }
    ], {
        name: 'Copper Knife',
        id: 'wrong-id'
    });

    assert.equal(result.id, 'correct-id');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Using the exact name match/);
});

test('barter item reference uses id to disambiguate duplicate names', () => {
    const { result, warnings } = resolve([
        { id: 'apple-1', name: 'Apple' },
        { id: 'apple-2', name: 'Apple' }
    ], {
        name: 'Apple',
        id: 'apple-2'
    });

    assert.equal(result.id, 'apple-2');
    assert.deepEqual(warnings, []);
});

test('barter item reference warns and skips bad id for ambiguous name', () => {
    const { result, warnings } = resolve([
        { id: 'apple-1', name: 'Apple' },
        { id: 'apple-2', name: 'Apple' }
    ], {
        name: 'Apple',
        id: 'missing-id'
    });

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /did not match any listed item with that name/);
});

test('barter item reference can resolve by id when name is missing', () => {
    const { result, warnings } = resolve([
        { id: 'blank-name-id', name: 'Unlabeled Gear' }
    ], {
        id: 'blank-name-id'
    });

    assert.equal(result.id, 'blank-name-id');
    assert.deepEqual(warnings, []);
});

test('barter item reference warns and skips unknown id when name is missing', () => {
    const { result, warnings } = resolve([
        { id: 'known-id', name: 'Known Gear' }
    ], {
        id: 'unknown-id'
    });

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown item id/);
});

test('barter currency settlement reports merchant shortfall before accepted', () => {
    assert.throws(
        () => buildBarterCurrencySettlement({
            netPlayerPays: -50,
            playerCurrency: 0,
            merchantCurrency: 12,
            merchantName: 'Test Merchant'
        }),
        error => {
            assert.equal(error.reason, 'merchant-insufficient-currency');
            assert.equal(error.status, 409);
            assert.equal(error.requiredMerchantPayment, 50);
            assert.equal(error.merchantCurrency, 12);
            assert.equal(error.shortfall, 38);
            return true;
        }
    );
});

test('barter currency settlement pays only available merchant currency when accepted', () => {
    const settlement = buildBarterCurrencySettlement({
        netPlayerPays: -50,
        playerCurrency: 0,
        merchantCurrency: 12,
        merchantName: 'Test Merchant',
        allowMerchantCurrencyShortfall: true
    });

    assert.equal(settlement.merchantPays, 12);
    assert.equal(settlement.shortfall, 38);
    assert.equal(settlement.merchantCurrencyShortfallAccepted, true);
});

test('barter pricing prompt omits unavailable item offers instead of asking for willingness tags', () => {
    const rootDir = path.join(__dirname, '..');
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts/_includes/barter-prices.njk'), 'utf8');

    assert.doesNotMatch(promptSource, /willingToBuy/);
    assert.doesNotMatch(promptSource, /willingToSell/);
    assert.match(promptSource, /omit/i);
    assert.match(promptSource, /not willing to buy/i);
    assert.match(promptSource, /not willing to sell/i);

    assert.doesNotMatch(apiSource, /directChildText\(itemNode, 'willingToBuy'\)/);
    assert.doesNotMatch(apiSource, /directChildText\(itemNode, 'willingToSell'\)/);
    assert.match(apiSource, /playerOffers\.set\(resolved\.id,[\s\S]*?willingToBuy: true/);
    assert.match(apiSource, /merchantOffers\.set\(resolved\.id,[\s\S]*?willingToSell: true/);
    assert.doesNotMatch(apiSource, /did not include a usable offer for player item/);
});

test('barter pricing excludes installed modules from standalone inventory offers', () => {
    const rootDir = path.join(__dirname, '..');
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

    assert.match(apiSource, /function isInstalledModuleInventoryItem/);
    assert.match(apiSource, /function getStandaloneInventoryItems/);
    assert.match(apiSource, /getStandaloneInventoryItems\(currentPlayer\.getInventoryItems\(\)\)/);
    assert.match(apiSource, /getStandaloneInventoryItems\(npc\.getInventoryItems\(\)\)/);
    assert.match(apiSource, /getStandaloneInventoryItems\(npc\.getBarterInventoryItems\(\)\)/);
});

test('barter pricing XML sanitizer removes Unicode replacement characters before strict parsing', () => {
    const warnings = [];
    const sanitized = sanitizeBarterPricingXmlForParsing(
        '<barterPrices><playerItems><item><reason>broken\uFFFD\uFFFD\uFFFDtext</reason></item></playerItems></barterPrices>',
        { warn: message => warnings.push(message) }
    );

    assert.equal(
        sanitized,
        '<barterPrices><playerItems><item><reason>brokentext</reason></item></playerItems></barterPrices>'
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Unicode replacement character/);
});

test('barter generated stock count parser allows zero so pricing can skip that seed', () => {
    assert.equal(parseGeneratedBarterStockCount('', 'new stock Blank count'), 1);
    assert.equal(parseGeneratedBarterStockCount('0', 'new stock Empty Crate count'), 0);
    assert.equal(parseGeneratedBarterStockCount('3', 'new stock Torch count'), 3);
    assert.throws(
        () => parseGeneratedBarterStockCount('-1', 'new stock Bad count'),
        /must be a non-negative integer/
    );
});

test('barter pricing parser skips zero-count generated stock before inventory generation', () => {
    const rootDir = path.join(__dirname, '..');
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const parseBlock = apiSource.slice(
        apiSource.indexOf('const newStock = [];'),
        apiSource.indexOf('return {', apiSource.indexOf('const newStock = [];'))
    );

    assert.match(parseBlock, /parseGeneratedBarterStockCount/);
    assert.match(parseBlock, /if \(count === 0\) \{\s*continue;\s*\}/);
    assert.doesNotMatch(parseBlock, /parseBarterPositiveInteger\(directChildText\(itemNode, 'count'\)/);
});
