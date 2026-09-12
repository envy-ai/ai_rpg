const { test, expect } = require('@playwright/test');

const transparentBluePixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==',
    'base64'
);

test('mobile location and character inventory lightboxes expose direct transfer actions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/images/mobile-lightbox-actions/file', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: transparentBluePixel
    }));
    await page.route('**/api/players', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            players: [{ id: 'npc_mobile_actions', name: 'Mira', isNPC: true }]
        })
    }));
    const characterInventory = [
        {
            id: 'thing_mobile_drop',
            name: 'Drop Token',
            description: 'An item to drop.',
            thingType: 'item',
            count: 1,
            imageId: 'mobile-lightbox-actions'
        },
        {
            id: 'thing_mobile_inventory_give',
            name: 'Gift Token',
            description: 'An item to give away.',
            thingType: 'item',
            count: 1,
            imageId: 'mobile-lightbox-actions'
        }
    ];
    const inventoryOwner = {
        id: 'player_inventory_owner',
        name: 'Mobile Owner',
        isNPC: false,
        currentLocation: 'location_mobile_actions',
        inventory: characterInventory
    };
    await page.route('**/api/player', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, player: inventoryOwner })
    }));
    await page.route('**/api/npcs/player_inventory_owner', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            npc: inventoryOwner
        })
    }));

    const givePayloads = [];
    const dropPayloads = [];
    await page.route('**/api/things/*/give', async route => {
        const itemId = route.request().url().match(/\/api\/things\/([^/]+)\/give/)?.[1] || '';
        const payload = route.request().postDataJSON();
        givePayloads.push({ itemId, payload });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                thing: { id: itemId, name: 'Pocket Stone', thingType: 'item' },
                owner: { id: payload.ownerId, name: payload.ownerId, inventory: [] }
            })
        });
    });
    await page.route('**/api/things/*/drop', async route => {
        const itemId = route.request().url().match(/\/api\/things\/([^/]+)\/drop/)?.[1] || '';
        const payload = route.request().postDataJSON();
        dropPayloads.push({ itemId, payload });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                thing: { id: itemId, name: 'Drop Token', thingType: 'item' },
                owner: {
                    id: payload.ownerId,
                    name: 'Mobile Owner',
                    isNPC: false,
                    currentLocation: 'location_mobile_actions',
                    inventory: [
                        {
                            id: 'thing_mobile_inventory_give',
                            name: 'Gift Token',
                            description: 'An item to give away.',
                            thingType: 'item',
                            count: 1,
                            imageId: 'mobile-lightbox-actions'
                        }
                    ]
                }
            })
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderLocationThingCollections === 'function');

    const renderItem = itemId => page.evaluate(id => {
        const thing = {
            id,
            name: 'Pocket Stone',
            description: 'A small smooth stone.',
            thingType: 'item',
            count: 1,
            imageId: 'mobile-lightbox-actions'
        };
        window.currentPlayerData = { id: 'player_mobile_actions', name: 'Mobile Player', inventory: [] };
        window.currentNpcData = new Map([['npc_mobile_actions', { id: 'npc_mobile_actions', name: 'Mira', isNPC: true }]]);
        window.lastRenderedLocation = { id: 'location_mobile_actions', things: [thing] };
        window.loadCurrentLocation = async () => {};
        window.refreshParty = async () => {};
        window.renderLocationThingCollections(window.lastRenderedLocation, [thing]);
    }, itemId);
    const openItemLightbox = itemId => page.evaluate(id => {
        const trigger = document.querySelector(`[data-thing-id="${id}"] .image-lightbox-trigger`);
        if (!(trigger instanceof HTMLElement)) {
            throw new Error(`Lightbox trigger for ${id} is unavailable.`);
        }
        trigger.click();
    }, itemId);

    await renderItem('thing_mobile_close');
    await openItemLightbox('thing_mobile_close');
    const lightbox = page.locator('#imageLightbox');
    await expect(lightbox).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick up', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Give to...', exact: true })).toBeVisible();
    await page.locator('#imageLightboxClose').click();
    await expect(lightbox).toBeHidden();

    await page.setViewportSize({ width: 900, height: 844 });
    await openItemLightbox('thing_mobile_close');
    await expect(page.locator('#imageLightboxActions')).toBeHidden();
    await page.locator('#imageLightboxClose').click();

    await page.setViewportSize({ width: 390, height: 844 });
    await renderItem('thing_mobile_pickup');
    await page.evaluate(() => {
        const trigger = document.querySelector('[data-thing-id="thing_mobile_pickup"] .image-lightbox-trigger');
        if (!(trigger instanceof HTMLElement)) {
            throw new Error('Pickup lightbox trigger is unavailable.');
        }
        trigger.click();
        const pickupButton = document.querySelector('[data-lightbox-action-id="location-pick-up"]');
        if (!(pickupButton instanceof HTMLButtonElement)) {
            throw new Error('Pickup lightbox action is unavailable.');
        }
        pickupButton.focus();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    await expect(page.getByRole('button', { name: 'Pick up', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => givePayloads.find(entry => entry.itemId === 'thing_mobile_pickup')).toEqual({
        itemId: 'thing_mobile_pickup',
        payload: {
            ownerId: 'player_mobile_actions',
            ownerType: 'player',
            locationId: 'location_mobile_actions'
        }
    });
    await expect(lightbox).toBeHidden();

    await renderItem('thing_mobile_give');
    await openItemLightbox('thing_mobile_give');
    await page.getByRole('button', { name: 'Give to...', exact: true }).click();
    await expect(lightbox).toBeHidden();
    await expect(page.locator('.npc-selection-modal')).toBeVisible();
    await page.locator('.npc-selection-item', { hasText: 'Mira' }).click();
    await expect.poll(() => givePayloads.find(entry => entry.itemId === 'thing_mobile_give')).toEqual({
        itemId: 'thing_mobile_give',
        payload: {
            ownerId: 'npc_mobile_actions',
            ownerType: 'npc',
            locationId: 'location_mobile_actions'
        }
    });

    const playerInventoryFetch = page.waitForResponse(response => (
        response.url().endsWith('/api/player')
        && response.request().method() === 'GET'
    ));
    const characterInventoryRefresh = page.waitForResponse(response => (
        response.url().includes('/api/npcs/player_inventory_owner')
        && response.request().method() === 'PUT'
    ));
    await page.evaluate(owner => {
        window.currentPlayerData = owner;
        window.currentNpcData = new Map([
            [owner.id, owner],
            ['npc_mobile_actions', { id: 'npc_mobile_actions', name: 'Mira', isNPC: true }]
        ]);
        window.loadCurrentLocation = async () => {};
        window.refreshParty = async () => {};
        const inventoryButton = document.getElementById('chatPlayerInventoryButton');
        if (!(inventoryButton instanceof HTMLButtonElement)) {
            throw new Error('Player inventory button is unavailable.');
        }
        inventoryButton.disabled = false;
        inventoryButton.click();
    }, inventoryOwner);
    await playerInventoryFetch;
    await characterInventoryRefresh;
    await expect(page.locator('#npcInventoryModal')).toBeVisible();

    await openItemLightbox('thing_mobile_drop');
    const characterLightboxActions = page.locator('#imageLightboxActions');
    await expect(characterLightboxActions.getByRole('button', { name: 'Drop', exact: true })).toBeVisible();
    await expect(characterLightboxActions.getByRole('button', { name: 'Give to...', exact: true })).toBeVisible();
    await characterLightboxActions.getByRole('button', { name: 'Drop', exact: true }).click();
    await expect.poll(() => dropPayloads.find(entry => entry.itemId === 'thing_mobile_drop')).toEqual({
        itemId: 'thing_mobile_drop',
        payload: {
            ownerId: 'player_inventory_owner',
            ownerType: 'player',
            locationId: 'location_mobile_actions'
        }
    });
    await expect(lightbox).toBeHidden();

    await openItemLightbox('thing_mobile_inventory_give');
    await characterLightboxActions.getByRole('button', { name: 'Give to...', exact: true }).click();
    await expect(lightbox).toBeHidden();
    await expect(page.locator('.npc-selection-modal')).toBeVisible();
    await page.locator('.npc-selection-item', { hasText: 'Mira' }).click();
    await expect.poll(() => givePayloads.find(entry => entry.itemId === 'thing_mobile_inventory_give')).toEqual({
        itemId: 'thing_mobile_inventory_give',
        payload: {
            ownerId: 'npc_mobile_actions',
            ownerType: 'npc'
        }
    });
});
