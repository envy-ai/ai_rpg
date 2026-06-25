const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractCssRule(source, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`));
    assert.ok(match, `Expected to find CSS rule for ${selector}`);
    return match[0];
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Expected to find function signature: ${signature}`);
    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `Expected to find parameters for: ${signature}`);
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
    assert.notEqual(paramsEnd, -1, `Expected to find parameter end for: ${signature}`);
    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `Expected to find body for: ${signature}`);
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
    throw new Error(`Unable to extract function: ${signature}`);
}

test('chat sidebar template renders tracker section and hidden toggle', () => {
    const source = readRepoFile('views/index.njk');

    assert.match(source, /id="chatTrackersSection"/);
    assert.match(source, /id="chatTrackersAddButton"/);
    assert.match(source, /id="chatTrackersHiddenToggle"/);
    assert.match(source, /id="chatTrackersList"/);
    assert.match(source, /id="trackerEditModal"/);
    assert.match(source, /id="trackerEditForm"/);
    assert.match(source, /id="trackerEditName"/);
    assert.match(source, /id="trackerEditType"/);
    assert.match(source, /id="trackerEditValue"/);
    assert.match(source, /id="trackerEditHiddenFromPlayer"/);
    assert.match(source, /id="trackerEditDescription"/);
    assert.match(source, /id="trackerEditNote"/);
    assert.match(source, /let chatTrackersShowHidden = false;/);
    assert.match(source, /function renderChatTrackersPanel\(trackers = \[\]\)/);
    assert.match(source, /function openTrackerEditModal/);
    assert.match(source, /function submitTrackerEditForm/);
    assert.match(source, /function deleteTrackerFromSidebar/);
    assert.match(source, /renderChatTrackersPanel\(Array\.isArray\(data\?\.trackers\) \? data\.trackers : \[\]\);/);
    assert.match(source, /renderChatTrackersPanel\(Array\.isArray\(window\.currentPlayerData\?\.trackers\) \? window\.currentPlayerData\.trackers : \[\]\);/);
});

test('chat sidebar tracker rows omit secondary metadata lines and bind detail tooltip', () => {
    const source = readRepoFile('views/index.njk');
    const tooltipSource = extractFunction(source, 'function formatTrackerTooltipHtml(tracker)');

    assert.doesNotMatch(source, /chat-tracker-card__meta/);
    assert.doesNotMatch(source, /formatTrackerTypeLabel\(tracker\.type\)/);
    assert.match(source, /function formatTrackerTooltipHtml\(tracker\)/);
    assert.match(source, /tracker\.description/);
    assert.match(source, /tracker\.note/);
    assert.match(source, /tracker\.lastUpdated/);
    assert.match(source, /function bindTrackerTooltip\(card,\s*tracker\)/);
    assert.match(source, /floatingTooltipController\.show\(tooltipHtml,\s*event,\s*\{\s*allowHTML:\s*true\s*\}\)/);
    assert.match(source, /bindTrackerTooltip\(card,\s*tracker\)/);
    assert.doesNotMatch(tooltipSource, /tracker\.type/);
    assert.doesNotMatch(tooltipSource, /tracker\.value/);
});

test('server attaches serialized trackers only to the player payload', () => {
    const source = readRepoFile('server.js');
    const trackerSource = readRepoFile('Tracker.js');
    const toClientJsonSource = extractFunction(trackerSource, 'toClientJSON({ formatLastUpdated, formatCountdownValue } = {})');

    assert.match(source, /function serializeTrackersForClient\(\)/);
    assert.match(source, /Tracker\.getAll\(\)\.map\(tracker => tracker\.toClientJSON/);
    assert.match(source, /serialized\.trackers = serializeTrackersForClient\(\);/);
    assert.match(toClientJsonSource, /description:\s*this\.description/);
    assert.match(toClientJsonSource, /note:\s*this\.note/);
});

test('tracker sidebar styles are maintained in SCSS source', () => {
    const source = readRepoFile('public/css/main.scss');
    const trackerActionsRule = extractCssRule(source, '.chat-tracker-card__actions');

    assert.match(source, /\.chat-trackers-section/);
    assert.match(source, /\.chat-trackers-add-button/);
    assert.match(source, /\.chat-trackers-hidden-toggle/);
    assert.match(source, /\.chat-tracker-card/);
    assert.match(source, /\.chat-tracker-card__actions/);
    assert.match(source, /\.chat-tracker-card__edit/);
    assert.match(source, /\.chat-tracker-card__delete/);
    assert.match(source, /opacity:\s*0;/);
    assert.match(source, /\.chat-tracker-card:hover \.chat-tracker-card__actions/);
    assert.match(source, /\.chat-tracker-card\s*\{[\s\S]*?padding:\s*10px 11px;/);
    assert.doesNotMatch(source, /padding:\s*10px 72px 10px 11px;/);
    assert.match(trackerActionsRule, /position:\s*absolute;/);
    assert.match(trackerActionsRule, /z-index:\s*20;/);
    assert.doesNotMatch(trackerActionsRule, /z-index:\s*2;/);
    assert.match(source, /\.chat-tracker-card\.is-hidden-from-player/);
    assert.match(source, /\.tracker-edit-modal/);
    assert.doesNotMatch(source, /\.chat-tracker-card__meta/);
});

test('tracker percentage and x out of total rows expose progress fill hooks', () => {
    const templateSource = readRepoFile('views/index.njk');
    const scssSource = readRepoFile('public/css/main.scss');

    assert.match(templateSource, /function getTrackerProgressPercent\(tracker\)/);
    assert.match(templateSource, /tracker\.type === 'percentage'/);
    assert.match(templateSource, /tracker\.type === 'x_out_of_total'/);
    assert.match(templateSource, /Math\.max\(0, Math\.min\(100,/);
    assert.match(templateSource, /chat-tracker-card--progress/);
    assert.match(templateSource, /--tracker-progress-percent/);

    assert.match(scssSource, /\.chat-tracker-card--progress/);
    assert.match(scssSource, /--tracker-progress-percent/);
    assert.match(scssSource, /linear-gradient/);
});

test('tracker sidebar calls CRUD API endpoints for modal edits', () => {
    const viewSource = readRepoFile('views/index.njk');
    const apiSource = readRepoFile('api.js');

    assert.match(apiSource, /app\.get\('\/api\/trackers\/:id'/);
    assert.match(apiSource, /app\.post\('\/api\/trackers'/);
    assert.match(apiSource, /app\.put\('\/api\/trackers\/:id'/);
    assert.match(apiSource, /app\.delete\('\/api\/trackers\/:id'/);
    assert.match(apiSource, /Tracker\.getById\(trackerId\)/);
    assert.match(apiSource, /new Tracker\(\{/);
    assert.match(apiSource, /Tracker\.removeById\(trackerId\)/);

    assert.match(viewSource, /fetch\('\/api\/trackers'/);
    assert.match(viewSource, /fetch\(`\/api\/trackers\/\$\{encodeURIComponent\(trackerId\)\}`/);
    assert.match(viewSource, /method:\s*'POST'/);
    assert.match(viewSource, /method:\s*'PUT'/);
    assert.match(viewSource, /method:\s*'DELETE'/);
});
