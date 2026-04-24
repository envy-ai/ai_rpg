const { test, expect } = require('@playwright/test');

const historyPayload = {
    history: [
        {
            id: 'entry-1',
            role: 'user',
            type: 'player-action',
            content: 'I ask Mara about the obsidian door.',
            timestamp: '2026-04-24T00:00:00.000Z',
            locationId: 'loc-gate'
        },
        {
            id: 'entry-2',
            role: 'assistant',
            type: 'assistant',
            content: 'Mara says the blue lantern opens at dusk.',
            timestamp: '2026-04-24T00:01:00.000Z',
            locationId: 'loc-market'
        },
        {
            id: 'entry-3',
            role: 'assistant',
            type: 'plot-summary',
            content: 'A private summary about Mara and the gate.',
            timestamp: '2026-04-24T00:02:00.000Z',
            parentId: 'entry-2'
        },
        {
            id: 'entry-4',
            role: 'assistant',
            type: 'event-summary',
            timestamp: '2026-04-24T00:03:00.000Z',
            locationId: 'loc-river',
            summaryTitle: 'Events - River',
            summaryItems: [
                { icon: '*', text: 'The river current changes.' }
            ]
        },
        {
            id: 'entry-5',
            role: 'assistant',
            type: 'assistant',
            content: 'BLUE lantern inventory noted without the dusk clue.',
            timestamp: '2026-04-24T00:04:00.000Z',
            locationId: 'loc-archive'
        }
    ],
    count: 5,
    worldTime: {}
};

async function openStoryToolsWithMockHistory(page) {
    await page.route('**/api/chat/history?includeAllEntries=true', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(historyPayload)
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#tab-story-tools-tab').click();
    await expect(page.locator('#tab-story-tools')).toBeVisible();
    await expect(page.locator('.story-tools-entry')).toHaveCount(5);
}

test('Story Tools search filters full history and highlights content matches', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.fill('#storyToolsSearchInput', 'blue lantern');

    await expect(page.locator('.story-tools-entry')).toHaveCount(2);
    await expect(page.locator('.story-tools-entry-title')).toHaveText(['Entry #2', 'Entry #5']);
    await expect(page.locator('#storyToolsSearchStatus')).toHaveText('2 of 5 entries match');
    await expect(page.locator('.story-tools-search-mark')).toContainText(['blue', 'lantern', 'BLUE', 'lantern']);
});

test('Story Tools search waits one second after typing before filtering', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.fill('#storyToolsSearchInput', 'blue lantern');
    await page.waitForTimeout(500);

    await expect(page.locator('.story-tools-entry')).toHaveCount(5);
    await expect(page.locator('#storyToolsSearchStatus')).toHaveText('5 entries');

    await page.waitForTimeout(650);
    await expect(page.locator('.story-tools-entry')).toHaveCount(2);
    await expect(page.locator('#storyToolsSearchStatus')).toHaveText('2 of 5 entries match');
});

test('Story Tools search matches metadata, requires all terms, and clears cleanly', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.fill('#storyToolsSearchInput', 'plot-summary');
    await expect(page.locator('.story-tools-entry')).toHaveCount(1);
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #3');
    await expect(page.locator('.story-tools-search-mark')).toContainText('plot-summary');

    await page.fill('#storyToolsSearchInput', 'mara obsidian');
    await expect(page.locator('.story-tools-entry')).toHaveCount(1);
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #1');

    await page.fill('#storyToolsSearchInput', 'missing phrase');
    await expect(page.locator('.story-tools-entry')).toHaveCount(0);
    await expect(page.locator('#storyToolsEmpty')).toContainText('No story entries match "missing phrase".');

    await expect(page.locator('#storyToolsSearchClear')).toBeVisible();
    await page.locator('#storyToolsSearchClear').click();
    await expect(page.locator('#storyToolsSearchInput')).toHaveValue('');
    await expect(page.locator('#storyToolsSearchClear')).toBeHidden();
    await expect(page.locator('.story-tools-entry')).toHaveCount(5);
    await expect(page.locator('#storyToolsSearchStatus')).toHaveText('5 entries');
});

test('Story Tools substring mode matches the exact typed phrase only', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.selectOption('#storyToolsSearchMode', 'substring');
    await page.fill('#storyToolsSearchInput', 'blue lantern');

    await expect(page.locator('.story-tools-entry')).toHaveCount(2);
    await expect(page.locator('.story-tools-entry-title')).toHaveText(['Entry #2', 'Entry #5']);
    await expect(page.locator('.story-tools-search-mark')).toContainText(['blue lantern', 'BLUE lantern']);

    await page.fill('#storyToolsSearchInput', 'lantern blue');
    await expect(page.locator('.story-tools-entry')).toHaveCount(0);
    await expect(page.locator('#storyToolsEmpty')).toContainText('No story entries match "lantern blue".');
});

test('Story Tools regex mode matches valid patterns and reports invalid patterns', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.selectOption('#storyToolsSearchMode', 'regex');
    await page.fill('#storyToolsSearchInput', 'Mara.*gate');

    await expect(page.locator('.story-tools-entry')).toHaveCount(1);
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #3');
    await expect(page.locator('.story-tools-search-mark')).toContainText('Mara and the gate');

    await page.fill('#storyToolsSearchInput', '[');
    await expect(page.locator('.story-tools-entry')).toHaveCount(0);
    await expect(page.locator('#storyToolsSearchStatus')).toContainText('Invalid regular expression');
    await expect(page.locator('#storyToolsEmpty')).toContainText('Invalid regular expression');
});

test('Story Tools case-sensitive toggle affects all search modes', async ({ page }) => {
    await openStoryToolsWithMockHistory(page);

    await page.fill('#storyToolsSearchInput', 'blue');
    await expect(page.locator('.story-tools-entry-title')).toHaveText(['Entry #2', 'Entry #5']);

    await page.check('#storyToolsSearchCaseSensitive');
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #2');

    await page.selectOption('#storyToolsSearchMode', 'substring');
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #2');

    await page.selectOption('#storyToolsSearchMode', 'regex');
    await page.fill('#storyToolsSearchInput', 'BLUE');
    await expect(page.locator('.story-tools-entry-title')).toHaveText('Entry #5');

    await page.uncheck('#storyToolsSearchCaseSensitive');
    await expect(page.locator('.story-tools-entry-title')).toHaveText(['Entry #2', 'Entry #5']);
});
