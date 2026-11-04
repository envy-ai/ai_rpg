const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });

test('quest board shows anchored level and edits the offset', async ({ page }) => {
    const editPayloads = [];
    const quest = { id: 'quest-fixture', name: 'Beacon', description: 'Restore the beacon', originLocationLevel: 7,
        relativeLevel: -2, level: 5, objectives: [{ id: 'obj', description: 'Repair it', completed: false, optional: false }],
        rewardXp: 30, rewardCurrency: 0, rewardItems: [], rewardFactionReputation: {}, rewardNpcDispositions: [],
        rewardBenefits: [], rewardNotes: [], appliedRewardBenefitIds: [], rewardClaimed: false };
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
            title: 'Quest fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
            clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded: true,
            availableSkills: [], thingImageBadges: [], thingContextActions: [], thingEditFields: [], playerEditFields: [],
            rarityDefinitions: [], needBarDefinitions: [], pointPoolFormulas: {}
        }) });
        if (url.pathname === '/api/quest/edit') {
            editPayloads.push(route.request().postDataJSON());
            return route.fulfill({ json: { success: true, player: { quests: [quest], completedQuests: [] } } });
        }
        if (url.pathname === '/api/player/ability-selection') return route.fulfill({ json: { success: true, abilitySelection: { pending: false } } });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, attributes: {}, history: [], player: { quests: [], completedQuests: [] }, routeKnowledge: [] } });
        const assetRoot = path.join(root, url.pathname.startsWith('/assets/') ? 'assets' : 'public');
        const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets'.length) : url.pathname;
        const file = path.resolve(assetRoot, `.${relative}`);
        if (file.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderQuestPanel === 'function');
    await page.evaluate(q => window.renderQuestPanel([q], []), quest);
    const errorClose = page.getByRole('dialog', { name: 'Operation stopped' }).getByRole('button', { name: 'Close' });
    if (await errorClose.isVisible()) await errorClose.click();
    await page.locator('#tab-quests-tab').click();
    const card = page.locator('.quest-card').filter({ hasText: 'Beacon' });
    await expect(card).toContainText('Level 5');
    await expect(card).toContainText('30 XP value');
    await card.evaluate(el => { el.open = true; });
    await card.locator('.quest-edit-button').click();
    await expect(page.locator('#questEditRelativeLevel')).toHaveValue('-2');
    await page.locator('#questEditRelativeLevel').fill('2');
    await expect(page.locator('#questEditLevelHelp')).toContainText('9');
    await page.locator('#questEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => editPayloads.length).toBe(1);
    expect(editPayloads[0].relativeLevel).toBe(2);
    for (const [value, index] of [['', 1], ['0', 2]]) {
        await page.evaluate(q => window.renderQuestPanel([q], []), quest);
        const currentCard = page.locator('.quest-card').filter({ hasText: 'Beacon' });
        await currentCard.evaluate(el => { el.open = true; });
        await currentCard.locator('.quest-edit-button').click();
        await page.locator('#questEditRewardXp').fill(value);
        await page.locator('#questEditForm').evaluate(form => form.requestSubmit());
        await expect.poll(() => editPayloads.length).toBe(index + 1);
    }
    expect(editPayloads[1]).not.toHaveProperty('rewardXp');
    expect(editPayloads[2].rewardXp).toBe(0);
});
