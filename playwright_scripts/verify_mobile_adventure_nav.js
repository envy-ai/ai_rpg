const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7777';
const SHOT_DIR = path.join(ROOT, 'tmp/mobile-theme');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function fetchPage(url) {
    return new Promise((resolve, reject) => http.get(url, response => {
        let html = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { html += chunk; });
        response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
            ? resolve(html) : reject(new Error(`GET ${url} returned HTTP ${response.statusCode}`)));
    }).on('error', reject));
}

function latestNavigation() {
    const template = fs.readFileSync(path.join(ROOT, 'views/index.njk'), 'utf8');
    const start = template.indexOf('<nav class="mobile-adventure-primary-nav"');
    const end = template.indexOf('</nav>\n\n            <div class="tab-panels">', start);
    assert(start >= 0 && end >= 0, 'Could not extract current mobile Adventure navigation from index.njk.');
    return template.slice(start, end + 6);
}

function fixture(html) {
    const scriptless = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
    assert(!/<script\b/i.test(scriptless), 'Fixture contains executable scripts.');
    const withoutOldNav = scriptless.replace(/\s*<nav\b[^>]*\bid=(?:"|')mobileAdventure(?:PrimaryNav|LocationSubnav|PlayerSubnav)(?:"|')[^>]*>[\s\S]*?<\/nav>/gi, '');
    return withoutOldNav.replace('</head>', `<base href="${BASE_URL}/">\n</head>`);
}

function dockContent(mode) {
    if (mode === 'collapsed') return '<div class="prompt-progress-bar prompt-progress-bar--aggregate"><div class="prompt-progress-bar__fill" style="width:42%"></div></div>';
    if (mode === 'one-line') return '<div class="prompt-progress-dock__content"><div class="prompt-progress-dock__one-line-row"><div class="prompt-progress-dock__one-line-fill" style="width:42%"></div><div class="prompt-progress-dock__one-line-content"><span class="prompt-progress-dock__one-line-label">Example prompt</span><span class="prompt-progress-dock__one-line-stat">42 chars</span><span class="prompt-progress-dock__one-line-percent">~42%</span><div class="prompt-progress-dock__mode-controls"><button class="prompt-progress-dock__mode-button"></button><button class="prompt-progress-dock__mode-button"></button></div></div></div></div>';
    return '<div class="prompt-progress-dock__header"><div class="prompt-progress-dock__meta"><span class="prompt-progress-dock__title">AI Prompts</span></div></div><div class="prompt-progress-dock__content"><div class="prompt-progress-table-wrap"><table class="prompt-progress-table"><thead><tr><th>Actions</th><th>Prompt</th><th>Progress</th></tr></thead><tbody><tr><td></td><td>Example prompt</td><td>42%</td></tr><tr><td></td><td>Another prompt</td><td>17%</td></tr></tbody></table></div></div>';
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const html = fixture(await fetchPage(`${BASE_URL}/`));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.evaluate(markup => document.querySelector('.tab-bar').insertAdjacentHTML('afterend', markup), latestNavigation());
        for (const id of ['mobileAdventurePrimaryNav', 'mobileAdventureLocationSubnav', 'mobileAdventurePlayerSubnav']) {
            assert(await page.locator(`#${id}`).count() === 1, `Fixture has duplicate or missing #${id}.`);
        }
        await page.evaluate(content => {
            const dock = document.getElementById('promptProgressDock');
            if (!dock) throw new Error('Static Play fixture is missing #promptProgressDock.');
            dock.classList.remove('prompt-progress-dock--collapsed', 'prompt-progress-dock--table');
            dock.classList.add('prompt-progress-dock--one-line');
            dock.innerHTML = content;
        }, dockContent('one-line'));
        await page.addStyleTag({ url: `${BASE_URL}/css/main.css` });
        await page.addScriptTag({ url: `${BASE_URL}/js/mobile-adventure-nav.js` });
        await page.waitForTimeout(100);

        const state = () => page.evaluate(() => {
            const root = document.querySelector('body > .container');
            const adventure = document.querySelector('.adventure-content');
            const dock = document.getElementById('promptProgressDock');
            const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
            const showing = selector => { const e = document.querySelector(selector); const r = e.getBoundingClientRect(); return !e.hidden && getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; };
            return {
                data: { primary: adventure.dataset.mobileAdventurePane, location: adventure.dataset.mobileLocationPane, player: adventure.dataset.mobilePlayerPane },
                content: Object.fromEntries(['location:.location-block', 'chat:.chat-container', 'player:.chat-player-section', 'party:.chat-party-section', 'trackers:.chat-trackers-section', 'npcs:.location-npcs', 'things:.location-things'].map(value => { const [key, selector] = value.split(':'); return [key, showing(selector)]; })),
                nav: { global: box('.tab-bar'), primary: box('#mobileAdventurePrimaryNav'), location: box('#mobileAdventureLocationSubnav'), player: box('#mobileAdventurePlayerSubnav') },
                navHidden: ['mobileAdventurePrimaryNav', 'mobileAdventureLocationSubnav', 'mobileAdventurePlayerSubnav'].map(id => document.getElementById(id).hidden),
                dock: { parent: dock.parentElement === root, count: document.querySelectorAll('#promptProgressDock').length, position: getComputedStyle(dock).position, z: Number(getComputedStyle(dock).zIndex), ...box('#promptProgressDock') },
                measure: { dock: Number.parseFloat(root.style.getPropertyValue('--mobile-play-dock-height')), padding: Number.parseFloat(getComputedStyle(root).paddingBottom) },
                counts: Object.fromEntries(Array.from(document.querySelectorAll('[data-mobile-count]')).map(e => [e.dataset.mobileCount, e.textContent]))
            };
        });
        const checkDock = async (label) => {
            const s = await state();
            assert(s.dock.parent && s.dock.count === 1, `${label}: dock identity/root placement changed.`);
            assert(s.dock.position === 'fixed' && Math.abs(s.dock.bottom - 844) <= 1, `${label}: dock is not fixed at viewport bottom.`);
            assert(Math.abs(s.measure.dock - s.dock.height) <= 1 && s.measure.padding >= s.dock.height - 1, `${label}: dock measurement or bottom inset is wrong.`);
        };

        await page.evaluate(() => {
            const host = document.getElementById('locationNPCs');
            host.replaceChildren();
            [false, false, true].forEach(hidden => {
                const card = document.createElement('button'); card.className = 'entity-card'; card.hidden = hidden;
                card.addEventListener('click', () => { card.dataset.listenerKept = 'yes'; }); host.append(card);
            });
            const dock = document.getElementById('promptProgressDock');
            dock.addEventListener('verify-listener', () => { dock.dataset.listenerKept = 'yes'; });
            [['locationItemsCount', '2'], ['locationSceneryCount', '3'], ['chatPartyCount', '2'], ['chatTrackersCount', '0']].forEach(([id, count]) => { const element = document.getElementById(id); element.dataset.visibleCount = count; element.textContent = count; });
        });
        await page.waitForTimeout(60);
        assert(JSON.stringify((await state()).counts) === JSON.stringify({ npcs: '2', items: '2', scenery: '3', party: '2', trackers: '0' }), 'Initial count rendering failed.');
        assert(await page.locator('[data-mobile-count]').evaluateAll(nodes => nodes.every(node => !node.closest('button').disabled)), 'A zero-count tab was disabled.');
        await page.evaluate(() => [['locationItemsCount', '0'], ['locationSceneryCount', '0'], ['chatPartyCount', '0']].forEach(([id, count]) => { const element = document.getElementById(id); element.dataset.visibleCount = count; element.textContent = count; }));
        await page.waitForTimeout(60);
        assert(JSON.stringify((await state()).counts) === JSON.stringify({ npcs: '2', items: '0', scenery: '0', party: '0', trackers: '0' }), 'Live zero-count rendering failed.');
        await page.evaluate(() => [['locationItemsCount', '2'], ['locationSceneryCount', '3'], ['chatPartyCount', '2']].forEach(([id, count]) => { const element = document.getElementById(id); element.dataset.visibleCount = count; element.textContent = count; }));
        await page.waitForTimeout(60);

        const views = [
            ['button[data-mobile-location-pane="general"]', { primary: 'location', location: 'general', player: 'player' }, { location: true, chat: false, player: false, party: false, trackers: false, npcs: false, things: false }],
            ['button[data-mobile-location-pane="npcs"]', { primary: 'location', location: 'npcs', player: 'player' }, { location: true, chat: false, player: false, party: false, trackers: false, npcs: true, things: false }],
            ['button[data-mobile-location-pane="things"]', { primary: 'location', location: 'things', player: 'player' }, { location: true, chat: false, player: false, party: false, trackers: false, npcs: false, things: true }],
            ['button[data-mobile-adventure-pane="chat"]', { primary: 'chat', location: 'things', player: 'player' }, { location: false, chat: true, player: false, party: false, trackers: false, npcs: false, things: false }],
            ['button[data-mobile-adventure-pane="player-party"]', { primary: 'player-party', location: 'things', player: 'player' }, { location: false, chat: false, player: true, party: false, trackers: false, npcs: false, things: false }],
            ['button[data-mobile-player-pane="party"]', { primary: 'player-party', location: 'things', player: 'party' }, { location: false, chat: false, player: false, party: true, trackers: false, npcs: false, things: false }],
            ['button[data-mobile-player-pane="trackers"]', { primary: 'player-party', location: 'things', player: 'trackers' }, { location: false, chat: false, player: false, party: false, trackers: true, npcs: false, things: false }]
        ];
        for (const [selector, data, content] of views) {
            await page.locator(selector).click(); await page.waitForTimeout(40);
            const s = await state();
            assert(JSON.stringify(s.data) === JSON.stringify(data), `Wrong selected data after ${selector}.`);
            assert(JSON.stringify(s.content) === JSON.stringify(content), `Wrong visible content after ${selector}: ${JSON.stringify(s.content)}`);
            await checkDock(selector);
        }
        let s = await state();
        assert(!s.navHidden[2] && s.nav.player.height > 0 && s.nav.player.height < s.nav.primary.height, 'Player & Party did not show a smaller three-tab subnavigation row.');
        await page.locator('button[data-mobile-player-pane="trackers"]').focus(); await page.keyboard.press('ArrowLeft');
        assert(await page.locator('button[data-mobile-player-pane="party"]').evaluate(button => document.activeElement === button && button.getAttribute('aria-selected') === 'true'), 'ArrowLeft did not select and focus Party.');
        await page.locator('button[data-mobile-adventure-pane="location"]').click(); await page.locator('button[data-mobile-location-pane="npcs"]').click();
        await page.locator('#locationNPCs .entity-card').first().click();
        assert(await page.locator('#locationNPCs .entity-card').first().evaluate(card => card.dataset.listenerKept === 'yes'), 'Panel switch replaced an existing card listener.');
        assert(await page.evaluate(() => { const dock = document.getElementById('promptProgressDock'); dock.dispatchEvent(new Event('verify-listener')); return dock.dataset.listenerKept === 'yes'; }), 'Panel switch replaced dock listener.');

        const beforeScroll = await state(); await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(40); const afterScroll = await state();
        assert(['global', 'primary', 'location'].every(key => Math.abs(beforeScroll.nav[key].top - afterScroll.nav[key].top) <= 1), 'Fixed navigation moved during scroll.');
        await checkDock('scroll');
        for (const mode of ['collapsed', 'one-line', 'table']) {
            await page.evaluate(({ mode, content }) => { const dock = document.getElementById('promptProgressDock'); dock.className = `prompt-progress-dock prompt-progress-dock--${mode}`; dock.innerHTML = content; }, { mode, content: dockContent(mode) });
            await page.waitForTimeout(60); await checkDock(`dock ${mode}`);
        }
        await page.evaluate(content => {
            window.scrollTo(0, 0);
            const dock = document.getElementById('promptProgressDock');
            dock.className = 'prompt-progress-dock prompt-progress-dock--one-line';
            dock.innerHTML = content;
        }, dockContent('one-line'));
        await page.waitForTimeout(60);
        await page.locator('button[data-mobile-adventure-pane="location"]').click(); await page.locator('button[data-mobile-location-pane="general"]').click();
        await page.screenshot({ path: path.join(SHOT_DIR, 'mobile-adventure-live-location.png') });
        await page.locator('button[data-mobile-location-pane="npcs"]').click(); await page.screenshot({ path: path.join(SHOT_DIR, 'mobile-adventure-live-npc.png') });
        await page.locator('button[data-mobile-adventure-pane="player-party"]').click(); await page.screenshot({ path: path.join(SHOT_DIR, 'mobile-adventure-live-playerparty.png') });
        await page.locator('button[data-mobile-adventure-pane="chat"]').click(); await page.screenshot({ path: path.join(SHOT_DIR, 'mobile-adventure-live-chat.png') });

        await page.evaluate(() => { const backdrop = document.createElement('div'); backdrop.id = 'verifyBackdrop'; backdrop.className = 'modal-backdrop'; backdrop.style.zIndex = '900'; document.body.append(backdrop); });
        const layer = await page.evaluate(() => { const backdrop = document.getElementById('verifyBackdrop'); return { hit: document.elementFromPoint(10, 120) === backdrop, backdrop: Number(getComputedStyle(backdrop).zIndex), global: Number(getComputedStyle(document.querySelector('.tab-bar')).zIndex), primary: Number(getComputedStyle(document.querySelector('#mobileAdventurePrimaryNav')).zIndex), dock: Number(getComputedStyle(document.querySelector('#promptProgressDock')).zIndex) }; });
        assert(layer.hit && layer.backdrop > layer.global && layer.backdrop > layer.primary && layer.backdrop > layer.dock, `Modal layering failed: ${JSON.stringify(layer)}`);
        await page.locator('#verifyBackdrop').evaluate(node => node.remove());
        await page.evaluate(() => { document.getElementById('tab-adventure').classList.remove('active'); document.getElementById('tab-adventure').hidden = true; document.getElementById('tab-map').classList.add('active'); document.getElementById('tab-map').hidden = false; }); await page.waitForTimeout(60);
        s = await state(); assert(s.navHidden.every(Boolean), 'A global non-Adventure tab left local Adventure navigation visible.'); await checkDock('non-Adventure tab');
        await page.setViewportSize({ width: 541, height: 844 }); await page.waitForTimeout(80);
        const restored = await page.evaluate(() => { const dock = document.getElementById('promptProgressDock'); const spinner = document.getElementById('chatSpinnerStatusBar'); return { chatParent: dock.parentElement === document.querySelector('.chat-container'), position: getComputedStyle(dock).position, beforeSpinner: !spinner || dock.nextElementSibling === spinner, nav: getComputedStyle(document.getElementById('mobileAdventurePrimaryNav')).display, inline: document.querySelector('body > .container').style.cssText }; });
        assert(restored.chatParent && restored.position === 'static' && restored.beforeSpinner && restored.nav === 'none' && !restored.inline.includes('--mobile-play-dock-height'), `541px restoration failed: ${JSON.stringify(restored)}`);
        await page.setViewportSize({ width: 1280, height: 844 }); await page.waitForTimeout(60);
        const desktop = await page.evaluate(() => ({ parent: document.getElementById('promptProgressDock').parentElement === document.querySelector('.chat-container'), position: getComputedStyle(document.getElementById('promptProgressDock')).position, nav: getComputedStyle(document.getElementById('mobileAdventurePrimaryNav')).display }));
        assert(desktop.parent && desktop.position === 'static' && desktop.nav === 'none', `1280px restoration failed: ${JSON.stringify(desktop)}`);
        console.log('mobile Adventure navigation verification passed');
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
