const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4174';
const artifactDirectory = path.resolve(__dirname, '../tmp/item-currency-browser-verification');

async function requestJson(route, options = {}) {
    const response = await fetch(`${baseUrl}${route}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `${options.method || 'GET'} ${route} returned HTTP ${response.status}`);
    }
    return payload;
}

async function createInventoryItem(playerId, payload) {
    const created = await requestJson('/api/things', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    await requestJson(`/api/things/${encodeURIComponent(created.thing.id)}/give`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: playerId, ownerType: 'player' })
    });
    return created.thing;
}

function captureNextDialog(page, { type, includes, action }) {
    return new Promise((resolve, reject) => {
        page.once('dialog', async (dialog) => {
            try {
                assert.equal(dialog.type(), type);
                for (const expectedText of includes) {
                    assert.ok(dialog.message().includes(expectedText), `Dialog did not include: ${expectedText}`);
                }
                if (action === 'dismiss') {
                    await dialog.dismiss();
                } else {
                    await dialog.accept();
                }
                resolve(dialog.message());
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function openCurrencyAction(page, thingId) {
    const card = page.locator(`[data-thing-id="${thingId}"]:visible`).first();
    await card.waitFor({ state: 'visible' });
    await card.scrollIntoViewIfNeeded();
    await card.locator('.thing-card-menu-button').click();
    const action = page.locator('.entity-context-menu.is-open .thing-card-menu-item', { hasText: 'Convert to Currency' }).first();
    await action.waitFor({ state: 'visible' });
    return { card, action };
}

async function main() {
    fs.mkdirSync(artifactDirectory, { recursive: true });

    const playerResult = await requestJson('/api/player');
    const player = playerResult.player;
    if (player?.name !== 'Adventurer' || player?.locationId) {
        throw new Error('Currency-conversion browser verification only runs against the isolated no-save Adventurer session.');
    }

    const suffix = Date.now().toString(36);
    const valuedName = `Browser Copper Stack ${suffix}`;
    const valuelessName = `Browser Valueless Item ${suffix}`;
    const valuedItem = await createInventoryItem(player.id, {
        name: valuedName,
        description: 'Isolated currency-conversion browser verification item.',
        thingType: 'item',
        count: 7,
        metadata: { value: 2 }
    });
    const valuelessItem = await createInventoryItem(player.id, {
        name: valuelessName,
        description: 'Isolated missing-value browser verification item.',
        thingType: 'item',
        count: 1,
        metadata: {}
    });
    const valuedPreview = (await requestJson(
        `/api/things/${encodeURIComponent(valuedItem.id)}/currency-conversion`
    )).conversion;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message || error}`));
    page.on('console', message => {
        if (message.type() === 'error') {
            browserErrors.push(`console.error: ${message.text()}`);
        }
    });

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.refreshInventory === 'function');
        await page.evaluate(() => window.refreshInventory());
        const inventoryButton = page.locator('#chatPlayerInventoryButton');
        await inventoryButton.waitFor({ state: 'visible' });
        await inventoryButton.click();

        const valuedAction = await openCurrencyAction(page, valuedItem.id);
        await page.screenshot({
            path: path.join(artifactDirectory, 'currency-context-menu.png'),
            fullPage: true
        });

        const confirmationPromise = captureNextDialog(page, {
            type: 'confirm',
            includes: [
                'Warning: convert this item to currency?',
                `Item being deleted: ${valuedItem.name} (x7)`,
                `You will receive ${valuedPreview.totalValue} ${valuedPreview.currencyLabel}.`
            ],
            action: 'dismiss'
        });
        await valuedAction.action.click();
        const confirmationMessage = await confirmationPromise;

        const playerAfterDismissal = (await requestJson('/api/player')).player;
        assert.equal(playerAfterDismissal.currency, player.currency);
        assert.ok(playerAfterDismissal.inventory.some(item => item?.id === valuedItem.id));
        assert.deepEqual(browserErrors, []);

        const acceptedAction = await openCurrencyAction(page, valuedItem.id);
        const acceptedConfirmationPromise = captureNextDialog(page, {
            type: 'confirm',
            includes: [
                `Item being deleted: ${valuedItem.name} (x7)`,
                `You will receive ${valuedPreview.totalValue} ${valuedPreview.currencyLabel}.`
            ],
            action: 'accept'
        });
        await acceptedAction.action.click();
        const acceptedConfirmationMessage = await acceptedConfirmationPromise;
        await page.locator(`[data-thing-id="${valuedItem.id}"]:visible`).waitFor({ state: 'detached' });

        const playerAfterConversion = (await requestJson('/api/player')).player;
        assert.equal(playerAfterConversion.currency, player.currency + valuedPreview.totalValue);
        assert.ok(!playerAfterConversion.inventory.some(item => item?.id === valuedItem.id));
        assert.deepEqual(browserErrors, []);

        const valuelessAction = await openCurrencyAction(page, valuelessItem.id);
        const errorPromise = captureNextDialog(page, {
            type: 'alert',
            includes: [
                'Failed to convert item to currency:',
                'it has no numeric value. Edit the item and set its value first.'
            ],
            action: 'accept'
        });
        await valuelessAction.action.click();
        const errorMessage = await errorPromise;

        const unexpectedBrowserErrors = browserErrors.filter(message => (
            !message.includes('the server responded with a status of 409 (Conflict)')
        ));
        assert.deepEqual(unexpectedBrowserErrors, []);
        fs.writeFileSync(path.join(artifactDirectory, 'result.json'), JSON.stringify({
            success: true,
            valuedItemId: valuedItem.id,
            valuelessItemId: valuelessItem.id,
            confirmationMessage,
            acceptedConfirmationMessage,
            currencyBefore: player.currency,
            currencyAfter: playerAfterConversion.currency,
            errorMessage,
            expectedBrowserErrors: browserErrors,
            unexpectedBrowserErrors
        }, null, 2));
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
