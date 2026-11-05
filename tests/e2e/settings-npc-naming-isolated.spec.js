const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const origin = 'http://0.0.0.0:4173';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });

test('world editor saves, reloads, and clears NPC naming guidance', async ({ page }) => {
    let profile = { id: 'isolated-world', name: 'Isolated World', theme: 'Fantasy', genre: 'Adventure', hidingAttribute: 'dexterity', perceptionAttribute: 'wisdom', npcNamingGuidance: 'Existing moon names', modSettings: { modules: { slotTypes: [{ id: 'scope', label: 'Scope', description: 'Optics' }] } }, calendarDefinition: { yearName: 'Fixture Era', months: [{ name: 'Dawn', lengthDays: 30 }], weekdays: ['Firstday'], seasons: [], holidays: [] } };
    const saves = [];
    const fillRequests = [];
    const blocked = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const pathname = decodeURIComponent(url.pathname);
        const method = route.request().method();
        if (pathname === '/settings') return route.fulfill({ contentType: 'text/html', body: env.render('settings.njk', {
            title: 'World Profiles', unifiedTonalScaleDefinition: {}, unifiedTonalScaleError: '',
            attributeOptions: [{ name: 'dexterity', label: 'Dexterity' }, { name: 'wisdom', label: 'Wisdom' }],
            modSettingFields: [{ namespace: 'modules', key: 'slotTypes', label: 'Slot types', type: 'array', defaultValue: [{ id: 'module', label: 'Module', description: 'Default' }] }]
        }) });
        if (pathname === '/api/settings/current') return route.fulfill({ json: { success: true, setting: profile } });
        if (pathname === '/api/settings') return route.fulfill({ json: { success: true, settings: [profile] } });
        if (pathname === '/api/settings/load' && method === 'POST') return route.fulfill({ json: { success: true } });
        if (pathname === '/api/settings/fill-missing' && method === 'POST') { fillRequests.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true, setting: {} } }); }
        if (pathname === '/api/settings/isolated-world' && method === 'PUT') {
            profile = { ...profile, ...route.request().postDataJSON(), id: profile.id };
            saves.push(profile.npcNamingGuidance);
            return route.fulfill({ json: { success: true, setting: profile } });
        }
        if (pathname === '/api/settings/isolated-world/save' && method === 'POST') return route.fulfill({ json: { success: true } });
        if (pathname === '/api/settings/isolated-world/apply' && method === 'POST') return route.fulfill({ json: { success: true, setting: profile } });
        if (method === 'GET' && ['/api/comfyui/workflow-options', '/api/image-workflow-presets', '/api/pending-load'].includes(pathname)) {
            return route.fulfill({ json: { success: true, workflows: [], presets: [], pending: false } });
        }
        if (pathname.startsWith('/api/')) { blocked.push(`${method} ${pathname}`); return route.fulfill({ status: 404, json: { success: false } }); }
        const asset = path.resolve(root, 'public', `.${pathname}`);
        if (asset.startsWith(path.join(root, 'public') + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
            const type = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            return route.fulfill({ contentType: type, body: fs.readFileSync(asset) });
        }
        return route.fulfill({ status: 404, body: 'Not found' });
    });
    await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#settingsCalendarYearName')).toHaveValue('Fixture Era');
    await expect(page.locator('.settings-calendar-month-row')).toHaveCount(1);
    await expect(page.getByText(/Could not load current setting:/)).toHaveCount(0);
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    const moduleRow = page.locator('.modules-slot-types-editor__row');
    await expect(moduleRow.locator('[data-module-slot-type-id]')).toHaveValue('scope');
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const issues = await moduleRow.evaluate(row => {
            const root = row.getBoundingClientRect();
            const elements = [...row.querySelectorAll('label, input, button')].filter(el => el.getClientRects().length);
            const boxes = elements.map(el => ({ el, r: el.getBoundingClientRect() }));
            const problems = [];
            for (const { el, r } of boxes) if (r.left < root.left - 1 || r.right > root.right + 1) problems.push(`${el.tagName} outside row`);
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                if (!a.el.contains(b.el) && !b.el.contains(a.el) && Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1) problems.push(`${a.el.tagName} overlaps ${b.el.tagName}`);
            }
            return problems;
        });
        expect(issues).toEqual([]);
    }
    await moduleRow.locator('[data-module-slot-type-label]').fill('Edited scope');
    const field = page.getByLabel('NPC Naming Guidance');
    await expect(field).toHaveValue('Existing moon names');
    await field.fill('Names from the stars\nNo titles');
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toBe('Names from the stars\nNo titles');
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    await expect(field).toHaveValue('Names from the stars\nNo titles');
    await field.fill('');
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]).toBe('');
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    await expect(field).toHaveValue('');
    profile.defaultStartMonth = 1; profile.defaultStartDay = 31;
    profile.calendarDefinition = { yearName: 'Fixture Era', months: [{ name: 'Dawn', lengthDays: 30, seasonName: 'Missing season' }], weekdays: ['Firstday'], seasons: [], holidays: [{ name: 'Old festival', month: 'Dawn', day: 31 }] };
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="defaults"]').click();
    await expect(page.locator('#defaultStartDay')).toHaveValue('');
    await expect(page.locator('#defaultStartDay option:checked')).toBeDisabled();
    await page.locator('#defaultStartDay').selectOption('30');
    await page.locator('[data-editor-tab="calendar"]').click();
    await expect(page.locator('.settings-calendar-month-season option:checked')).toHaveText('Missing season (missing)');
    await page.locator('#settingsCalendarSubTabHolidays').click();
    await expect(page.locator('.settings-calendar-holiday-day option:checked')).toHaveText('31 (outside month)');
    await page.locator('#settingsCalendarSubTabMonths').click();
    await page.locator('.settings-calendar-month-length').fill('31');
    await page.locator('#settingsCalendarSubTabHolidays').click();
    await expect(page.locator('.settings-calendar-holiday-day option:checked')).toHaveText('31');
    await page.locator('#settingsCalendarSubTabMonths').click();
    await page.locator('.settings-calendar-month-length').fill('30');
    await page.locator('#settingsCalendarSubTabHolidays').click();
    await expect(page.locator('.settings-calendar-holiday-day option:checked')).toHaveText('31 (outside month)');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#settingsCalendarStatus')).toContainText('references a missing season');
    expect(saves).toHaveLength(2);
    await page.locator('#settingsCalendarClearBtn').click();
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(3);
    expect(profile.calendarDefinition).toBeNull();
    await page.locator('#selectedEditBtn').click();
    const fill = page.locator('#generateBtn'), guidance = page.locator('#autofillInstructionsModal');
    await fill.click(); await expect(guidance).toBeVisible();
    await page.locator('#autofillInstructionsInput').fill('Draft guidance');
    await page.keyboard.press('Escape'); await expect(guidance).toBeHidden();
    expect(fillRequests).toHaveLength(0);
    await fill.click(); await page.locator('#autofillInstructionsInput').fill('Keep coastal details');
    await page.locator('#autofillInstructionsConfirmBtn').click();
    await expect(guidance).toBeHidden(); await expect.poll(() => fillRequests.length).toBe(1);
    expect(fillRequests[0].instructions).toBe('Keep coastal details');
    expect(profile.modSettings.modules.slotTypes).toEqual([{ id: 'scope', label: 'Edited scope', description: 'Optics' }]);
    expect(blocked).toEqual([]);
});

test('Worlds rejects malformed saved module slot configuration without replacing it or saving', async ({ page }) => {
    const profile = { id: 'broken-world', name: 'Broken World', theme: 'Fantasy', genre: 'Adventure', modSettings: { modules: { slotTypes: '{broken json' } } };
    const writes = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url()), pathname = decodeURIComponent(url.pathname), method = route.request().method();
        if (url.origin !== origin) return route.abort();
        if (pathname === '/settings') return route.fulfill({ contentType: 'text/html', body: env.render('settings.njk', {
            title: 'World Profiles', unifiedTonalScaleDefinition: {}, unifiedTonalScaleError: '', attributeOptions: [],
            modSettingFields: [{ namespace: 'modules', key: 'slotTypes', label: 'Slot types', type: 'array', defaultValue: [{ id: 'module', label: 'Module' }] }]
        }) });
        if (pathname === '/api/settings/current') return route.fulfill({ json: { success: true, setting: profile } });
        if (pathname === '/api/settings') return route.fulfill({ json: { success: true, settings: [profile] } });
        if (pathname.startsWith('/api/') && method !== 'GET') { writes.push(`${method} ${pathname}`); return route.fulfill({ json: { success: true } }); }
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, workflows: [], presets: [], pending: false } });
        const asset = path.resolve(root, 'public', `.${pathname}`);
        if (asset.startsWith(path.join(root, 'public') + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(asset) });
        return route.fulfill({ status: 404, body: 'Not found' });
    });
    await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
    const feedback = page.locator('dialog.page-feedback-dialog');
    await expect(feedback).toContainText('modSettings.modules.slotTypes');
    await expect(feedback).toContainText('Expected a JSON array of slot-type records');
    const raw = page.locator('#modSetting_modules_slotTypes');
    await expect(raw).toHaveValue(JSON.stringify('{broken json'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
        const field = document.querySelector('#modSetting_modules_slotTypes');
        field.value = '{broken json';
        try { renderModulesSlotTypesEditor(field); } catch (error) { window.fixtureModuleSyntaxError = { message: error.message, cause: error.cause?.message }; }
    });
    await expect(feedback).toContainText('modSettings.modules.slotTypes');
    const syntaxError = await page.evaluate(() => window.fixtureModuleSyntaxError);
    expect(syntaxError.cause).toBeTruthy();
    expect(syntaxError.message).toContain(syntaxError.cause);
    await expect(raw).toHaveValue('{broken json');
    await page.keyboard.press('Escape');
    await page.locator('#submitBtn').evaluate(formButton => formButton.click());
    await expect(raw).toHaveValue('{broken json');
    expect(writes.filter(write => write !== 'POST /api/settings/load')).toEqual([]);
});
