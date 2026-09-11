const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseUrl = process.env.AIRPG_TEST_URL || 'http://127.0.0.1:7788';
const outputDir = path.resolve(__dirname, '..', 'tmp', 'quest-offer-inline-verification');

(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1564, height: 1007 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        chat.updateServerHistory([
            {
                id: 'quest-visual-turn',
                role: 'assistant',
                content: 'Pel slides a marked observation page across the table. “Watch the grid at noon, then bring me the exact time.”',
                timestamp: '2026-09-09T18:54:00.000Z'
            },
            {
                id: 'quest-visual-offer',
                role: 'system',
                type: 'quest-offer',
                confirmationId: 'confirmation-visual-1',
                status: 'pending',
                timestamp: '2026-09-09T18:54:01.000Z',
                quest: {
                    name: 'Ground-Station Gridwatch',
                    giver: 'Mirage-Watch Pel',
                    description: 'Watch the buried grid’s noon flash from the basin tomorrow, record its time, and report back to Pel.',
                    objectives: [
                        { description: 'Carry Pel’s observation page down to the basin.' },
                        { description: 'Witness the grid flash and record the exact time.' },
                        { description: 'Return the annotated page to Mirage-Watch Pel.' }
                    ],
                    rewardCurrency: 15,
                    rewardItems: [{ name: 'Co-signed Gridwatch Codex', description: '' }],
                    rewardFactionReputation: [{ name: 'Guild', points: 5 }]
                }
            }
        ]);
    });

    const offer = page.locator('.quest-offer-message');
    await offer.waitFor({ state: 'visible' });
    if (await page.locator('.quest-offer').getAttribute('open') !== null) {
        throw new Error('Quest offer should be collapsed on initial render.');
    }
    await page.screenshot({ path: path.join(outputDir, 'collapsed.png'), fullPage: true });

    await page.locator('.quest-offer__summary').click();
    await page.locator('.quest-offer[open]').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(outputDir, 'expanded.png'), fullPage: true });

    const draft = 'I want to answer after rereading the offer.';
    await page.locator('#messageInput').fill(draft);
    await page.locator('#sendButton').click();
    await page.locator('#questDecisionReminderModal[aria-hidden="false"]').waitFor({ state: 'visible' });
    if (await page.locator('#messageInput').inputValue() !== draft) {
        throw new Error('Opening the pending-quest reminder cleared the typed draft.');
    }
    await page.screenshot({ path: path.join(outputDir, 'reminder.png'), fullPage: true });

    await page.locator('#questDecisionReminderReviewBtn').click();
    await page.locator('#questDecisionReminderModal').waitFor({ state: 'hidden' });
    if (await page.locator('.quest-offer').getAttribute('open') === null) {
        throw new Error('Review quest did not expand the pending offer.');
    }

    await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        const updated = chat.serverHistory.map(entry => entry.type === 'quest-offer'
            ? { ...entry, status: 'accepted', questId: 'quest-accepted-1' }
            : entry);
        chat.updateServerHistory(updated);
    });
    await page.locator('.quest-offer__badge--accepted').waitFor({ state: 'visible' });
    if (await page.locator('.quest-offer__decision-button').count() !== 0) {
        throw new Error('Resolved quest offer still displayed decision buttons.');
    }
    await page.screenshot({ path: path.join(outputDir, 'accepted.png'), fullPage: true });

    await browser.close();
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write(JSON.stringify({ success: true, draftPreserved: true, screenshots: 4 }));
})().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
