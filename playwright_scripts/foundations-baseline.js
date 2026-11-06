const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

(async () => {
    const root = path.resolve(__dirname, '..');
    const cssRoot = path.join(root, process.argv[2] || 'tmp/foundations-baseline');
    const output = path.join(root, process.argv[3] || 'tmp/foundations-baseline/metrics.json');
    const styles = ['main.css', 'settings.css', 'page-feedback.css', 'story-editor.css', 'story-authoring.css'];
    const fixtures = {
        main: `<div class="favorites-panel"><div class="form-group"><label for="a">Label</label><input id="a" value="value"><small class="help-text">Help</small></div><button class="button">Button</button><button class="btn" disabled>Disabled</button><button class="thing-list-panel__icon-toggle">Icon</button><div class="data-table-scroll"><table class="data-table"><tr><th>Label</th><td>Long text value</td></tr></table></div><span class="techniques-badge">Badge</span></div>`,
        settings: `<section class="settings-library-panel"><div class="library-control"><label for="b">Label</label><input id="b" value="value"></div><div class="form-group"><label for="c">Label</label><input id="c" readonly value="value"><small class="help-text">Help</small></div><span class="setting-badge">Applied</span><button class="btn">Button</button></section>`,
        stories: `<div class="stories"><section class="stories__panel"><label for="d">Label</label><input id="d" value="value"><span class="stories__badge">Badge</span><button class="btn">Button</button></section></div><div class="story-authoring"><div class="form-group"><label for="e">Notes</label><textarea id="e">Value</textarea></div></div>`,
        feedback: `<dialog class="page-feedback-dialog" open><button>Close</button></dialog>`
    };
    const cssFor = { main: ['main.css'], settings: ['main.css', 'settings.css'], stories: ['main.css', 'story-editor.css', 'story-authoring.css'], feedback: ['page-feedback.css'] };
    const browser = await chromium.launch({ headless: true });
    const results = {};
    try {
        for (const [name, html] of Object.entries(fixtures)) {
            const page = await browser.newPage();
            await page.route('**/*', route => route.abort());
            await page.setContent(`<!doctype html><html><head>${cssFor[name].map(file => `<style>${fs.readFileSync(path.join(cssRoot, file), 'utf8')}</style>`).join('')}<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style></head><body>${html}</body></html>`);
            await page.evaluate(() => document.fonts.ready);
            for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 800 });
                results[`${name}-${width}`] = await page.evaluate(() => [...document.querySelectorAll('body *')].map(element => {
                    const style = getComputedStyle(element), box = element.getBoundingClientRect();
                    return { tag: element.tagName, class: element.className, id: element.id, display: style.display, justify: style.justifyContent, align: style.alignItems, gap: style.gap, padding: style.padding, border: style.border, radius: style.borderRadius, font: style.font, color: style.color, background: style.backgroundColor, shadow: style.boxShadow, width: box.width, height: box.height };
                }));
                results[`${name}-${width}-focus`] = await page.evaluate(() => [...document.querySelectorAll('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')].map(element => {
                    element.focus(); const style = getComputedStyle(element);
                    return { id: element.id, class: element.className, outline: style.outline, outlineOffset: style.outlineOffset, shadow: style.boxShadow, color: style.color, background: style.backgroundColor };
                }));
                await page.screenshot({ path: path.join(path.dirname(output), `${name}-${width}.png`), fullPage: true });
            }
            await page.close();
        }
        fs.writeFileSync(output, JSON.stringify(results, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
