const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const commonDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'common.md'), 'utf8');
const drawerPath = path.join(rootDir, 'public', 'js', 'turn-state-diff-drawer.js');
const drawerSource = fs.existsSync(drawerPath) ? fs.readFileSync(drawerPath, 'utf8') : '';

function loadDrawerApi() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(drawerSource, context, { filename: drawerPath });
    return context.window.TurnStateDiffDrawer;
}

test('turn state diff drawer script is loaded before chat controller', () => {
    assert.ok(fs.existsSync(drawerPath), 'turn-state-diff-drawer.js should exist');
    const drawerScriptIndex = viewSource.indexOf('<script src="/js/turn-state-diff-drawer.js"></script>');
    const chatScriptIndex = viewSource.indexOf('<script src="/js/chat.js"></script>');
    assert.notEqual(drawerScriptIndex, -1, 'turn state diff drawer script should be included');
    assert.notEqual(chatScriptIndex, -1, 'chat.js script should be included');
    assert.ok(drawerScriptIndex < chatScriptIndex, 'drawer script should load before chat.js');
});

test('chat history rendering tracks parent-linked turn diff entries separately from insight attachments', () => {
    assert.match(chatSource, /getTurnDiffEntryTypes\(\)\s*\{[\s\S]*event-summary[\s\S]*status-summary[\s\S]*\}/);
    assert.match(chatSource, /turnDiffEntries:\s*\[\]/);
    assert.match(chatSource, /pendingTurnDiffEntries/);
    assert.match(chatSource, /createChatMessageElement\(entry,\s*attachments,\s*turnDiffEntries\)/);

    const attachmentTypesMatch = chatSource.match(/getAttachmentTypes\(\)\s*\{[\s\S]*?return new Set\(\[([\s\S]*?)\]\);[\s\S]*?\}/);
    assert.ok(attachmentTypesMatch, 'getAttachmentTypes should return an explicit Set');
    assert.doesNotMatch(attachmentTypesMatch[1], /event-summary/);
    assert.doesNotMatch(attachmentTypesMatch[1], /status-summary/);
});

test('live chat rendering keeps a parent element for turn diff drawer updates', () => {
    assert.match(chatSource, /context\.playerActionElement\s*=/);
    assert.match(chatSource, /addMessage\(sender,\s*content,\s*isError\s*=\s*false,[\s\S]*return messageDiv;/);
    assert.match(chatSource, /startEventBundle\([\s\S]*parentElement/);
    assert.match(chatSource, /startStatusBundle\([\s\S]*parentElement/);
    assert.match(chatSource, /appendTurnDiffDrawer/);
});

test('async disposition changes use a dedicated summary batch renderer', () => {
    assert.match(chatSource, /renderDispositionSummaryBatch\(items\)/);
    assert.match(chatSource, /messageDiv\.className = 'message event-summary-batch disposition-summary-batch'/);
    assert.match(chatSource, /senderDiv\.textContent = '💞 Disposition Changes'/);
    assert.match(chatSource, /this\.renderDispositionSummaryBatch\(summaryItems\)/);
});

test('turn state diff drawer styles are scoped and keyboard-visible', () => {
    assert.match(scssSource, /\.turn-diff-drawer/);
    assert.match(scssSource, /\.turn-diff-drawer__toggle/);
    assert.match(scssSource, /\.turn-diff-drawer__category-chip/);
    assert.match(scssSource, /\.turn-diff-drawer__group/);
    assert.match(scssSource, /\.turn-diff-drawer__toggle:focus-visible/);
    assert.match(scssSource, /content:\s*"▶"/);
    assert.doesNotMatch(scssSource, /content:\s*">"/);
});

test('disposition changes get their own drawer category', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: 'Events - Disposition Check (Mara)',
        summaryItems: [{
            icon: '💞',
            category: 'disposition',
            text: "Mara's Trust disposition Δ +2 - kept a promise"
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].category, 'disposition');
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['disposition']);
    assert.deepEqual(Array.from(summary.categories, category => category.label), ['Dispositions']);
});


test('custom need bar changes are categorized as needs even when their reason mentions time', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: 'Events - Player Turn',
        summaryItems: [{
            icon: '!',
            category: 'needs',
            text: "Mara's Exhaustion small decrease Δ -3 - time passed"
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].category, 'needs');
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['needs']);
});

test('explicit inventory category keeps harvested items out of quests', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: '🌾 Harvest Results',
        summaryItems: [{
            icon: '🌾',
            category: 'inventory',
            text: "Exis harvested Captain Vassmera's Lucky Saber, Scrimshaw Dagger of Questionable Provenance, Oilcloth Bundle of the Forgotten Hero from The Gossiping Armory Stand."
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].category, 'inventory');
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['inventory']);
});

test('actual quest objective text still categorizes as quests', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '✅',
            category: 'quest_reward',
            text: 'Quest objective complete: Return the saber to Captain Vassmera.'
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].category, 'quest_reward');
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['quest_reward']);
});

test('drawer does not infer categories from uncategorized event text', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: '🌾 Harvest Results',
        summaryItems: [{
            icon: '🌾',
            text: "Exis harvested Captain Vassmera's Lucky Saber, Scrimshaw Dagger of Questionable Provenance, Oilcloth Bundle of the Forgotten Hero from The Gossiping Armory Stand."
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].category, 'other');
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['other']);
});

test('server and live bundles preserve explicit summary item categories', () => {
    assert.match(apiSource, /category:\s*normalizeSummaryCategory\(item\?\.category\)/);
    assert.match(chatSource, /pushEventBundleItem\(icon,\s*text,\s*category\s*=\s*'other'/);
    assert.match(chatSource, /category:\s*this\.normalizeTurnDiffCategory\(item\.category\)/);
});

test('phase 2 summary metadata is preserved for server and live drawer rows', () => {
    assert.match(apiSource, /function normalizeSummarySeverity\(value,\s*fallback = 'normal'\)/);
    assert.match(apiSource, /function normalizeSummarySourceType\(value\)/);
    assert.match(apiSource, /function normalizeSummaryEntityRefs\(refs\)/);
    assert.match(apiSource, /severity:\s*normalizeSummarySeverity\(item\?\.severity\)/);
    assert.match(apiSource, /sourceType:\s*normalizeSummarySourceType\(item\?\.sourceType\)/);
    assert.match(apiSource, /entityRefs:\s*normalizeSummaryEntityRefs\(item\?\.entityRefs\)/);

    assert.match(chatSource, /pushEventBundleItem\(icon,\s*text,\s*category\s*=\s*'other',\s*metadata\s*=\s*\{\}/);
    assert.match(chatSource, /severity:\s*this\.normalizeTurnDiffSeverity\(item\.severity\)/);
    assert.match(chatSource, /sourceType:\s*this\.normalizeTurnDiffSourceType\(item\.sourceType\)/);
    assert.match(chatSource, /entityRefs:\s*this\.normalizeTurnDiffEntityRefs\(item\.entityRefs\)/);

    assert.match(drawerSource, /entityRefs:\s*normalizeEntityRefs\(item\.entityRefs\)/);
});

test('common API docs describe phase 2 summary item metadata', () => {
    assert.match(commonDocSource, /`severity`:\s*string/);
    assert.match(commonDocSource, /`sourceType`:\s*string \| null/);
    assert.match(commonDocSource, /`entityRefs`:\s*array/);
});
