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

    test('tinybrain viewer follows staged prompts and retains parse failures in red', async ({ page }) => {
        const progressGroupId = 'tinybrain-viewer-test';
        await pushPromptProgress(page, [{
            id: 'tinybrain-stage-1',
            label: 'player_action[1]',
            model: 'test-model',
            progressGroupId,
            promptText: 'First tinybrain checkpoint prompt.',
            previewText: 'Malformed checkpoint response.',
            progressFraction: 0.5,
            failedResponses: [],
            responseFailed: false
        }]);
        await page.evaluate(() => window.AIRPG_CHAT.openPromptProgressViewer('tinybrain-stage-1'));

        const viewer = page.locator('.prompt-progress-viewer');
        await expect(viewer).toHaveCount(1);
        await expect(viewer).toHaveAttribute('data-prompt-id', 'tinybrain-stage-1');
        await expect(viewer.locator('.prompt-progress-viewer__follow-input')).toBeChecked();

        await page.evaluate((groupId) => {
            window.AIRPG_CHAT.handlePromptProgressGroupFailure({
                progressGroupId: groupId,
                promptId: 'tinybrain-stage-1',
                failedResponses: ['Malformed checkpoint response.']
            });
        }, progressGroupId);
        await expect(viewer.locator('.prompt-progress-viewer__failed-response-inline'))
            .toHaveText('Malformed checkpoint response.');

        await pushPromptProgress(page, [{
            id: 'tinybrain-stage-2',
            label: 'player_action[2]',
            model: 'test-model',
            progressGroupId,
            promptText: 'Second tinybrain checkpoint prompt.',
            previewText: 'Valid retry response.',
            progressFraction: 0.25,
            failedResponses: ['Malformed checkpoint response.'],
            responseFailed: false
        }]);

        await expect(viewer).toHaveCount(1);
        await expect(viewer).toHaveAttribute('data-prompt-id', 'tinybrain-stage-2');
        await expect(viewer.locator('.prompt-progress-viewer__prompt-inline'))
            .toHaveText('Second tinybrain checkpoint prompt.');
        await expect(viewer.locator('.prompt-progress-viewer__failed-response-inline'))
            .toHaveText('Malformed checkpoint response.');
        await expect(viewer.locator('.prompt-progress-viewer__response-inline'))
            .toHaveText('Valid retry response.');

        const colors = await viewer.evaluate(element => ({
            prompt: getComputedStyle(element.querySelector('.prompt-progress-viewer__prompt-inline')).color,
            failed: getComputedStyle(element.querySelector('.prompt-progress-viewer__failed-response-inline')).color,
            response: getComputedStyle(element.querySelector('.prompt-progress-viewer__response-inline')).color
        }));
        expect(new Set(Object.values(colors)).size).toBe(3);
        expect(colors.failed).toBe('rgb(252, 165, 165)');

        await page.screenshot({ path: 'tmp/tinybrain-prompt-viewer.png', fullPage: true });
        await pushPromptProgress(page, []);
    });
});
