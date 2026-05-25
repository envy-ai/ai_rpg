const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const config = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));

test('request-user-input tool is enabled by default and validated as a boolean', () => {
    assert.equal(config.chat_tools?.request_user_input_enabled, true);
    assert.match(serverSource, /chat_tools must be an object when provided/);
    assert.match(serverSource, /chat_tools\.request_user_input_enabled must be a boolean when provided/);
});

test('regular and generic chat tool payloads filter requestUserInput by config', () => {
    assert.match(apiSource, /function isRequestUserInputToolEnabled\(\)/);
    assert.match(apiSource, /function filterEnabledChatTools\(/);
    assert.match(apiSource, /requestUserInput/);
    assert.match(apiSource, /getChatToolDefinitions\(\{ modExtensionRegistry \}\)\.filter\(toolDefinition =>/);
    assert.match(apiSource, /return isRegularProseChatToolAllowed\(functionName, modExtensionRegistry\)/);
});

test('api exposes a response endpoint and emits input requests to the originating client id', () => {
    assert.match(apiSource, /pendingPlayerInputRequests = new Map\(\)/);
    assert.match(apiSource, /app\.post\('\/api\/chat\/user-input-response'/);
    assert.match(apiSource, /realtimeHub\.emit\(\s*targetClientId,\s*'player_input_request'/);
    assert.match(apiSource, /realtimeHub\.emit\(\s*pending\.clientId,\s*'player_input_request_closed'/);
    assert.match(apiSource, /clientId !== pending\.clientId/);
});

test('api supports confirmation-mode player input requests', () => {
    assert.match(apiSource, /mode:\s*inputMode/);
    assert.match(apiSource, /confirmLabel:\s*confirmLabel/);
    assert.match(apiSource, /cancelLabel:\s*cancelLabel/);
    assert.match(apiSource, /if \(pending\.mode === 'confirmation'\)/);
    assert.match(apiSource, /body\.confirmed === true/);
});

test('request-user-input floating panel is non-modal and draggable', () => {
    assert.match(viewSource, /id="playerInputRequestPanel"/);
    assert.match(viewSource, /aria-modal="false"/);
    assert.doesNotMatch(viewSource, /id="playerInputRequestPanel"[^>]*class="[^"]*\bmodal\b/);

    assert.match(chatSource, /case 'player_input_request':/);
    assert.match(chatSource, /case 'player_input_request_closed':/);
    assert.match(chatSource, /handlePlayerInputRequest/);
    assert.match(chatSource, /submitPlayerInputRequest/);
    assert.match(chatSource, /bindPlayerInputRequestDrag/);
    assert.match(chatSource, /fetch\('\/api\/chat\/user-input-response'/);

    assert.match(scssSource, /\.player-input-request-panel\s*\{/);
    assert.match(scssSource, /z-index:\s*11120/);
    assert.match(scssSource, /\.player-input-request-panel__header\s*\{[^}]*cursor:\s*grab/s);
    assert.doesNotMatch(scssSource, /\.player-input-request-backdrop/);
});

test('request-user-input panel renders confirmation-mode requests without free text input', () => {
    assert.match(chatSource, /mode:\s*payload\.mode === 'confirmation' \? 'confirmation' : 'text'/);
    assert.match(chatSource, /const isConfirmation = request\.mode === 'confirmation'/);
    assert.match(chatSource, /playerInputRequestPanel\.classList\.toggle\('is-confirmation', isConfirmation\)/);
    assert.match(chatSource, /confirmed:\s*true/);
    assert.match(chatSource, /request\.confirmLabel \|\| 'Confirm'/);
    assert.match(chatSource, /request\.cancelLabel \|\| 'Cancel'/);
    assert.match(scssSource, /\.player-input-request-panel\.is-confirmation \.player-input-request-panel__label/);
    assert.match(scssSource, /\.player-input-request-panel\.is-confirmation \.player-input-request-panel__answer/);
});
