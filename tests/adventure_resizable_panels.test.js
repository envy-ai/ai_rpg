const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.css'), 'utf8');

test('Adventure tab exposes horizontal resize handles for location and party panels', () => {
    assert.match(viewSource, /id="adventureLocationResizeHandle"/);
    assert.match(viewSource, /id="adventurePartyResizeHandle"/);
    assert.match(viewSource, /role="separator"/);
    assert.match(viewSource, /aria-orientation="vertical"/);
    assert.match(viewSource, /data-adventure-resize-target="location"/);
    assert.match(viewSource, /data-adventure-resize-target="party"/);
});

test('Adventure panel resizing has persisted width variables and desktop-only handles', () => {
    assert.match(viewSource, /initializeAdventurePanelResizing/);
    assert.match(viewSource, /aiRpg\.adventurePanelWidths/);
    assert.match(viewSource, /--adventure-location-width/);
    assert.match(viewSource, /--adventure-party-width/);
    assert.match(scssSource, /\.adventure-resize-handle/);
    assert.match(scssSource, /cursor:\s*col-resize/);
    assert.match(scssSource, /\.chat-wrapper\s*\{[\s\S]*min-width:\s*0/);
    assert.match(scssSource, /max-width:\s*900px[\s\S]*\.adventure-resize-handle[\s\S]*display:\s*none/);
});

test('Adventure chat wrapper preserves remaining column width when chat content is wide', async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
        await browser.close();
    });

    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await page.setContent(`<!doctype html>
        <meta charset="utf-8">
        <style>${cssSource}</style>
        <div
            class="adventure-content"
            style="width: 900px; height: 500px; --adventure-location-width: 220px; --adventure-party-width: 220px; --adventure-chat-min-width: 360px;"
        >
            <div class="location-block"><div class="container">Location</div></div>
            <div class="adventure-resize-handle"></div>
            <div class="chat-wrapper">
                <div class="chat-container">
                    <div class="chat-log">
                        <div class="message ai-message">
                            <div class="message-content">
                                <div style="width: 1400px; height: 20px;">Wide generated content</div>
                            </div>
                        </div>
                    </div>
                    <div class="input-area">
                        <textarea class="message-input"></textarea>
                        <button class="send-button">Send</button>
                    </div>
                </div>
                <div class="adventure-resize-handle"></div>
                <aside class="chat-sidebar">Sidebar</aside>
            </div>
        </div>
    `);

    const metrics = await page.evaluate(() => {
        const root = document.querySelector('.adventure-content');
        const locationPanel = document.querySelector('.location-block');
        const handles = [...document.querySelectorAll('.adventure-resize-handle')];
        const wrapper = document.querySelector('.chat-wrapper');
        const chat = document.querySelector('.chat-container');
        const sidebar = document.querySelector('.chat-sidebar');
        const rootRect = root.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const chatRect = chat.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        const locationRect = locationPanel.getBoundingClientRect();
        const locationHandleRect = handles[0].getBoundingClientRect();
        const partyHandleRect = handles[1].getBoundingClientRect();
        const expectedWrapperWidth = rootRect.width - locationRect.width - locationHandleRect.width;
        const expectedChatWidth = expectedWrapperWidth - partyHandleRect.width - sidebarRect.width;
        return {
            rootWidth: rootRect.width,
            rootScrollWidth: root.scrollWidth,
            wrapperWidth: wrapperRect.width,
            chatWidth: chatRect.width,
            expectedWrapperWidth,
            expectedChatWidth
        };
    });

    assert.ok(
        Math.abs(metrics.wrapperWidth - metrics.expectedWrapperWidth) <= 1,
        `expected chat wrapper width ${metrics.expectedWrapperWidth}, got ${metrics.wrapperWidth}`
    );
    assert.ok(
        Math.abs(metrics.chatWidth - metrics.expectedChatWidth) <= 1,
        `expected chat column width ${metrics.expectedChatWidth}, got ${metrics.chatWidth}`
    );
    assert.ok(
        metrics.rootScrollWidth <= metrics.rootWidth + 1,
        `expected Adventure layout not to expand horizontally, got scrollWidth ${metrics.rootScrollWidth} for width ${metrics.rootWidth}`
    );
});
