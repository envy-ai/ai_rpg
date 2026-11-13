const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
let fixtureServer;
let fixtureUrl;

function contrastRatio(foreground, background) {
    const channels = value => {
        const match = String(value).match(/rgba?\(([^)]+)\)/);
        if (!match) throw new Error(`Could not parse computed color ${value}.`);
        const [red, green, blue, alpha = '1'] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { channels: [red, green, blue], alpha };
    };
    const foregroundColor = channels(foreground);
    const backgroundColor = channels(background);
    const composited = foregroundColor.channels.map((channel, index) => channel * foregroundColor.alpha + backgroundColor.channels[index] * (1 - foregroundColor.alpha));
    const luminance = rgb => rgb.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const first = luminance(composited), second = luminance(backgroundColor.channels);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.beforeAll(async () => {
    fs.mkdirSync(path.join(ROOT, 'tmp', 'techniques-ui-review'), { recursive: true });
    fixtureServer = http.createServer((request, response) => {
        if (request.url !== '/') {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Technique editor fixture</title></head><body><main class="container"><section class="config-section npc-view-section" id="playerTechniquesSection"></section></main></body></html>');
    });
    await new Promise(resolve => fixtureServer.listen(0, '0.0.0.0', resolve));
    fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/`;
});

test.afterAll(async () => {
    if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
});

test('player discipline chooser groups techniques, inserts at the cursor, cycles with T, and ignores typing fields', async ({ page }) => {
    const groups = [
        { id: 'discipline-a', name: 'Arcana', entries: [
            { techniqueId: 'mend', name: 'Mend', description: 'Restores health.', disciplineId: 'discipline-a', disciplineName: 'Arcana', selectedSourceId: 'learned:mend', sources: [{ sourceId: 'learned:mend', sourceKind: 'learned', definitionRevision: 1, available: true, costs: [], mechanics: { target: { kind: 'self' }, effects: [{ kind: 'healing', amount: 24 }] } }] },
            { techniqueId: 'ward', name: 'Ward', description: 'Raises a ward.', disciplineId: 'discipline-a', disciplineName: 'Arcana', selectedSourceId: null, sources: [
                { sourceId: 'learned:ward', sourceKind: 'learned', definitionRevision: 1, available: true, costs: [{ resource: 'health', amount: 2 }], mechanics: { target: { kind: 'self' }, effects: [{ kind: 'healing', amount: 4 }] } },
                { sourceId: 'grant-lantern', sourceKind: 'equipment', itemName: 'Lantern', definitionRevision: 1, available: true, costs: [{ resource: 'health', amount: 5 }], mechanics: { target: { kind: 'self' }, effects: [{ kind: 'healing', amount: 8 }] } }
            ] }
        ] },
        { id: 'discipline-b', name: 'Fieldcraft', entries: [
            { techniqueId: 'track', name: 'Track', description: 'Follow a trail.', disciplineId: 'discipline-b', disciplineName: 'Fieldcraft', selectedSourceId: 'learned:track', sources: [{ sourceId: 'learned:track', sourceKind: 'learned', definitionRevision: 1, available: true, costs: [], mechanics: { target: { kind: 'self' }, effects: [{ kind: 'summon', summonMode: 'template', lifetimeMinutes: 3 }] } }] }
        ] }
    ];
    await page.route('**/api/techniques**', route => route.fulfill({ json: {
        actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', canUse: true,
        techniques: groups.flatMap(group => group.entries), disciplines: groups.map(({ id, name }) => ({ id, name })), catalog: [], targets: []
    } }));
    await page.goto(fixtureUrl);
    await page.setContent('<input id="messageInput" value="before after"><section class="chat-player-section" style="width:320px"><h3 class="chat-sidebar-heading">Player</h3><div class="chat-player-card" id="chatPlayerCard"><div class="chat-player-disciplines" id="chatPlayerDisciplines" aria-label="Technique disciplines"></div></div></section><div id="playerTechniquesModal" class="modal player-techniques-modal" role="dialog" aria-modal="false" aria-hidden="true" hidden><div class="modal__dialog"><header class="modal__header"><h2 id="chooserTitle">Techniques</h2><button class="modal__close" id="chooserClose" aria-label="Close techniques" type="button">X</button></header><div class="modal__body player-techniques-body"><p class="modal__instruction">Choose a technique to insert its name into your action. Costs and availability are advisory; the turn checks the chosen source.</p><div id="playerTechniquesGrid" class="npc-view-ability-cards player-techniques-grid"></div><p class="modeless-chooser-help">Click or press Enter / Space to insert · Esc to close</p></div></div></div>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/modeless-chooser.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/popup-dismissal.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/action-images.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => {
        window.AIRPG_PAGE_FEEDBACK = { showError: error => { throw error; } };
        window.renderEntityImage = async ({ element, altText }) => {
            const image = document.createElement('img');
            image.alt = altText;
            image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="12" fill="%230e7490"/%3E%3Cpath d="M32 8 39 25 56 32 39 39 32 56 25 39 8 32 25 25z" fill="%23a5f3fc"/%3E%3C/svg%3E';
            element.replaceChildren(image);
            return { imageId: 'fixture-icon' };
        };
        const input = document.getElementById('messageInput');
        window.__input = input;
        const chooser = new window.AIRPG_WIDGETS.ModelessChooser({
            root: document.getElementById('playerTechniquesModal'), title: document.getElementById('chooserTitle'),
            closeButton: document.getElementById('chooserClose'),
            insert: text => { const start = input.selectionStart, end = input.selectionEnd; input.setRangeText(text, start, end, 'end'); input.focus(); }
        });
        window.__sidebar = new window.TechniqueSidebar({ root: document.getElementById('chatPlayerDisciplines'), grid: document.getElementById('playerTechniquesGrid'), chooser });
        window.__sidebar.updateActor({ id: 'actor-ui-fixture', name: 'Fixture Actor' });
    });
    const disciplines = page.locator('#chatPlayerDisciplines [data-discipline-id]');
    await expect(disciplines).toHaveCount(2);
    await expect(disciplines.nth(0)).toContainText('Arcana');
    await expect(disciplines.nth(0)).toContainText('2');
    await expect(disciplines.nth(1)).toContainText('Fieldcraft');

    await page.locator('#messageInput').evaluate(input => { input.focus(); input.setSelectionRange(7, 7); });
    await page.keyboard.press('t');
    await expect(page.locator('#playerTechniquesModal')).toBeHidden();
    await page.locator('#messageInput').evaluate(input => { input.value = 'before after'; input.setSelectionRange(7, 7); input.blur(); });
    await page.evaluate(() => { document.body.tabIndex = 0; document.body.focus(); });
    await expect.poll(() => page.evaluate(() => document.activeElement.tagName)).toBe('BODY');
    await page.keyboard.press('t');
    await expect(page.locator('#playerTechniquesModal')).toBeVisible();
    await expect(page.locator('#chooserTitle')).toHaveText('Arcana');
    await expect(page.locator('#playerTechniquesGrid .action-card-content[data-chooser-choice]')).toHaveCount(2);
    await expect(page.locator('#playerTechniquesGrid .action-image-host img[alt="Mend"]')).toBeVisible();
    const ward = page.locator('#playerTechniquesGrid [data-chooser-choice="Ward"]');
    await expect(ward).toContainText('Learned · Cost: 2 health · Effect: healing: 4');
    await expect(ward).toContainText('Equipment Lantern · Cost: 5 health · Effect: healing: 8');
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-ui-review', 'player-techniques-desktop.png') });
    const dialog = page.locator('#playerTechniquesModal .modal__dialog');
    const body = page.locator('#playerTechniquesModal .modal__body');
    const font = await page.locator('#playerTechniquesGrid .action-card-content').first().evaluate(element => getComputedStyle(element).fontFamily);
    expect(font).toContain('Roboto');
    await page.setViewportSize({ width: 390, height: 520 });
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await body.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    await page.locator('#playerTechniquesModal .modeless-chooser-help').scrollIntoViewIfNeeded();
    expect(await page.locator('#playerTechniquesModal').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-ui-review', 'player-techniques-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#playerTechniquesGrid [data-chooser-choice="Mend"]').press('Enter');
    await expect(page.locator('#messageInput')).toHaveValue('before [Mend]after');
    await page.locator('#playerTechniquesGrid [data-chooser-choice="Ward"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#messageInput')).toHaveValue('before [Mend][Ward]after');
    await expect(page.locator('#playerTechniquesModal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#playerTechniquesModal')).toBeHidden();
    await expect(page.locator('#messageInput')).toBeFocused();
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('t');
    await expect(page.locator('#chooserTitle')).toHaveText('Arcana');
    await expect(page.locator('#playerTechniquesModal')).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.locator('#chooserTitle')).toHaveText('Fieldcraft');
    await expect(page.locator('#playerTechniquesGrid')).toContainText('Track');
    await expect(page.locator('#playerTechniquesGrid')).toContainText('summon template selected at use for 3 world minutes');
    await page.keyboard.press('Escape');
    await page.locator('#messageInput').press('t');
    await expect(page.locator('#playerTechniquesModal')).toBeHidden();
});

test('technique icon menu opens the right editor from the sidebar without inserting a choice', async ({ page }) => {
    const requests = [];
    const mechanics = { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 2 }], acquisitionRequirements: [], useRequirements: [] };
    const learned = { sourceId: 'learned:ward', sourceKind: 'learned', definitionRevision: 1, personalRevision: 1, available: true, costs: [], mechanics };
    const granted = { sourceId: 'grant:ward', sourceKind: 'equipment', itemName: 'Charm', definitionRevision: 1, available: true, costs: [], mechanics };
    const entries = [
        { techniqueId: 'ward', name: 'Ward', description: 'A ward.', disciplineId: 'arts', disciplineName: 'Arts', learned: true, selectedSourceId: granted.sourceId, available: true, sources: [learned, granted] },
        { techniqueId: 'gift', name: 'Gift', description: 'A granted action.', disciplineId: 'arts', disciplineName: 'Arts', learned: false, selectedSourceId: granted.sourceId, available: true, sources: [granted] }
    ];
    await page.route('**/api/techniques**', route => {
        requests.push({ url: route.request().url(), method: route.request().method() });
        return route.fulfill({ json: { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', canUse: true, techniques: entries, disciplines: [{ id: 'arts', name: 'Arts', description: 'Practice.' }], disciplineAccess: [], catalog: entries.map(entry => ({ id: entry.techniqueId, name: entry.name, description: entry.description, disciplineId: 'arts', semanticKey: entry.techniqueId, revisions: [mechanics] })), targets: [], formulaVariables: [] } });
    });
    await page.goto(fixtureUrl);
    await page.setContent('<input id="messageInput" value="unchanged"><div id="disciplines"></div><div id="chooser" class="modal" role="dialog" aria-hidden="true" hidden><div class="modal__dialog"><h2 id="title"></h2><button id="close">Close</button><div id="grid"></div></div></div>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    for (const file of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'widgets/modeless-chooser.js', 'widgets/popup-dismissal.js', 'page-feedback.js', 'formula-evaluator.js', 'technique-formula-variables.js', 'action-images.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', file) });
    await page.evaluate(() => {
        window.renderEntityImage = async () => ({ imageId: null });
        const chooser = new window.AIRPG_WIDGETS.ModelessChooser({ root: document.getElementById('chooser'), title: document.getElementById('title'), closeButton: document.getElementById('close'), insert: text => { document.getElementById('messageInput').value += text; } });
        window.__sidebar = new window.TechniqueSidebar({ root: document.getElementById('disciplines'), grid: document.getElementById('grid'), chooser });
        window.__sidebar.updateActor({ id: 'actor-ui-fixture', name: 'Fixture Actor' });
    });
    await page.locator('#disciplines [data-discipline-id="arts"]').click();
    const card = name => page.locator('#grid .action-card').filter({ hasText: name });
    const menu = card('Ward').locator('.action-image-menu');
    await menu.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('open', '');
    await menu.getByRole('button', { name: 'Edit technique…' }).focus();
    await page.keyboard.press('Enter');
    const personal = page.getByRole('dialog', { name: 'Edit Ward — Fixture Actor' });
    await expect(personal).toBeVisible();
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(page.locator('#messageInput')).toHaveValue('unchanged');
    expect(requests.every(request => request.method === 'GET' && new URL(request.url).searchParams.get('actor') === 'actor-ui-fixture' && new URL(request.url).searchParams.get('catalog') === 'true')).toBe(true);
    await personal.getByRole('button', { name: 'Cancel' }).click();
    const giftMenu = card('Gift').locator('.action-image-menu');
    await giftMenu.locator('summary').click();
    await giftMenu.getByRole('button', { name: 'Edit technique…' }).click();
    const catalog = page.getByRole('dialog', { name: 'Edit catalogue — Gift' });
    await expect(catalog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(catalog).toBeHidden();
    await expect(page.locator('#messageInput')).toHaveValue('unchanged');
    await page.locator('#disciplines .action-image-menu summary').click();
    await expect(page.locator('#disciplines .action-image-menu').getByRole('button', { name: 'Edit technique…' })).toHaveCount(0);
    await expect(page.locator('#disciplines .action-image-menu').getByRole('button', { name: 'Edit discipline…' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.locator('#close').click();
    await page.evaluate(() => { const root = document.createElement('section'); root.id = 'fixture-panel'; document.body.append(root); window.TechniquesPanel.mount(root, { id: 'actor-ui-fixture', name: 'Fixture Actor' }); });
    const panelCard = page.locator('#fixture-panel .techniques-card').filter({ hasText: 'Ward' });
    const panelMenu = panelCard.locator('.action-image-menu');
    await panelMenu.locator('summary').click();
    await panelMenu.getByRole('button', { name: 'Edit technique…' }).click();
    await expect(personal).toBeVisible();
    await expect(panelMenu).not.toHaveAttribute('open', '');
    await personal.getByRole('button', { name: 'Cancel' }).click();
    await expect(panelMenu.locator('summary')).toBeFocused();
});

test('discipline icon opens the clicked discipline editor with the actor baseline and preserves access on save', async ({ page }) => {
    const disciplines = [{ id: 'z', name: 'Zeta', description: 'Zeta lore.' }, { id: 'a', name: 'Alpha', description: 'Alpha lore.' }];
    const access = [{ disciplineId: 'a', provenance: { kind: 'training', reason: 'Prior training.' } }];
    const baseline = { worldId: 'fixture-world', disciplines, disciplineAccess: access };
    const mechanics = { target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 2 }] };
    const techniques = disciplines.map(entry => ({ techniqueId: `tech-${entry.id}`, name: `Technique ${entry.id}`, description: 'Fixture.', disciplineId: entry.id, disciplineName: entry.name, selectedSourceId: `learned:${entry.id}`, sources: [{ sourceId: `learned:${entry.id}`, sourceKind: 'learned', definitionRevision: 1, available: true, costs: [], mechanics }] }));
    const requests = [];
    await page.route('**/api/techniques**', route => {
        const request = route.request();
        requests.push({ url: request.url(), method: request.method(), body: request.postDataJSON() });
        return route.fulfill({ json: { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', disciplines, disciplineAccess: access, disciplineEditContext: baseline, techniques, catalog: [], targets: [], formulaVariables: [], disciplinesChanged: request.method() === 'PUT' } });
    });
    await page.goto(fixtureUrl);
    await page.setContent('<input id="messageInput" value="unchanged"><div id="disciplines"></div><div id="chooser" class="modal" role="dialog" aria-hidden="true" hidden><div class="modal__dialog"><h2 id="title"></h2><button id="close">Close</button><div id="grid"></div></div></div><section id="fixture-panel"></section>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    for (const file of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'widgets/modeless-chooser.js', 'widgets/popup-dismissal.js', 'page-feedback.js', 'action-images.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', file) });
    await page.evaluate(() => {
        window.renderEntityImage = async () => ({ imageId: null });
        const chooser = new window.AIRPG_WIDGETS.ModelessChooser({ root: document.getElementById('chooser'), title: document.getElementById('title'), closeButton: document.getElementById('close'), insert: text => { document.getElementById('messageInput').value += text; } });
        window.__sidebar = new window.TechniqueSidebar({ root: document.getElementById('disciplines'), grid: document.getElementById('grid'), chooser });
        window.__sidebar.updateActor({ id: 'actor-ui-fixture', name: 'Fixture Actor' });
        window.TechniquesPanel.mount(document.getElementById('fixture-panel'), { id: 'actor-ui-fixture', name: 'Fixture Actor' });
    });
    const zetaRow = page.locator('#disciplines .chat-player-discipline-row').filter({ hasText: 'Zeta' });
    const menu = zetaRow.locator('.action-image-menu');
    await menu.locator('summary').focus(); await page.keyboard.press('Enter');
    await menu.getByRole('button', { name: 'Edit discipline…' }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit discipline — Fixture Actor' });
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Zeta');
    await expect(dialog.getByRole('checkbox', { name: 'Alpha · a' })).toBeChecked();
    await dialog.getByLabel('Name', { exact: true }).fill('Updated Zeta');
    await dialog.getByRole('button', { name: 'Save discipline changes' }).click();
    await expect.poll(() => requests.filter(request => request.method === 'PUT').length).toBe(1);
    const saved = requests.find(request => request.method === 'PUT');
    expect(saved.body).toMatchObject({ actorId: 'actor-ui-fixture', edits: [{ id: 'z', name: 'Updated Zeta', description: 'Zeta lore.' }], accessIds: ['a'], expected: baseline });
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => requests.filter(request => request.method === 'GET').length).toBeGreaterThan(2);
    await expect(page.locator('#messageInput')).toHaveValue('unchanged');
    await expect(page.locator('#chooser')).toBeHidden();
    const panelMenu = page.locator('#fixture-panel .techniques-discipline-heading').filter({ hasText: 'Zeta' }).locator('.action-image-menu');
    await panelMenu.locator('summary').click();
    await panelMenu.getByRole('button', { name: 'Edit discipline…' }).click();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Zeta');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panelMenu.locator('summary')).toBeFocused();
});

test('sidebar refreshes current techniques, discards stale actor responses, and leaves an empty player hidden', async ({ page }) => {
    let releaseFirst;
    await page.route('**/api/techniques**', async route => {
        const actor = new URL(route.request().url()).searchParams.get('actor');
        if (actor === 'actor-old') {
            await new Promise(resolve => { releaseFirst = resolve; });
            if (!route.request().failure()) await route.fulfill({ json: { actorId: 'actor-old', catalog: [], techniques: [{ techniqueId: 'old', name: 'Stale', disciplineId: 'old', disciplineName: 'Old', sources: [] }] } });
            return;
        }
        await route.fulfill({ json: { actorId: actor, catalog: [], techniques: actor === 'actor-new' ? [{ techniqueId: 'new', name: 'Current', disciplineId: 'current', disciplineName: 'Current Arts', sources: [] }] : [] } });
    });
    await page.goto(fixtureUrl);
    await page.setContent('<main class="container"><section class="chat-player-section" style="width:320px"><h3 class="chat-sidebar-heading">Player · Adventure</h3><div class="chat-player-card"><div class="chat-player-disciplines" id="chatPlayerDisciplines" aria-label="Technique disciplines"></div></div></section></main><div id="playerTechniquesModal" class="modal player-techniques-modal" role="dialog" aria-modal="false" aria-hidden="true" hidden><div class="modal__dialog"><header class="modal__header"><h2 id="chooserTitle">Techniques</h2><button class="modal__close" id="chooserClose" aria-label="Close techniques"></button></header><div class="modal__body player-techniques-body"><p class="modal__instruction">Choose a technique to insert its name into your action.</p><div id="playerTechniquesGrid" class="npc-view-ability-cards player-techniques-grid"></div></div></div></div>');
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/modeless-chooser.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => {
        window.ActionImages = { create: () => document.createElement('div'), destroyWithin: () => {} };
        const chooser = new window.AIRPG_WIDGETS.ModelessChooser({ root: document.getElementById('playerTechniquesModal'), title: document.getElementById('chooserTitle'), closeButton: document.getElementById('chooserClose'), insert: () => {} });
        window.__sidebar = new window.TechniqueSidebar({ root: document.getElementById('chatPlayerDisciplines'), grid: document.getElementById('playerTechniquesGrid'), chooser });
        window.__sidebar.updateActor({ id: 'actor-old' });
    });
    await page.waitForRequest(request => request.url().includes('actor=actor-old'));
    await page.evaluate(() => window.__sidebar.updateActor({ id: 'actor-new' }));
    await expect(page.locator('#chatPlayerDisciplines [data-discipline-id]')).toHaveCount(1);
    await expect(page.locator('#chatPlayerDisciplines')).toContainText('Current Arts');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('techniques:refresh', { detail: { actorId: 'actor-new' } })));
    await expect(page.locator('#chatPlayerDisciplines [data-discipline-id]')).toHaveCount(1);
    await page.evaluate(() => window.__sidebar.updateActor({ id: 'actor-empty' }));
    await expect(page.locator('#chatPlayerDisciplines')).toBeEmpty();
    expect(await page.evaluate(() => window.__sidebar.chooser.isOpen)).toBe(false);
    if (releaseFirst) { releaseFirst(); releaseFirst = null; }
});

test('technique icons keep one identity, use updated images after refresh, and stop retrying failed loads', async ({ page }) => {
    let imageId = 'icon-before';
    let disciplineImageId = 'discipline-icon-before';
    await page.route('**/api/techniques**', route => route.fulfill({ json: {
        actorId: 'actor-icons', catalog: [],
        disciplines: [{ id: 'discipline-icons', name: 'Fieldcraft', description: 'A practical discipline.' }],
        disciplineIcons: { 'discipline-icons': { imageId: disciplineImageId, imagePrompt: 'A bronze compass.' } },
        techniques: [{ techniqueId: 'icon-technique', name: 'Icon Mend', description: 'A healing action.', disciplineId: 'discipline-icons', disciplineName: 'Fieldcraft', selectedSourceId: 'learned:icon-technique', imageId, imagePrompt: 'A silver leaf.' , sources: [] }]
    } }));
    await page.goto(fixtureUrl);
    await page.setContent('<section class="chat-player-section" style="width:320px"><div class="chat-player-card"><div id="chatPlayerDisciplines"></div></div></section><div id="playerTechniquesModal" hidden aria-hidden="true"><h2 id="chooserTitle"></h2><button id="chooserClose"></button><div id="playerTechniquesGrid"></div></div>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/modeless-chooser.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/popup-dismissal.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/action-images.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => {
        window.__imageCalls = [];
        window.__imageErrors = [];
        window.AIRPG_PAGE_FEEDBACK = { showError: error => window.__imageErrors.push(error.message) };
        window.renderEntityImage = async options => {
            window.__imageCalls.push({ entityType: options.entityType, entityId: options.entityId, imageId: options.imageId });
            if (window.__failTechniqueIcons && options.entityType === 'technique') throw new Error('Icon fixture failed.');
            const image = document.createElement('img');
            image.alt = options.altText || 'Action icon fixture';
            image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="12" fill="%230e7490"/%3E%3Cpath d="M32 8 39 25 56 32 39 39 32 56 25 39 8 32 25 25z" fill="%23a5f3fc"/%3E%3C/svg%3E';
            options.element.replaceChildren(image);
            return { imageId: options.imageId || 'icon-generated' };
        };
        window.__failTechniqueIcons = false;
        const chooser = new window.AIRPG_WIDGETS.ModelessChooser({ root: document.getElementById('playerTechniquesModal'), title: document.getElementById('chooserTitle'), closeButton: document.getElementById('chooserClose'), insert: () => {} });
        window.__sidebar = new window.TechniqueSidebar({ root: document.getElementById('chatPlayerDisciplines'), grid: document.getElementById('playerTechniquesGrid'), chooser });
        window.__sidebar.updateActor({ id: 'actor-icons' });
    });
    await page.locator('#chatPlayerDisciplines [data-discipline-id]').click();
    await expect.poll(() => page.evaluate(() => window.__imageCalls.length)).toBe(2);
    expect(await page.evaluate(() => window.__imageCalls)).toEqual([
        { entityType: 'discipline', entityId: 'discipline-icons', imageId: 'discipline-icon-before' },
        { entityType: 'technique', entityId: 'icon-technique', imageId: 'icon-before' }
    ]);
    const disciplineLayout = await page.locator('#chatPlayerDisciplines [data-discipline-id]').evaluate(button => {
        const icon = button.parentElement.querySelector(':scope > .action-image');
        const host = icon.querySelector('.action-image-host');
        const buttonRect = button.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        return {
            button: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
            icon: { x: iconRect.x, y: iconRect.y, width: iconRect.width, height: iconRect.height },
            host: { width: hostRect.width, height: hostRect.height },
            contained: iconRect.left >= buttonRect.left && iconRect.top >= buttonRect.top && iconRect.right <= buttonRect.right && iconRect.bottom <= buttonRect.bottom
        };
    });
    expect(disciplineLayout.icon.width).toBe(32);
    expect(disciplineLayout.host).toEqual({ width: 32, height: 32 });
    expect(disciplineLayout.contained).toBe(true);
    expect(await page.locator('#chatPlayerDisciplines [data-discipline-id] .action-image-menu').count()).toBe(0, 'the menu must be a sibling of the discipline button, not nested inside it');
    const iconMenu = page.locator('#chatPlayerDisciplines .action-image-menu').first();
    const iconTrigger = iconMenu.locator('summary');
    await expect(iconTrigger).toHaveAccessibleName('Image options for Fieldcraft');
    await expect(iconTrigger).toHaveText('•••');
    const menuLayout = await iconMenu.evaluate(element => ({
        position: getComputedStyle(element).position, top: getComputedStyle(element).top, right: getComputedStyle(element).right,
        border: getComputedStyle(element.querySelector('summary')).borderWidth,
        background: getComputedStyle(element.querySelector('summary')).backgroundColor,
        textShadow: getComputedStyle(element.querySelector('summary')).textShadow
    }));
    expect(menuLayout).toMatchObject({ position: 'absolute', top: '2px', right: '2px', border: '0px', background: 'rgba(0, 0, 0, 0)' });
    expect(menuLayout.textShadow).not.toBe('none');
    await iconTrigger.focus();
    await expect(iconTrigger).toBeFocused();
    await iconTrigger.click();
    await expect(iconMenu.getByRole('button', { name: 'Regenerate image' })).toBeVisible();
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-discipline-review', 'discipline-sidebar-icon-menu.png'), fullPage: true });
    await iconTrigger.click();
    await page.locator('#chatPlayerDisciplines').screenshot({ path: path.join(ROOT, 'tmp', 'sidebar-discipline-compact.png') });

    imageId = 'icon-after';
    disciplineImageId = 'discipline-icon-after';
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('image:updated', { detail: { entityType: 'technique', entityId: 'icon-technique', imageId: 'icon-after' } }));
        window.dispatchEvent(new CustomEvent('image:updated', { detail: { entityType: 'discipline', entityId: 'discipline-icons', imageId: 'discipline-icon-after' } }));
        window.dispatchEvent(new CustomEvent('techniques:refresh', { detail: { actorId: 'actor-icons' } }));
    });
    await expect.poll(() => page.evaluate(() => window.__imageCalls.some(call => call.imageId === 'icon-after') && window.__imageCalls.some(call => call.imageId === 'discipline-icon-after'))).toBe(true);
    expect(await page.evaluate(() => ({ technique: window.__imageCalls.filter(call => call.entityId === 'icon-technique').length, discipline: window.__imageCalls.filter(call => call.entityId === 'discipline-icons').length }))).toEqual({ technique: 2, discipline: 2 });

    await page.evaluate(() => {
        window.__failTechniqueIcons = true;
        window.dispatchEvent(new CustomEvent('techniques:refresh', { detail: { actorId: 'actor-icons' } }));
    });
    await expect.poll(() => page.evaluate(() => window.__imageErrors.length)).toBe(1);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => ({ errors: window.__imageErrors.length, calls: window.__imageCalls.length }))).toEqual({ errors: 1, calls: 6 });
});

test('action icon popups dismiss before actions, survive stopped outside clicks, and preserve modal focus', async ({ page }) => {
    await page.goto(fixtureUrl);
    await page.setContent('<main><div id="action-icons"></div><button id="stopped-click">Outside action</button><dialog id="prompt-dialog"><input aria-label="Prompt draft"></dialog></main>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/popup-dismissal.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/action-images.js') });
    await page.evaluate(() => {
        window.__jobs = [];
        window.__errors = [];
        window.AIRPG_PAGE_FEEDBACK = { showError: error => window.__errors.push({ message: error.message, stack: error.stack }) };
        window.AIRPG = { imageManager: { ensureImage: () => new Promise((resolve, reject) => window.__jobs.push({ resolve, reject })) } };
        window.renderEntityImage = async options => ({ imageId: options.imageId || null });
        window.openEntityImagePromptModal = () => {
            const dialog = document.getElementById('prompt-dialog');
            dialog.showModal();
            dialog.querySelector('input').focus();
        };
        const root = document.getElementById('action-icons');
        root.append(
            window.ActionImages.create({ entityType: 'technique', entityId: 'popup-action-one', name: 'First action', imagePrompt: 'Keep this prompt.' }),
            window.ActionImages.create({ entityType: 'discipline', entityId: 'popup-discipline-two', name: 'Second discipline', imagePrompt: 'Editable discipline prompt.' })
        );
        document.getElementById('stopped-click').addEventListener('click', event => event.stopPropagation());
    });

    const first = page.locator('.action-image-menu').nth(0);
    const second = page.locator('.action-image-menu').nth(1);
    const firstTrigger = first.locator('summary');
    const secondTrigger = second.locator('summary');
    await firstTrigger.click();
    await expect(first).toHaveAttribute('open', '');
    await first.getByRole('button', { name: 'Regenerate image' }).click();
    await expect.poll(() => page.evaluate(() => window.__jobs.length)).toBe(1);
    await expect(first).not.toHaveAttribute('open', '');
    await page.evaluate(() => window.__jobs[0].resolve({ imageId: 'async-generated-image' }));

    await secondTrigger.click();
    await expect(second).toHaveAttribute('open', '');
    await firstTrigger.click();
    await expect(first).toHaveAttribute('open', '');
    await expect(second).not.toHaveAttribute('open', '');
    await page.locator('#stopped-click').click();
    await expect(first).not.toHaveAttribute('open', '');

    await secondTrigger.click();
    await page.keyboard.press('Escape');
    await expect(second).not.toHaveAttribute('open', '');
    await expect(secondTrigger).toBeFocused();

    await secondTrigger.click();
    await second.getByRole('button', { name: 'Regenerate image' }).click();
    await expect.poll(() => page.evaluate(() => window.__jobs.length)).toBe(2);
    await expect(second).not.toHaveAttribute('open', '');
    await page.evaluate(() => window.__jobs[1].reject(new Error('Original image generation failure.')));
    await expect.poll(() => page.evaluate(() => window.__errors.length)).toBe(1);
    expect(await page.evaluate(() => window.__errors[0])).toMatchObject({ message: 'Original image generation failure.' });
    expect(await page.evaluate(() => window.__errors[0].stack)).toContain('Original image generation failure.');
    await expect(second).not.toHaveAttribute('open', '');

    await secondTrigger.click();
    await second.getByRole('button', { name: 'Edit image prompt…' }).click();
    await expect(page.locator('#prompt-dialog')).toHaveJSProperty('open', true);
    await expect(page.getByLabel('Prompt draft')).toBeFocused();
    await expect(second).not.toHaveAttribute('open', '');
});

test('check-results renderer shows committed technique formulas, actual costs, learning, and historical receipts', async ({ page }) => {
    await page.goto(fixtureUrl);
    await page.evaluate(() => { window.DomUtils = { escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }; });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(ROOT, 'public/js/chat.js'), 'utf8')}\nwindow.__AIRPGChatForReceiptTests = AIRPGChat;` });
    const html = await page.evaluate(() => {
        const chat = Object.create(window.__AIRPGChatForReceiptTests.prototype);
        chat.decorateChatBubbleElement = () => {};
        chat.createMessageActions = () => null;
        chat.formatTimestamp = () => '';
        chat.appendMessageSections = (root, { senderDiv, bodyDiv }) => root.append(senderDiv, bodyDiv);
        const use = {
            kind: 'technique', status: 'completed', summary: 'Restored Fixture Ally.',
            techniqueReceipt: {
                operationId: 'op:use:healing', success: true, costOutcome: 'normal',
                display: { targets: [{ id: 'ally-1', name: 'Fixture Ally' }], effects: [{ effectId: 'heal', calculation: { authored: { formula: 'round(10 + level * 2)' }, inputs: { level: 7 }, amount: 24 } }] },
                source: { sourceKind: 'learned', definitionRevision: 1, personalRevision: 2 }, checks: [],
                costs: [{ resource: 'need', needId: 'mana', previousValue: 100, newValue: 83, amount: 17, direction: 'decrease', delta: -17, calculations: [{ authored: { formula: 'ceil(100 / (1 + level))' }, inputs: { level: 7 }, amount: 17 }] }],
                effects: [{ targetId: 'ally-1', effectId: 'heal', kind: 'healing', success: true, amount: 24, delta: 24, previousHealth: 12, newHealth: 36 }]
            }
        };
        const learned = { kind: 'technique-learned', status: 'completed', summary: 'Learned Field Mend.', techniqueReceipt: { operationId: 'op:change:1', display: { techniqueDescription: 'Restores an ally with a quick gesture.' } } };
        const historical = { kind: 'technique', status: 'completed', summary: 'A past technique use.', techniqueReceipt: { operationId: 'legacy-op:1', success: true, costs: [], effects: [] } };
        const element = chat.createCheckResultsEntryElement({ timestamp: '', checkResults: [use, learned, historical] });
        document.body.append(element);
        return element.outerHTML;
    });
    const result = await page.evaluate(markup => {
        const container = document.createElement('div');
        container.innerHTML = markup;
        return { text: container.innerText, formulas: [...container.querySelectorAll('.technique-formula')].map(item => item.textContent), heading: container.querySelector('.message-sender')?.textContent };
    }, html);
    expect(result.heading).toBe('Techniques');
    expect(result.text).toContain('mana: 100 → 83; charged 17 (decrease), actual change -17.');
    expect(result.text).toContain('Fixture Ally: healing');
    expect(result.text).toContain('actual +24 HP');
    expect(result.text).toContain('New technique learned.');
    expect(result.text).toContain('Restores an ally with a quick gesture.');
    expect(result.text).toContain('Historical receipt: only originally recorded values are available.');
    expect(result.formulas).toEqual(['ceil(100 / (1 + level))', 'round(10 + level * 2)']);
});

test('technique editor saves the selected skill difficulty through the shared controls', async ({ page }) => {
    const saved = [];
    const previews = [];
    await page.route('**/api/techniques**', async route => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill({ json: {
                actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false,
                disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline', description: 'A fixture discipline.' }],
                disciplineAccess: [], techniques: [], catalog: [], targets: [],
                formulaVariables: [
                    { key: 'level', label: 'Level', kind: 'level', value: 5 },
                    { key: 'skill_spellcasting', label: 'Spellcasting rank', kind: 'skill', name: 'Spellcasting', value: 4 },
                    { key: 'attribute_strength_modifier', label: 'strength modifier', kind: 'attribute', name: 'strength', value: 2 }
                ]
            } });
            return;
        }
        const body = request.postDataJSON();
        if (request.url().includes('/preview')) {
            previews.push(body);
            await route.fulfill({ json: { mechanics: { ...body.mechanics, effects: [{ ...body.mechanics.effects[0], amount: 11 }] }, costs: [] } });
            return;
        }
        saved.push(body);
        await route.fulfill({ json: { definition: { id: 'technique-ui-fixture' } } });
    });

    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/formula-evaluator.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/technique-formula-variables.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Create technique' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create world technique' });
    await dialog.getByLabel('Name').fill('Measured Mend');
    await dialog.getByLabel('Description', { exact: true }).first().fill('Restores health after a focused check.');
    await dialog.getByLabel('Semantic identity (stable description of the action)').fill('focused healing');
    await dialog.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Fixture Discipline · discipline-ui-fixture' });
    await dialog.getByLabel('Check kind', { exact: true }).first().selectOption('skill');
    await dialog.getByLabel('Skill', { exact: true }).first().fill('Medicine');
    await dialog.getByRole('group', { name: 'Check', exact: true }).getByLabel('Difficulty', { exact: true }).selectOption('Medium');
    await dialog.locator('select[aria-label="Amount mode"]').selectOption('Formula');
    const formula = dialog.getByLabel('Formula', { exact: true });
    await formula.fill('level + ');
    await formula.evaluate(element => element.setSelectionRange(8, 8));
    const available = dialog.getByRole('button', { name: 'Available variables' });
    await available.click();
    const reference = page.getByRole('dialog', { name: 'Available formula variables' });
    await expect(reference).toContainText('skill_spellcasting');
    await expect(reference).toContainText('Spellcasting rank');
    await expect(reference).toContainText('4');
    await expect(reference.getByRole('table', { name: 'Current character values' })).toBeVisible();
    await expect(reference.getByRole('columnheader')).toHaveText(['Variable', 'Source', 'Current value', 'Action']);
    await expect(reference.getByText('Bindings')).toHaveCount(0);
    await expect(reference.locator('[aria-label="Available formula variables"]')).toBeVisible();
    await expect(dialog.getByText('Bindings', { exact: true })).toHaveCount(0);
    expect(await page.locator('html').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await reference.locator('.data-table-scroll').evaluate(element => element.clientWidth <= window.innerWidth)).toBe(true);
    await reference.getByRole('button', { name: 'Insert skill_spellcasting' }).click();
    await expect(reference).toHaveCount(0);
    await expect(formula).toHaveValue('level + skill_spellcasting');
    await expect(formula).toBeFocused();
    await expect(dialog.getByLabel('Name')).toHaveValue('Measured Mend');
    await expect(dialog.getByLabel('Description', { exact: true }).first()).toHaveValue('Restores health after a focused check.');

    await available.click();
    const escapeDialog = page.getByRole('dialog', { name: 'Available formula variables' });
    await page.keyboard.press('Escape');
    await expect(escapeDialog).toHaveCount(0);
    await expect(available).toBeFocused();
    await dialog.getByRole('button', { name: 'Calculate preview' }).click();
    await expect.poll(() => previews.length).toBe(1);
    expect(previews[0]).toMatchObject({ mechanics: { effects: [{ amount: { formula: 'level + skill_spellcasting' } }] } });
    await expect(dialog.locator('.techniques-preview')).toContainText('healing: 11');
    await dialog.getByLabel('Reason / source for this change').fill('Fixture authoring reason.');
    await dialog.locator('.modal__body').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-ui-review', 'desktop-editor.png') });
    await dialog.getByRole('button', { name: 'Create technique', exact: true }).click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].disciplineId).toBe('discipline-ui-fixture');
    expect(saved[0].revisions[0]).toMatchObject({
        check: { kind: 'skill', skill: 'Medicine', difficulty: 'Medium' },
        effects: [{ id: 'effect-1', kind: 'healing', amount: { formula: 'level + skill_spellcasting' } }]
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('discipline editor retains per-discipline drafts after a save error and refreshes after a global rename', async ({ page }) => {
    const originalDisciplines = [
        { id: 'discipline-shared-a', name: 'Old Arcana', description: 'Old arcane description.' },
        { id: 'discipline-shared-b', name: 'Old Fieldcraft', description: 'Old fieldcraft description.' }
    ];
    let currentDisciplines = originalDisciplines.map(value => ({ ...value }));
    const savedRequests = [];
    let rejectFirstSave = true;
    let getCount = 0;
    await page.route('**/api/techniques**', async route => {
        const request = route.request();
        if (request.method() === 'GET') {
            getCount += 1;
            await route.fulfill({ json: {
                actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false,
                disciplines: currentDisciplines, disciplineAccess: [],
                disciplineEditContext: { worldId: 'edit-world-fixture', disciplines: currentDisciplines, disciplineAccess: [] },
                techniques: [], catalog: [], targets: [], formulaVariables: []
            } });
            return;
        }
        savedRequests.push(request.postDataJSON());
        if (rejectFirstSave) {
            rejectFirstSave = false;
            await route.fulfill({ status: 400, json: { error: 'Fixture discipline save failed.', stack: 'Error: Fixture discipline save failed.\n    at discipline-editor-fixture.js:1:1' } });
            return;
        }
        currentDisciplines = currentDisciplines.map(discipline => savedRequests.at(-1).edits.find(edit => edit.id === discipline.id) || discipline);
        await route.fulfill({ json: {
            actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false,
            disciplines: currentDisciplines, disciplineAccess: [],
            disciplineEditContext: { worldId: 'edit-world-fixture', disciplines: currentDisciplines, disciplineAccess: [] },
            techniques: [], catalog: [], targets: [], formulaVariables: [], disciplinesChanged: true, accessChanged: true
        } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => {
        window.__editorErrors = [];
        window.AIRPG_PAGE_FEEDBACK = { showError: error => window.__editorErrors.push(error.message) };
        window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' });
    });

    await page.getByRole('button', { name: 'Edit discipline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit discipline — Fixture Actor' });
    const selector = dialog.getByLabel('Discipline to edit', { exact: true });
    const name = dialog.getByLabel('Name', { exact: true });
    const description = dialog.getByLabel('Description', { exact: true });
    await name.fill('Arcana draft');
    await description.fill('A revised global arcana description.');
    await selector.selectOption({ label: 'Old Fieldcraft · discipline-shared-b' });
    await name.fill('Fieldcraft draft');
    await description.fill('A revised global fieldcraft description.');
    await selector.selectOption({ label: 'Old Arcana · discipline-shared-a' });
    await expect(name).toHaveValue('Arcana draft');
    await expect(description).toHaveValue('A revised global arcana description.');

    await dialog.getByRole('checkbox', { name: 'Old Arcana · discipline-shared-a' }).check();
    await dialog.getByRole('checkbox', { name: 'Old Fieldcraft · discipline-shared-b' }).check();
    expect(await dialog.getByRole('checkbox', { name: 'Old Arcana · discipline-shared-a' }).evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(32);
    const reason = dialog.getByLabel('Reason / source of newly granted access');
    await reason.fill('Grant the actor access while editing shared discipline details.');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-discipline-review', 'combined-discipline-editor.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Save discipline changes' }).click();
    await expect.poll(() => savedRequests.length).toBe(1);
    await expect(dialog.locator('[role="status"]')).toContainText('Fixture discipline save failed.');
    await expect(name).toHaveValue('Arcana draft');
    await expect(description).toHaveValue('A revised global arcana description.');
    await expect(dialog.getByRole('checkbox', { name: 'Old Arcana · discipline-shared-a' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Old Fieldcraft · discipline-shared-b' })).toBeChecked();

    await reason.fill('Retry after the server recovers.');
    await dialog.getByRole('button', { name: 'Save discipline changes' }).click();
    await expect.poll(() => savedRequests.length).toBe(2);
    expect(savedRequests[1]).toMatchObject({
        actorId: 'actor-ui-fixture',
        edits: [
            { id: 'discipline-shared-a', name: 'Arcana draft', description: 'A revised global arcana description.' },
            { id: 'discipline-shared-b', name: 'Fieldcraft draft', description: 'A revised global fieldcraft description.' }
        ],
        accessIds: ['discipline-shared-a', 'discipline-shared-b'],
        accessReason: 'Retry after the server recovers.',
        expected: { worldId: 'edit-world-fixture', disciplines: originalDisciplines, disciplineAccess: [] }
    });
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => getCount).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.__editorErrors)).toEqual(['Fixture discipline save failed.']);
});

test('techniques panel selects the equipment version, submits an ordinary targeted turn, and fits a mobile viewport', async ({ page }) => {
    const learned = {
        sourceId: 'learned:technique-ui-use', sourceKind: 'learned', definitionRevision: 1, personalRevision: 2,
        available: true, blockers: [], costs: [{ key: 'health', resource: 'health', amount: 2 }], failureCosts: [{ key: 'health', resource: 'health', amount: 1 }],
        mechanics: { revision: 2, target: { kind: 'single' }, check: { kind: 'automatic' }, costs: [{ resource: 'health', amount: 2 }], effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }
    };
    const equipment = {
        sourceId: 'grant-lantern', sourceKind: 'equipment', itemId: 'item-lantern', itemName: 'Lantern', definitionRevision: 1,
        available: true, blockers: [], costs: [{ key: 'health', resource: 'health', amount: 5 }], failureCosts: [{ key: 'health', resource: 'health', amount: 5 }],
        mechanics: { revision: 1, target: { kind: 'single' }, check: { kind: 'automatic' }, costs: [{ resource: 'health', amount: 5 }], effects: [{ id: 'heal', kind: 'healing', amount: 8 }] }
    };
    await page.route('**/api/techniques**', async route => {
        if (route.request().url().includes('/use-preview')) {
            await route.fulfill({ json: { targetIds: ['target-ui-fixture'], costs: [{ resource: 'health', amount: 5, calculations: [{ amount: 5 }] }] } });
            return;
        }
        await route.fulfill({ json: {
            actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: true, canUse: true,
            disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline', description: 'A fixture discipline.' }],
            disciplineAccess: [], catalog: [], targets: [{ id: 'target-ui-fixture', name: 'Target Fixture' }],
            techniques: [{ techniqueId: 'technique-ui-use', name: 'Field Mend', description: 'Restores a target.', disciplineId: 'discipline-ui-fixture', disciplineName: 'Fixture Discipline', learned: true, selectedSourceId: learned.sourceId, available: true, sources: [learned, equipment] }]
        } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => {
        window.__submittedTechniqueTurn = null;
        window.submitTechniqueTurn = async action => { window.__submittedTechniqueTurn = action; };
        window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' });
    });

    const card = page.locator('.techniques-card');
    await expect(card.getByText('Equipment access')).toBeVisible();
    await card.getByLabel('Executable source', { exact: true }).selectOption({ label: 'Equipment Lantern · definition 1 · grant-lantern' });
    await expect(card.getByText('Cost', { exact: true }).locator('..')).toContainText('5 health');
    const heading = page.locator('#playerTechniquesSection .techniques-actions h3');
    await expect(heading).toHaveText('Techniques');
    const headingColor = await heading.evaluate(element => getComputedStyle(element).color);
    const headingBounds = await heading.boundingBox();
    const scrollY = await page.evaluate(() => window.scrollY);
    const screenshot = await page.screenshot({ path: path.join(ROOT, 'tmp', 'techniques-ui-review', 'mobile-source-selection.png'), fullPage: true });
    const { data: screenshotPixels, info: screenshotInfo } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sampleX = Math.min(screenshotInfo.width - 1, Math.round(headingBounds.x + headingBounds.width + 8));
    const sampleY = Math.min(screenshotInfo.height - 1, Math.round(headingBounds.y + scrollY + headingBounds.height / 2));
    const pixelIndex = (sampleY * screenshotInfo.width + sampleX) * screenshotInfo.channels;
    const headingBackground = `rgb(${screenshotPixels[pixelIndex]}, ${screenshotPixels[pixelIndex + 1]}, ${screenshotPixels[pixelIndex + 2]})`;
    expect(contrastRatio(headingColor, headingBackground)).toBeGreaterThan(4.5);

    await card.getByRole('button', { name: 'Use', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Use Field Mend' });
    await expect(dialog).toContainText('equipment · definition 1');
    await dialog.getByLabel('Target', { exact: true }).selectOption({ label: 'Target Fixture · target-ui-fixture' });
    await dialog.getByLabel('Intention / action details').fill('Use the lantern version to restore the target.');
    await dialog.getByRole('button', { name: 'Calculate cost preview' }).click();
    await expect(dialog.locator('.techniques-use-preview')).toContainText('5 health');
    await dialog.getByRole('button', { name: 'Use technique', exact: true }).click();

    await expect.poll(() => page.evaluate(() => window.__submittedTechniqueTurn)).toMatchObject({
        techniqueUse: {
            actorId: 'actor-ui-fixture', techniqueId: 'technique-ui-use', sourceId: 'grant-lantern', definitionRevision: 1,
            targetIds: ['target-ui-fixture']
        }
    });
    await expect(dialog).toHaveCount(0);
    const input = card.locator('input').first();
    const fonts = await input.evaluate(element => ({ input: getComputedStyle(element).fontFamily, body: getComputedStyle(document.body).fontFamily }));
    const optionColors = await card.getByLabel('Executable source', { exact: true }).locator('option').nth(2).evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    expect(await page.locator('#playerTechniquesSection').evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    expect(fonts.input).toBe(fonts.body);
    expect(contrastRatio(optionColors.color, optionColors.background)).toBeGreaterThan(4.5);
});

test('editing a legacy formula rewrites saved binding aliases to their original sources', async ({ page }) => {
    const saved = [];
    const legacySource = {
        sourceId: 'learned:legacy-formula', sourceKind: 'learned', definitionRevision: 1, personalRevision: 2,
        available: true, blockers: [], costs: [], mechanics: {
            revision: 2, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [],
            effects: [{ id: 'heal', kind: 'healing', amount: { formula: 'power + level', bindings: { power: { kind: 'attribute', name: 'strength' }, level: { kind: 'skill', name: 'Spellcasting' } } } }]
        }
    };
    await page.route('**/api/techniques**', async route => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ json: {
                actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false,
                disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline', description: 'A fixture discipline.' }],
                disciplineAccess: [], catalog: [], targets: [],
                formulaVariables: [
                    { key: 'level', label: 'Level', kind: 'level', value: 5 },
                    { key: 'skill_spellcasting', label: 'Spellcasting rank', kind: 'skill', name: 'Spellcasting', value: 4 },
                    { key: 'attribute_strength_modifier', label: 'strength modifier', kind: 'attribute', name: 'strength', value: 2 }
                ],
                techniques: [{ techniqueId: 'legacy-formula', name: 'Legacy Formula', description: 'Retains saved custom bindings.', disciplineId: 'discipline-ui-fixture', disciplineName: 'Fixture Discipline', learned: true, selectedSourceId: legacySource.sourceId, available: true, sources: [legacySource] }]
            } });
            return;
        }
        saved.push(route.request().postDataJSON());
        await route.fulfill({ json: { receipt: { kind: 'improve' } } });
    });

    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/formula-evaluator.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/technique-formula-variables.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));

    const card = page.locator('.techniques-card');
    await expect(card).toContainText('attribute_strength_modifier + skill_spellcasting');
    await card.getByRole('button', { name: 'Edit Fixture Actor’s learned revision' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Legacy Formula — Fixture Actor' });
    const formula = editor.getByLabel('Formula', { exact: true });
    await expect(formula).toHaveValue('attribute_strength_modifier + skill_spellcasting');
    await expect(editor.getByText('Bindings', { exact: true })).toHaveCount(0);
    await formula.fill('attribute_strength_modifier + skill_spellcasting + level');
    await editor.getByLabel('Reason / source for this change').fill('Preserve the original legacy sources.');
    await editor.getByRole('button', { name: 'Save personal revision' }).click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].mechanics.effects[0].amount).toEqual({ formula: 'attribute_strength_modifier + skill_spellcasting + level' });
    await expect(editor).toHaveCount(0);
});

test('managed personal edits preserve the recipe by default and require an explicit custom conversion', async ({ page }) => {
    const saved = [];
    const balance = {
        schemaVersion: 1, recipeId: 'standard-healing',
        policy: { version: 1, digest: 'saved-policy-digest', snapshot: { version: 1 } },
        selections: { skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana', needId: 'mana', effectId: 'restore' },
        parameters: { baseCost: 100, healingBonus: 0, appliedImprovementIds: [] }
    };
    let source = {
        sourceId: 'learned:managed-balance', sourceKind: 'learned', definitionRevision: 1, personalRevision: 2,
        available: true, blockers: [], costs: [{ key: 'need:mana', resource: 'need', needId: 'mana', direction: 'decrease', amount: 83 }],
        mechanics: {
            revision: 2, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' },
            costs: [{ resource: 'need', needId: 'mana', direction: 'decrease', amount: { formula: 'ceil(100 / (1 + 0.05 * skill_spellcasting + 0.02 * level))' } }],
            effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)' } }],
            balance
        }
    };
    await page.route('**/api/techniques**', async route => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill({ json: {
                actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false,
                disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline', description: 'A fixture discipline.' }],
                disciplineAccess: [], catalog: [], targets: [],
                formulaVariables: [
                    { key: 'level', label: 'Level', kind: 'level', value: 3 },
                    { key: 'skill_spellcasting', label: 'Spellcasting rank', kind: 'skill', name: 'Spellcasting', value: 3 },
                    { key: 'attribute_intelligence_modifier', label: 'Intelligence modifier', kind: 'attribute', name: 'Intelligence', value: 4 }
                ],
                techniques: [{ techniqueId: 'managed-balance', name: 'Managed Mend', description: 'A saved managed healing recipe.', disciplineId: 'discipline-ui-fixture', disciplineName: 'Fixture Discipline', learned: true, selectedSourceId: source.sourceId, available: true, sources: [source] }]
            } });
            return;
        }
        const body = request.postDataJSON();
        if (request.url().includes('/preview')) {
            await route.fulfill({ json: { mechanics: body.mechanics, costs: [] } });
            return;
        }
        saved.push(body);
        source = { ...source, personalRevision: source.personalRevision + 1, mechanics: body.mechanics };
        await route.fulfill({ json: { receipt: { kind: 'improve' } } });
    });

    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/formula-evaluator.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/technique-formula-variables.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));

    const card = page.locator('.techniques-card');
    const edit = () => card.getByRole('button', { name: 'Edit Fixture Actor’s learned revision' }).click();
    await edit();
    let dialog = page.getByRole('dialog', { name: 'Edit Managed Mend — Fixture Actor' });
    await expect(dialog.getByLabel('Balance mode', { exact: true })).toHaveValue('Managed balance');
    await expect(dialog).toContainText('Skill and level are recalculated when used.');
    await dialog.getByLabel('Reason / source for this change').fill('Preserve the managed recipe.');
    await dialog.getByRole('button', { name: 'Save personal revision' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].mechanics.balance).toEqual(balance);
    expect(saved[0].mechanics.effects[0].amount.formula).toBe('round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)');
    expect(saved[0].convertToCustom).toBeUndefined();

    await page.reload();
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/formula-evaluator.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/technique-formula-variables.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));
    await edit();
    dialog = page.getByRole('dialog', { name: 'Edit Managed Mend — Fixture Actor' });
    await dialog.getByLabel('Balance mode', { exact: true }).selectOption('Custom mechanics');
    await expect(dialog.getByText('Effects', { exact: true }).first()).toBeVisible();
    await dialog.getByLabel('Reason / source for this change').fill('Explicitly convert this personal draft to custom mechanics.');
    await dialog.getByRole('button', { name: 'Save personal revision' }).click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1].mechanics.balance).toBeUndefined();
    expect(saved[1].convertToCustom).toBe(true);
    expect(saved[1].mechanics.effects[0].amount).toEqual({ formula: 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)' });
});

test('technique editor displays the original API error and stack trace', async ({ page }) => {
    await page.route('**/api/techniques**', async route => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ json: { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', canUse: false, disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline' }], disciplineAccess: [], techniques: [], catalog: [], targets: [], formulaVariables: [{ key: 'level', label: 'Level', kind: 'level', value: 5 }] } });
            return;
        }
        await route.fulfill({ status: 400, json: { error: 'Unknown discipline in reviewed definition.', stack: 'Error: Unknown discipline in reviewed definition.\n    at TechniqueService.addDefinition (TechniqueService.js:178:1)' } });
    });
    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/formula-evaluator.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/technique-formula-variables.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));
    await page.getByRole('button', { name: 'Create technique' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create world technique' });
    await dialog.getByLabel('Name', { exact: true }).fill('Rejected Technique');
    await dialog.getByLabel('Description', { exact: true }).first().fill('A fixture technique.');
    await dialog.getByLabel('Semantic identity (stable description of the action)').fill('rejected technique');
    await dialog.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Fixture Discipline · discipline-ui-fixture' });
    await dialog.getByLabel('Reason / source for this change').fill('A fixture failure.');
    await dialog.getByRole('button', { name: 'Create technique', exact: true }).click();
    const error = page.locator('.page-feedback-dialog');
    await expect(error).toContainText('Unknown discipline in reviewed definition.');
    await expect(error).toContainText('TechniqueService.addDefinition');
});

test('weapon use previews exact selection and reviewed rebase submits guards', async ({ page }) => {
    const posted = [];
    const mechanics = { revision: 1, target: { kind: 'single' }, check: { kind: 'attack', skill: 'Strength', attribute: 'Strength' }, costs: [], effects: [{ id: 'strike', kind: 'damage', damageMode: 'weapon', multiplier: 2, bonus: 1 }] };
    const source = { sourceId: 'learned:blade', sourceKind: 'learned', definitionRevision: 1, personalRevision: 1, available: true, requiresWeaponSelection: true, blockers: [], costs: [], mechanics };
    const data = { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: true, canUse: true, disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline' }], disciplineAccess: [], targets: [{ id: 'target', name: 'Target', isDead: false }], weaponItems: [{ itemId: 'blade-a', name: 'Blade A' }, { itemId: 'blade-b', name: 'Blade B' }], utilityContext: {}, catalog: [{ id: 'blade', name: 'Blade Form', revisions: [mechanics, { ...mechanics, revision: 2 }] }], techniques: [{ techniqueId: 'blade', name: 'Blade Form', description: 'A weapon form.', disciplineId: 'discipline-ui-fixture', disciplineName: 'Fixture Discipline', learned: true, selectedSourceId: source.sourceId, available: true, sources: [source] }] };
    await page.route('**/api/techniques**', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: data });
        const request = route.request();
        const body = request.postDataJSON();
        posted.push({ url: request.url(), body });
        if (request.url().endsWith('/use-preview')) return route.fulfill({ json: { targetIds: body.targetIds, weaponItemId: body.weaponItemId, weapon: { name: 'Blade B' }, costs: [{ resource: 'charge', itemId: 'blade-b', amount: 2, calculations: [{ amount: 2 }] }] } });
        if (request.url().endsWith('/personal-reset/preview')) return route.fulfill({ json: { actorId: body.actorId, before: mechanics, after: { ...mechanics, revision: 2 }, fromPersonalRevision: 1, toPersonalRevision: 2, fromDefinitionRevision: 1, toDefinitionRevision: body.targetDefinitionRevision } });
        return route.fulfill({ json: { ...data, receipt: { committed: true } } });
    });
    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    for (const script of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'page-feedback.js', 'formula-evaluator.js', 'technique-formula-variables.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', script) });
    await page.evaluate(() => { window.submitTechniqueTurn = async value => { window.__submittedTechniqueTurn = value; }; window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }); });
    const card = page.locator('.techniques-card');
    await card.getByRole('button', { name: 'Use', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Use Blade Form' });
    await dialog.getByLabel('Equipped weapon', { exact: true }).selectOption({ label: 'Blade B · blade-b' });
    await dialog.getByLabel('Target', { exact: true }).selectOption({ label: 'Target · target' });
    await dialog.getByLabel('Intention / action details').fill('Strike the target.');
    await dialog.getByRole('button', { name: 'Calculate cost preview' }).click();
    await expect(dialog.locator('.techniques-use-preview')).toContainText('2 charge/ammunition');
    await page.screenshot({ path: path.join(ROOT, 'tmp/techniques-ui-review/desktop-weapon-use.png') });
    await dialog.getByRole('button', { name: 'Use technique', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__submittedTechniqueTurn)).toMatchObject({ techniqueUse: { weaponItemId: 'blade-b', targetIds: ['target'] } });
    await card.getByRole('button', { name: 'Reset / rebase personal revision' }).click();
    dialog = page.getByRole('dialog', { name: 'Reset / rebase — Blade Form' });
    await dialog.getByLabel('Operation', { exact: true }).selectOption('Rebase to catalogue revision');
    await dialog.getByLabel('Catalogue revision', { exact: true }).selectOption('Revision 2');
    await dialog.getByLabel('Reason for this change').fill('Adopt the reviewed revision.');
    await dialog.getByRole('button', { name: 'Review before and after' }).click();
    await expect(dialog.locator('.techniques-reset-comparison')).toContainText('Personal revision 1 → 2');
    await page.screenshot({ path: path.join(ROOT, 'tmp/techniques-ui-review/desktop-rebase-review.png') });
    await dialog.getByRole('button', { name: 'Apply reviewed change' }).click();
    await expect.poll(() => posted.find(entry => entry.url.endsWith('/personal-reset'))?.body).toMatchObject({ expectedDefinitionRevision: 1, expectedPersonalRevision: 1, expectedCatalogRevision: 2, targetDefinitionRevision: 2 });
});

test('committed weapon and utility receipts render their recorded effects safely', async ({ page }) => {
    await page.goto(fixtureUrl);
    const chat = fs.readFileSync(path.join(ROOT, 'public/js/chat.js'), 'utf8');
    const start = chat.indexOf('    buildTechniqueResultDetailsHtml(record) {');
    const end = chat.indexOf('    appendTurnDiffDrawer(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const method = chat.slice(start, end);
    await page.evaluate(source => {
        const renderer = new Function(`return ({ ${source}, escapeHtml(value) { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; } });`)();
        const receipt = { success: true, operationId: 'receipt-1', costs: [], checks: [], effects: [
            { effectId: 'strike', targetId: 'target', kind: 'damage', success: true, weapon: { itemId: 'blade', ordinary: { calculation: { unmitigatedDamage: 4 } }, multiplier: { amount: 2 }, bonus: { amount: 1 }, modifiedPreDefense: 9, finalDamage: 7 } },
            { effectId: 'travel', targetId: 'target', kind: 'teleport', success: true, mutation: { kind: 'teleport', actorId: 'target', fromLocationId: 'old', destinationId: 'new' } },
            { effectId: 'summon', targetId: 'target', kind: 'summon', success: true, mutation: { kind: 'summon', actorId: 'npc', actorName: '<Familiar>', destinationId: 'new', expiresAtWorldMinute: 42, templateId: 'template' } },
            { effectId: 'revive', targetId: 'target', kind: 'resurrection', success: true, mutation: { kind: 'resurrection', actorId: 'target', restoredHealth: 4 } }
        ] };
        document.body.innerHTML = renderer.buildTechniqueResultDetailsHtml({ kind: 'technique-used', techniqueReceipt: receipt });
    }, method);
    const details = page.locator('.technique-result-details');
    await expect(details).toContainText('before defenses 9; final 7');
    await expect(details).toContainText('Moved target from old to new');
    await expect(details).toContainText('Summoned <Familiar> (npc) to new until world minute 42 from template template');
    await expect(details).toContainText('Resurrected target with 4 health');
    await expect(details.locator('familiar')).toHaveCount(0);
});

test('shared editor authors a weapon effect with explicit native defense settings', async ({ page }) => {
    const saved = [];
    await page.route('**/api/techniques**', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: false, canUse: false, disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline' }], disciplineAccess: [], techniques: [], catalog: [], targets: [], formulaVariables: [], utilityContext: {} } });
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { definition: { id: 'weapon-form' } } });
    });
    await page.goto(fixtureUrl);
    for (const script of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'page-feedback.js', 'formula-evaluator.js', 'technique-formula-variables.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', script) });
    await page.evaluate(() => window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }));
    await page.getByRole('button', { name: 'Create technique' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create world technique' });
    await dialog.getByLabel('Name', { exact: true }).fill('Blade Form');
    await dialog.getByLabel('Description', { exact: true }).first().fill('A weapon form.');
    await dialog.getByLabel('Semantic identity (stable description of the action)').fill('blade form');
    await dialog.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Fixture Discipline · discipline-ui-fixture' });
    const check = dialog.getByRole('group', { name: 'Check', exact: true });
    await check.getByLabel('Check kind', { exact: true }).selectOption('attack');
    await check.getByLabel('Skill', { exact: true }).fill('Strength');
    await check.getByLabel('Target toughness attribute').fill('Strength');
    await expect(check.getByText(/Damage effectiveness is assessed for each target/i)).toBeVisible();
    await expect(check.getByLabel('Damage effectiveness', { exact: true })).toHaveCount(0);
    await dialog.getByLabel('Effect', { exact: true }).selectOption('damage');
    await dialog.getByLabel('Damage mode', { exact: true }).selectOption('weapon');
    await dialog.getByLabel('Reason / source for this change').fill('Create a reviewed weapon form.');
    await dialog.getByRole('button', { name: 'Create technique', exact: true }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].revisions[0].check).toMatchObject({ kind: 'attack', skill: 'Strength', toughnessAttribute: 'Strength' });
    expect(saved[0].revisions[0].check).not.toHaveProperty('damageEffectiveness');
    expect(saved[0].revisions[0].effects[0]).toMatchObject({ kind: 'damage', damageMode: 'weapon', multiplier: 1, bonus: 0 });
});

test('standard mixed recipe authors percent status and resurrection selects a dead target', async ({ page }) => {
    const saved = [];
    const source = { sourceId: 'learned:revive', sourceKind: 'learned', definitionRevision: 1, personalRevision: 1, available: true, blockers: [], costs: [], mechanics: { revision: 1, target: { kind: 'single', allowDead: true }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'revive', kind: 'resurrection', health: 4 }] } };
    const authoring = { availableRecipeKinds: ['healing', 'damage', 'buff', 'debuff'], skills: [{ name: 'Spellcasting' }], attributes: [{ name: 'Strength' }], resourceProfiles: [{ resourceProfileId: 'mana' }], status: { standard: { fixedMagnitude: 1, percentMagnitude: 5, durationMinutes: 3 } } };
    const data = { actorId: 'actor-ui-fixture', actorName: 'Fixture Actor', isPlayer: true, canUse: true, disciplines: [{ id: 'discipline-ui-fixture', name: 'Fixture Discipline' }], disciplineAccess: [], catalog: [], formulaVariables: [], balanceAuthoring: authoring, utilityContext: {}, targets: [{ id: 'dead-npc', name: 'Fallen Ally', isDead: true }, { id: 'live-npc', name: 'Living Ally', isDead: false }], techniques: [{ techniqueId: 'revive', name: 'Revive', description: 'Return an ally.', disciplineId: 'discipline-ui-fixture', disciplineName: 'Fixture Discipline', learned: true, selectedSourceId: source.sourceId, available: true, sources: [source] }] };
    await page.route('**/api/techniques**', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: data });
        const body = route.request().postDataJSON(); saved.push(body);
        if (route.request().url().endsWith('/use-preview')) return route.fulfill({ json: { targetIds: body.targetIds, costs: [] } });
        return route.fulfill({ json: { definition: { id: 'mixed' } } });
    });
    await page.goto(fixtureUrl);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    for (const script of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'page-feedback.js', 'formula-evaluator.js', 'technique-formula-variables.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', script) });
    await page.evaluate(() => { window.submitTechniqueTurn = async value => { window.__submittedTechniqueTurn = value; }; window.TechniquesPanel.mount(document.getElementById('playerTechniquesSection'), { id: 'actor-ui-fixture', name: 'Fixture Actor' }); });
    await page.getByRole('button', { name: 'Create technique' }).click();
    let dialog = page.getByRole('dialog', { name: 'Create world technique' });
    await dialog.getByLabel('Name', { exact: true }).fill('Mixed Aid');
    await dialog.getByLabel('Description', { exact: true }).first().fill('Healing and a percent blessing.');
    await dialog.getByLabel('Semantic identity (stable description of the action)').fill('mixed aid');
    await dialog.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Fixture Discipline · discipline-ui-fixture' });
    await expect(dialog.getByLabel('Authoring mode', { exact: true })).toHaveValue('Standard recipe');
    let rows = dialog.getByRole('group', { name: 'Components' }).locator('.techniques-editor-row');
    await rows.nth(0).getByLabel('Scaling skill', { exact: true }).selectOption('Spellcasting');
    await rows.nth(0).getByLabel('Resource profile', { exact: true }).selectOption('mana');
    await rows.nth(0).getByLabel('Scaling attribute', { exact: true }).selectOption('Strength');
    await dialog.getByRole('button', { name: 'Add component' }).click();
    await rows.nth(1).getByLabel('Component', { exact: true }).selectOption('buff');
    await rows.nth(1).getByLabel('Scaling skill', { exact: true }).selectOption('Spellcasting');
    await rows.nth(1).getByLabel('Resource profile', { exact: true }).selectOption('mana');
    await rows.nth(1).getByLabel('Affected stat', { exact: true }).selectOption('Strength');
    await rows.nth(1).getByLabel('Status modifier', { exact: true }).selectOption('percent');
    await rows.nth(1).getByLabel('Status name', { exact: true }).fill('Blessed');
    await rows.nth(1).getByLabel('Status description', { exact: true }).fill('A blessing.');
    await dialog.getByLabel('Reason / source for this change').fill('Create mixed aid.');
    await page.screenshot({ path: path.join(ROOT, 'tmp/techniques-ui-review/desktop-mixed-recipe.png') });
    await dialog.getByRole('button', { name: 'Create technique', exact: true }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].revisions[0].recipe.components.map(component => component.kind)).toEqual(['healing', 'buff']);
    expect(saved[0].revisions[0].recipe.components[1].statusModifierKind).toBe('percent');
    await page.locator('.techniques-card').getByRole('button', { name: 'Use', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Use Revive' });
    const target = dialog.getByLabel('Dead character at this scene', { exact: true });
    await expect(target.locator('option')).toContainText(['Choose target…', 'Fallen Ally · dead-npc']);
    await target.selectOption({ label: 'Fallen Ally · dead-npc' });
    await dialog.getByLabel('Intention / action details').fill('Restore the fallen ally.');
    await dialog.getByRole('button', { name: 'Calculate cost preview' }).click();
    await expect(dialog.locator('.techniques-use-preview')).toContainText('No resource cost');
    await dialog.getByRole('button', { name: 'Use technique', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__submittedTechniqueTurn)).toMatchObject({ techniqueUse: { targetIds: ['dead-npc'] } });
});

test('technique result presentation rounds damage and healing without changing recorded facts', async ({ page }) => {
    await page.goto(fixtureUrl);
    const chat = fs.readFileSync(path.join(ROOT, 'public/js/chat.js'), 'utf8');
    const start = chat.indexOf('    buildTechniqueResultDetailsHtml(record) {');
    const end = chat.indexOf('    appendTurnDiffDrawer(', start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const result = await page.evaluate(source => {
        const renderer = new Function(`return ({ ${source}, escapeHtml(value) { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; } });`)();
        const receipt = { success: true, operationId: 'fractional-ui', costOutcome: 'normal', costs: [], checks: [], effects: [
            { effectId: 'burn', targetId: 'target', kind: 'damage', success: true, amount: 2.6, delta: -2.6, previousHealth: 10.4, newHealth: 7.8,
                calculation: { authored: { formula: 'level * 2' }, inputs: { level: 1.3 }, amount: 2.6 },
                damageEffectiveness: 4, damageCalculation: { preEffectiveness: 1.3, effectivenessMultiplier: 2, finalDamage: 2.6 } },
            { effectId: 'heal', targetId: 'target', kind: 'healing', success: true, amount: 2.6, delta: 2.6, previousHealth: 7.8, newHealth: 10.4,
                calculation: { authored: { formula: 'level * 2' }, inputs: { level: 1.3 }, amount: 2.6 } }
        ] };
        const before = JSON.stringify(receipt);
        document.body.innerHTML = renderer.buildTechniqueResultDetailsHtml({ kind: 'technique', techniqueReceipt: receipt });
        return { text: document.body.innerText, before, after: JSON.stringify(receipt) };
    }, chat.slice(start, end));
    expect(result.text).toContain('Damage effectiveness 4: 1.3 × 2 = 3 damage');
    expect(result.text).toContain('Health: 10.4 → 7.8; actual -3 HP');
    expect(result.text).toContain('Health: 7.8 → 10.4; actual +3 HP');
    expect(result.text).toContain('inputs: level = 1.3');
    expect(result.before).toBe(result.after);
});


test('mechanics editor retains a legacy effectiveness rating without presenting it as current', async ({ page }) => {
    await page.goto(fixtureUrl);
    for (const script of ['widgets/controls.js', 'widgets/searchable-select.js', 'widgets/overlays.js', 'page-feedback.js', 'formula-evaluator.js', 'technique-formula-variables.js', 'techniques.js']) await page.addScriptTag({ path: path.join(ROOT, 'public/js', script) });
    await page.evaluate(() => {
        const root = document.querySelector('#playerTechniquesSection');
        const mechanics = { revision: 1, target: { kind: 'single' }, check: { kind: 'attack', skill: 'Strength', toughnessAttribute: 'Strength', damageEffectiveness: 2 }, costs: [], effects: [{ id: 'strike', kind: 'damage', damageMode: 'weapon', multiplier: 1, bonus: 0 }] };
        window.__readLegacyMechanics = window.TechniqueMechanicsEditor.editor(root, mechanics, []);
    });
    const check = page.getByRole('group', { name: 'Check', exact: true });
    await expect(check.getByText(/Saved legacy rating 2 is retained/i)).toBeVisible();
    await expect(check.getByLabel('Damage effectiveness', { exact: true })).toHaveCount(0);
    expect((await page.evaluate(() => window.__readLegacyMechanics())).check.damageEffectiveness).toBe(2);
    await check.getByLabel('Check kind', { exact: true }).selectOption('automatic');
    expect((await page.evaluate(() => window.__readLegacyMechanics())).check).toEqual({ kind: 'automatic' });
    await check.getByLabel('Check kind', { exact: true }).selectOption('attack');
    expect((await page.evaluate(() => window.__readLegacyMechanics())).check.damageEffectiveness).toBe(2);
});
