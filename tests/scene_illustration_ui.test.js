const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const sceneIllustrationSource = fs.readFileSync(
    path.join(repoRoot, 'mods', 'scene-illustration', 'public', 'js', 'scene-illustration.js'),
    'utf8'
);

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || '').toUpperCase();
        this.children = [];
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.title = '';
        this.type = '';
        this.attributes = new Map();
        this.listeners = new Map();
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(listener);
    }

    querySelector() {
        return null;
    }

    querySelectorAll() {
        return [];
    }
}

function createFakeDocument(intervalCallbacks) {
    return {
        readyState: 'complete',
        body: new FakeElement('body'),
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        addEventListener() {},
        querySelector() {
            return null;
        },
        getElementById() {
            return null;
        },
        _intervalCallbacks: intervalCallbacks
    };
}

test('scene illustration action hook forwards base message action options', () => {
    const intervalCallbacks = [];
    const originalCalls = [];
    const chatLog = new FakeElement('div');
    const chat = {
        chatLog,
        createMessageActions(entry, options = {}) {
            originalCalls.push({ entry, options });
            if (entry?.role === 'system' && options.allowSystem !== true) {
                return null;
            }
            const wrapper = new FakeElement('div');
            wrapper.className = 'message-actions';
            return wrapper;
        },
        setMessageContent() {}
    };

    const context = {
        window: { AIRPG_CHAT: chat },
        document: createFakeDocument(intervalCallbacks),
        console: {
            log() {},
            warn() {},
            error() {}
        },
        setInterval(callback) {
            intervalCallbacks.push(callback);
            return intervalCallbacks.length;
        },
        clearInterval() {},
        setTimeout() {},
        fetch() {
            throw new Error('fetch should not run during action hook setup.');
        }
    };
    vm.createContext(context);
    vm.runInContext(sceneIllustrationSource, context, {
        filename: 'mods/scene-illustration/public/js/scene-illustration.js'
    });

    assert.equal(intervalCallbacks.length, 1, 'scene illustration should wait for the chat controller');
    intervalCallbacks[0]();

    const systemEntry = {
        id: 'debug-1',
        timestamp: '2026-06-16T12:34:56.000Z',
        role: 'system',
        type: 'tool-call-debug'
    };
    const systemActions = chat.createMessageActions(systemEntry, {
        allowSystem: true,
        allowEdit: false,
        persistent: true
    });

    assert.ok(systemActions, 'system diagnostic entries should still receive base actions');
    assert.deepEqual(originalCalls.at(-1).options, {
        allowSystem: true,
        allowEdit: false,
        persistent: true
    });
    assert.equal(systemActions.children.length, 0, 'system entries should not get a scene illustration button');

    const assistantActions = chat.createMessageActions({
        id: 'assistant-1',
        timestamp: '2026-06-16T12:35:00.000Z',
        role: 'assistant'
    });

    assert.equal(assistantActions.children.length, 1);
    assert.equal(assistantActions.children[0].className, 'message-action message-action--mod message-action--scene-illustration');
});
