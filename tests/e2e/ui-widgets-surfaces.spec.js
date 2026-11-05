const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://surface-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><button id="busy">Initial</button><div id="status" hidden></div><div id="notices"></div>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('busy, status and notice surfaces retain independent state and dispose timers', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { BusyButton, StatusSurface, NoticeHost } = await import('/src/index.js');
        const button = document.querySelector('#busy'); const busy = BusyButton.attach(button);
        busy.setBusy(true, { disabled: false, busyContent: 'Working' });
        const active = { disabled: button.disabled, text: button.textContent, aria: button.getAttribute('aria-busy') };
        busy.setIdleState({ disabled: true, content: 'Updated idle' }); busy.setBusy(false, { disabled: true });
        const idle = { disabled: button.disabled, text: button.textContent, aria: button.getAttribute('aria-busy') };
        const statusNode = document.querySelector('#status'), status = StatusSurface.attach(statusNode);
        status.update({ text: 'Old', state: 'info', visible: true, autoHideMs: 20 });
        status.update({ text: 'New', state: 'success', visible: true });
        const notices = new NoticeHost(document.querySelector('#notices'));
        const first = notices.show('Temporary', { duration: 20, exitDuration: 0 });
        const second = notices.show('Retained', { duration: 200, exitDuration: 0 });
        await new Promise(resolve => setTimeout(resolve, 60));
        const after = { status: statusNode.textContent, hidden: statusNode.hidden, oldNotice: first.element.isConnected, newNotice: second.element.isConnected };
        notices.destroy(); status.destroy(); busy.destroy();
        return { active, idle, after, noticeCount: document.querySelector('#notices').children.length };
    });
    expect(result).toEqual({ active: { disabled: true, text: 'Working', aria: 'true' }, idle: { disabled: true, text: 'Updated idle', aria: null }, after: { status: 'New', hidden: false, oldNotice: false, newNotice: true }, noticeCount: 0 });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
