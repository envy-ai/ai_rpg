const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const playerSource = fs.readFileSync(path.join(rootDir, 'Player.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const mapSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'map.js'), 'utf8');
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

    get childNodes() {
        return this.children;
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
        },
        createDocumentFragment() {
            return new FakeElement('#fragment');
        },
        createTextNode(text) {
            const node = new FakeElement('#text');
            node.textContent = text;
            return node;
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

function extractClassMethod(source, methodName) {
    const start = source.indexOf(`    ${methodName}(`);
    assert.notEqual(start, -1, `${methodName} should exist`);
    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `${methodName} should have parameters`);
    let parenDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            parenDepth += 1;
        } else if (char === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `${methodName} should close parameters`);
    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `${methodName} should have a body`);
    let braceDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }
    assert.fail(`${methodName} body should close`);
}

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
    let braceDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }
    assert.fail(`${functionName} body should close`);
}

function loadChatHistoryHarness() {
    const methodSources = [
        extractClassMethod(chatSource, 'getAttachmentTypes'),
        extractClassMethod(chatSource, 'getTurnDiffEntryTypes'),
        extractClassMethod(chatSource, 'getClientMessageHistoryConfig'),
        extractClassMethod(chatSource, 'getServerHistoryTurnAnchorIndexes'),
        extractClassMethod(chatSource, 'pruneServerHistoryIfNeeded'),
        extractClassMethod(chatSource, 'renderChatHistory')
    ];
    const document = createFakeDocument();
    const context = {
        document,
        window: {
            AIRPG_CONFIG: {
                clientMessageHistory: {
                    maxMessages: 1,
                    pruneTo: 1
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(`
class Harness {
    constructor() {
        this.serverHistory = [];
        this.chatLog = document.createElement('div');
        this.systemMessage = { role: 'system', content: 'System.' };
        this.messageRegistry = new Map();
        this.chatBubbleTypes = new Map();
        this.renderedEntries = [];
    }
${methodSources.join('\n')}
    getLatestPlayerActionEntry() {
        return null;
    }
    getEntryKey() {
        return null;
    }
    isLegacyDirectTravelSummaryEntry() {
        return false;
    }
    findLegacyDirectTravelDrawerParentId() {
        return null;
    }
    createChatMessageElement(entry, attachments = [], turnDiffEntries = []) {
        this.renderedEntries.push({ entry, attachments, turnDiffEntries });
        const element = document.createElement('div');
        element.textContent = entry.id || entry.type || entry.role || '';
        return element;
    }
    decorateChatBubbleElement() {}
    syncChatBubbleTypesFromDom() {}
    renderChatBubbleFilterOptions() {}
    applyChatBubbleFilters() {}
    scrollToBottom() {}
}
this.Harness = Harness;
`, context);
    return new context.Harness();
}

function loadServerOrphanFilterHarness() {
    const context = {
        HIDDEN_CHAT_ENTRY_TYPES: new Set([
            'supplemental-story-info',
            'offscreen-npc-activity-daily',
            'offscreen-npc-activity-weekly',
            'scheduled-event',
            'while-you-were-away',
            'plot-summary',
            'plot-expander'
        ])
    };
    vm.createContext(context);
    vm.runInContext(`
${extractFunction(serverSource, 'isHiddenChatEntry')}
${extractFunction(serverSource, 'filterOrphanedChatEntries')}
this.filterOrphanedChatEntries = filterOrphanedChatEntries;
`, context);
    return context.filterOrphanedChatEntries;
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
    assert.match(chatSource, /isLegacyDirectTravelSummaryEntry\(entry\)/);
    assert.match(chatSource, /findLegacyDirectTravelDrawerParentId\(entryIndex\)/);
    assert.match(chatSource, /candidate\.type === 'while-you-were-away-player'/);

    const attachmentTypesMatch = chatSource.match(/getAttachmentTypes\(\)\s*\{[\s\S]*?return new Set\(\[([\s\S]*?)\]\);[\s\S]*?\}/);
    assert.ok(attachmentTypesMatch, 'getAttachmentTypes should return an explicit Set');
    assert.doesNotMatch(attachmentTypesMatch[1], /event-summary/);
    assert.doesNotMatch(attachmentTypesMatch[1], /status-summary/);
});

test('client pruning drops parent-linked turn diff entries when their parent aged out', () => {
    const harness = loadChatHistoryHarness();
    harness.serverHistory = [
        { id: 'old-user', role: 'user', content: 'Old action.' },
        { id: 'old-parent', role: 'assistant', type: 'player-action', content: 'Old result.' },
        { id: 'new-user', role: 'user', content: 'New action.' },
        {
            id: 'old-event-summary',
            role: 'assistant',
            type: 'event-summary',
            parentId: 'old-parent',
            summaryItems: [{ text: 'Old item changed.' }]
        },
        {
            id: 'old-status-summary',
            role: 'assistant',
            type: 'status-summary',
            parentId: 'old-parent',
            summaryItems: [{ text: 'Old status changed.' }]
        }
    ];

    assert.equal(harness.pruneServerHistoryIfNeeded(), true);
    assert.deepEqual(harness.serverHistory.map(entry => entry.id), ['new-user']);
});

test('chat history rendering does not render unresolved parent-linked turn diff entries as standalone rows', () => {
    const harness = loadChatHistoryHarness();
    harness.serverHistory = [
        { id: 'visible-user', role: 'user', content: 'Visible action.' },
        {
            id: 'orphan-event-summary',
            role: 'assistant',
            type: 'event-summary',
            parentId: 'missing-parent',
            summaryItems: [{ text: 'Old item changed.' }]
        }
    ];

    harness.renderChatHistory();

    assert.deepEqual(
        Array.from(harness.renderedEntries, record => record.entry.id),
        ['visible-user']
    );
});

test('server orphan filtering drops parent-linked turn diff entries with missing parents but keeps standalone summaries', () => {
    const filterOrphanedChatEntries = loadServerOrphanFilterHarness();
    const filtered = filterOrphanedChatEntries([
        { id: 'visible-user', role: 'user', content: 'Visible action.' },
        {
            id: 'attached-event-summary',
            role: 'assistant',
            type: 'event-summary',
            parentId: 'visible-user',
            summaryItems: [{ text: 'Attached event.' }]
        },
        {
            id: 'orphan-event-summary',
            role: 'assistant',
            type: 'event-summary',
            parentId: 'missing-parent',
            summaryItems: [{ text: 'Orphan event.' }]
        },
        {
            id: 'standalone-event-summary',
            role: 'assistant',
            type: 'event-summary',
            summaryItems: [{ text: 'Standalone event.' }]
        },
        {
            id: 'orphan-status-summary',
            role: 'assistant',
            type: 'status-summary',
            parentId: 'missing-parent',
            summaryItems: [{ text: 'Orphan status.' }]
        }
    ]);

    assert.deepEqual(
        filtered.map(entry => entry.id),
        ['visible-user', 'attached-event-summary', 'standalone-event-summary']
    );
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
    assert.match(chatSource, /createDispositionSummaryRows\(items\)/);
    assert.match(chatSource, /this\.renderDispositionSummaryBatch\(summaryItems\)/);
});

test('disposition definition icons are preserved in applied summary metadata', () => {
    assert.match(playerSource, /const icon = typeof config\.icon === 'string'/);
    assert.match(playerSource, /description,\s*icon,\s*moveUp,/);
    assert.match(apiSource, /typeIcon:\s*typeDefinition\.icon \|\| null/);
    assert.match(apiSource, /dispositionChange:\s*\{/);
    assert.match(apiSource, /icon:\s*dispositionIcon/);
});

test('turn state diff drawer styles are scoped and keyboard-visible', () => {
    assert.match(scssSource, /\.turn-diff-drawer/);
    assert.match(scssSource, /\.turn-diff-drawer--empty/);
    assert.match(scssSource, /\.turn-diff-drawer__toggle/);
    assert.match(scssSource, /&:disabled/);
    assert.match(scssSource, /\.turn-diff-drawer__category-chip/);
    assert.match(scssSource, /\.turn-diff-drawer__elapsed-time/);
    assert.match(scssSource, /\.turn-diff-drawer__group/);
    assert.match(scssSource, /\.turn-diff-drawer__entity-chip/);
    assert.match(scssSource, /\.turn-diff-drawer__entity-chip--clickable/);
    assert.match(scssSource, /\.turn-diff-drawer__new-exit-pill/);
    assert.match(scssSource, /\.event-summary-new-exit-pill/);
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

test('disposition drawer rows collapse by character with icon delta pills', () => {
    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });

    const element = drawer.createDrawer([{
        type: 'event-summary',
        summaryTitle: 'Events - Disposition Check (Bob)',
        summaryItems: [{
            icon: '🙂',
            category: 'disposition',
            text: "Bob's Platonic disposition Δ +1 - shared a joke",
            metadata: {
                dispositionChange: {
                    npcId: 'npc-bob',
                    npcName: 'Bob',
                    typeLabel: 'Platonic',
                    icon: '🙂',
                    delta: 1,
                    text: "Bob's Platonic disposition Δ +1 - shared a joke"
                }
            }
        }, {
            icon: '❤️',
            category: 'disposition',
            text: "Bob's Romantic disposition Δ +4 - meaningful gift",
            metadata: {
                dispositionChange: {
                    npcId: 'npc-bob',
                    npcName: 'Bob',
                    typeLabel: 'Romantic',
                    icon: '❤️',
                    delta: 4,
                    text: "Bob's Romantic disposition Δ +4 - meaningful gift"
                }
            }
        }, {
            icon: '🔥',
            category: 'disposition',
            text: "Bob's Lust disposition Δ +0",
            metadata: {
                dispositionChange: {
                    npcId: 'npc-bob',
                    npcName: 'Bob',
                    typeLabel: 'Lust',
                    icon: '🔥',
                    delta: 0,
                    text: "Bob's Lust disposition Δ +0"
                }
            }
        }]
    }], { open: true });

    const rows = collectByClass(element, 'turn-diff-drawer__disposition-row');
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /Bob/);
    assert.match(rows[0].textContent, /🙂\+1/);
    assert.match(rows[0].textContent, /❤️\+4/);
    assert.doesNotMatch(rows[0].textContent, /🔥\+0/);
    assert.match(rows[0].textContent, /shared a joke/);
    assert.match(rows[0].textContent, /meaningful gift/);
});

test('need drawer rows collapse by character with icon delta pills', () => {
    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });

    const element = drawer.createDrawer([{
        type: 'event-summary',
        summaryTitle: 'Events - Player Turn',
        summaryItems: [{
            icon: '🍗',
            category: 'needs',
            sourceType: 'need_bar_change',
            text: "Bob's Hunger small decrease Δ -3 – missed lunch",
            metadata: {
                needBarChange: {
                    actorId: 'npc-bob',
                    actorName: 'Bob',
                    needBarName: 'Hunger',
                    icon: '🍗',
                    delta: -3,
                    deltaText: '-3',
                    text: "Bob's Hunger small decrease Δ -3 – missed lunch"
                }
            }
        }, {
            icon: '💧',
            category: 'needs',
            sourceType: 'need_bar_change',
            text: "Bob's Thirst medium decrease Δ -6 – desert heat",
            metadata: {
                needBarChange: {
                    actorId: 'npc-bob',
                    actorName: 'Bob',
                    needBarName: 'Thirst',
                    icon: '💧',
                    delta: -6,
                    deltaText: '-6',
                    text: "Bob's Thirst medium decrease Δ -6 – desert heat"
                }
            }
        }, {
            icon: '⚡',
            category: 'needs',
            sourceType: 'need_bar_change',
            text: "Bob's Stamina all increase Δ +1000 – fully recovered",
            metadata: {
                needBarChange: {
                    actorId: 'npc-bob',
                    actorName: 'Bob',
                    needBarName: 'Stamina',
                    icon: '⚡',
                    delta: 10,
                    deltaText: '+1000',
                    max: 1000,
                    text: "Bob's Stamina all increase Δ +1000 – fully recovered"
                }
            }
        }, {
            icon: '🧘',
            category: 'needs',
            sourceType: 'need_bar_change',
            text: "Bob's Calm changed – already centered",
            metadata: {
                needBarChange: {
                    actorId: 'npc-bob',
                    actorName: 'Bob',
                    needBarName: 'Calm',
                    icon: '🧘',
                    delta: 0,
                    deltaText: null,
                    text: "Bob's Calm changed – already centered"
                }
            }
        }, {
            icon: '🛌',
            category: 'needs',
            sourceType: 'need_bar_change',
            text: "Alice's Rest small increase Δ +2 – short break",
            metadata: {
                needBarChange: {
                    actorId: 'npc-alice',
                    actorName: 'Alice',
                    needBarName: 'Rest',
                    icon: '🛌',
                    delta: 2,
                    deltaText: '+2',
                    text: "Alice's Rest small increase Δ +2 – short break"
                }
            }
        }]
    }], { open: true });

    const rows = collectByClass(element, 'turn-diff-drawer__need-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /Bob/);
    assert.match(rows[0].textContent, /🍗-3/);
    assert.match(rows[0].textContent, /💧-6/);
    assert.match(rows[0].textContent, /⚡\+1000/);
    assert.match(rows[0].textContent, /🧘/);
    assert.doesNotMatch(rows[0].textContent, /🧘[+-]?0/);
    assert.match(rows[0].textContent, /missed lunch/);
    assert.match(rows[0].textContent, /fully recovered/);
    assert.match(rows[0].textContent, /already centered/);
    assert.match(rows[1].textContent, /Alice/);
    assert.match(rows[1].textContent, /🛌\+2/);
});

test('need summary metadata is emitted for grouped drawer rows', () => {
    assert.match(apiSource, /needBarChange:\s*\{/);
    assert.match(apiSource, /deltaText/);
    assert.match(apiSource, /formatNeedBarDisplayDelta\(entry,\s*delta,\s*rawBarName\)/);
    assert.match(apiSource, /magnitude === 'all' \|\| magnitude === 'fill'/);
    assert.match(chatSource, /needBarChange:\s*\{/);
    assert.match(chatSource, /resolveNeedBarMaxValue\(change,\s*barName\)/);
    assert.match(chatSource, /magnitude === 'all' \|\| magnitude === 'fill'/);
    assert.match(chatSource, /const deltaText = this\.formatNeedBarDelta\(change,\s*delta,\s*barName,\s*\{\s*roundNonHealth:\s*true\s*\}\);\s*if \(deltaText\)/);
    assert.doesNotMatch(chatSource, /Number\.isFinite\(delta\) && delta !== 0/);
    assert.match(drawerSource, /function createNeedRows\(rows,\s*options\)/);
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

test('routine elapsed time rows render in the drawer header instead of the Time category', () => {
    const entries = [{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '⏳',
            category: 'time',
            sourceType: 'time_passed',
            text: '2 minutes passed.'
        }, {
            icon: '💡',
            category: 'time',
            sourceType: 'world_time_transition',
            text: 'Light level changed from day to evening.'
        }]
    }];

    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });
    const summary = drawer.summarizeTurnDiff(entries);

    assert.equal(summary.total, 2);
    assert.equal(summary.changeCount, 1);
    assert.equal(summary.elapsedTimeText, '⏳ 2 minutes passed.');
    assert.equal(summary.elapsedTimeRows.length, 1);
    assert.deepEqual(Array.from(summary.categories, category => category.category), ['time']);
    assert.deepEqual(summary.bodyRows.map(row => row.text), ['Light level changed from day to evening.']);

    const element = drawer.createDrawer(entries, { open: true });
    const toggle = collectByClass(element, 'turn-diff-drawer__toggle')[0];
    assert.equal(toggle.textContent, 'What changed (1)');
    assert.equal(toggle.disabled, undefined);
    const elapsedHeader = collectByClass(element, 'turn-diff-drawer__elapsed-time')[0];
    assert.equal(elapsedHeader.textContent, '⏳ 2 minutes passed.');
    assert.equal(collectByClass(element, 'turn-diff-drawer__row').length, 1);
});

test('Time category is omitted when it only contains routine elapsed time', () => {
    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });
    const summary = drawer.summarizeTurnDiff([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '⏳',
            category: 'time',
            sourceType: 'time_passed',
            text: '2 minutes passed.'
        }]
    }]);

    assert.equal(summary.total, 1);
    assert.equal(summary.changeCount, 0);
    assert.equal(summary.elapsedTimeText, '⏳ 2 minutes passed.');
    assert.deepEqual(Array.from(summary.categories, category => category.category), []);
    assert.deepEqual(summary.bodyRows, []);

    const element = drawer.createDrawer([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '⏳',
            category: 'time',
            sourceType: 'time_passed',
            text: '2 minutes passed.'
        }]
    }], { open: true });
    assert.ok(element.className.split(/\s+/).includes('turn-diff-drawer--empty'));
    const toggle = collectByClass(element, 'turn-diff-drawer__toggle')[0];
    assert.equal(toggle.textContent, 'What changed (0)');
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.getAttribute('aria-disabled'), 'true');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    const elapsedHeader = collectByClass(element, 'turn-diff-drawer__elapsed-time')[0];
    assert.equal(elapsedHeader.textContent, '⏳ 2 minutes passed.');
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

test('crafting endpoint emits craft and harvest result rows as inventory changes', () => {
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} harvested \$\{recoveredNames\.join\(', '\)\} from \$\{harvestSourceName\}\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} attempted to harvest \$\{harvestSourceName\} but obtained nothing usable\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} salvaged \$\{recoveredNames\.join\(', '\)\} from \$\{salvageSourceName\}\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} attempted to salvage from \$\{salvageSourceName\} but recovered nothing usable\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} processed \$\{craftedNames\.join\(', '\)\} using \$\{processSourceLabel\}\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} attempted to process using \$\{processSourceLabel\} but produced nothing usable\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} crafted \$\{craftedNames\.join\(', '\)\} using \$\{craftUsingLabel\}\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{actorName\} attempted to craft using \$\{craftUsingLabel\} but produced nothing usable\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`Consumed \$\{name\}\.`,\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*'Through exceptional care, the ingredients were preserved\.',\s*category:\s*'inventory'/
    );
    assert.match(
        apiSource,
        /description:\s*`\$\{ability\.name\}: \$\{ability\.effect\}`,\s*category:\s*'inventory'/
    );
});

test('phase 2 summary metadata is preserved for server and live drawer rows', () => {
    assert.match(apiSource, /function normalizeSummarySeverity\(value,\s*fallback = 'normal'\)/);
    assert.match(apiSource, /function normalizeSummarySourceType\(value\)/);
    assert.match(apiSource, /function normalizeSummaryEntityRefs\(refs\)/);
    assert.match(apiSource, /severity:\s*normalizeSummarySeverity\(item\?\.severity\)/);
    assert.match(apiSource, /sourceType:\s*normalizeSummarySourceType\(item\?\.sourceType\)/);
    assert.match(apiSource, /entityRefs:\s*normalizeSummaryEntityRefs\(item\?\.entityRefs\)/);
    assert.match(apiSource, /metadata:\s*normalizeSummaryMetadata\(item\?\.metadata\)/);

    assert.match(chatSource, /pushEventBundleItem\(icon,\s*text,\s*category\s*=\s*'other',\s*metadata\s*=\s*\{\}/);
    assert.match(chatSource, /severity:\s*this\.normalizeTurnDiffSeverity\(item\.severity\)/);
    assert.match(chatSource, /sourceType:\s*this\.normalizeTurnDiffSourceType\(item\.sourceType\)/);
    assert.match(chatSource, /entityRefs:\s*this\.normalizeTurnDiffEntityRefs\(item\.entityRefs\)/);
    assert.match(chatSource, /metadata:\s*this\.normalizeTurnDiffMetadata\(item\.metadata\)/);

    assert.match(drawerSource, /entityRefs:\s*normalizeEntityRefs\(item\.entityRefs\)/);
    assert.match(drawerSource, /metadata:\s*normalizeMetadata\(item\.metadata\)/);
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

test('drawer renders new exit map pill and dispatches navigation metadata', () => {
    const drawer = loadDrawerApi({
        document: createFakeDocument(),
        CustomEvent: FakeCustomEvent
    });

    const element = drawer.createDrawer([{
        type: 'event-summary',
        summaryTitle: '📋 Events',
        summaryItems: [{
            icon: '🚪',
            text: 'New exit discovered: Old Gatehouse -> Gorge Trailhead (Copperwheel Gorge).',
            category: 'travel',
            severity: 'important',
            sourceType: 'new_exit_discovered',
            metadata: {
                newExitDiscovered: {
                    label: 'Old Gatehouse -> Gorge Trailhead (Copperwheel Gorge)',
                    destinationKind: 'region',
                    originLocationId: 'loc_gatehouse',
                    originRegionId: 'region_castle',
                    destinationId: 'loc_gorge_stub',
                    destinationLocationName: 'Gorge Trailhead',
                    destinationRegionId: 'region_gorge',
                    destinationRegionName: 'Copperwheel Gorge',
                    exitId: 'exit_gorge'
                }
            }
        }]
    }], { open: true });

    const pills = collectByClass(element, 'turn-diff-drawer__new-exit-pill');
    assert.equal(pills.length, 1);
    assert.equal(pills[0].tagName, 'BUTTON');
    assert.equal(pills[0].textContent, '🗺️ Gorge Trailhead');

    let selectedDetail = null;
    element.addEventListener('airpg:new-exit-summary-selected', event => {
        selectedDetail = event.detail;
    });

    pills[0].dispatchEvent({
        type: 'click',
        bubbles: true,
        cancelable: true
    });

    assert.equal(selectedDetail.originRegionId, 'region_castle');
    assert.equal(selectedDetail.destinationId, 'loc_gorge_stub');
    assert.equal(selectedDetail.exitId, 'exit_gorge');
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

test('new exit map pills route through focused region map loading', () => {
    assert.match(chatSource, /event-summary-new-exit-pill/);
    assert.match(chatSource, /airpg:new-exit-summary-selected/);
    assert.match(viewSource, /openNewExitSummaryOnMap/);
    assert.match(viewSource, /__AIRPG_NEXT_REGION_MAP_OPTIONS/);
    assert.match(viewSource, /window\.activateTab\('map'\)/);
    assert.match(mapSource, /function loadRegionMap\(regionId = null,\s*options = \{\}\)/);
    assert.match(mapSource, /function focusRegionMapNode\(options = \{\}\)/);
    assert.match(mapSource, /region-exit-\$\{normalized\.focusExitId\}/);
    assert.match(mapSource, /selector:\s*'node\.map-focus'/);
});

test('common API docs describe phase 2 summary item metadata', () => {
    assert.match(commonDocSource, /`severity`:\s*string/);
    assert.match(commonDocSource, /`sourceType`:\s*string \| null/);
    assert.match(commonDocSource, /`entityRefs`:\s*array/);
});
