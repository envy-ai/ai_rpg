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
        sanitizeForXml,
        directChildText(node, tagName) {
            const child = Array.from(node.childNodes).find(entry => entry.nodeType === 1 && entry.tagName === tagName);
            return child?.textContent?.trim() || null;
        }
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

test('craft result XML preserves selected source IDs, quantities and output stack counts', async () => {
    const { parseCraftingResultsResponse, restore } = loadParseCraftingResultsResponse();
    try {
        const xml = `<response><craftingResults><result><level>success</level>
          <itemsConsumed><item><thingId>iron_1</thingId><quantity>3</quantity></item>
          <item><thingId>iron_2</thingId><quantity>1</quantity></item></itemsConsumed>
          <itemsCrafted><item><name>Iron bar</name><count>2</count></item></itemsCrafted>
          <timeTaken>10 minutes</timeTaken></result></craftingResults></response>`;
        const result = (await parseCraftingResultsResponse(xml)).get('success');
        assert.deepEqual(JSON.parse(JSON.stringify(result.consumedItems)), [
            { thingId: 'iron_1', quantity: 3 }, { thingId: 'iron_2', quantity: 1 }
        ]);
        assert.equal(result.itemsRecovered[0].count, 2);
    } finally { restore(); }
});

test('craft result rejects structured content inside scalar consumed quantities', async () => {
    const { parseCraftingResultsResponse, restore } = loadParseCraftingResultsResponse();
    try {
        const xml = `<response><craftingResults><result><level>success</level><itemsConsumed>
            <item><thingId>iron_1</thingId><quantity><value>3</value></quantity></item>
            </itemsConsumed><timeTaken>1 minute</timeTaken></result></craftingResults></response>`;
        await assert.rejects(parseCraftingResultsResponse(xml), /quantity.*(?:text|child|scalar)/i);
    } finally { restore(); }
});

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
      </itemsConsumed>
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

test('success-degree craft parsing rejects mismatched item field closing tags', async () => {
    const { parseCraftingResultsResponse, restore } = loadParseCraftingResultsResponse();
    try {
        const malformedDegreeXml = `
<response>
  <craftingResults>
    <result>
      <level>critical_success</level>
      <itemsConsumed>
        <itemName>Wild Onion</itemName>
      </itemsConsumed>
      <itemsCrafted>
        <item>
          <name>Blessed Onion Knife</name>
          <count>1</count>
          <description>A knife with a clean green edge.</description>
          <moduleInstalledOnItemId>N/A</moduleType>
          <rarity>Uncommon</rarity>
        </item>
      </itemsCrafted>
      <timeTaken>20 minutes</timeTaken>
    </result>
  </craftingResults>
</response>`;

        await assert.rejects(
            parseCraftingResultsResponse(malformedDegreeXml, { baseOutcomeXml }),
            /Failed to parse crafting results response: Failed to parse XML content strictly/i
        );
    } finally {
        restore();
    }
});

function loadDegreePromptHelper({ complete, retries = 3, logs = [] }) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        async function renderCraftOutcomeForDegree(');
    const end = source.indexOf('\n        function parseCraftingNarrativeResponse(', start);
    assert.ok(start >= 0 && end > start);
    const parser = loadParseCraftingResultsResponse();
    const context = { promptEnv: { render: () => '<template/>' }, parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }), config: { ai: { retryAttempts: retries } },
        LLMClient: { chatCompletion: complete, logPrompt: options => logs.push(options) }, parseCraftingResultsResponse: parser.parseCraftingResultsResponse,
        getThingGenerationSchemaExtensions: require('../ThingGenerationSchema.js').getThingGenerationSchemaExtensions, modExtensionRegistry: null, ...require('../PromptRetryPolicy.js'), console: { warn() {} } };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.render = renderCraftOutcomeForDegree;`, context);
    return { render: context.render, restore: parser.restore };
}

test('degree prompt retries a marked completion failure and invalid selected outcomes before acceptance', async () => {
    const requests = [], logs = [], validations = [];
    const guardError = Object.assign(new Error('XML closing guard exhausted'), { isXmlGuardResponseError: true, rejectedResponse: '<response><craftingResults><result>' });
    const resultXml = (level, quantity) => `<response><craftingResults><result><level>${level}</level><itemsConsumed><item><thingId>iron_1</thingId><quantity>${quantity}</quantity></item></itemsConsumed><itemsCrafted/><timeTaken>1 minute</timeTaken></result></craftingResults></response>`;
    const responses = [guardError, resultXml('failure', 1), resultXml('success', 9), resultXml('success', 1)];
    const h = loadDegreePromptHelper({ logs, complete: async options => { requests.push(options); const next = responses.shift(); if (next instanceof Error) throw next; return next; } });
    try {
        const result = await h.render({ baseContext: {}, baseOutcomeXml: resultXml('success', 1), successOrFailure: 'success', mode: 'process', selectedInputQuantities: true,
            validateResults: async ({ selectedResult }) => { validations.push(selectedResult.consumedItems[0].quantity); if (selectedResult.consumedItems[0].quantity > 2) throw new Error('selected source quantity exceeds available 2'); } });
        assert.equal(requests.length, 4); assert.deepEqual(validations, [9, 1]);
        assert.equal(result.results.get('success').consumedItems[0].quantity, 1);
        assert.equal(result.raw, resultXml('success', 1));
        assert.ok(requests.every(request => request.metadataLabel === 'craft_success_degree_process'));
        assert.ok(requests.every(request => typeof request.xmlSchema === 'string'));
        assert.equal(typeof requests[0].xmlSchemaExtensions, 'function');
        for (const request of requests.slice(1)) {
            assert.equal(request.messages.filter(message => message.role === 'assistant').length, 0, 'correction starts from original prompt without rejected output');
            assert.equal(request.messages.length, 3);
        }
        assert.ok(logs.some(log => log.response === guardError.rejectedResponse));
        assert.match(requests[1].messages.at(-1).content, /closing guard exhausted/);
        assert.match(requests[2].messages.at(-1).content, /missing result.*success/i);
        assert.match(requests[3].messages.at(-1).content, /exceeds available/i);
    } finally { h.restore(); }
});

test('degree prompt does not retry cancellation, unrelated completion failures, or exhausted guard failures', async () => {
    for (const error of [Object.assign(new Error('cancelled'), { code: 'PROMPT_CANCELLED' }), new Error('configuration failed')]) {
        let calls = 0;
        const h = loadDegreePromptHelper({ complete: async () => { calls++; throw error; } });
        try { await assert.rejects(h.render({ baseContext: {}, baseOutcomeXml, successOrFailure: 'success' }), actual => actual === error); assert.equal(calls, 1); }
        finally { h.restore(); }
    }
    let calls = 0;
    const failure = Object.assign(new Error('guard exhausted'), { isXmlGuardResponseError: true, rejectedResponse: '<response>' });
    const h = loadDegreePromptHelper({ retries: 1, complete: async () => { calls++; throw failure; } });
    try { await assert.rejects(h.render({ baseContext: {}, baseOutcomeXml, successOrFailure: 'success' }), error => error.cause === failure); assert.equal(calls, 2); }
    finally { h.restore(); }
});

test('degree helper selects the proper schema for every crafting mode and leaves extensions lazy', async () => {
    const cases = [['craft', 'craftingResults', 'craft-success-degree.schema.xml'], ['process', 'craftingResults', 'craft-success-degree.schema.xml'], ['repair', 'craftingResults', 'craft-success-degree.schema.xml'], ['upgrade', 'craftingResults', 'craft-success-degree.schema.xml'], ['salvage', 'salvageResults', 'salvage-success-degree.schema.xml'], ['harvest', 'harvestResults', 'harvest-success-degree.schema.xml']];
    const requests = [];
    const h = loadDegreePromptHelper({ complete: async options => { requests.push(options); const wrapper = cases.find(row => row[0] === options.metadataLabel.replace('craft_success_degree_', ''))[1]; return `<response><${wrapper}><result><level>success</level></result></${wrapper}></response>`; } });
    try {
        for (const [mode, , schema] of cases) {
            await h.render({ baseContext: {}, baseOutcomeXml, successOrFailure: 'success', mode });
            const request = requests.at(-1);
            assert.equal(request.xmlSchema, schema);
            assert.equal(typeof request.xmlSchemaExtensions, 'function');
        }
        await assert.rejects(h.render({ baseContext: {}, baseOutcomeXml, successOrFailure: 'success', mode: 'unknown' }), /mode/i);
        assert.equal(requests.length, cases.length);
    } finally { h.restore(); }
});

test('degree helper recovers actual mocked transport guard exhaustion with a fresh complete response', async () => {
    const path = require('node:path'), axios = require('axios'), LLMClient = require('../LLMClient.js');
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir, hub: Globals.realtimeHub };
    Globals.baseDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'craft-degree-guard-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1', apiKey: 'test', model: 'mock', stream: false, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, xml_closing_tag_guard: true, live_deslop: false } };
    const requests = [], notices = [];
    Globals.realtimeHub = { emit: (...args) => notices.push(args) };
    const terminal = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };
    const partial = '<response><craftingResults><result><level>';
    const valid = '<response><craftingResults><result><level>success</level><itemsConsumed/><itemsCrafted/><timeTaken>1 minute</timeTaken></result></craftingResults></response>';
    axios.post = async (_url, payload) => {
        requests.push(structuredClone(payload)); const text = requests.length === 1 ? partial : valid;
        return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop', logprobs: { content: [{ id: 1, token: text, bytes: [...Buffer.from(text)], logprob: -0.1, top_logprobs: [] }], terminal } }], usage: { completion_tokens: requests.length === 1 ? 100 : 1 } } };
    };
    const h = loadDegreePromptHelper({ retries: 1, complete: options => LLMClient.chatCompletion({ ...options, requiredRegex: new RegExp(options.requiredRegex.source, options.requiredRegex.flags), stream: false, maxTokens: 100, retryAttempts: 0, output: 'silent', throwOnError: true }) });
    try {
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        const result = await h.render({ baseContext: {}, baseOutcomeXml, successOrFailure: 'success', mode: 'process' });
        assert.equal(result.raw, valid); assert.equal(requests.length, 2);
        assert.equal(requests[1].messages.some(message => message.role === 'assistant' && message.content === partial), false);
        assert.match(requests[1].messages.at(-1).content, /previous craft success-degree XML/i);
        assert.ok(!notices.some(args => args[1] === 'prompt_failed'));
    } finally { h.restore(); axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; Globals.realtimeHub = old.hub; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});
