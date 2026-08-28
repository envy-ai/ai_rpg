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

    test('truncates model names after ten characters in the prompt table and viewer', async ({ page }) => {
        const longModelName = 'abcdefghij-extra';
        await page.evaluate(() => window.AIRPG_CHAT.setPromptProgressDockState('table', { persist: false }));
        await pushPromptProgress(page, [{
            id: 'long-model-prompt',
            label: 'long-model-test',
            model: longModelName,
            promptText: 'Long model prompt.',
            previewText: 'Long model response.',
            receivedCount: 24,
            progressFraction: 0.4
        }, {
            id: 'ten-character-model-prompt',
            label: 'ten-character-test',
            model: '1234567890',
            promptText: 'Boundary prompt.',
            previewText: 'Boundary response.',
            receivedCount: 18,
            progressFraction: 0.3
        }]);

        const rows = page.locator('.prompt-progress-table tbody tr');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('td').nth(3)).toHaveText('abcdefghij...');
        await expect(rows.nth(0).locator('td').nth(3)).toHaveAttribute('title', longModelName);
        await expect(rows.nth(1).locator('td').nth(3)).toHaveText('1234567890');
        await expect(rows.nth(1).locator('td').nth(3)).not.toHaveAttribute('title');

        await page.evaluate(() => window.AIRPG_CHAT.openPromptProgressViewer('long-model-prompt'));
        const viewerSubtitle = page.locator('.prompt-progress-viewer__subtitle');
        await expect(viewerSubtitle).toContainText('abcdefghij...');
        await expect(viewerSubtitle).not.toContainText('abcdefghij-extra');
        await expect(viewerSubtitle).toHaveAttribute('title', `Model: ${longModelName}`);

        await page.screenshot({ path: 'tmp/prompt-progress-model-name-truncation.png', fullPage: true });
        await pushPromptProgress(page, []);
    });

    test('full prompt table releases widths from earlier progress renders', async ({ page }) => {
        const measurements = await page.evaluate(() => {
            const chat = window.AIRPG_CHAT;
            chat.setPromptProgressDockState('table', { persist: false });

            const renderAndMeasure = (label) => {
                chat.renderPromptProgress([{
                    id: 'stable-width-prompt',
                    label,
                    model: 'test-model',
                    promptText: 'Keep the prompt tracker width stable.',
                    previewText: 'Streaming update',
                    receivedCount: 100,
                    progressFraction: 0.4,
                    seconds: 12,
                    timeoutSeconds: 48,
                    latencyMs: 350,
                    retries: 0
                }]);

                const dock = document.querySelector('#promptProgressDock');
                const table = dock.querySelector('.prompt-progress-table');
                return {
                    dock: dock.getBoundingClientRect().width,
                    table: table.getBoundingClientRect().width
                };
            };

            const initial = renderAndMeasure('stable-width-test');
            const widest = renderAndMeasure(`stable-width-${'unbroken'.repeat(40)}`);
            const final = renderAndMeasure('stable-width-test');
            return { initial, widest, final };
        });

        expect(measurements.widest.table).toBeGreaterThan(measurements.initial.table);
        expect(measurements.final.dock).toBeCloseTo(measurements.initial.dock, 1);
        expect(measurements.final.table).toBeCloseTo(measurements.initial.table, 1);
    });

    test('retains the final streamed token when completion is immediately cleared', async ({ page }) => {
        const promptId = 'final-token-prompt';
        await pushPromptProgress(page, [{
            id: promptId,
            label: 'final-token-test',
            model: 'test-model',
            promptText: 'Finish the response.',
            previewText: 'The response is almost',
            receivedCount: 22,
            progressFraction: 0.9
        }]);
        await page.evaluate((id) => window.AIRPG_CHAT.openPromptProgressViewer(id), promptId);

        const viewer = page.locator('.prompt-progress-viewer');
        const response = viewer.locator('.prompt-progress-viewer__response-inline');
        await expect(response).toHaveText('The response is almost');

        await page.evaluate((id) => {
            const chat = window.AIRPG_CHAT;
            chat.promptProgressLastRenderTs = Date.now();
            chat.handlePromptProgress({
                done: false,
                entries: [{
                    id,
                    label: 'final-token-test',
                    model: 'test-model',
                    promptText: 'Finish the response.',
                    previewText: 'The response is almost complete.',
                    receivedCount: 32,
                    progressFraction: 1,
                    isComplete: true
                }]
            });
            chat.handlePromptProgress({ done: true, entries: [] });
        }, promptId);

        await expect(response).toHaveText('The response is almost complete.');
        await expect(viewer.locator('.prompt-progress-viewer__subtitle')).toContainText('Saved prompt snapshot');
    });

    test('tinybrain keeps one row and turns its waiting bar blue between stages', async ({ page }) => {
        const stablePromptId = 'tinybrain-stable-progress';
        const progressGroupId = 'tinybrain-stable-group';

        await pushPromptProgress(page, [{
            id: stablePromptId,
            label: 'player_action[1]',
            model: 'test-model',
            progressGroupId,
            promptText: 'First checkpoint.',
            previewText: 'First response.',
            receivedCount: 84,
            progressFraction: 0.2625,
            isGroupWaiting: true
        }]);

        const row = page.locator('.prompt-progress-dock__one-line-row');
        await expect(row).toHaveCount(1);
        await expect(row).toHaveClass(/prompt-progress-dock__one-line-row--group-waiting/);
        await expect(row.locator('.prompt-progress-cancel')).toBeDisabled();
        await expect(row.locator('.prompt-progress-retry')).toBeDisabled();
        await expect(row.locator('.prompt-progress-view')).toBeEnabled();
        await expect(row.locator('.prompt-progress-dock__one-line-stat')).toHaveText('84 chars');
        await expect(row.locator('.prompt-progress-dock__one-line-percent')).toHaveText('~26%');
        await expect.poll(async () => (
            row.locator('.prompt-progress-dock__one-line-fill').evaluate(element => parseFloat(element.style.width))
        )).toBeCloseTo(26.25, 1);

        const waitingFillColor = await row.locator('.prompt-progress-dock__one-line-fill')
            .evaluate(element => getComputedStyle(element).backgroundImage);
        expect(waitingFillColor).toContain('59, 130, 246');
        await page.screenshot({ path: 'tmp/tinybrain-shared-progress-blue-dock.png', fullPage: true });

        const modalId = await openSharedModal(page, 'tinybrain-progress-modal');
        expect(modalId).toBeTruthy();
        const modalBar = page.locator(`#${modalId} .modal__prompt-progress`);
        await expect(modalBar).toHaveClass(/modal__prompt-progress--group-waiting/);
        await expect.poll(async () => (
            modalBar.locator('.modal__prompt-progress-fill').evaluate(element => parseFloat(element.style.width))
        )).toBeCloseTo(26.25, 1);
        await page.screenshot({ path: 'tmp/tinybrain-shared-progress-blue.png', fullPage: true });

        await pushPromptProgress(page, [{
            id: stablePromptId,
            label: 'player_action[1]',
            model: 'test-model',
            progressGroupId,
            promptText: 'Second checkpoint.',
            previewText: '',
            receivedCount: 84,
            progressFraction: 0.2625,
            isGroupWaiting: false
        }]);

        await expect(row).toHaveCount(1);
        await expect(row).not.toHaveClass(/prompt-progress-dock__one-line-row--group-waiting/);
        await expect(row.locator('.prompt-progress-cancel')).toBeEnabled();
        await expect(row.locator('.prompt-progress-retry')).toBeEnabled();
        await expect(modalBar).not.toHaveClass(/modal__prompt-progress--group-waiting/);
        await expect(row.locator('.prompt-progress-dock__one-line-percent')).toHaveText('~26%');

        await pushPromptProgress(page, [{
            id: stablePromptId,
            label: 'player_action[1]',
            model: 'test-model',
            progressGroupId,
            promptText: 'Second checkpoint.',
            previewText: 'Second response.',
            receivedCount: 120,
            progressFraction: 0.375,
            isGroupWaiting: true
        }]);

        await expect(row).toHaveCount(1);
        await expect(row).toHaveClass(/prompt-progress-dock__one-line-row--group-waiting/);
        await expect(row.locator('.prompt-progress-dock__one-line-stat')).toHaveText('120 chars');
        await expect(row.locator('.prompt-progress-dock__one-line-percent')).toHaveText('~37%');
        await page.evaluate((id) => {
            const modal = document.getElementById(id);
            modal?.setAttribute('aria-hidden', 'true');
            modal?.setAttribute('hidden', '');
        }, modalId);
        await page.screenshot({ path: 'tmp/tinybrain-multiprompt-progress-monotonic.png', fullPage: true });

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
