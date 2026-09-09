const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<input id="level" value="2"><div id="attributes"></div><span id="ap"></span><span id="aw"></span><section id="skillsSection"><div id="skills"></div></section><span id="sp"></span><span id="sw"></span>');
        await page.evaluate(() => {
            window.fetch = async () => ({ ok: true, json: async () => ({
                success: true, attributes: { intelligence: { label: 'Intelligence' } }
            }) });
        });
        for (const file of ['formula-evaluator.js', 'attribute-skill-allocator.js']) {
            await page.addScriptTag({ path: path.resolve('public/js', file) });
        }
        const results = await page.evaluate(async () => {
            const el = id => document.getElementById(id);
            const allocator = window.AttributeSkillAllocator.init({
                levelField: el('level'), attributeGrid: el('attributes'),
                attributePointsDisplay: el('ap'), attributePointsWarning: el('aw'),
                skillsSection: el('skillsSection'), skillsGrid: el('skills'),
                skillPointsDisplay: el('sp'), skillPointsWarning: el('sw'),
                defaultSkillNames: [], attributePoolBaseValue: 4, skillPoolBaseValue: 6,
                attributeFloorValues: { intelligence: 10 }, skillFloorValues: {},
                poolFormulas: { attribute: '4 + attribute.intelligence.bonus', skill: '6 + attribute.intelligence.bonus' }
            });
            await allocator.ready;
            allocator.applyLoadedValues({ attributes: { intelligence: 10 }, skills: {} });
            const initial = allocator.refreshPools(2);
            const input = document.querySelector('.attribute-input');
            input.value = '12';
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const changed = allocator.refreshPools(2);
            input.value = '10';
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { initial, changed, reverted: allocator.refreshPools(2) };
        });
        assert.deepEqual(results.initial, { attributePool: 4, skillPool: 6 });
        assert.deepEqual(results.changed, { attributePool: 3, skillPool: 7 });
        assert.deepEqual(results.reverted, results.initial);
        console.log('Point balances passed: empty skills, attribute spending, dependent formula changes, and undo.');
        const playerPools = await page.evaluate(async () => {
            const attributes = { strength: 10, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 7, charisma: 12, luck: 10 };
            window.fetch = async () => ({ ok: true, json: async () => ({
                success: true, attributes: Object.fromEntries(Object.keys(attributes).map(key => [key, { label: key }]))
            }) });
            document.getElementById('level').value = '4';
            const el = id => document.getElementById(id);
            const allocator = window.AttributeSkillAllocator.init({
                levelField: el('level'), attributeGrid: el('attributes'),
                attributePointsDisplay: el('ap'), attributePointsWarning: el('aw'),
                skillsSection: el('skillsSection'), skillsGrid: el('skills'),
                skillPointsDisplay: el('sp'), skillPointsWarning: el('sw'),
                attributeFloorValues: attributes, attributePoolBaseValue: 3, skillPoolBaseValue: 10,
                defaultSkillNames: [],
                poolFormulas: { attribute: 'ceil(level * (number_of_attributes / 2))', skill: '10' }
            });
            await allocator.ready;
            allocator.applyLoadedValues({ attributes, skills: {} });
            const initial = allocator.refreshPools(4);
            const input = document.querySelector('[name="attributes.strength"]');
            input.value = '11';
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { initial, spentOne: allocator.refreshPools(4), display: el('ap').textContent };
        });
        assert.deepEqual(playerPools.initial, { attributePool: 3, skillPool: 10 });
        assert.deepEqual(playerPools.spentOne, { attributePool: 2, skillPool: 10 });
        assert.equal(Number(playerPools.display), 2);
        console.log('Level-four, seven-attribute regression passed: 3 points available, 2 after spending one.');
        const template = fs.readFileSync(path.resolve('views/index.njk'), 'utf8');
        const start = template.indexOf('        for (const trigger of [chatSidebarElements.viewButton, chatSidebarElements.pointsIndicator])');
        const end = template.indexOf('        if (chatSidebarElements.abilitiesButton)', start);
        assert.ok(start >= 0 && end > start);
        const button = template.match(/<button[^>]*id="chatPlayerPointsIndicator"[^>]*>[\s\S]*?<\/button>/)[0];
        await page.setContent(`${button}<button id="view">View</button><section id="npcViewAttributesSection"><input id="attributeControl"></section><section id="npcViewSkillsSection"><input id="skillControl"></section>`);
        await page.evaluate(source => {
            const indicator = document.getElementById('chatPlayerPointsIndicator');
            indicator.hidden = false;
            indicator.removeAttribute('aria-hidden');
            const chatSidebarElements = { pointsIndicator: indicator, viewButton: document.getElementById('view') };
            window.calls = [];
            const fetchLatestPlayerDataForModal = async () => {
                window.calls.push('fetch');
                return { id: 'player', unspentAttributePoints: 4, unspentSkillPoints: 6 };
            };
            const showNpcViewModal = async player => { window.calls.push(player.id); };
            eval(source);
        }, template.slice(start, end));
        await page.locator('#chatPlayerPointsIndicator').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement.id === 'attributeControl');
        assert.deepEqual(await page.evaluate(() => window.calls), ['fetch', 'player']);
        assert.equal(await page.locator('#chatPlayerPointsIndicator').isEnabled(), true);
        console.log('Warning icon passed: keyboard activation, fresh player fetch, awaited modal opening, and allocation focus.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
