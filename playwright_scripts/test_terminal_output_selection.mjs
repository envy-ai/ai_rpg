import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:7777';
const baseOutput = Array.from(
    { length: 180 },
    (_, index) => `line ${String(index).padStart(3, '0')} selection-stability sample text`
).join('\n');
const appendedOutput = '\nline 180 appended while text remains selected';

let sentInitialOutput = false;
let appendRequested = false;
let sentAppend = false;
let cursor = 0;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
    if (message.type() === 'error') {
        errors.push(message.text());
    }
});

await page.route('**/api/terminal-output?*', async route => {
    const source = new URL(route.request().url()).searchParams.get('source');
    let output = '';
    if (!sentInitialOutput) {
        sentInitialOutput = true;
        output = baseOutput;
        cursor = output.length;
    } else if (appendRequested && !sentAppend) {
        sentAppend = true;
        output = appendedOutput;
        cursor += output.length;
    }
    await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            source,
            available: true,
            running: true,
            pid: 12345,
            output,
            cursor,
            startCursor: 0,
            reset: false,
            truncated: false
        })
    });
});

try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.click('#terminalOutputButton');
    const outputSelector = '.terminal-output-viewer__output';
    await page.waitForFunction(
        selector => document.querySelector(selector)?.textContent.includes('line 179'),
        outputSelector
    );

    const initial = await page.evaluate(selector => {
        const output = document.querySelector(selector);
        const textNode = output?.firstChild;
        if (!output || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
            throw new Error('Terminal output did not render as one text node.');
        }
        const start = textNode.data.indexOf('line 080');
        const end = textNode.data.indexOf('line 086');
        if (start < 0 || end <= start) {
            throw new Error('Could not find terminal selection fixture text.');
        }
        output.scrollTop = Math.floor(output.scrollHeight / 2);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        textNode.__terminalSelectionTestIdentity = true;
        return {
            selectedText: selection.toString(),
            scrollTop: output.scrollTop
        };
    }, outputSelector);

    await page.waitForTimeout(1700);
    const afterSilentPolls = await page.evaluate(selector => {
        const output = document.querySelector(selector);
        return {
            selectedText: window.getSelection()?.toString() || '',
            scrollTop: output.scrollTop,
            sameTextNode: output.firstChild?.__terminalSelectionTestIdentity === true
        };
    }, outputSelector);
    assert.equal(afterSilentPolls.selectedText, initial.selectedText);
    assert.equal(afterSilentPolls.scrollTop, initial.scrollTop);
    assert.equal(afterSilentPolls.sameTextNode, true);

    appendRequested = true;
    await page.waitForFunction(
        selector => document.querySelector(selector)?.textContent.includes('line 180 appended'),
        outputSelector
    );
    const afterAppend = await page.evaluate(selector => {
        const output = document.querySelector(selector);
        return {
            selectedText: window.getSelection()?.toString() || '',
            scrollTop: output.scrollTop,
            sameTextNode: output.firstChild?.__terminalSelectionTestIdentity === true
        };
    }, outputSelector);
    assert.equal(afterAppend.selectedText, initial.selectedText);
    assert.equal(afterAppend.scrollTop, initial.scrollTop);
    assert.equal(afterAppend.sameTextNode, true);
    assert.deepEqual(errors, []);

    await page.screenshot({
        path: 'tmp/terminal-selection-behavior.png',
        fullPage: true
    });
    console.log(JSON.stringify({ initial, afterSilentPolls, afterAppend }, null, 2));
} finally {
    await browser.close();
}
