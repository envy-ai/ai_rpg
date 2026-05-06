const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildBarterItemReferenceIndex,
    resolveBarterOfferItemReference,
    buildBarterCurrencySettlement
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
