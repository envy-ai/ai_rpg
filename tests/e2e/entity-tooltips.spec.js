const { test, expect } = require('@playwright/test');

const transparentBluePixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==',
    'base64'
);

test('location and NPC cards show rich item-style tooltips with pertinent details', async ({ page }) => {
    await page.route('**/api/factions', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            factions: [{
                id: 'faction-tooltip-test',
                name: 'Azure Watch',
                shortDescription: 'Wardens of the eastern roads.',
                imageId: 'entity-tooltip-image'
            }],
            playerStandings: {}
        })
    }));
    await page.route('**/api/images/entity-tooltip-image/file', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: transparentBluePixel
    }));

    await page.goto('/');

    const visibleNpc = {
        id: 'npc-tooltip-visible',
        name: 'Mira Vale',
        description: 'A vigilant ranger who knows every trail through the vale.',
        shortDescription: 'A vigilant ranger.',
        class: 'Ranger',
        race: 'Human',
        level: 5,
        health: 31,
        maxHealth: 40,
        imageId: 'entity-tooltip-image',
        isNPC: true,
        isInPlayerParty: true,
        isHostileToPlayer: true,
        willingToTrade: true,
        factionId: 'faction-tooltip-test',
        aliases: ['Pathfinder'],
        resistances: 'Cold',
        vulnerabilities: 'Fire',
        dispositionsTowardPlayer: { trust: 12, fear: -4 },
        statusEffects: [{ name: 'Marked', duration: 5 }],
        needBars: []
    };

    await page.evaluate(async ({ npc }) => {
        if (typeof window.updateLocationDisplay !== 'function') {
            throw new Error('updateLocationDisplay is unavailable.');
        }
        if (typeof window.loadFactionOptions === 'function') {
            await window.loadFactionOptions({ force: true });
        }
        window.currentPlayerData = {
            ...(window.currentPlayerData || {}),
            partyMembers: [npc.id]
        };
        await window.updateLocationDisplay({
            id: 'location-tooltip-test',
            name: 'Eastern Gate',
            description: 'A broad stone gate overlooks the road and the wooded hills beyond.',
            shortDescription: 'A guarded eastern gate.',
            baseLevel: 7,
            imageId: 'entity-tooltip-image',
            favorite: true,
            controllingFactionId: 'faction-tooltip-test',
            regionName: 'Aster Vale',
            regionPath: [{ id: 'region-parent', name: 'The Marches' }, { id: 'region-child', name: 'Aster Vale' }],
            exits: {
                west: { id: 'exit-west', destination: 'location-west', destinationName: 'West Road', travelTimeMinutes: 5 },
                north: { id: 'exit-north', destination: 'location-north', destinationName: 'North Trail', travelTimeMinutes: 10 }
            },
            npcs: [
                npc,
                {
                    id: 'npc-tooltip-hidden',
                    name: 'Secret Scout',
                    description: 'Should remain undisclosed.',
                    level: 2,
                    health: 10,
                    maxHealth: 10,
                    imageId: 'entity-tooltip-image',
                    isNPC: true,
                    hiddenFromPlayer: true,
                    needBars: []
                }
            ],
            things: [
                { id: 'thing-tooltip-item', name: 'Gate Key', description: 'A key.', thingType: 'item', imageId: 'entity-tooltip-image' },
                { id: 'thing-tooltip-scenery', name: 'Watch Bell', description: 'A bell.', thingType: 'scenery', imageId: 'entity-tooltip-image' }
            ],
            thingIds: ['thing-tooltip-item', 'thing-tooltip-scenery'],
            statusEffects: [{ name: 'Blessed Ground', duration: 60 }]
        });
    }, { npc: visibleNpc });

    const tooltip = page.locator('#inventoryTooltip');
    await page.locator('#locationImage').hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.tooltip-entity.is-location')).toHaveCount(1);
    await expect(tooltip).toContainText('Eastern Gate');
    await expect(tooltip).toContainText('Level 7');
    await expect(tooltip).toContainText('The Marches › Aster Vale');
    await expect(tooltip).toContainText('Exits');
    await expect(tooltip).toContainText('2');
    await expect(tooltip).toContainText('NPCs');
    await expect(tooltip).toContainText('1');
    await expect(tooltip).toContainText('Items');
    await expect(tooltip).toContainText('Scenery');
    await expect(tooltip).toContainText('Azure Watch');
    await expect(tooltip).toContainText('Blessed Ground');
    await expect(tooltip).not.toContainText('Secret Scout');
    await page.screenshot({ path: 'tmp/location-rich-tooltip.png' });

    const lightbox = page.locator('#imageLightbox');
    await page.locator('#locationImage').click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.tooltip-entity.is-location')).toHaveCount(1);
    await expect(lightbox).toContainText('Eastern Gate');
    await expect(lightbox).toContainText('The Marches › Aster Vale');
    await expect(lightbox).toContainText('Azure Watch');
    await expect(lightbox).toContainText('Blessed Ground');
    await expect(lightbox).not.toContainText('Secret Scout');
    await page.screenshot({ path: 'tmp/location-rich-lightbox.png' });
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    const npcCard = page.locator('#locationNPCs .location-entity-card').first();
    await npcCard.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(tooltip).toContainText('Mira Vale');
    await expect(tooltip).toContainText('Level 5');
    await expect(tooltip).toContainText('Ranger • Human');
    await expect(tooltip).toContainText('31 / 40');
    await expect(tooltip).toContainText('Party');
    await expect(tooltip).toContainText('Member');
    await expect(tooltip).toContainText('Trade');
    await expect(tooltip).toContainText('Unavailable');
    await expect(tooltip).toContainText('Pathfinder');
    await expect(tooltip).toContainText('Cold');
    await expect(tooltip).toContainText('Fire');
    await expect(tooltip).toContainText('Toward You');
    await expect(tooltip).toContainText('Trust');
    await expect(tooltip).toContainText('+12');
    await expect(tooltip).toContainText('Fear');
    await expect(tooltip).toContainText('-4');
    await expect(tooltip).toContainText('Marked');
    await page.screenshot({ path: 'tmp/npc-rich-tooltip.png' });

    await npcCard.locator('.location-entity-image').click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(lightbox).toContainText('Mira Vale');
    await expect(lightbox).toContainText('31 / 40');
    await expect(lightbox).toContainText('Toward You');
    await expect(lightbox).toContainText('Marked');
    await page.screenshot({ path: 'tmp/npc-rich-lightbox.png' });
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    await page.evaluate((npc) => {
        if (typeof window.renderChatPartyPanel !== 'function' || typeof window.updatePartyDisplay !== 'function') {
            throw new Error('Party renderers are unavailable.');
        }
        window.renderChatPartyPanel([npc]);
    }, visibleNpc);

    const compactPartyCard = page.locator('#chatPartyMembers .location-entity-card').first();
    await compactPartyCard.hover();
    await expect(tooltip.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(tooltip).toContainText('Mira Vale');
    await expect(tooltip).toContainText('Toward You');

    await compactPartyCard.locator('.location-entity-image').click();
    await expect(lightbox.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(lightbox).toContainText('Mira Vale');
    await page.keyboard.press('Escape');

    await page.locator('#tab-party-tab').click();
    await page.evaluate((npc) => {
        window.updatePartyDisplay([npc]);
    }, visibleNpc);
    const partyCard = page.locator('#partyMembers .party-card').first();
    await partyCard.hover();
    const partyTooltip = page.locator('#partyTooltip');
    await expect(partyTooltip).toBeVisible();
    await expect(partyTooltip.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(partyTooltip).toContainText('Mira Vale');
    await expect(partyTooltip).toContainText('31 / 40');
    await expect(partyTooltip).toContainText('Marked');
    await page.screenshot({ path: 'tmp/npc-party-rich-tooltip.png' });

    await partyCard.locator('.party-portrait-image').click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.tooltip-entity.is-npc.is-hostile')).toHaveCount(1);
    await expect(lightbox).toContainText('Mira Vale');
    await expect(lightbox).toContainText('Marked');
    await page.screenshot({ path: 'tmp/npc-party-rich-lightbox.png' });
});
