const { chromium } = require('playwright');
const path = require('node:path');

async function main() {
    const baseUrl = process.env.AIRPG_TEST_BASE_URL || 'http://127.0.0.1:4179';
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });
    page.on('pageerror', error => errors.push(error.message || String(error)));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const terminalButton = page.locator('#terminalOutputButton');
    const stopButton = page.locator('#abortTurnButton');
    const terminalButtonBox = await terminalButton.boundingBox();
    const stopButtonBox = await stopButton.boundingBox();
    if (!terminalButtonBox || !stopButtonBox || terminalButtonBox.x >= stopButtonBox.x) {
        throw new Error('Terminal output button is not positioned to the left of Stop.');
    }

    await terminalButton.click();
    const viewer = page.locator('.terminal-output-viewer');
    await viewer.waitFor({ state: 'visible' });
    const viewerBox = await viewer.boundingBox();
    if (!viewerBox || viewerBox.width < 800 || viewerBox.height < 500) {
        throw new Error(`Terminal viewer is smaller than expected: ${JSON.stringify(viewerBox)}`);
    }

    const follow = page.locator('.terminal-output-viewer__follow-input');
    if (!(await follow.isChecked())) {
        throw new Error('Terminal viewer Follow checkbox is not checked by default.');
    }

    const sourceSelect = page.locator('.terminal-output-viewer__source-select');
    if (await sourceSelect.inputValue() !== 'llama') {
        throw new Error('Terminal viewer did not default to llama.cpp.');
    }
    await sourceSelect.selectOption('airpg');
    await page.waitForFunction(() => {
        const output = document.querySelector('.terminal-output-viewer__output')?.textContent || '';
        return output.includes('AI RPG Game Master is ready!');
    });

    const subtitle = await page.locator('.terminal-output-viewer__subtitle').textContent();
    if (!subtitle || !subtitle.includes('AI RPG') || !subtitle.includes('Running') || !subtitle.includes('PID')) {
        throw new Error(`Unexpected AI RPG terminal subtitle: ${subtitle}`);
    }
    if (errors.length) {
        throw new Error(`Browser errors: ${errors.join(' | ')}`);
    }

    await page.screenshot({
        path: path.resolve('tmp/terminal-output-viewer-airpg.png'),
        fullPage: true
    });
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
