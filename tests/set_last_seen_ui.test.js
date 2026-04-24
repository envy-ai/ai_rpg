const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');

test('location menus expose a set last seen action and modal', () => {
    assert.match(viewSource, /id="locationSetLastSeenButton"/);
    assert.match(viewSource, /id="mapLocationMenuSetLastSeenButton"/);
    assert.match(viewSource, /id="setLastSeenModal"/);
    assert.match(viewSource, /id="setLastSeenForm"/);
    assert.match(viewSource, /id="setLastSeenLocationName"/);
    assert.match(viewSource, /id="setLastSeenTimeInput"/);
    assert.match(viewSource, /id="setLastSeenSubmitBtn"/);
});

test('set last seen modal reuses slash command execution with matching input guidance', () => {
    assert.match(viewSource, /openSetLastSeenModal/);
    assert.match(viewSource, /submitSetLastSeenForm/);
    assert.match(viewSource, /executeSlashCommand\(`\/set_last_seen \$\{locationArg\} \$\{rawTimeValue\}`\)/);
    assert.match(viewSource, /Enter an exact time like <code>3 PM<\/code> or <code>3:15 PM<\/code>, or a relative duration like <code>2 hours ago<\/code>\./);
    assert.match(viewSource, /Uses the same format as the <code>\/set_last_seen<\/code> slash command\./);
});
