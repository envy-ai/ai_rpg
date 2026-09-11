// Isolated UI/API check: never starts server.js, rotates real logs, or loads a save.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const nunjucks = require('nunjucks');
const { chromium } = require('@playwright/test');
const LogViewer = require('../LogViewer');

(async () => {
    const project = path.resolve(__dirname, '..');
    const root = await fs.mkdtemp(path.join(project, 'tmp/log-viewer-browser-'));
    await fs.mkdir(path.join(root, 'logs'));
    await fs.mkdir(path.join(root, 'logs_prev'));
    const oldName = 'event-check_2026-09-09_14-31-52.log';
    const newName = 'player-action_2026-09-09_14-32-08.log';
    for (let index = 0; index < 20; index += 1) {
        await fs.writeFile(path.join(root, 'logs', `npc-turn_${String(index).padStart(2, '0')}.log`), `NPC turn ${index}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.writeFile(path.join(root, 'logs', oldName), 'Event check complete.');
    await new Promise(resolve => setTimeout(resolve, 20));
    const log = '[2026-09-09 14:32:08] Player action\n\n--- REQUEST ---\nAction: Summon Mot\nOutcome: Critical success\n\n--- RESPONSE ---\nMot appears beside the player.\n\n--- EVENTS ---\ntriggeredAbility: Summon drone\nnpcFirstAppearance: Mot\n\n[2026-09-09 14:32:10] Complete';
    await fs.writeFile(path.join(root, 'logs', newName), log);
    await fs.writeFile(path.join(root, 'logs_prev', 'previous.log'), '<script>window.logInjected = true</script>\nPrevious session.');
    const app = express();
    nunjucks.configure(path.join(project, 'views'), { autoescape: true, express: app });
    app.use(express.static(path.join(project, 'public')));
    app.use('/assets', express.static(path.join(project, 'assets')));
    app.get('/api/pending-load', (_req, res) => res.json({ success: true, pendingLoad: null }));
    new LogViewer(root).registerRoutes(app);
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/log-viewer`);
        await page.waitForFunction(() => document.getElementById('log-content').value.includes('Summon Mot'));
        assert.equal(await page.locator('#log-files button').first().getAttribute('data-filename'), newName);
        assert.equal(await page.locator('#log-content').getAttribute('readonly'), '');
        await page.screenshot({ path: path.join(project, 'tmp/log-viewer-desktop.png'), fullPage: true });
        await page.locator('.app-tools-menu summary').click();
        await page.getByRole('link', { name: 'Log Viewer', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('log-content').value.includes('Summon Mot'));
        await page.locator('#log-filter').fill('ACTION  14-32');
        assert.equal(await page.locator('#log-files button').count(), 1);
        await page.locator('#log-filter').fill('no-match');
        assert.equal(await page.locator('#log-files button').count(), 0);
        assert.equal(await page.locator('#log-content').inputValue(), '');
        await page.locator('#log-filter').fill('');
        await page.locator('#log-session').selectOption('logs_prev');
        await page.waitForFunction(() => document.getElementById('log-content').value.includes('Previous session.'));
        assert.equal(await page.evaluate(() => window.logInjected), undefined);
        await page.locator('#log-session').selectOption('logs');
        await page.waitForFunction(() => document.getElementById('log-content').value.includes('Summon Mot'));

        // A late response from the previous session must not overwrite the new selection.
        await page.route('**/api/log-viewer/file?**', async route => {
            if (new URL(route.request().url()).searchParams.get('session') === 'logs_prev') {
                await new Promise(resolve => setTimeout(resolve, 150));
                await route.fulfill({ json: { success: true, file: { name: 'previous.log', content: 'STALE', createdAt: new Date().toISOString(), size: 5 } } });
            } else await route.continue();
        });
        await page.locator('#log-session').selectOption('logs_prev');
        await page.waitForFunction(() => document.getElementById('log-filename').textContent === 'previous.log');
        await page.locator('#log-session').selectOption('logs');
        await page.waitForFunction(() => document.getElementById('log-content').value.includes('Summon Mot'));
        await page.waitForTimeout(200);
        assert.match(await page.locator('#log-content').inputValue(), /Summon Mot/);
        await page.unroute('**/api/log-viewer/file?**');

        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(project, 'tmp/log-viewer-mobile.png'), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.ok((await page.locator('#log-content').boundingBox()).height > 100);
        assert.equal(await page.locator('#log-files').evaluate(element => element.scrollHeight > element.clientHeight), true);
        await page.setViewportSize({ width: 1600, height: 1000 });
        await fs.writeFile(path.join(root, 'logs', newName), Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join('\n'));
        await page.locator('#log-refresh').click();
        await page.waitForFunction(() => document.getElementById('log-content').value.startsWith('Line 1'));
        await page.locator('#log-content').evaluate(element => { element.scrollTop = 1000; element.dispatchEvent(new Event('scroll')); });
        assert.equal(await page.locator('#log-lines').evaluate(element => element.scrollTop), await page.locator('#log-content').evaluate(element => element.scrollTop));
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok((await page.locator('#log-content').boundingBox()).height < 600);
        assert.equal(await page.locator('#log-content').evaluate(element => element.scrollHeight > element.clientHeight), true);
        await page.setViewportSize({ width: 1600, height: 1000 });

        await page.route('**/api/log-viewer/files?**', route => route.fulfill({ status: 500, json: { success: false, error: 'Test failure', stack: 'Error: Test failure\n    at test fixture' } }));
        await page.locator('#log-refresh').click();
        await page.locator('#log-error[open]').waitFor();
        assert.match(await page.locator('#log-error-details').textContent(), /at test fixture/);
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        console.log('PASS: navigation, ordering, filtering, sessions, literal text, stale responses, desktop/mobile layout, line scrolling, and error modal.');
        console.log('Screenshots: tmp/log-viewer-desktop.png and tmp/log-viewer-mobile.png');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
