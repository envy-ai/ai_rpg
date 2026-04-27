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
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const drawerPath = path.join(rootDir, 'public', 'js', 'turn-state-diff-drawer.js');
const drawerSource = fs.existsSync(drawerPath) ? fs.readFileSync(drawerPath, 'utf8') : '';

class FakeCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
        this.bubbles = Boolean(options.bubbles);
        this.cancelable = Boolean(options.cancelable);
        this.defaultPrevented = false;
        this.propagationStopped = false;
    }

    preventDefault() {
        if (this.cancelable) {
            this.defaultPrevented = true;
        }
    }

    stopPropagation() {
        this.propagationStopped = true;
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || '').toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.dataset = {};
        this.listeners = new Map();
        this.className = '';
        this.id = '';
        this.hidden = false;
        this.type = '';
        this._textContent = '';
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id') {
            this.id = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(listener);
    }

    dispatchEvent(event) {
        if (!event || !event.type) {
            return true;
        }
        if (typeof event.preventDefault !== 'function') {
            event.preventDefault = () => {
                event.defaultPrevented = true;
            };
        }
        if (typeof event.stopPropagation !== 'function') {
            event.stopPropagation = () => {
                event.propagationStopped = true;
            };
        }
        const listeners = this.listeners.get(event.type) || [];
        listeners.forEach(listener => listener.call(this, event));
        if (event.bubbles && !event.propagationStopped && this.parentNode) {
            this.parentNode.dispatchEvent(event);
        }
        return !event.defaultPrevented;
    }

    get textContent() {
        return this._textContent + this.children.map(child => child.textContent || '').join('');
    }

    set textContent(value) {
        this._textContent = String(value ?? '');
        this.children = [];
    }

    get classList() {
        const element = this;
        return {
            contains(className) {
                return element.className.split(/\s+/).includes(className);
            }
        };
    }
}

function createFakeDocument() {
    return {
        createElement(tagName) {
            return new FakeElement(tagName);
        }
    };
}

function collectByClass(element, className, results = []) {
    if (!element) {
        return results;
    }
    if (element.className && element.className.split(/\s+/).includes(className)) {
        results.push(element);
    }
    (element.children || []).forEach(child => collectByClass(child, className, results));
    return results;
}

function loadDrawerApi(extraContext = {}) {
    const window = extraContext.window || {};
    const context = {
        window,
        document: extraContext.document,
        CustomEvent: extraContext.CustomEvent
    };
    if (typeof context.CustomEvent === 'function' && !window.CustomEvent) {
        window.CustomEvent = context.CustomEvent;
    }
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
    assert.match(scssSource, /\.turn-diff-drawer__entity-chip/);
    assert.match(scssSource, /\.turn-diff-drawer__entity-chip--clickable/);
    assert.match(scssSource, /\.turn-diff-drawer__toggle:focus-visible/);
    assert.match(scssSource, /\.turn-diff-drawer__entity-chip--clickable:focus-visible/);
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

test('turn diff rows are ordered by severity inside drawer categories', () => {
    const drawer = loadDrawerApi();
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [
            { icon: '•', category: 'character', severity: 'normal', text: 'Minor scratch.' },
            { icon: '☠', category: 'character', severity: 'critical', text: 'Mara died.' },
            { icon: '!', category: 'character', severity: 'important', text: 'Mara took damage.' }
        ]
    }]);

    assert.deepEqual(summary.rows.map(row => row.text), [
        'Mara died.',
        'Mara took damage.',
        'Minor scratch.'
    ]);
});

test('drawer renders exact entity chips and dispatches id-backed selection events', () => {
    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });

    const element = drawer.createDrawer([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '✅',
            text: 'Quest objective complete: Speak with Mara.',
            category: 'quest_reward',
            severity: 'important',
            sourceType: 'completed_quest_objective',
            entityRefs: [
                { type: 'npc', id: 'npc-mara', name: 'Mara' },
                { type: 'quest', name: 'The Lost Bell' }
            ]
        }]
    }], { open: true });

    const row = collectByClass(element, 'turn-diff-drawer__row')[0];
    assert.equal(row.dataset.sourceType, 'completed_quest_objective');
    assert.equal(row.dataset.severity, 'important');

    const chips = collectByClass(element, 'turn-diff-drawer__entity-chip');
    assert.equal(chips.length, 2);
    assert.equal(chips[0].tagName, 'BUTTON');
    assert.equal(chips[0].dataset.entityType, 'npc');
    assert.equal(chips[0].dataset.entityId, 'npc-mara');
    assert.equal(chips[0].dataset.entityName, 'Mara');
    assert.equal(chips[0].classList.contains('turn-diff-drawer__entity-chip--clickable'), true);
    assert.equal(chips[1].tagName, 'SPAN');
    assert.equal(chips[1].dataset.entityType, 'quest');
    assert.equal(chips[1].dataset.entityName, 'The Lost Bell');
    assert.equal(chips[1].classList.contains('turn-diff-drawer__entity-chip--clickable'), false);

    let selectedDetail = null;
    element.addEventListener('airpg:turn-diff-entity-selected', event => {
        selectedDetail = event.detail;
    });

    chips[0].dispatchEvent({
        type: 'click',
        bubbles: true,
        cancelable: true
    });

    assert.equal(selectedDetail.type, 'npc');
    assert.equal(selectedDetail.id, 'npc-mara');
    assert.equal(selectedDetail.name, 'Mara');
    assert.equal(selectedDetail.sourceType, 'completed_quest_objective');

    selectedDetail = null;
    chips[1].dispatchEvent({
        type: 'click',
        bubbles: true,
        cancelable: true
    });
    assert.equal(selectedDetail, null);
});

test('phase 3 drawer docs describe entity chips and severity ordering', () => {
    assert.match(chatDocSource, /entity chips/i);
    assert.match(chatDocSource, /id-backed/i);
    assert.match(chatDocSource, /name-only/i);
    assert.match(chatDocSource, /severity/i);
});

test('chat page routes exact turn diff entity selection events to existing UI targets', () => {
    assert.match(viewSource, /airpg:turn-diff-entity-selected/);
    assert.match(viewSource, /handleTurnDiffEntitySelected/);
    assert.match(viewSource, /showNpcViewModal\(\{ id,/);
    assert.match(viewSource, /openLocationContextMenuForLocationId\(id\)/);
    assert.match(viewSource, /fetchThingDetails\(id\)/);
    assert.match(viewSource, /openThingContainerModal\(thing/);
    assert.match(viewSource, /activateTurnDiffEntityPanel\('quests'\)/);
    assert.match(viewSource, /activateTurnDiffEntityPanel\('factions'\)/);
    assert.match(scssSource, /\.turn-diff-drawer__entity-target-highlight/);
});

test('common API docs describe phase 2 summary item metadata', () => {
    assert.match(commonDocSource, /`severity`:\s*string/);
    assert.match(commonDocSource, /`sourceType`:\s*string \| null/);
    assert.match(commonDocSource, /`entityRefs`:\s*array/);
});
