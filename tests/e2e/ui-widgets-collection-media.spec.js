const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://collection-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="count"></div><div id="empty" hidden></div><div id="collection"></div><div id="frame"></div>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('collection modes preserve supplied order, empty/count state and release mounted entries', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { CollectionView } = await import('/src/index.js');
        window.disposed = [];
        window.collection = new CollectionView(document.querySelector('#collection'), { count: document.querySelector('#count'), empty: document.querySelector('#empty') });
        window.renderCollection = (items, mode) => window.collection.render({ items, totalCount: 4, countText: `${items.length} of 4`, emptyText: 'No matches', mode, columns: [{ id: 'name', label: 'Name' }], renderItem: item => { const element = document.createElement('div'); element.textContent = item; return { element, dispose: () => window.disposed.push(item) }; } });
        window.renderCollection(['Alpha', 'Beta'], 'classic');
    });
    await expect(page.locator('#collection')).toContainText('Alpha'); await expect(page.locator('#count')).toHaveText('2 of 4');
    await page.evaluate(() => window.renderCollection(['Beta'], 'table'));
    expect(await page.evaluate(() => window.disposed)).toEqual(['Alpha', 'Beta']);
    await expect(page.locator('#collection')).toContainText('Beta');
    await page.evaluate(() => window.renderCollection([], 'grid'));
    await expect(page.locator('#empty')).toHaveText('No matches'); await expect(page.locator('#empty')).toBeVisible();
    expect(await page.evaluate(() => window.disposed)).toEqual(['Alpha', 'Beta', 'Beta']);
    await page.evaluate(() => { window.collection.destroy(); window.collection.destroy(); });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('image frame releases stale image listeners when a newer image replaces it', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { ImageFrame } = await import('/src/index.js');
        window.frame = new ImageFrame(document.querySelector('#frame')); window.events = [];
        window.frame.show({ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', alt: 'First', onImage: () => () => window.events.push('first cleanup') });
        const old = document.querySelector('#frame img');
        window.frame.show({ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', alt: 'Second', onImage: () => () => window.events.push('second cleanup') });
        old.dispatchEvent(new Event('load')); old.dispatchEvent(new Event('error'));
        return { alt: document.querySelector('#frame img').alt, events: window.events };
    });
    expect(result.alt).toBe('Second'); expect(result.events).toEqual(['first cleanup']);
    await page.evaluate(() => { window.frame.destroy(); window.frame.destroy(); });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('image frame cleanup may replace or destroy its owner without stale rendering', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { ImageFrame } = await import('/src/index.js');
        const root = document.querySelector('#frame'), events = [];
        const frame = new ImageFrame(root);
        frame.show({ src: 'first', onImage: () => () => { events.push('replace'); frame.show({ src: 'replacement', alt: 'Replacement' }); } });
        frame.show({ src: 'superseded', alt: 'Superseded' });
        const replacement = root.querySelector('img').alt;
        frame.show({ src: 'error', errorHtml: '<p>stale error</p>', onImage: () => () => { events.push('error cleanup'); frame.show({ src: 'after-error', alt: 'After error' }); } });
        root.querySelector('img').dispatchEvent(new Event('error'));
        const afterError = root.querySelector('img').alt;
        frame.show({ src: 'destroy', onImage: () => () => { events.push('destroy'); frame.destroy(); } });
        frame.show({ src: 'ignored', alt: 'Ignored' });
        return { replacement, afterError, events, destroyed: frame.destroyed, alt: root.querySelector('img').alt };
    });
    expect(result).toEqual({ replacement: 'Replacement', afterError: 'After error', events: ['replace', 'error cleanup', 'destroy'], destroyed: true, alt: '' });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
