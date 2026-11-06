const path = require('node:path');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');

async function mount(page) {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="chatLog"></div><div id="playerAbilitySelectionModal" hidden><div class="modal__body"></div></div></body></html>');
    await page.addScriptTag({ path: path.join(root, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(root, 'public/js/widgets/controls.js') });
    await page.evaluate(() => {
        window.fixtureCalls = []; window.fixtureHooks = { input: 0, ability: 0, flow: 0, undo: 0 };
        window.AIRPG_CHAT = { clientId: 'fixture', generateRequestId: () => 'owner-fixture', registerPlayerInputRequestHandler: handler => { window.fixtureInput = handler; return () => window.fixtureHooks.input++; }, showChatErrorPopup: message => { window.fixtureError = message; }, cancelAllPromptsAndLoadLatestAutosave: async () => { window.fixtureHooks.undo++; return true; } };
        window.registerPlayerAbilitySelectionHandler = handler => { window.fixtureAbility = handler; return () => window.fixtureHooks.ability++; };
        window.requestPlayerAbilitySelectionFlow = async () => { window.fixtureHooks.flow++; };
        navigator.sendBeacon = () => true;
        window.fetch = async (url, options = {}) => {
            const name = String(url).split('/').at(-1); window.fixtureCalls.push({ name, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
            if (name === 'start' && window.fixtureHoldStart) await new Promise(resolve => { window.fixtureReleaseStart = resolve; });
            if (name === window.fixtureHoldName) await new Promise(resolve => { window.fixtureReleasePending = resolve; });
            const saved = window.fixtureSaved || { goal: 'Goal', notes: 'Notes', sceneId: 'scene', completedTurns: 0 };
            const payload = name === 'start' ? { run: { runId: 'run-fixture', ownerId: 'owner-fixture', phase: 'idle' }, saved, available: true } : name === 'packet-1' ? { packet: { id: 'packet-1', goal: 'Reviewed goal', notes: 'Reviewed notes', subsceneId: 'sub' } } : name === 'input' ? { answer: 'Narrative answer' } : { run: null, saved, available: true };
            return new Response(JSON.stringify({ success: true, ...payload }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
    });
    await page.addScriptTag({ path: path.join(root, 'mods/story-authoring/public/js/story-authoring.js') });
    await expect(page.locator('#storyAuthoringStart')).toBeEnabled();
    return errors;
}

test('Runner cached hide retains controls while final hide releases hooks and late start owner', async ({ page }) => {
    const errors = await mount(page);
    await page.locator('#storyAuthoringPanel summary').click();
    await page.locator('#storyAuthoringGoal').fill('Manual goal');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect(page.locator('#storyAuthoringGoal')).toHaveValue('Manual goal');
    await page.locator('#storyAuthoringUndo').click(); await expect.poll(() => page.evaluate(() => window.fixtureHooks.undo)).toBe(1);
    await page.evaluate(() => { window.fixtureHoldStart = true; });
    await page.locator('#storyAuthoringStart').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.fixtureReleaseStart))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect(page.locator('#storyAuthoringPanel')).toHaveCount(0);
    await page.evaluate(() => window.fixtureReleaseStart());
    await expect.poll(() => page.evaluate(() => window.fixtureCalls.filter(call => call.name === 'pause').length)).toBe(1);
    expect(await page.evaluate(() => window.fixtureHooks)).toMatchObject({ input: 1, ability: 1, flow: 0, undo: 1 });
    expect(await page.evaluate(() => ({ disposed: window.AIRPG_STORY_AUTHORING.uiDisposed, heartbeat: Boolean(window.AIRPG_STORY_AUTHORING.heartbeatTimer), decisions: window.fixtureCalls.filter(call => call.name === 'decision').length }))).toEqual({ disposed: true, heartbeat: false, decisions: 0 });
    expect(errors).toEqual([]);
});

for (const name of ['state', 'settings', 'packet-1']) test(`Runner final hide ignores pending ${name} UI continuation`, async ({ page }) => {
    const errors = await mount(page);
    await page.evaluate(name => {
        window.fixtureSaved = { goal: 'Saved', notes: '', sceneId: 'scene', storyBinding: { binding: { storyId: 'story-1' }, snapshot: { rootId: 'root' } } };
        window.fixtureHoldName = name;
        const runner = window.AIRPG_STORY_AUTHORING;
        window.fixturePending = (name === 'state' ? runner.refresh() : name === 'settings' ? runner.saveSettings() : runner.loadStoryPacket('packet-1')).catch(error => { window.fixturePendingError = error.message; });
    }, name);
    await expect.poll(() => page.evaluate(() => Boolean(window.fixtureReleasePending))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.evaluate(async () => { window.fixtureHoldName = ''; window.fixtureReleasePending(); await window.fixturePending; });
    await expect(page.locator('#storyAuthoringPanel')).toHaveCount(0);
    expect(await page.evaluate(() => window.fixturePendingError || '')).toBe(''); expect(errors).toEqual([]);
});

test('Runner reviewed checkpoint returns to manual draft and handles input and ability ownership', async ({ page }) => {
    const errors = await mount(page);
    await page.locator('#storyAuthoringPanel summary').click();
    await page.locator('#storyAuthoringGoal').fill('Manual draft');
    await page.evaluate(() => { window.fixtureSaved = { goal: 'Saved', notes: '', sceneId: 'scene', storyBinding: { binding: { storyId: 'story-1' }, snapshot: { rootId: 'root' }, execution: { status: 'paused' } } }; });
    await page.evaluate(() => window.AIRPG_STORY_AUTHORING.loadStoryPacket('packet-1'));
    await expect(page.locator('#storyAuthoringGoal')).toHaveValue('Reviewed goal'); await expect(page.locator('#storyAuthoringGoal')).toHaveAttribute('readonly', '');
    await page.locator('[data-story-manual]').click(); await expect(page.locator('#storyAuthoringGoal')).toHaveValue('Manual draft'); await expect(page.locator('#storyAuthoringGoal')).not.toHaveAttribute('readonly', '');
    await page.evaluate(() => { document.querySelector('#playerAbilitySelectionModal').hidden = false; });
    await page.locator('#storyAuthoringUseForAbilities').click();
    await expect(page.locator('#playerAbilitySelectionModal #storyAuthoringPanel')).toHaveCount(1);
    await page.evaluate(() => { document.querySelector('#playerAbilitySelectionModal').hidden = true; });
    await expect(page.locator('#playerAbilitySelectionModal #storyAuthoringPanel')).toHaveCount(0);
    await expect(page.locator('#storyAuthoringPanel summary')).toBeFocused();
    await page.evaluate(() => { window.AIRPG_STORY_AUTHORING.run = { runId: 'run-fixture', ownerId: 'owner-fixture' }; });
    await page.keyboard.press('Control+Shift+P');
    await expect.poll(() => page.evaluate(() => window.fixtureCalls.filter(call => call.name === 'pause').length)).toBe(1);
    const result = await page.evaluate(async () => {
        const runner = window.AIRPG_STORY_AUTHORING; runner.run = { runId: 'run-fixture', ownerId: 'owner-fixture' }; runner.running = true; runner.pauseRequested = false;
        const ownsAbility = window.fixtureAbility();
        const handled = await window.fixtureInput({ inputRequestId: 'input-1', requestId: 'request-1', mode: 'text', question: 'Question' });
        runner.running = false; runner.run = null;
        return { ownsAbility, handled, response: window.fixtureCalls.find(call => call.name === 'user-input-response')?.body };
    });
    expect(result).toMatchObject({ ownsAbility: true, handled: true, response: { inputRequestId: 'input-1', answer: 'Narrative answer', clientId: 'fixture' } });
    expect(errors).toEqual([]);
});
