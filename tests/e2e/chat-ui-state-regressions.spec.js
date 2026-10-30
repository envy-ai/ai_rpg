const { test, expect } = require('@playwright/test');

const progressEntry = (progressFraction, extra = {}) => ({
    id: 'stable-progress-entry',
    label: 'A running prompt',
    model: 'test-model',
    promptText: 'Synthetic browser regression prompt.',
    previewText: `Response at ${progressFraction}`,
    receivedCount: Math.round(progressFraction * 100),
    progressFraction,
    ...extra
});

test.describe('chat and prompt progress DOM state', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AIRPG_CHAT?.chatLog && window.AIRPG_CHAT?.renderPromptProgress);
    });

    test('real check and tool disclosures survive unchanged history, progress ticks, and changed bodies', async ({ page }) => {
        const state = await page.evaluate(() => {
            const chat = window.AIRPG_CHAT;
            const history = (revision = 'Original') => [{
                id: 'check-history-row',
                timestamp: '2026-10-26T12:00:00.000Z',
                role: 'assistant',
                type: 'check-results',
                checkResults: [
                    { id: 'check-one', sequence: 1, kind: 'skill', status: 'completed', summary: `${revision} lockpicking check` },
                    { id: 'check-two', sequence: 2, kind: 'attack', status: 'completed', summary: `${revision} attack check` }
                ]
            }, {
                id: 'tool-history-row',
                timestamp: '2026-10-26T12:01:00.000Z',
                role: 'system',
                type: 'tool-call-debug',
                toolCalls: [{
                    id: 'tool-one', sequence: 1, name: 'resolveSkillCheck', status: 'completed',
                    parameters: { skill: 'Lockpicking' }, result: { content: `${revision} tool result` }
                }]
            }];
            chat.serverHistory = history();
            chat.renderChatHistory();
            const originalCheck = chat.chatLog.querySelector('[data-entry-id="check-history-row"]');
            const originalTool = chat.chatLog.querySelector('[data-entry-id="tool-history-row"]');
            const checkDetails = Array.from(originalCheck.querySelectorAll('.check-result-item'));
            const toolDetails = originalTool.querySelector('.tool-call-debug-item');
            checkDetails[0].open = true;
            checkDetails[1].open = true;
            toolDetails.open = true;
            chat.serverHistory = history();
            chat.renderChatHistory();
            const sameHistoryNodes = chat.chatLog.querySelector('[data-entry-id="check-history-row"]') === originalCheck
                && chat.chatLog.querySelector('[data-entry-id="tool-history-row"]') === originalTool;
            const checkAfterRefresh = chat.chatLog.querySelector('[data-entry-id="check-history-row"]');
            const toolAfterRefresh = chat.chatLog.querySelector('[data-entry-id="tool-history-row"]');
            const unchangedOpen = Array.from(checkAfterRefresh.querySelectorAll('.check-result-item')).every(item => item.open)
                && toolAfterRefresh.querySelector('.tool-call-debug-item').open;
            chat.renderPromptProgress([{ id: 'synthetic-tick', label: 'Tick', progressFraction: 0.4 }]);
            const sameAfterProgressTick = chat.chatLog.querySelector('[data-entry-id="check-history-row"]') === originalCheck
                && chat.chatLog.querySelector('[data-entry-id="tool-history-row"]') === originalTool;
            chat.serverHistory = history('Changed');
            chat.renderChatHistory();
            const replacementCheck = chat.chatLog.querySelector('[data-entry-id="check-history-row"]');
            const replacementTool = chat.chatLog.querySelector('[data-entry-id="tool-history-row"]');
            return {
                actualCheckMarkup: Boolean(originalCheck.querySelector('.check-result-item[data-disclosure-key="check:check-one"]')),
                actualToolMarkup: Boolean(originalTool.querySelector('.tool-call-debug-item[data-disclosure-key="tool:tool-one"]')),
                sameHistoryNodes,
                unchangedOpen,
                sameAfterProgressTick,
                changedNodesReplaced: replacementCheck !== originalCheck && replacementTool !== originalTool,
                changedCheckBody: replacementCheck.querySelector('.check-result-title')?.textContent,
                changedToolBody: replacementTool.querySelector('.tool-call-debug-content-field-body')?.textContent,
                changedOpen: Array.from(replacementCheck.querySelectorAll('.check-result-item')).every(item => item.open)
                    && replacementTool.querySelector('.tool-call-debug-item').open
            };
        });

        expect(state).toEqual({
            actualCheckMarkup: true,
            actualToolMarkup: true,
            sameHistoryNodes: true,
            unchangedOpen: true,
            sameAfterProgressTick: true,
            changedNodesReplaced: true,
            changedCheckBody: 'Changed lockpicking check',
            changedToolBody: 'Changed tool result',
            changedOpen: true
        });
    });

    test('special player entries render original prefixes, type labels, and themed surfaces', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1500 });
        await page.addStyleTag({ content: '#chatLog { height: 1280px !important; max-height: none !important; overflow-y: visible !important; flex: none !important; }' });
        const result = await page.evaluate(() => {
            const chat = window.AIRPG_CHAT;
            const timestamp = '2026-10-26T12:00:00.000Z';
            const user = (id, content, extra = {}) => ({ id, timestamp, role: 'user', content, ...extra });
            chat.serverHistory = [
                user('question', 'What do I notice?', { type: 'user-question', metadata: { inputPrefix: '?' } }),
                user('meta', 'Describe the room.', { type: 'user-generic-prompt', metadata: { inputPrefix: '@' } }),
                user('private-meta', 'Look for a hidden clue.', { type: 'user-generic-prompt', metadata: { inputPrefix: '@@' } }),
                user('no-context', 'Continue from the last visible line.', { type: 'user-generic-prompt', metadata: { inputPrefix: '\\' } }),
                user('creative', '! Search the desk.'),
                user('forced', '!! A sudden storm begins.'),
                user('comment', '# The player pauses.'),
                {
                    id: 'screenshot-check', timestamp, role: 'assistant', type: 'check-results',
                    checkResults: [{ id: 'screenshot-skill-check', sequence: 1, kind: 'skill', status: 'completed', summary: 'Search, total 18 vs DC 12' }]
                }
            ];
            chat.renderChatHistory();
            const byId = id => chat.chatLog.querySelector(`[data-entry-id="${id}"]`);
            const styles = Object.fromEntries(['question', 'meta', 'creative', 'forced', 'comment'].map(id => [
                id, getComputedStyle(byId(id)).backgroundColor
            ]));
            const labels = Object.fromEntries(['question', 'meta', 'private-meta', 'no-context', 'creative', 'forced', 'comment'].map(id => [
                id, byId(id).querySelector('.message-sender').textContent
            ]));
            const content = Object.fromEntries(['question', 'meta', 'private-meta', 'no-context', 'creative', 'forced', 'comment'].map(id => [
                id, byId(id).querySelector('.message-content').textContent.trim()
            ]));
            const firstQuestion = byId('question');
            chat.renderChatHistory();
            const unchangedOrdinaryNode = byId('question') === firstQuestion;
            const check = byId('screenshot-check').querySelector('.check-result-item');
            check.open = true;
            return { styles, labels, content, unchangedOrdinaryNode, checkOpen: check.open, promptCount: chat.serverHistory.length };
        });
        expect(result.unchangedOrdinaryNode).toBe(true);

        expect(result.labels).toEqual({
            question: '👤 You · Question',
            meta: '👤 You · Meta prompt',
            'private-meta': '👤 You · Private meta prompt',
            'no-context': '👤 You · No-context prompt',
            creative: '👤 You · Creative action',
            forced: '👤 You · Forced event',
            comment: '👤 You · Comment'
        });
        expect(result.content).toMatchObject({
            question: '? What do I notice?',
            meta: '@ Describe the room.',
            'private-meta': '@@ Look for a hidden clue.',
            'no-context': '\\ Continue from the last visible line.',
            creative: '! Search the desk.',
            forced: '!! A sudden storm begins.',
            comment: '# The player pauses.'
        });
        expect(result.styles).toEqual({
            question: 'rgba(71, 85, 105, 0.78)',
            meta: 'rgba(76, 47, 111, 0.86)',
            creative: 'rgba(89, 65, 20, 0.9)',
            forced: 'rgba(110, 44, 32, 0.9)',
            comment: 'rgba(30, 41, 59, 0.9)'
        });
        expect(result.checkOpen).toBe(true);
        expect(result.promptCount).toBe(8);
        await page.screenshot({ path: 'tmp/chat-special-input-and-open-check.png', fullPage: true });
    });

    test('a table progress tick between mouse down and up keeps the view button and opens one viewer', async ({ page }) => {
        await page.evaluate(progress => {
            const chat = window.AIRPG_CHAT;
            chat.setPromptProgressDockState('table', { persist: false });
            chat.renderPromptProgress([progress]);
        }, progressEntry(0.2));

        const viewButton = page.locator('#promptProgressDock .prompt-progress-view').first();
        await expect(viewButton).toBeVisible();
        const originalButton = await viewButton.elementHandle();
        const bounds = await viewButton.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.evaluate(progress => window.AIRPG_CHAT.renderPromptProgress([progress]), progressEntry(0.47));
        await expect(viewButton).toBeFocused();
        expect(await originalButton.evaluate(button => button.isConnected)).toBe(true);
        expect(await originalButton.evaluate(button => button.isSameNode(document.querySelector('#promptProgressDock .prompt-progress-view')))).toBe(true);
        await page.mouse.up();

        await expect(page.locator('.prompt-progress-viewer')).toHaveCount(1);
    });

    test('one-line progress ticks preserve the focused eye action and keyboard activation', async ({ page }) => {
        await page.evaluate(progress => {
            const chat = window.AIRPG_CHAT;
            chat.setPromptProgressDockState('one-line', { persist: false });
            chat.renderPromptProgress([progress]);
        }, progressEntry(0.2));

        const viewButton = page.locator('#promptProgressDock .prompt-progress-view').first();
        await viewButton.focus();
        await page.evaluate(progress => window.AIRPG_CHAT.renderPromptProgress([progress]), progressEntry(0.58));
        await expect(viewButton).toBeFocused();
        await viewButton.press('Enter');
        await expect(page.locator('.prompt-progress-viewer')).toHaveCount(1);
        await expect(page.locator('.prompt-progress-viewer__response-inline')).toHaveText('Response at 0.58');
    });
});

