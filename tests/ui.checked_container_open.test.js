const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('checked containers use a dedicated open-attempt modal and API route', () => {
    const viewSource = read('views/index.njk');
    const apiSource = read('api.js');
    const promptSource = read('prompts/_includes/player-action-open-container.njk');

    assert.match(viewSource, /id="containerOpenCheckModal"/);
    assert.match(viewSource, /function requiresContainerOpenCheck\(thing\)/);
    assert.match(viewSource, /submitContainerOpenCheckAttempt/);
    assert.match(viewSource, /\/api\/things\/\$\{encodeURIComponent\(containerId\)\}\/container\/open-check/);
    assert.match(apiSource, /app\.post\('\/api\/things\/:id\/container\/open-check'/);
    assert.match(apiSource, /promptType: 'player-action-open-container'/);
    assert.match(apiSource, /enabledChatToolNames/);
    assert.match(apiSource, /toolName === 'resolveSkillCheck'/);
    assert.match(apiSource, /toolName === 'resolveOpposedSkillCheck'/);
    assert.match(apiSource, /permanentlyOpened/);
    assert.match(apiSource, /container\.requiresCheckToOpen\s*=\s*false/);
    assert.match(apiSource, /Events\.runEventChecks/);
    assert.match(apiSource, /applySlopRemoval/);
    assert.match(promptSource, /<containerOpenResult>/);
    assert.match(promptSource, /resolveSkillCheck/);
});

test('checked container cards show a red lock overlay on the container badge', () => {
    const viewSource = read('views/index.njk');
    const scssSource = read('public/css/main.scss');

    assert.match(viewSource, /function getThingPropertyBadges\(thing\)/);
    assert.match(viewSource, /requiresCheckToOpen/);
    assert.match(viewSource, /lockedContainer/);
    assert.match(viewSource, /entity-image-badge__lock/);
    assert.match(viewSource, /\/assets\/material-icons\/misc\/lock\.svg/);
    assert.match(scssSource, /\.entity-image-badge--locked-container/);
    assert.match(scssSource, /\.entity-image-badge__lock/);
    assert.match(scssSource, /#ff4444/);
    assert.match(scssSource, /25%/);
});
