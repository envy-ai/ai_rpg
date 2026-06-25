const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const docsSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const assetsDocsSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'assets_styles.md'), 'utf8');

function extractMethod(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} should exist`);
    const bodyOpenMarker = source.indexOf(') {', start);
    assert.notEqual(bodyOpenMarker, -1, `${signature} should have a body`);
    const bodyStart = bodyOpenMarker + 2;

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    assert.fail(`${signature} body should close`);
}

test('chat bubble filter control is absolutely positioned in the chat container', () => {
    const chatContainerIndex = viewSource.indexOf('class="chat-container"');
    const toggleIndex = viewSource.indexOf('id="chatBubbleFilterToggle"');
    const popoverIndex = viewSource.indexOf('id="chatBubbleFilterPopover"');
    const chatLogIndex = viewSource.indexOf('id="chatLog"');

    assert.notEqual(chatContainerIndex, -1, 'chat container should exist');
    assert.notEqual(toggleIndex, -1, 'bubble filter toggle should exist');
    assert.notEqual(popoverIndex, -1, 'bubble filter popover should exist');
    assert.notEqual(chatLogIndex, -1, 'chat log should exist');
    assert.ok(chatContainerIndex < toggleIndex, 'filter toggle should be inside the chat container');
    assert.ok(toggleIndex < chatLogIndex, 'filter toggle should sit before the chat log');
    assert.match(viewSource, /id="chatBubbleFilterToggle"[\s\S]*aria-controls="chatBubbleFilterPopover"/);
    assert.match(viewSource, /id="chatBubbleFilterIcon"[\s\S]*assets\/material-icons\/misc\/visibility\.svg/);
    assert.match(viewSource, /id="chatBubbleFilterOptions"/);
});

test('chat bubble filter state and visible type options are managed in chat.js', () => {
    assert.match(chatSource, /chatBubbleFilterCookieName = 'airpg_chat_bubble_hidden_types'/);
    assert.match(chatSource, /this\.chatBubbleHiddenTypes = this\.loadChatBubbleHiddenTypes\(\)/);
    assert.match(chatSource, /readClientCookie\(/);
    assert.match(chatSource, /writeClientCookie\(/);
    assert.match(chatSource, /setupChatBubbleFilter\(\)/);
    assert.match(chatSource, /toggleChatBubbleFilterPopover\(/);
    assert.match(chatSource, /renderChatBubbleFilterOptions\(\)/);
    assert.match(chatSource, /persistChatBubbleHiddenTypes\(\)/);
    assert.match(chatSource, /applyChatBubbleTypeVisibility\(/);
});

test('chat bubbles receive normalized data hooks for filtering', () => {
    const decorateSource = extractMethod(chatSource, 'decorateChatBubbleElement(element, entryOrType');
    const applyVisibilitySource = extractMethod(chatSource, '\n    applyChatBubbleTypeVisibility(element)');
    const createMessageSource = extractMethod(chatSource, '\n    createChatMessageElement(entry, attachments');
    const addMessageSource = extractMethod(chatSource, 'addMessage(sender, content');

    assert.match(decorateSource, /dataset\.chatBubbleType/);
    assert.match(decorateSource, /dataset\.chatBubbleLabel/);
    assert.match(decorateSource, /this\.applyChatBubbleTypeVisibility\(element\)/);
    assert.match(applyVisibilitySource, /classList\.toggle\('chat-bubble-hidden-by-filter'/);
    assert.match(createMessageSource, /this\.decorateChatBubbleElement\(messageDiv, entry\)/);
    assert.match(addMessageSource, /this\.decorateChatBubbleElement\(messageDiv, options\.bubbleType/);
    assert.match(chatSource, /this\.decorateChatBubbleElement\(container, 'event-summary'\)/);
    assert.match(chatSource, /this\.decorateChatBubbleElement\(container, 'status-summary'\)/);
    assert.match(chatSource, /this\.decorateChatBubbleElement\(messageDiv, 'check-results'\)/);
    assert.match(chatSource, /this\.decorateChatBubbleElement\(messageDiv, 'tool-call-debug'\)/);
});

test('chat bubble filter hidden type settings persist in a client cookie', () => {
    const loadSource = extractMethod(chatSource, '\n    loadChatBubbleHiddenTypes()');
    const persistSource = extractMethod(chatSource, '\n    persistChatBubbleHiddenTypes()');

    assert.match(loadSource, /this\.readClientCookie\(this\.chatBubbleFilterCookieName\)/);
    assert.match(persistSource, /this\.writeClientCookie\(\s*this\.chatBubbleFilterCookieName,\s*JSON\.stringify\(values\)/);
    assert.doesNotMatch(loadSource, /localStorage/);
    assert.doesNotMatch(persistSource, /localStorage/);
});

test('chat bubble filter styles float above the chat log and hide disabled types', () => {
    assert.match(scssSource, /\.chat-container\s*\{[\s\S]*position:\s*relative/);
    assert.match(scssSource, /\.chat-bubble-filter-toggle\s*\{[\s\S]*position:\s*absolute/);
    assert.match(scssSource, /\.chat-bubble-filter-toggle\s*\{[\s\S]*top:\s*10px/);
    assert.match(scssSource, /\.chat-bubble-filter-toggle\s*\{[\s\S]*right:\s*10px/);
    assert.match(scssSource, /\.chat-bubble-filter-toggle\s*\{[\s\S]*z-index:\s*300/);
    assert.match(scssSource, /\.chat-bubble-filter-icon\s*\{[\s\S]*filter:\s*brightness\(0\) invert\(1\)/);
    assert.match(scssSource, /\.chat-bubble-filter-popover\s*\{[\s\S]*position:\s*absolute/);
    assert.match(scssSource, /\.chat-bubble-filter-popover\s*\{[\s\S]*z-index:\s*301/);
    assert.match(scssSource, /\.chat-bubble-hidden-by-filter\s*\{[\s\S]*display:\s*none\s*!important/);
});

test('chat bubble filter behavior is documented', () => {
    assert.match(docsSource, /upper-right eye button/);
    assert.match(docsSource, /chat bubble types/);
    assert.match(docsSource, /client cookie/);
    assert.match(docsSource, /airpg_chat_bubble_hidden_types/);
    assert.doesNotMatch(docsSource, /airpg:chatBubbleHiddenTypes/);
    assert.match(assetsDocsSource, /visibility\.svg/);
});
