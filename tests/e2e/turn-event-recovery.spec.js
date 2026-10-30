const { test, expect } = require('@playwright/test');

function recoveryPayload(canRerun = true) {
    return {
        type: 'player_input_request', mode: 'choice', promptLabel: 'vehicle_route_recovery',
        inputRequestId: 'recovery-test', requestId: 'turn-test',
        title: 'Travel could not be processed',
        question: 'Gondola cannot travel to Sky-Harbor Platform because that destination is not in its allowed route.',
        details: {
            routeDescription: 'Allowed stops: Concourse, Gate Plaza. Requested stop: Sky-Harbor Platform (Sky-Harbor).',
            stack: 'Error: Invalid route\n    at moveVehicleFormoveTurnResult (api.js:18282:23)'
        },
        choices: [
            { value: 'rerun', label: 'Re-run turn', disabled: !canRerun, description: canRerun ? 'Restore this turn’s starting autosave and generate a new response.' : 'No starting autosave is available for this turn.' },
            { value: 'accept-route', label: 'Accept and time-skip', description: 'Move your character and companions off the vehicle to the narrated destination, then continue processing.' },
            { value: 'skip-events', label: 'Don’t process events', description: 'Keep the prose and stop the remaining post-action processing. Earlier changes remain.' }
        ]
    };
}

async function prepare(page) {
    await page.route('**/api/**', route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!['GET', 'HEAD'].includes(request.method()) && !['/api/chat', '/api/load', '/api/chat/user-input-response'].includes(path)) {
            return route.fulfill({ json: { success: true } });
        }
        return route.fallback();
    });
    await page.route('**/api/chat/history**', route => route.fulfill({
        json: { history: [{ id: 'prior', role: 'assistant', type: 'player-action', content: 'Before departure.', timestamp: '2026-10-04T07:00:00Z' }], count: 1, worldTime: {} }
    }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.AIRPG_CHAT))).toBe(true);
}

for (const choice of ['rerun', 'accept-route', 'skip-events']) {
    test(`route recovery modal submits ${choice} exactly once`, async ({ page }) => {
        const answers = [];
        await page.route('**/api/chat/user-input-response', async route => {
            answers.push(route.request().postDataJSON());
            await route.fulfill({ json: { success: true } });
        });
        await prepare(page);
        await page.evaluate(payload => {
            document.getElementById('messageInput').focus();
            window.AIRPG_CHAT.handleWebSocketMessage({ data: JSON.stringify(payload) });
        }, recoveryPayload());
        const dialog = page.getByRole('dialog', { name: 'Travel could not be processed' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button')).toHaveCount(3);
        await expect(dialog).toContainText('Allowed stops: Concourse, Gate Plaza.');
        await dialog.getByText('Error details', { exact: true }).click();
        await expect(dialog.locator('pre')).toContainText('api.js:18282:23');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await dialog.locator(`[data-recovery-choice="${choice}"]`).click();
        await expect(dialog).toHaveCount(0);
        expect(answers).toHaveLength(1);
        expect(answers[0]).toMatchObject({ inputRequestId: 'recovery-test', answer: choice });
        await expect(page.locator('#messageInput')).toBeFocused();
    });
}

test('unavailable rerun and rejected answers keep a readable mobile modal open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat/user-input-response', route => route.fulfill({
        status: 400, json: { success: false, error: 'That turn recovery option is unavailable.' }
    }));
    await prepare(page);
    await page.evaluate(payload => window.AIRPG_CHAT.handlePlayerInputRequest(payload), recoveryPayload(false));
    const dialog = page.getByRole('dialog', { name: 'Travel could not be processed' });
    await expect(dialog.getByRole('button', { name: 'Re-run turn' })).toBeDisabled();
    await expect(dialog).toContainText('No starting autosave is available');
    await dialog.getByRole('button', { name: 'Accept and time-skip' }).click();
    await expect(dialog.getByRole('status')).toContainText('Could not apply your choice');
    await expect(dialog.getByRole('button', { name: 'Accept and time-skip' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Re-run turn' })).toBeDisabled();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'tmp/turn-event-recovery-mobile.png' });
});

test('rerun response restores its exact starting autosave and resubmits the original action', async ({ page }) => {
    const actions = [];
    const restores = [];
    await page.route(url => new URL(url).pathname === '/api/chat', async route => {
        actions.push(route.request().postDataJSON());
        await route.fulfill({ json: actions.length === 1 ? {
            response: 'The rejected travel prose.', messages: [], eventsSkipped: true,
            turnEventRecovery: { action: 'rerun', autosaveName: 'this-turn-start-not-latest' },
            streamMeta: { enabled: false }
        } : { response: 'A fresh turn.', messages: [], streamMeta: { enabled: false } } });
    });
    await page.route('**/api/load', async route => {
        restores.push(route.request().postDataJSON());
        await route.fulfill({ json: { success: true } });
    });
    await prepare(page);
    await page.evaluate(() => {
        window.isPlayerAbilitySelectionBlockingGameplay = () => false;
        window.AIRPG_CHAT.pendingQuestOffers.clear();
        void window.AIRPG_CHAT.submitChatMessage('Take the gondola to the harbor.', { setButtonLoading: true });
    });
    await expect.poll(() => restores.length).toBe(1);
    expect(restores[0]).toMatchObject({ saveName: 'this-turn-start-not-latest', saveType: 'autosaves' });
    await expect.poll(() => actions.length, { timeout: 15000 }).toBe(2);
    expect(actions[1].messages.at(-1).content).toBe('Take the gondola to the harbor.');
    expect(actions[1].requestId).not.toBe(actions[0].requestId);
});
