const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in views/index.njk`);
    }

    const bodyStart = source.indexOf('{', start);
    if (bodyStart < 0) {
        throw new Error(`Unable to locate body for ${functionName}`);
    }

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

    throw new Error(`Unable to extract ${functionName}`);
}

function loadHiddenNpcHelpers() {
    const helperSource = [
        extractFunction(viewSource, 'isNpcHiddenFromLocationDisplay'),
        extractFunction(viewSource, 'shouldRenderLocationNpc'),
        extractFunction(viewSource, 'shouldStyleLocationNpcAsHidden')
    ].join('\n\n');
    const context = {};
    vm.runInNewContext(
        `${helperSource}
this.isNpcHiddenFromLocationDisplay = isNpcHiddenFromLocationDisplay;
this.shouldRenderLocationNpc = shouldRenderLocationNpc;
this.shouldStyleLocationNpcAsHidden = shouldStyleLocationNpcAsHidden;`,
        context
    );
    return context;
}

test('location NPC hidden helpers hide living hidden NPCs by default and always show corpses', () => {
    const {
        isNpcHiddenFromLocationDisplay,
        shouldRenderLocationNpc,
        shouldStyleLocationNpcAsHidden
    } = loadHiddenNpcHelpers();

    const visibleNpc = { hiddenFromPlayer: false, isDead: false };
    const hiddenNpc = { hiddenFromPlayer: true, isDead: false };
    const hiddenCorpse = { hiddenFromPlayer: true, isDead: true };

    assert.equal(isNpcHiddenFromLocationDisplay(visibleNpc), false);
    assert.equal(isNpcHiddenFromLocationDisplay(hiddenNpc), true);
    assert.equal(isNpcHiddenFromLocationDisplay(hiddenCorpse), false);

    assert.equal(shouldRenderLocationNpc(hiddenNpc, false), false);
    assert.equal(shouldRenderLocationNpc(hiddenNpc, true), true);
    assert.equal(shouldRenderLocationNpc(hiddenCorpse, false), true);

    assert.equal(shouldStyleLocationNpcAsHidden(hiddenNpc, true), true);
    assert.equal(shouldStyleLocationNpcAsHidden(hiddenCorpse, true), false);
});

test('server sends hidden NPCs to the client instead of filtering them out', () => {
    assert.doesNotMatch(serverSource, /\.filter\(\s*npc\s*=>\s*npc\s*&&\s*!\s*npc\.hiddenFromPlayer\s*\)/);
    assert.match(serverSource, /hiddenFromPlayer:\s*Boolean\(npc\.hiddenFromPlayer\s*&&\s*!npc\.isDead\)/);
});

test('location NPC area has a show-hidden eye toggle and distinct hidden styling', () => {
    assert.match(viewSource, /id="toggleHiddenNpcsButton"/);
    assert.match(viewSource, /title="show hidden"/);
    assert.match(viewSource, /aria-label="show hidden"/);
    assert.match(viewSource, /classList\.toggle\('is-hidden-from-player', shouldStyleLocationNpcAsHidden\(npc, locationNpcsShowHidden\)\)/);
    assert.match(scssSource, /\.entity-card--npc\.is-hidden-from-player[\s\S]*opacity:\s*0\.32/);
    assert.match(scssSource, /\.location-hidden-npcs-toggle/);
    assert.match(chatDocSource, /show hidden/);
});
