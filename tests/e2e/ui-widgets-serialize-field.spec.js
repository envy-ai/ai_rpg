const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://field-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="fields"></div>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('field serialization reflects current native state without changing live defaults', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { createField, serializeField } = await import('/src/index.js');
        const text = createField({ document, label: 'Text <&>', type: 'textarea', value: 'original' });
        text.input.defaultValue = 'original';
        text.input.value = '\nLine <one> & "two"\nnext'; text.input.readOnly = true;
        const number = createField({ document, label: 'Number', type: 'number', value: null }); number.input.value = '0';
        const boolean = createField({ document, label: 'Boolean', type: 'checkbox' }); boolean.input.checked = false;
        const checked = createField({ document, label: 'Checked', type: 'checkbox' }); checked.input.checked = true;
        const choice = createField({ document, label: 'Choice', type: 'select' });
        for (const value of ['known', 'unknown<&>']) { const option = document.createElement('option'); option.value = value; option.textContent = value; choice.input.append(option); }
        choice.input.value = 'unknown<&>'; choice.input.disabled = true;
        const values = [text, number, boolean, checked, choice].map(serializeField);
        const invalid = createField({ document, label: 'Invalid select', type: 'select' });
        invalid.input.append(document.createElement('option')); invalid.input.selectedIndex = -1;
        let invalidError = ''; try { serializeField(invalid); } catch (error) { invalidError = error.message; }
        const container = document.createElement('div'); container.innerHTML = values.join('');
        const [copyText, copyNumber, copyBoolean, copyChecked, copyChoice] = container.querySelectorAll('textarea, input, select');
        return { invalidError, text: copyText.value, readonly: copyText.readOnly, number: copyNumber.value, checked: copyBoolean.checked, trueChecked: copyChecked.checked, selected: copyChoice.value, disabled: copyChoice.disabled, label: container.querySelector('label').textContent, originalTextDefault: text.input.defaultValue, originalNumberDefault: number.input.defaultValue, originalCheckedDefault: boolean.input.defaultChecked, originalChoiceDefaults: [...choice.input.options].map(option => option.defaultSelected) };
    });
    expect(result.invalidError).toMatch(/select/i); delete result.invalidError;
    expect(result).toEqual({ text: '\nLine <one> & "two"\nnext', readonly: true, number: '0', checked: false, trueChecked: true, selected: 'unknown<&>', disabled: true, label: 'Text <&>', originalTextDefault: 'original', originalNumberDefault: '', originalCheckedDefault: false, originalChoiceDefaults: [false, false] });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
