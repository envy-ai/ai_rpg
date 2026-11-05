const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://feedback-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="actions"></div><div id="list"></div><div id="meter"><div id="fill"></div></div><div id="scroll" style="height:80px;overflow:auto"><div style="height:500px"></div></div>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('feedback action, snapshot, meter and follow-scroll owners update and dispose', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { ActionGroup, SnapshotList, ProgressMeter, FollowScroll } = await import('/src/index.js');
        const actions = [], disposed = [];
        const group = new ActionGroup(document.querySelector('#actions'), { onAction: id => actions.push(id) });
        group.update([{ id: 'cancel', label: 'Cancel' }, { id: 'retry', label: 'Retry' }]);
        const focusedButton = group.buttons.get('cancel'); focusedButton.focus(); group.setPending(['retry'], true);
        group.update([{ id: 'cancel', label: 'Cancel' }, { id: 'retry', label: 'Retry' }]);
        const retainedFocus = document.activeElement === focusedButton && group.buttons.get('cancel') === focusedButton;
        const retainedPending = group.buttons.get('retry').disabled; group.setPending(['retry'], false);
        group.buttons.get('cancel').click(); group.setPending(['cancel'], true); const disabled = group.buttons.get('cancel').disabled;
        group.setPending(['cancel'], false); group.buttons.get('cancel').click();
        const list = new SnapshotList(document.querySelector('#list'), { key: item => item.id, create: () => document.createElement('div'), update: (row, item) => { row.textContent = item.label; }, dispose: row => disposed.push(row.textContent) });
        list.render([{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }]);
        const first = document.querySelector('#list').firstElementChild;
        list.render([{ id: 'b', label: 'Updated' }, { id: 'a', label: 'Retained' }]);
        const retained = document.querySelector('#list').lastElementChild === first;
        list.render([{ id: 'a', label: 'Retained' }]);
        const meter = new ProgressMeter(document.querySelector('#meter'), { fill: document.querySelector('#fill'), completeClass: 'complete', waitingClass: 'waiting' });
        meter.update({ fraction: 0.25, waiting: true }); const width = document.querySelector('#fill').style.width;
        const scroll = document.querySelector('#scroll');
        const follow = new FollowScroll(scroll, { isFollowing: () => true }); follow.request({ immediate: true }); const bottom = scroll.scrollTop > 0;
        follow.destroy(); group.destroy(); list.destroy(); meter.destroy();
        return { actions, disabled, retained, retainedFocus, retainedPending, disposed, width, bottom };
    });
    expect(result.retainedFocus).toBe(true); expect(result.retainedPending).toBe(true);
    expect(result.actions).toEqual(['cancel', 'cancel']); expect(result.disabled).toBe(true); expect(result.retained).toBe(true);
    expect(result.disposed).toContain('Updated'); expect(result.disposed).toContain('Retained'); expect(result.width).toBe('25%'); expect(result.bottom).toBe(true);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('follow scroll honors user scroll intent, gating and destruction', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { FollowScroll } = await import('/src/index.js');
        const root = document.querySelector('#scroll'); let allowed = true;
        const owner = new FollowScroll(root, { trackIntent: true, canScroll: () => allowed });
        owner.request({ force: true, immediate: true });
        root.scrollTop = 40; owner.captureIntent();
        owner.request({ immediate: true }); const paused = root.scrollTop;
        allowed = false; owner.request({ force: true });
        await new Promise(resolve => requestAnimationFrame(resolve)); const gated = root.scrollTop;
        allowed = true; owner.flush(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const resumed = owner.atBottom();
        owner.request({ force: true }); owner.destroy();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { paused, gated, resumed };
    });
    expect(result.paused).toBe(40); expect(result.gated).toBe(40); expect(result.resumed).toBe(true);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('snapshot removal survives reentrant destruction and preserves original cleanup error', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { SnapshotList } = await import('/src/index.js');
        const root = document.querySelector('#list'), events = [], original = new Error('fixture disposal failure');
        let owner;
        owner = new SnapshotList(root, {
            create: item => ({ element: document.createElement('div'), dispose: () => { events.push(`local ${item.id}`); if (item.id === 'a') { owner.destroy(); throw original; } } }),
            update: (element, item) => { element.textContent = item.id; },
            dispose: element => events.push(`global ${element.textContent}`)
        });
        owner.render([{ id: 'a' }, { id: 'b' }]);
        let error; try { owner.render([]); } catch (caught) { error = caught; }
        owner.destroy();
        return { events, message: error?.message, original: error === original || error?.cause === original, children: root.children.length };
    });
    expect(result.events.sort()).toEqual(['global a', 'global b', 'local a', 'local b']);
    expect(result.original).toBe(true); expect(result.message).toContain('fixture disposal failure'); expect(result.children).toBe(0);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('observed follow scroll reacts to streamed text and new child without surviving disposal', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { FollowScroll } = await import('/src/index.js');
        const root = document.querySelector('#scroll'); root.replaceChildren();
        const content = document.createElement('div'); content.textContent = 'first\n'.repeat(40); content.style.whiteSpace = 'pre-wrap'; root.append(content);
        const owner = new FollowScroll(root, { observe: true, isFollowing: () => true });
        owner.request({ force: true, immediate: true });
        content.firstChild.data += 'new text\n'.repeat(40);
        await new Promise(resolve => setTimeout(resolve, 80)); const textBottom = owner.atBottom();
        const child = document.createElement('div'); child.textContent = 'another line\n'.repeat(40); child.style.whiteSpace = 'pre-wrap'; root.append(child);
        await new Promise(resolve => setTimeout(resolve, 80)); const childBottom = owner.atBottom();
        owner.destroy(); content.firstChild.data += 'after destroy';
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { textBottom, childBottom };
    });
    expect(result).toEqual({ textBottom: true, childBottom: true }); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
