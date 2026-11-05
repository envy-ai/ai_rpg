const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'http://lorebooks-fixture.test';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });

test('Lorebooks upload and delete dialogs retain failure and cancellation behavior', async ({ page }) => {
    let books = [{ filename: 'lore.json', name: 'Fixture Lore', enabled: true, entryCount: 0, tokenEstimate: 0, entries: [] }];
    let failUpload = true, failDelete = true; const writes = [], errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url()), request = route.request(), pathname = decodeURIComponent(url.pathname);
        if (url.origin !== ORIGIN) return route.abort();
        if (pathname === '/lorebooks') return route.fulfill({ contentType: 'text/html', body: env.render('lorebooks.njk', { title: 'Lorebooks', currentPage: 'lorebooks' }) });
        if (pathname === '/api/pending-load' && request.method() === 'GET') return route.fulfill({ json: { success: true, pendingLoad: null } });
        if (pathname === '/api/lorebooks' && request.method() === 'GET') return route.fulfill({ json: { success: true, lorebooks: books } });
        if (pathname === '/api/lorebooks/lore.json' && request.method() === 'GET') return route.fulfill({ json: { success: true, lorebook: books[0] } });
        if (pathname === '/api/lorebooks/lore.json' && request.method() === 'DELETE') { writes.push('delete'); if (failDelete) return route.fulfill({ json: { success: false, error: 'Delete rejected', stack: 'Error: Delete rejected\n    at lore-fixture.js:42:3' } }); books = []; return route.fulfill({ json: { success: true } }); }
        if (pathname === '/api/lorebooks/upload' && request.method() === 'POST') { writes.push(request.postDataJSON()); return route.fulfill({ json: failUpload ? { success: false, error: 'Upload rejected' } : { success: true, message: 'Saved' } }); }
        if (pathname.startsWith('/api/')) { unexpected.push(`${request.method()} ${pathname}`); return route.fulfill({ status: 404, json: { success: false } }); }
        const file = path.resolve(ROOT, 'public', `.${pathname}`);
        if (file.startsWith(path.join(ROOT, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.abort();
    });
    await page.goto(`${ORIGIN}/lorebooks`);
    await page.locator('#uploadBtn').click();
    await page.locator('#lorebookFile').setInputFiles({ name: 'upload.json', mimeType: 'application/json', buffer: Buffer.from('{"entries":{}}') });
    await page.locator('#lorebookFilename').fill('Custom');
    await page.locator('#confirmUpload').click();
    await expect(page.locator('#statusMessage')).toContainText('Upload rejected');
    await expect(page.locator('dialog.page-feedback-dialog')).toContainText('Upload rejected');
    await page.keyboard.press('Escape');
    await expect(page.locator('#uploadModal')).toBeVisible(); await expect(page.locator('#lorebookFilename')).toHaveValue('Custom');
    await page.keyboard.press('Escape'); await expect(page.locator('#uploadModal')).toBeHidden();
    failUpload = false;
    await page.locator('#uploadBtn').click(); await page.locator('#confirmUpload').click();
    await expect(page.locator('#uploadModal')).toBeHidden(); await expect.poll(() => writes.length).toBe(2);
    await page.getByText('Fixture Lore', { exact: true }).first().click();
    await page.locator('#deleteBtn').click(); await expect(page.locator('#deleteModal')).toBeVisible();
    await page.locator('#cancelDelete').click(); await expect(page.locator('#deleteModal')).toBeHidden(); expect(writes).toHaveLength(2);
    await page.locator('#deleteBtn').click(); await page.locator('#confirmDelete').click();
    const feedback = page.locator('dialog.page-feedback-dialog'); await expect(feedback).toContainText('lore-fixture.js:42:3');
    await expect(page.locator('#statusMessage')).toContainText('Delete rejected');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3200);
    await expect(page.locator('#statusMessage')).toBeVisible(); await expect(page.locator('#statusMessage')).toContainText('Delete rejected');
    failDelete = false; await page.locator('#deleteBtn').click(); await page.locator('#confirmDelete').click();
    await expect(page.locator('#deleteModal')).toBeHidden(); await expect.poll(() => writes.length).toBe(4);
    expect(writes.slice(2)).toEqual(['delete', 'delete']); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
