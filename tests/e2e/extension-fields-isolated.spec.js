const path = require('node:path');
const { test, expect } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..');

test('extension fields preserve zero, false, empty collections and typed validation', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><div id="fields"></div>');
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/extension-field-editor.js') });
    await page.evaluate(() => {
        window.editor = new window.ExtensionFieldEditor(document.querySelector('#fields'), { idPrefix: 'fixture-', inputClass: 'fixture-input', inputTypeFor: field => field.type === 'boolean' ? 'checkbox' : field.type === 'number' || field.type === 'integer' ? 'number' : 'textarea' });
        window.editor.render([{ fieldName: 'enabled', type: 'boolean', edit: { label: 'Enabled' } }, { fieldName: 'count', type: 'integer', edit: { label: 'Count' } }, { fieldName: 'entries', type: 'array', edit: { label: 'Entries' } }, { fieldName: 'options', type: 'object', edit: { label: 'Options' } }, { fieldName: 'notes', type: 'string', edit: { label: 'Notes' } }], { enabled: false, count: 0, entries: [], options: {}, notes: '' });
    });
    expect(await page.evaluate(() => window.editor.collect())).toEqual({ enabled: false, count: 0, entries: [], options: {}, notes: null });
    await page.getByLabel('Entries').fill('{"bad":true}');
    expect(await page.evaluate(() => { try { window.editor.collect(); return ''; } catch (error) { return error.message; } })).toMatch(/entries.*array/i);
    await page.evaluate(() => { window.editor.destroy(); window.editor.destroy(); });
    expect(errors).toEqual([]);
});
