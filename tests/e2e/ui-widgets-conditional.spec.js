const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://conditional-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><select id="choice"><option value="known">Known</option><option value="other">Other</option></select><input id="other"><input id="secret" type="password" value="retained-secret"><button id="toggle">Reveal</button><input id="field">' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('native field state, Other entry and secret reveal preserve values and release handlers', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { setFieldState, OtherEntry, bindSecretToggle } = await import('/src/index.js');
        const field = document.querySelector('#field'), select = document.querySelector('#choice'), input = document.querySelector('#other');
        field.value = 'retained'; field.required = true; setFieldState(field, { disabled: true });
        const explicit = { value: field.value, required: field.required, disabled: field.disabled };
        const owner = new OtherEntry(select, input, { otherValue: 'other', enabled: true });
        select.value = 'other'; select.dispatchEvent(new Event('change')); const focused = document.activeElement === input;
        input.value = 'Custom value'; select.value = 'known'; select.dispatchEvent(new Event('change'));
        const hidden = input.hidden || input.style.display === 'none';
        select.value = 'other'; select.dispatchEvent(new Event('change')); const restored = input.value;
        document.querySelector('#toggle').focus(); owner.setEnabled(false); select.dispatchEvent(new Event('change')); const locked = input.disabled, stoleFocus = document.activeElement === input;
        owner.destroy(); owner.setEnabled; select.value = 'known'; select.dispatchEvent(new Event('change')); const afterDestroy = input.disabled;
        const secret = document.querySelector('#secret'), toggle = document.querySelector('#toggle');
        const dispose = bindSecretToggle(secret, toggle, { onChange: visible => { toggle.setAttribute('aria-label', visible ? 'Hide secret' : 'Show secret'); } }); toggle.click(); const revealed = secret.type === 'text' && toggle.getAttribute('aria-pressed') === 'true';
        toggle.click(); const concealed = secret.type === 'password' && toggle.getAttribute('aria-pressed') === 'false';
        dispose(); toggle.click();
        let rejected = false; try { setFieldState(document.createElement('div'), { required: true }); } catch (error) { rejected = error instanceof TypeError; }
        const iframe = document.createElement('iframe'); document.body.append(iframe); const foreign = iframe.contentDocument.createElement('input');
        let crossDocument = false; try { new OtherEntry(select, foreign, { otherValue: 'other', enabled: true }); } catch (error) { crossDocument = error instanceof TypeError; } iframe.remove();
        return { crossDocument, explicit, focused, hidden, restored, locked, stoleFocus, afterDestroy, revealed, concealed, finalType: secret.type, secret: secret.value, rejected };
    });
    expect(result).toEqual({ crossDocument: true, explicit: { value: 'retained', required: true, disabled: true }, focused: true, hidden: true, restored: 'Custom value', locked: true, stoleFocus: false, afterDestroy: true, revealed: true, concealed: true, finalType: 'password', secret: 'retained-secret', rejected: true });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
