const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const { XMLSerializer } = require('@xmldom/xmldom');
const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function sanitizeForXml(input) {
    return `<root>${input}</root>`
        .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
        .replace(/<\s*br\s*>/gi, '<br/>')
        .replace(/<\s*hr\s*>/gi, '<hr/>');
}

function loadLocationModifyHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        const LOCATION_MODIFICATION_RESULT_BASE_FIELD_EXCLUDES');
    const end = source.indexOf('\n        async function renderLocationModificationOutcomeForDegree', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate location modification helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };

    const context = {
        Array,
        Boolean,
        Error,
        Number,
        String,
        TypeError,
        XMLSerializer,
        Utils,
        console,
        sanitizeForXml
    };

    vm.createContext(context);
vm.runInContext(
        `${functionSource}
this.parseLocationModificationResultsResponse = parseLocationModificationResultsResponse;
this.extractInlineDieRollFromLocationModifyText = extractInlineDieRollFromLocationModifyText;
this.validateLocationModificationReceivedItemNames = typeof validateLocationModificationReceivedItemNames === 'function'
    ? validateLocationModificationReceivedItemNames
    : null;`,
        context
    );

    return {
        parseLocationModificationResultsResponse: context.parseLocationModificationResultsResponse,
        extractInlineDieRollFromLocationModifyText: context.extractInlineDieRollFromLocationModifyText,
        validateLocationModificationReceivedItemNames: context.validateLocationModificationReceivedItemNames,
        restore: () => {
            Globals.config = previousConfig;
        }
    };
}

const baseOutcomeXml = `
<response>
  <locationModificationResults>
    <result>
      <level>success</level>
      <locationChanged>true</locationChanged>
      <alteration>Repair the cracked windows and clear the smoke.</alteration>
      <itemsConsumed>
        <itemName>Glass Pane</itemName>
      </itemsConsumed>
      <itemsReceived>
        <itemName>Old Silver Coin</itemName>
      </itemsReceived>
      <timeTaken>20 minutes</timeTaken>
    </result>
  </locationModificationResults>
</response>`;

test('location modification parsing reads locationChanged, alteration, consumed and received items, time, and critical other effect', async () => {
    const { parseLocationModificationResultsResponse, restore } = loadLocationModifyHelpers();
    try {
        const xml = `
<response>
  <locationModificationResults>
    <result>
      <level>critical_failure</level>
      <locationChanged>true</locationChanged>
      <alteration>The repair collapses the window frame and leaves the study draftier than before.</alteration>
      <itemsConsumed>
        <itemName>Glass Pane</itemName>
        <itemName>Wooden Brace</itemName>
      </itemsConsumed>
      <itemsReceived>
        <itemName>Hidden Brass Key</itemName>
      </itemsReceived>
      <timeTaken>35 minutes</timeTaken>
      <other>A shower of splinters cuts anyone standing close.</other>
    </result>
  </locationModificationResults>
</response>`;

        const results = await parseLocationModificationResultsResponse(xml);
        const result = results.get('critical_failure');

        assert.ok(result);
        assert.equal(result.locationChanged, true);
        assert.equal(result.alteration, 'The repair collapses the window frame and leaves the study draftier than before.');
        assert.deepEqual(result.itemsConsumed, ['Glass Pane', 'Wooden Brace']);
        assert.deepEqual(result.itemsReceived, ['Hidden Brass Key']);
        assert.equal(result.timeTakenRaw, '35 minutes');
        assert.equal(result.timeTakenMinutes, 35);
        assert.equal(result.other, 'A shower of splinters cuts anyone standing close.');
    } finally {
        restore();
    }
});

test('location modification success-degree parsing fills omitted direct fields from the base outcome', async () => {
    const { parseLocationModificationResultsResponse, restore } = loadLocationModifyHelpers();
    try {
        const xml = `
<response>
  <locationModificationResults>
    <result>
      <level>major_success</level>
      <alteration>Repair the windows with clean panes and polished braces.</alteration>
    </result>
  </locationModificationResults>
</response>`;

        const results = await parseLocationModificationResultsResponse(xml, { baseOutcomeXml });
        const result = results.get('major_success');

        assert.ok(result);
        assert.equal(result.locationChanged, true);
        assert.deepEqual(result.itemsConsumed, ['Glass Pane']);
        assert.deepEqual(result.itemsReceived, ['Old Silver Coin']);
        assert.equal(result.timeTakenRaw, '20 minutes');
        assert.equal(result.timeTakenMinutes, 20);
        assert.equal(result.alteration, 'Repair the windows with clean panes and polished braces.');
    } finally {
        restore();
    }
});

test('location modification received items cannot duplicate selected input item names', () => {
    const { validateLocationModificationReceivedItemNames, restore } = loadLocationModifyHelpers();
    try {
        assert.equal(typeof validateLocationModificationReceivedItemNames, 'function');

        assert.throws(
            () => validateLocationModificationReceivedItemNames({
                receivedNames: ['Old Silver Coin', 'Wooden Brace'],
                inputThings: [
                    { name: 'Glass Pane' },
                    { name: 'Wooden Brace' }
                ]
            }),
            /listed selected input items as received items.*Wooden Brace/i
        );

        assert.doesNotThrow(() => validateLocationModificationReceivedItemNames({
            receivedNames: ['Old Silver Coin'],
            inputThings: [
                { name: 'Glass Pane' },
                { name: 'Wooden Brace' }
            ]
        }));
    } finally {
        restore();
    }
});

test('location modification inline die roll extraction strips the first override and preserves text', () => {
    const { extractInlineDieRollFromLocationModifyText, restore } = loadLocationModifyHelpers();
    try {
        const rollState = { value: null };
        const stripped = extractInlineDieRollFromLocationModifyText(
            'Patch the cracked bridge <17> with braided rope <3> and scavenged planks.',
            rollState
        );

        assert.equal(rollState.value, 17);
        assert.equal(stripped, 'Patch the cracked bridge with braided rope and scavenged planks.');
    } finally {
        restore();
    }
});
