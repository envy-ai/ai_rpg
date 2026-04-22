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

function getText(node, tagName) {
    const child = node.getElementsByTagName(tagName)[0] || null;
    return child && typeof child.textContent === 'string'
        ? child.textContent.trim()
        : null;
}

async function parseThingsXml(xmlContent) {
    const doc = Utils.parseXmlDocument(sanitizeForXml(xmlContent), 'text/xml');
    return Array.from(doc.getElementsByTagName('item')).map(itemNode => {
        const countRaw = getText(itemNode, 'count');
        const count = countRaw === null ? null : Number(countRaw);
        return {
            name: getText(itemNode, 'name'),
            description: getText(itemNode, 'description'),
            slot: getText(itemNode, 'slot'),
            rarity: getText(itemNode, 'rarity'),
            count: Number.isFinite(count) ? count : null
        };
    });
}

function loadParseCraftingResultsResponse() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        const sharedXmlSerializer = new XMLSerializer();');
    const end = source.indexOf('\n        async function renderCraftOutcomeForDegree', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate craft result parser in api.js');
    }

    const functionSource = source.slice(start, end);
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };

    const context = {
        Array,
        Error,
        Number,
        String,
        TypeError,
        XMLSerializer,
        Utils,
        console,
        parseThingsXml,
        sanitizeForXml
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.parseCraftingResultsResponse = parseCraftingResultsResponse;`,
        context
    );

    return {
        parseCraftingResultsResponse: context.parseCraftingResultsResponse,
        restore: () => {
            Globals.config = previousConfig;
        }
    };
}

const baseOutcomeXml = `
<response>
  <craftingResults>
    <result>
      <level>success</level>
      <itemsConsumed>
        <itemName>Wild Onion</itemName>
        <itemName>Primordial Leaf Compost</itemName>
      </itemsConsumed>
      <itemsCrafted>
        <item>
          <name>Planted Onion Row</name>
          <count>1</count>
          <description>A neat row of onion sets.</description>
          <slot>N/A</slot>
          <rarity>Common</rarity>
        </item>
      </itemsCrafted>
      <timeTaken>20 minutes</timeTaken>
    </result>
  </craftingResults>
</response>`;

test('success-degree craft parsing fills omitted result fields from the base outcome', async () => {
    const { parseCraftingResultsResponse, restore } = loadParseCraftingResultsResponse();
    try {
        const degreeXml = `
<response>
  <craftingResults>
    <result>
      <level>critical_success</level>
      <itemsConsumed>
        <itemName>Wild Onion</itemName>
        <itemName>Primordial Leaf Compost</itemName>
      </itemsCrafted>
      <item>
        <name>Blessed Onion Row</name>
        <count>1</count>
        <description>A better row of onion sets.</description>
        <rarity>Uncommon</rarity>
      </item>
    </result>
  </craftingResults>
</response>`;

        const results = await parseCraftingResultsResponse(degreeXml, { baseOutcomeXml });
        const result = results.get('critical_success');

        assert.ok(result);
        assert.equal(result.timeTakenRaw, '20 minutes');
        assert.equal(result.timeTakenMinutes, 20);
        assert.deepEqual(
            JSON.parse(JSON.stringify(result.itemsConsumed)),
            ['Wild Onion', 'Primordial Leaf Compost']
        );
        assert.equal(result.itemsRecovered[0]?.name, 'Blessed Onion Row');
        assert.equal(result.itemsRecovered[0]?.rarity, 'Uncommon');
        assert.equal(result.itemsRecovered[0]?.slot, 'N/A');
    } finally {
        restore();
    }
});

test('success-degree craft parsing preserves explicit empty crafted output fields', async () => {
    const { parseCraftingResultsResponse, restore } = loadParseCraftingResultsResponse();
    try {
        const degreeXml = `
<response>
  <craftingResults>
    <result>
      <level>critical_failure</level>
      <itemsConsumed>
        <itemName>Wild Onion</itemName>
        <itemName>Primordial Leaf Compost</itemName>
      </itemsConsumed>
      <itemsCrafted></itemsCrafted>
      <timeTaken>30 minutes</timeTaken>
    </result>
  </craftingResults>
</response>`;

        const results = await parseCraftingResultsResponse(degreeXml, { baseOutcomeXml });
        const result = results.get('critical_failure');

        assert.ok(result);
        assert.equal(result.timeTakenRaw, '30 minutes');
        assert.deepEqual(JSON.parse(JSON.stringify(result.itemsRecovered)), []);
    } finally {
        restore();
    }
});
