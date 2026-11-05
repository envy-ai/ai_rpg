const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const url = 'http://0.0.0.0:4173/';
const base = '/api/players/fixture-player/abilities/ability-a/attachments';
const expected = { world: 'fixture-v1', ability: 'baseline' };
const generatedExpected = { world: 'fixture-v1', ability: 'generated' };
const generated = { statusEffects: [{ id: 'status-existing', name: 'Sturdy Frame', description: 'Bolsters resilience.', duration: -1, maxHealthPercent: 20, attributes: [{ attribute: 'strength', modifier: 2, percentModifier: 10 }], skills: [{ skill: 'Athletics', modifier: -1, percentModifier: -5 }], techniqueEntries: [{ id: 'grant-existing', techniqueId: 'technique-ward', definitionRevision: 1, provenance: { kind: 'training', reason: 'Saved origin.' } }] }] };

async function setup(page, { existing = false, fixtureDraft = null, techniqueContext = null } = {}) {
    const writes = [], errors = [];
    let rejectApply = false;
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.route('**/*', async route => {
        const request = route.request(), requestUrl = new URL(request.url());
        if (requestUrl.hostname === 'fonts.googleapis.com') { await route.fulfill({ contentType: 'text/css', body: '' }); return; }
        if (requestUrl.origin !== new URL(url).origin) { await route.abort(); return; }
        const pathname = requestUrl.pathname;
        if (pathname === '/') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="container"><button id="open">Edit ability</button></main></body></html>' }); return; }
        if (pathname === '/api/techniques') { await route.fulfill({ json: techniqueContext || { catalog: [{ id: 'technique-ward', name: 'Ward' }], disciplines: [], formulaVariables: [] } }); return; }
        if (pathname === base && request.method() === 'GET') { await route.fulfill({ json: { ability: { name: 'Sturdy Frame' }, draft: fixtureDraft || (existing ? generated : { statusEffects: [] }), expected } }); return; }
        if (pathname === `${base}/generate` && request.method() === 'POST') { writes.push({ method: 'POST', body: request.postDataJSON() }); await route.fulfill({ json: { draft: generated, expected: generatedExpected } }); return; }
        if (pathname === base && request.method() === 'PUT') {
            writes.push({ method: 'PUT', body: request.postDataJSON() });
            if (rejectApply) { await route.fulfill({ status: 409, json: { error: 'Stale attachment draft', stack: 'Error: Stale attachment draft\n    at applyAttachment (fixture.js:17:3)' } }); return; }
            await route.fulfill({ json: { success: true, ability: { id: 'ability-a', statusEffects: request.postDataJSON().draft.statusEffects } } }); return;
        }
        await route.fulfill({ status: 404, body: `Unexpected request ${request.method()} ${pathname}` });
    });
    await page.goto(url);
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/overlays.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/searchable-select.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/techniques.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/ability-attachments.js') });
    await page.evaluate(() => {
        window.__applied = [];
        document.querySelector('#open').addEventListener('click', () => window.AbilityAttachmentsEditor.open({ actorId: 'fixture-player', abilityId: 'ability-a', trigger: document.querySelector('#open'), onApplied: result => window.__applied.push(result) }));
    });
    await page.locator('#open').click();
    await expect(page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' })).toBeVisible();
    return { writes, errors, rejectApply: () => { rejectApply = true; } };
}

test('generated attachments remain editable draft until apply and retain fixed and percentage modifiers', async ({ page }) => {
    const fixture = await setup(page);
    const dialog = page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' });
    await dialog.getByRole('button', { name: 'Generate attachments' }).click();
    await expect(dialog.getByRole('status')).toContainText('draft ready');
    expect(fixture.writes.map(write => write.method)).toEqual(['POST']);
    expect(await page.evaluate(() => window.__applied)).toEqual([]);
    await expect(dialog.getByLabel('Maximum health bonus (%)')).toHaveValue('20');
    const attribute = dialog.getByRole('group', { name: 'Attribute modifiers', exact: true });
    await expect(attribute.getByLabel('Fixed modifier')).toHaveValue('2');
    await expect(attribute.getByLabel('Percent modifier (%)')).toHaveValue('10');
    const skill = dialog.getByRole('group', { name: 'Skill modifiers', exact: true });
    await expect(skill.getByLabel('Fixed modifier')).toHaveValue('-1');
    await expect(skill.getByLabel('Percent modifier (%)')).toHaveValue('-5');
    await expect(dialog.locator('label').filter({ has: page.locator('span').getByText('World technique', { exact: true }) }).locator('select')).toHaveValue('technique-ward');
    await dialog.getByLabel('Maximum health bonus (%)').fill('25');
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'tmp/ability-attachments-desktop.png') });
    await dialog.getByRole('button', { name: 'Apply attachments' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#open')).toBeFocused();
    expect(fixture.writes.map(write => write.method)).toEqual(['POST', 'PUT']);
    expect(fixture.writes[1].body).toEqual({ draft: { statusEffects: [{ ...generated.statusEffects[0], maxHealthPercent: 25 }] }, expected: generatedExpected });
    expect(await page.evaluate(() => window.__applied.length)).toBe(1);
    expect(fixture.errors).toEqual([]);
});

test('failed apply retains edited draft and original server stack on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await setup(page);
    fixture.rejectApply();
    const dialog = page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' });
    await dialog.getByRole('button', { name: 'Generate attachments' }).click();
    await dialog.getByLabel('Maximum health bonus (%)').fill('23');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(ROOT, 'tmp/ability-attachments-mobile.png') });
    await dialog.getByRole('button', { name: 'Apply attachments' }).click();
    const error = page.getByRole('dialog', { name: 'Operation stopped' });
    await expect(error).toContainText('Stale attachment draft');
    await expect(error).toContainText('fixture.js:17:3');
    await error.getByRole('button', { name: 'Close' }).click();
    await expect(dialog.getByLabel('Maximum health bonus (%)')).toHaveValue('23');
    expect(await page.evaluate(() => window.__applied)).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#open')).toBeFocused();
    expect(fixture.errors).toEqual([]);
});


test('unchanged saved effect and pinned grant IDs survive attachment editing', async ({ page }) => {
    const fixture = await setup(page, { existing: true });
    const dialog = page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' });
    await dialog.getByRole('button', { name: 'Apply attachments' }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.writes).toEqual([{ method: 'PUT', body: { draft: generated, expected } }]);
    expect(fixture.errors).toEqual([]);
});

test('technique buff editor preserves percentage values and nested status grants', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
        const status = { name: 'Shielded', description: 'A ward.', duration: 5, maxHealthPercent: 20,
            attributes: [{ attribute: 'strength', modifier: 2, percentModifier: -10 }],
            skills: [{ skill: 'Athletics', modifier: -1, percentModifier: 15 }], needBars: [],
            techniqueGrants: [{ id: 'nested', sourceStatusId: 'shield-status', techniqueId: 'technique-ward', definitionRevision: 1 }] };
        const root = document.createElement('div');
        document.body.append(root);
        const read = window.TechniqueMechanicsEditor.editor(root, { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'buff', kind: 'buff', status, stacking: 'refresh', refreshPolicy: 'stronger' }], acquisitionRequirements: [], useRequirements: [] }, []);
        return read().effects[0].status;
    });
    expect(result.maxHealthPercent).toBe(20);
    expect(result.attributes).toEqual([{ attribute: 'strength', modifier: 2, percentModifier: -10 }]);
    expect(result.skills).toEqual([{ skill: 'Athletics', modifier: -1, percentModifier: 15 }]);
    expect(result.techniqueGrants).toEqual([{ id: 'nested', sourceStatusId: 'shield-status', techniqueId: 'technique-ward', definitionRevision: 1 }]);
});

test('nested v2 recipe and utility candidates preserve the full actor authoring context', async ({ page }) => {
    const authoring = { availableRecipeKinds: ['healing', 'buff'], skills: [{ name: 'Spellcasting' }], attributes: [{ name: 'Strength' }], resourceProfiles: [{ resourceProfileId: 'mana' }], status: { standard: { fixedMagnitude: 1, percentMagnitude: 5, durationMinutes: 3 } } };
    const candidate = (name, revision) => ({ name, description: `${name} description.`, semanticKey: name.toLowerCase(), disciplineId: 'discipline-test', aliases: [], revisions: [revision] });
    const common = { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, acquisitionRequirements: [], useRequirements: [] };
    const fixtureDraft = { statusEffects: [{ name: 'Attached', description: 'An attached effect.', duration: -1, attributes: [], skills: [], techniqueEntries: [
        { candidate: candidate('Mixed', { ...common, recipe: { recipeId: 'standard-components', components: [{ kind: 'buff', effectId: 'buff', skillName: 'Spellcasting', resourceProfileId: 'mana', statusStatKind: 'attribute', statusStatName: 'Strength', statusModifierKind: 'percent', statusName: 'Blessed', statusDescription: 'A blessing.' }] } }) },
        { candidate: candidate('Travel', { ...common, costs: [], effects: [{ id: 'travel', kind: 'teleport', destinationId: 'loc-destination' }] }) }
    ] }] };
    const context = { catalog: [], disciplines: [{ id: 'discipline-test', name: 'Practice' }], formulaVariables: [], balanceAuthoring: authoring, utilityContext: { destinations: [{ id: 'loc-destination', name: 'Destination' }] } };
    const fixture = await setup(page, { fixtureDraft, techniqueContext: context });
    const dialog = page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' });
    await expect(dialog.getByLabel('Component', { exact: true })).toHaveValue('buff');
    await expect(dialog.getByLabel('Status modifier', { exact: true })).toHaveValue('percent');
    await expect(dialog.getByLabel('Destination (optional; choose at use time if empty)', { exact: true })).toHaveValue('Destination · loc-destination');
    await dialog.getByRole('button', { name: 'Apply attachments' }).click();
    await expect(dialog).toHaveCount(0);
    const entries = fixture.writes[0].body.draft.statusEffects[0].techniqueEntries;
    expect(entries[0].candidate.revisions[0].recipe.components[0].statusModifierKind).toBe('percent');
    expect(entries[1].candidate.revisions[0].effects[0].destinationId).toBe('loc-destination');
    expect(fixture.errors).toEqual([]);
});

test('removing nested attachment rows changes only their serialized entries and releases old controls', async ({ page }) => {
    const fixture = await setup(page);
    const dialog = page.getByRole('dialog', { name: 'Edit attachments for Sturdy Frame' });
    await dialog.getByRole('button', { name: 'Generate attachments' }).click();
    await expect(dialog.getByRole('status')).toContainText('draft ready');
    const attribute = dialog.getByRole('group', { name: 'Attribute modifiers', exact: true });
    await attribute.getByRole('button', { name: 'Remove', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove technique' }).click();
    await page.evaluate(() => { window.oldAddAttribute = [...document.querySelectorAll('button')].find(button => button.textContent === 'Add attribute modifier'); });
    await dialog.getByRole('button', { name: 'Apply attachments' }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.writes[1].body.draft.statusEffects[0]).toMatchObject({ attributes: [], techniqueEntries: [], skills: generated.statusEffects[0].skills });
    await page.evaluate(() => window.oldAddAttribute.click());
    expect(fixture.errors).toEqual([]);
});
