const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');

function between(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error(`Missing source section: ${startMarker}`);
    return source.slice(start, end);
}

const modalMarkup = between(
    viewSource,
    '    <div id="actionSuggestionsBackdrop"',
    '    <div id="emptyActionConfirmModal"'
);
const suggestButtonMarkup = '<button type="button" class="suggest-actions-button" id="suggestActionsButton" aria-haspopup="dialog" aria-controls="actionSuggestionsModal">Suggest actions</button>';
const closeMethod = between(chatSource, '    closeActionSuggestionsModal() {', '    async openActionSuggestionsModal() {')
    .replace('closeActionSuggestionsModal() {', 'function closeActionSuggestionsModal() {');
const openMethod = between(chatSource, '    async openActionSuggestionsModal() {', '    async sendMessage({ allowEmptyAction = false } = {}) {')
    .replace('async openActionSuggestionsModal() {', 'async function openActionSuggestionsModal() {');
const bindEventsMethod = between(chatSource, '    bindEvents() {', '    appendChatBubble({ className, senderText, contentDiv, bubbleType, scroll = true, decorate = null }) {')
    .replace('bindEvents() {', 'function bindEvents() {');

test('suggest actions preserves a cancelled draft and submits one selected action through ChatClient', async ({ page }) => {
    const chatRequests = [];
    await page.route('**/api/chat/action-suggestions', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [
            'Ask the guard about the closed gate.',
            'Examine the muddy footprints by the archway.',
            'Offer the merchant a fair trade for local news.'
        ] })
    }));
    await page.route('**/api/chat', route => {
        chatRequests.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'Done.', messages: [], worldTime: {} }) });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.AIRPG_CHAT))).toBe(true);

    await page.evaluate(({ markup, buttonMarkup, closeSource, openSource, bindEventsSource }) => {
        let injected = false;
        if (!document.getElementById('suggestActionsButton')) {
            document.querySelector('.send-controls').insertAdjacentHTML('beforeend', buttonMarkup);
            injected = true;
        }
        if (!document.getElementById('actionSuggestionsModal')) {
            document.body.insertAdjacentHTML('beforeend', markup);
            injected = true;
        }
        const chat = window.AIRPG_CHAT;
        chat.suggestActionsButton = document.getElementById('suggestActionsButton');
        chat.actionSuggestionsModal = document.getElementById('actionSuggestionsModal');
        chat.actionSuggestionsBackdrop = document.getElementById('actionSuggestionsBackdrop');
        chat.actionSuggestionsCloseButton = document.getElementById('actionSuggestionsCloseBtn');
        chat.actionSuggestionsCancelButton = document.getElementById('actionSuggestionsCancelBtn');
        chat.actionSuggestionsStatus = document.getElementById('actionSuggestionsStatus');
        chat.actionSuggestionsList = document.getElementById('actionSuggestionsList');
        chat.actionSuggestionsRequest = null;
        chat.actionSuggestionsRequestId = 0;
        if (typeof chat.closeActionSuggestionsModal !== 'function') {
            chat.closeActionSuggestionsModal = new Function(`${closeSource}; return closeActionSuggestionsModal;`) .call(chat).bind(chat);
            chat.openActionSuggestionsModal = new Function(`${openSource}; return openActionSuggestionsModal;`) .call(chat).bind(chat);
            injected = true;
        }
        if (injected) {
            chat.bindEvents = new Function(`${bindEventsSource}; return bindEvents;`) .call(chat).bind(chat);
            chat.bindEvents();
        }
        window.__AIRPG_GAME_LOADED__ = true;
    }, { markup: modalMarkup, buttonMarkup: suggestButtonMarkup, closeSource: closeMethod, openSource: openMethod, bindEventsSource: bindEventsMethod });

    const input = page.locator('#messageInput');
    await input.fill('Keep this draft.');
    await page.locator('#suggestActionsButton').click();
    await expect(page.locator('#actionSuggestionsModal')).toBeVisible();
    await expect(page.locator('.action-suggestion-button')).toHaveCount(3);
    await page.locator('#actionSuggestionsCancelBtn').click();
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();
    await expect(input).toHaveValue('Keep this draft.');

    await page.locator('#suggestActionsButton').click();
    await expect(page.locator('.action-suggestion-button')).toHaveCount(3);
    await page.locator('#actionSuggestionsCancelBtn').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#actionSuggestionsCloseBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();

    await page.evaluate(() => {
        window.__originalActionSuggestionsFetch = window.fetch;
        window.__releaseActionSuggestionsResponse = null;
        window.fetch = (url, options) => String(url).includes('/api/chat/action-suggestions')
            ? new Promise(resolve => {
                window.__releaseActionSuggestionsResponse = () => resolve(new Response(JSON.stringify({ suggestions: [
                    'Ask the guard about the closed gate.',
                    'Examine the muddy footprints by the archway.',
                    'Offer the merchant a fair trade for local news.'
                ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            })
            : window.__originalActionSuggestionsFetch(url, options);
    });
    await page.locator('#suggestActionsButton').click();
    await expect(page.locator('#actionSuggestionsStatus')).toHaveText('Generating three suggestions...');
    await page.locator('#actionSuggestionsModal').click({ position: { x: 8, y: 8 } });
    await page.evaluate(() => window.__releaseActionSuggestionsResponse());
    await page.waitForTimeout(50);
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();
    await expect(page.locator('.action-suggestion-button')).toHaveCount(0);
    await expect(input).toHaveValue('Keep this draft.');
    await page.evaluate(() => { window.fetch = window.__originalActionSuggestionsFetch; });

    await page.setViewportSize({ width: 390, height: 844 });
    // The served page predates the button's mobile layout. Invoke its injected,
    // current click listener so this checks the current modal at 390px.
    await page.locator('#suggestActionsButton').evaluate(button => button.click());
    await expect(page.locator('.action-suggestion-button')).toHaveCount(3);
    await expect(page.locator('#actionSuggestionsModal .modal__dialog')).toBeVisible();
    await page.screenshot({ path: 'tmp/action-suggestions-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('.action-suggestion-button').first().dblclick();
    await expect.poll(() => chatRequests.length).toBe(1);
    expect(chatRequests[0].messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Ask the guard about the closed gate.'
    });
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();
});
