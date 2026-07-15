const { test, expect } = require('@playwright/test');

test.describe('save marker chat entry', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AIRPG_CHAT
            && typeof window.AIRPG_CHAT.createSaveNoticeElement === 'function');
    });

    test('the client renders a save-notice entry as a subtle non-story notice', async ({ page }) => {
        const rendered = await page.evaluate(() => {
            const el = window.AIRPG_CHAT.createSaveNoticeElement({
                type: 'save-notice',
                role: 'system',
                content: '💾 Game saved as "Adventure".',
                timestamp: new Date(0).toISOString()
            });
            document.body.appendChild(el);
            return {
                className: el.className,
                text: el.querySelector('.save-notice__text')?.textContent || '',
                hasTimestamp: Boolean(el.querySelector('.save-notice__timestamp'))
            };
        });
        expect(rendered.className).toContain('save-notice');
        expect(rendered.text).toContain('Game saved as "Adventure"');
        expect(rendered.hasTimestamp).toBe(true);
    });

    test('a manual save adds a player-visible, LLM-hidden marker when the player has a location', async ({ page }) => {
        // A freshly booted server may have a default player without a location; the
        // marker is only added when a location is resolvable, so gate the assertion.
        const player = await page.evaluate(async () => {
            const res = await fetch('/api/player');
            return res.ok ? (await res.json()).player : null;
        });
        const hasLocation = Boolean(player && (player.currentLocation || player.locationId));
        test.skip(!hasLocation, 'default player has no location on a fresh boot; nothing to save a marker against');

        const before = await page.evaluate(async () => {
            const res = await fetch('/api/chat/history?includeAllEntries=true');
            return (await res.json()).history.filter(e => e?.type === 'save-notice').length;
        });

        const saved = await page.evaluate(async () => {
            const res = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            return (await res.json()).success === true;
        });
        expect(saved).toBe(true);

        const after = await page.evaluate(async () => {
            const res = await fetch('/api/chat/history?includeAllEntries=true');
            const history = (await res.json()).history;
            const notices = history.filter(e => e?.type === 'save-notice');
            const last = notices[notices.length - 1] || null;
            return {
                count: notices.length,
                role: last?.role || null,
                excludeFromLlm: last?.metadata?.excludeFromBaseContextHistory === true,
                content: last?.content || ''
            };
        });
        expect(after.count).toBe(before + 1);
        expect(after.role).toBe('system');
        expect(after.excludeFromLlm).toBe(true);
        expect(after.content).toContain('Game saved');
    });
});
