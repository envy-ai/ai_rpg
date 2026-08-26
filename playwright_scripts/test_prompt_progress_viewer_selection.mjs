import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:7777';
const promptText = Array.from(
    { length: 90 },
    (_, index) => `[user ${String(index).padStart(2, '0')}] prompt selection sample text`
).join('\n');
const failedText = Array.from(
    { length: 30 },
    (_, index) => `failed ${String(index).padStart(2, '0')} response selection sample text`
).join('\n');
const responseText = Array.from(
    { length: 90 },
    (_, index) => `response ${String(index).padStart(2, '0')} selection sample text`
).join('\n');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
    if (message.type() === 'error') {
        errors.push(message.text());
    }
});

async function selectRange(selector, startMarker, endMarker) {
    return page.evaluate(({ selector, startMarker, endMarker }) => {
        const element = document.querySelector(selector);
        const textNode = element?.firstChild;
        if (!element || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
            throw new Error(`Missing single text node for ${selector}.`);
        }
        const start = textNode.data.indexOf(startMarker);
        const end = textNode.data.indexOf(endMarker);
        if (start < 0 || end <= start) {
            throw new Error(`Could not find selection markers in ${selector}.`);
        }
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        textNode.__promptFollowerSelectionIdentity = true;
        const stream = element.closest('.prompt-progress-viewer__stream-text');
        stream.scrollTop = Math.floor(stream.scrollHeight / 2);
        return {
            selectedText: selection.toString(),
            scrollTop: stream.scrollTop
        };
    }, { selector, startMarker, endMarker });
}

async function readSelectionState(selector) {
    return page.evaluate(selector => {
        const element = document.querySelector(selector);
        const stream = element.closest('.prompt-progress-viewer__stream-text');
        return {
            selectedText: window.getSelection()?.toString() || '',
            scrollTop: stream.scrollTop,
            sameTextNode: element.firstChild?.__promptFollowerSelectionIdentity === true
        };
    }, selector);
}

async function syncEntry(changes = {}) {
    await page.evaluate(changes => {
        const chat = window.AIRPG_CHAT;
        const entry = chat.promptProgressEntries.find(candidate => candidate.id === 'selection-test-prompt');
        const viewerState = Array.from(chat.promptProgressViewerWindows.values())
            .find(candidate => candidate.promptId === 'selection-test-prompt');
        if (!viewerState) {
            throw new Error('Synthetic prompt follower state disappeared.');
        }
        if (entry) {
            Object.assign(entry, changes);
        } else {
            Object.assign(viewerState.lastEntry, changes);
        }
        chat.syncPromptProgressViewerWindow(viewerState);
    }, changes);
    await page.waitForTimeout(100);
}

try {
    console.log('prompt follower selection: loading page');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    console.log('prompt follower selection: creating synthetic viewer');
    await page.evaluate(({ promptText, failedText, responseText }) => {
        const chat = window.AIRPG_CHAT;
        chat.promptProgressEntries = [{
            id: 'selection-test-prompt',
            label: 'Selection test prompt',
            model: 'selection-test-model',
            promptText,
            previewText: responseText,
            failedResponses: [failedText],
            receivedCount: responseText.length,
            progressFraction: 0.5,
            seconds: 1,
            timeoutSeconds: 60,
            isComplete: false
        }];
        chat.openPromptProgressViewer('selection-test-prompt');
    }, { promptText, failedText, responseText });

    const viewerSelector = '.prompt-progress-viewer[data-prompt-id="selection-test-prompt"]';
    await page.waitForSelector(viewerSelector);
    console.log('prompt follower selection: viewer ready');
    const promptSelector = `${viewerSelector} .prompt-progress-viewer__prompt-inline`;
    const failedSelector = `${viewerSelector} .prompt-progress-viewer__failed-response-inline`;
    const responseSelector = `${viewerSelector} .prompt-progress-viewer__response-inline`;

    const promptSelection = await selectRange(promptSelector, '[user 30]', '[user 36]');
    console.log('prompt follower selection: prompt selected');
    await syncEntry();
    console.log('prompt follower selection: silent sync complete');
    const promptAfterSilentSync = await readSelectionState(promptSelector);
    assert.equal(promptAfterSilentSync.selectedText, promptSelection.selectedText);
    assert.equal(promptAfterSilentSync.scrollTop, promptSelection.scrollTop);
    assert.equal(promptAfterSilentSync.sameTextNode, true);

    await syncEntry({
        previewText: `${responseText}\nresponse 90 appended while prompt remains selected`,
        receivedCount: responseText.length + 51
    });
    console.log('prompt follower selection: response append under prompt selection complete');
    const promptAfterResponseAppend = await readSelectionState(promptSelector);
    assert.equal(promptAfterResponseAppend.selectedText, promptSelection.selectedText);
    assert.equal(promptAfterResponseAppend.scrollTop, promptSelection.scrollTop);
    assert.equal(promptAfterResponseAppend.sameTextNode, true);

    const failedSelection = await selectRange(failedSelector, 'failed 10', 'failed 16');
    console.log('prompt follower selection: failed response selected');
    await syncEntry({
        failedResponses: [failedText, 'second failed response appended after the retained first response']
    });
    console.log('prompt follower selection: failed response append complete');
    const failedAfterAppend = await readSelectionState(failedSelector);
    assert.equal(failedAfterAppend.selectedText, failedSelection.selectedText);
    assert.equal(failedAfterAppend.scrollTop, failedSelection.scrollTop);
    assert.equal(failedAfterAppend.sameTextNode, true);

    const responseSelection = await selectRange(responseSelector, 'response 30', 'response 36');
    console.log('prompt follower selection: response selected');
    await syncEntry({
        previewText: `${responseText}\nresponse 90 appended while response remains selected\nresponse 91 more output`,
        receivedCount: responseText.length + 75
    });
    console.log('prompt follower selection: response append complete');
    const responseAfterAppend = await readSelectionState(responseSelector);
    assert.equal(responseAfterAppend.selectedText, responseSelection.selectedText);
    assert.equal(responseAfterAppend.scrollTop, responseSelection.scrollTop);
    assert.equal(responseAfterAppend.sameTextNode, true);
    assert.deepEqual(errors, []);

    await page.screenshot({
        path: 'tmp/prompt-follower-selection-behavior.png',
        fullPage: true
    });
    console.log(JSON.stringify({
        promptAfterSilentSync,
        promptAfterResponseAppend,
        failedAfterAppend,
        responseAfterAppend
    }, null, 2));
} finally {
    await browser.close();
}
