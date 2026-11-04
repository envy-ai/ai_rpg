'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const source = fs.readFileSync(require.resolve('../public/js/chat.js'), 'utf8');
function method(name) {
    const start = source.indexOf(`    ${name}(`);
    if (start < 0) throw new Error(`Missing ${name}`);
    const body = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let i = body; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unclosed ${name}`);
}
(async () => {
    let requests = 0;
    const html = `<!doctype html><script>class Chat { ${method('handleWebSocketMessage')} ${method('scheduleSlashCommandPageReload')} }; const chat = new Chat(); const socket = new WebSocket('ws://' + location.host); socket.onmessage = event => chat.handleWebSocketMessage(event);</script>`;
    const server = http.createServer((_req, res) => { requests++; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
    const ws = new WebSocketServer({ server });
    ws.on('connection', socket => { if (requests === 1) socket.send(JSON.stringify({ type: 'reload_page', delayMs: 20, reason: 'domain-id-migration' })); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForEvent('load', { timeout: 5000 });
        assert.ok(requests >= 2, 'realtime migration message reloads the document');
        console.log('Realtime migration reload passed in Chromium.');
    } finally {
        await browser.close();
        ws.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
