const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test('standard XML parser maps hidden Thing and exit reveal tags', () => {
    const parsed = Events._parseXmlEventCheckResponse(`<events>
      <revealHiddenThing><thingId>thing-1</thingId><thingName>Loose Stone</thingName><description>The seam became visible.</description></revealHiddenThing>
      <revealHiddenExit><exitId>exit-1</exitId><destinationName>Old Tunnel</destinationName><description>The door swung open.</description></revealHiddenExit>
    </events>`);
    assert.deepEqual(parsed.structured.parsed.reveal_hidden_thing, [{ id: 'thing-1', name: 'Loose Stone', description: 'The seam became visible.' }]);
    assert.deepEqual(parsed.structured.parsed.reveal_hidden_exit, [{ id: 'exit-1', destinationName: 'Old Tunnel', description: 'The door swung open.' }]);
});

test('TinyBrain reveal parser enforces required fields and authoritative id/name pairs', () => {
    const options = {
        sectionKind: 'current', stageId: 'scene',
        allowedTags: ['revealHiddenThing', 'revealHiddenExit'],
        hiddenThingTargets: [{ id: 'thing-1', name: 'Loose Stone' }],
        hiddenExitTargets: [{ id: 'exit-1', name: 'Old Tunnel' }]
    };
    const accepted = Events.parseTinyBrainEventXmlStage(`<events><revealHiddenThing><thingId>thing-1</thingId><thingName>Loose Stone</thingName><description>Found.</description></revealHiddenThing></events>`, options);
    assert.match(accepted.value.xml, /revealHiddenThing/);
    assert.throws(() => Events.parseTinyBrainEventXmlStage(`<events><revealHiddenThing><thingId>thing-1</thingId><thingName>Wrong</thingName><description>Found.</description></revealHiddenThing></events>`, options), /authoritative/);
    assert.throws(() => Events.parseTinyBrainEventXmlStage(`<events><revealHiddenExit><exitId>exit-1</exitId><destinationName>Old Tunnel</destinationName></revealHiddenExit></events>`, options), /requires a non-empty/);
});
