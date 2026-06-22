const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test('housekeeping XML parser converts quests trackers and relationships into tool calls', () => {
    assert.equal(typeof Events._parseHousekeepingXmlResponse, 'function');

    const parsed = Events._parseHousekeepingXmlResponse(`
Analysis text should be ignored.
<housekeeping>
  <quests>
    <quest>
      <summary>Repair the beacon so rescue can find the party.</summary>
      <giver>Captain Vale</giver>
    </quest>
  </quests>
  <trackers>
    <tracker>
      <action>add</action>
      <name>Beacon Repair</name>
      <type>percentage</type>
      <value>25%</value>
      <hiddenFromPlayer>false</hiddenFromPlayer>
      <description>Track repair progress on the distress beacon.</description>
      <note>The player scavenged one replacement antenna.</note>
    </tracker>
    <tracker>
      <action>update</action>
      <target>Gate Stability</target>
      <value>45%</value>
      <note>The gate weakened after the anchor cracked.</note>
    </tracker>
    <tracker>
      <action>remove</action>
      <target>Alarm State</target>
    </tracker>
  </trackers>
  <relationships>
	    <relationship>
	      <characterA>Mira</characterA>
	      <characterB>Neka</characterB>
	      <relationshipLabel>trusted ally</relationshipLabel>
	      <reciprocalRelationship>guarded patron</reciprocalRelationship>
	    </relationship>
	    <relationship>
	      <action>remove</action>
	      <characterA>Toma</characterA>
	      <characterB>Mira</characterB>
	    </relationship>
	  </relationships>
	</housekeeping>
	`);

    assert.match(parsed.xml, /^<housekeeping>/);
    assert.deepEqual(parsed.toolCalls.map(call => call.functionName), [
        'createQuest',
        'addTracker',
        'updateTracker',
        'removeTracker',
        'setRelationship'
    ]);
    assert.deepEqual(parsed.toolCalls[0].argumentsObject, {
        summary: 'Repair the beacon so rescue can find the party.',
        giver: 'Captain Vale'
    });
    assert.deepEqual(parsed.toolCalls[1].argumentsObject.items, [{
        name: 'Beacon Repair',
        type: 'percentage',
        value: '25%',
        hiddenFromPlayer: false,
        description: 'Track repair progress on the distress beacon.',
        note: 'The player scavenged one replacement antenna.'
    }]);
    assert.deepEqual(parsed.toolCalls[2].argumentsObject.items, [{
        tracker: 'Gate Stability',
        value: '45%',
        note: 'The gate weakened after the anchor cracked.'
    }]);
    assert.deepEqual(parsed.toolCalls[3].argumentsObject.items, [{
        tracker: 'Alarm State'
    }]);
    assert.deepEqual(parsed.toolCalls[4].argumentsObject.items, [
        {
            characterA: 'Mira',
            characterB: 'Neka',
            relationship: 'trusted ally',
            reciprocalRelationship: 'guarded patron'
        },
        {
            action: 'remove',
            characterA: 'Toma',
            characterB: 'Mira'
        }
    ]);
});

test('housekeeping XML executor records debug lifecycle and continues after tool errors', async () => {
    assert.equal(typeof Events._applyHousekeepingXmlResponse, 'function');

    const executed = [];
    const debugEvents = [];
    const result = await Events._applyHousekeepingXmlResponse(`
<housekeeping>
  <quests>
    <quest>
      <summary>Find the missing archive key.</summary>
    </quest>
  </quests>
  <trackers>
    <tracker>
      <action>update</action>
      <target>Missing Tracker</target>
      <value>2</value>
    </tracker>
  </trackers>
  <relationships>
    <relationship>
      <characterA>Toma</characterA>
      <characterB>Mira</characterB>
      <relationshipLabel>quiet informant</relationshipLabel>
    </relationship>
  </relationships>
</housekeeping>
`, {
        metadataLabel: 'housekeeping',
        startingSequence: 2,
        executeChatToolCall: async (toolCall) => {
            executed.push({
                functionName: toolCall.functionName,
                argumentsObject: toolCall.argumentsObject
            });
            if (toolCall.functionName === 'updateTracker') {
                return {
                    content: '<toolError><message>No tracker matches.</message></toolError>',
                    metadata: {
                        error: true,
                        functionName: 'updateTracker',
                        code: 'not_found',
                        message: 'No tracker matches.'
                    }
                };
            }
            return {
                content: `<${toolCall.functionName}Result><status>success</status></${toolCall.functionName}Result>`,
                metadata: {
                    status: 'success',
                    functionName: toolCall.functionName
                }
            };
        },
        onToolCallDebug: (event) => {
            debugEvents.push(event);
        }
    });

    assert.deepEqual(executed.map(call => call.functionName), [
        'createQuest',
        'updateTracker',
        'setRelationship'
    ]);
    assert.equal(result.toolInvocations.length, 3);
    assert.equal(result.toolInvocations[1].metadata.error, true);
    assert.equal(result.toolInvocations[2].metadata.status, 'success');
    assert.deepEqual(debugEvents.map(event => event.phase), [
        'started',
        'completed',
        'started',
        'error',
        'started',
        'completed'
    ]);
    assert.deepEqual(debugEvents.filter(event => event.phase === 'started').map(event => event.sequence), [3, 4, 5]);
});
