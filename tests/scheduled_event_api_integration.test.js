const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('api wires scheduled event scheduling and due-event resolution hooks', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

    assert.match(apiSource, /require\('\.\/ScheduledEvent\.js'\)/);
    assert.match(apiSource, /createScheduledEventScheduler/);
    assert.match(apiSource, /parseScheduledEventResultXml/);
    assert.match(apiSource, /scheduleEvent:\s*scheduledEventScheduler\.scheduleEvent/);
    assert.match(apiSource, /async function processDueScheduledEvents/);
    assert.match(apiSource, /ScheduledEvent\.getPendingDue/);
    assert.match(apiSource, /promptType:\s*'scheduled-event-resolution'/);
    assert.match(apiSource, /function getAllChatToolDefinitions/);
    assert.match(apiSource, /modExtensionRegistry\.getChatToolDefinitions\(\)/);
    assert.match(apiSource, /const scheduledEventTools = getAllChatToolDefinitions\(\{\s*modExtensionRegistry\s*\}\)/);
    assert.doesNotMatch(apiSource, /scheduledEventTools[\s\S]{0,240}\.filter\(toolDefinition => toolDefinition\?\.\function\?\.name !== 'requestUserInput'\)/);
    assert.match(apiSource, /promptLabel:\s*'scheduled_event_resolution'/);
    assert.match(apiSource, /LLMClient\.logPrompt\(\{\s*prefix:\s*'scheduled_event_resolution'/);
    assert.match(apiSource, /type:\s*'scheduled-event'/);
    assert.match(apiSource, /type:\s*'scheduled-event-prose'/);
    assert.match(apiSource, /await processDueVehicleArrivals\(\);\s*await processDueScheduledEvents/s);
});
