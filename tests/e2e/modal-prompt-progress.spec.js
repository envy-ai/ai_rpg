const { test, expect } = require('@playwright/test');

// Opens a static shared-structure modal by toggling its visibility attributes
// (without invoking its own open handler) and returns a stable id for it.
async function openSharedModal(page, forcedId) {
    return page.evaluate((id) => {
        const modal = Array.from(document.querySelectorAll('.modal'))
            .find(candidate => candidate.querySelector('.modal__dialog'));
        if (!modal) {
            return null;
        }
        modal.id = id;
        modal.removeAttribute('hidden');
        modal.setAttribute('aria-hidden', 'false');
        return id;
    }, forcedId);
}

async function pushPromptProgress(page, entries) {
    await page.evaluate((payloadEntries) => {
        window.AIRPG_CHAT.schedulePromptProgressRender(payloadEntries, { force: true });
    }, entries);
}

test.describe('modal prompt-progress bar', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () => window.AIRPG_CHAT
                && typeof window.AIRPG_CHAT.schedulePromptProgressRender === 'function'
                && typeof window.AIRPG_CHAT.updateModalPromptProgressBars === 'function'
        );
    });

    test('shows a thin bar in an open modal while a prompt runs, then removes it on clear', async ({ page }) => {
        const modalId = await openSharedModal(page, 'test-open-modal');
        expect(modalId).toBeTruthy();

        // No prompt running yet -> no bar.
        await expect(page.locator(`#${modalId} .modal__prompt-progress`)).toHaveCount(0);

        // Synthetic in-flight prompt at 42%.
        await pushPromptProgress(page, [{ id: 'p1', label: 'unit-test-prompt', progressFraction: 0.42 }]);

        const fill = page.locator(`#${modalId} .modal__dialog > .modal__prompt-progress > .modal__prompt-progress-fill`);
        await expect(fill).toHaveCount(1);
        const widthPct = await fill.evaluate(el => parseFloat(el.style.width));
        expect(widthPct).toBeGreaterThan(40);
        expect(widthPct).toBeLessThan(44);

        // Advancing the aggregate widens the fill.
        await pushPromptProgress(page, [{ id: 'p1', label: 'unit-test-prompt', progressFraction: 0.9 }]);
        await expect.poll(async () => fill.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(85);

        // Clearing removes the bar entirely.
        await pushPromptProgress(page, []);
        await expect(page.locator(`#${modalId} .modal__prompt-progress`)).toHaveCount(0);
    });

    test('a modal opened mid-prompt picks up the running prompt via the observer', async ({ page }) => {
        // Prompt starts with no modal open -> no bar anywhere.
        await pushPromptProgress(page, [{ id: 'p2', label: 'observer-test', progressFraction: 0.7 }]);
        await expect(page.locator('.modal__prompt-progress')).toHaveCount(0);

        // Opening a modal should trigger the MutationObserver to inject the bar.
        const modalId = await openSharedModal(page, 'test-open-modal-observer');
        expect(modalId).toBeTruthy();
        await expect(page.locator(`#${modalId} .modal__prompt-progress-fill`)).toHaveCount(1);

        await pushPromptProgress(page, []);
    });
});
