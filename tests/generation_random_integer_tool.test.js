const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const {
  createChatToolRuntime,
  getChatToolDefinitions,
} = require('../chat_tool_calls.js');

function createMinimalRuntime(overrides = {}) {
  return createChatToolRuntime({
    getConfig: () => ({ max_tool_calls: 3 }),
    getChatHistory: () => [],
    isAssistantProseLikeEntry: () => true,
    serializeNpcForClient: () => ({}),
    buildLocationResponse: () => ({}),
    getCurrentPlayer: () => null,
    createLocationFromEvent: async () => {
      throw new Error('createLocationFromEvent is unavailable in this test');
    },
    createRegionStubFromEvent: async () => {
      throw new Error('createRegionStubFromEvent is unavailable in this test');
    },
    generateItemsByNames: async () => {
      throw new Error('generateItemsByNames is unavailable in this test');
    },
    ensureExitConnection: () => {
      throw new Error('ensureExitConnection is unavailable in this test');
    },
    findRegionByLocationId: () => null,
    LLMClient: { chatCompletion: async () => '<done />' },
    Player: class Player {},
    Thing: class Thing {},
    Location: class Location {},
    Region: class Region {},
    getGameLocations: () => [],
    getFactions: () => ({}),
    getRegionsMap: () => ({}),
    getPendingRegionStubs: () => ({}),
    getModExtensionRegistry: () => null,
    ...overrides,
  });
}

test('generateRandomInteger is exposed as an inclusive integer range tool', () => {
  const tool = getChatToolDefinitions()
    .find((definition) => definition?.function?.name === 'generateRandomInteger');

  assert.ok(tool, 'expected generateRandomInteger tool definition');
  assert.strictEqual(tool.type, 'function');
  assert.deepStrictEqual(tool.function.parameters.required, ['min', 'max']);
  assert.strictEqual(tool.function.parameters.properties.min.type, 'integer');
  assert.strictEqual(tool.function.parameters.properties.max.type, 'integer');
  assert.strictEqual(tool.function.parameters.additionalProperties, false);
  assert.match(tool.function.description, /inclusive/i);
});

test('generateRandomInteger returns min when the inclusive range has one value', async () => {
  const runtime = createMinimalRuntime();

  const result = await runtime.executeChatToolCall({
    id: 'call_random',
    functionName: 'generateRandomInteger',
    argumentsObject: { min: 7, max: 7 },
    argumentsText: '{"min":7,"max":7}',
  });

  assert.strictEqual(result.metadata.status, 'success');
  assert.strictEqual(result.metadata.min, 7);
  assert.strictEqual(result.metadata.max, 7);
  assert.strictEqual(result.metadata.value, 7);
  assert.match(result.content, /<randomIntegerResult>/);
  assert.match(result.content, /<value>7<\/value>/);
});

test('generateRandomInteger reports invalid ranges loudly', async () => {
  const runtime = createMinimalRuntime();

  const result = await runtime.executeChatToolCall({
    id: 'call_random',
    functionName: 'generateRandomInteger',
    argumentsObject: { min: 10, max: 3 },
    argumentsText: '{"min":10,"max":3}',
  });

  assert.strictEqual(result.metadata.error, true);
  assert.match(result.content, /min &lt;= max/);
});

test('tool loop disables additionalPayload tools after attempts are exhausted', async () => {
  const seenRequestOptions = [];
  const runtime = createMinimalRuntime({
    getConfig: () => ({ max_tool_calls: 1 }),
    LLMClient: {
      formatMessagesForErrorLog: (messages) => JSON.stringify(messages),
      logPrompt: () => {},
      chatCompletion: async (options) => {
        seenRequestOptions.push(options);
        if (seenRequestOptions.length <= 2) {
          options.onResponse({
            data: {
              choices: [{
                message: {
                  content: '',
                  tool_calls: [{
                    id: `call_random_${seenRequestOptions.length}`,
                    type: 'function',
                    function: {
                      name: 'generateRandomInteger',
                      arguments: '{"min":1,"max":1}',
                    },
                  }],
                },
              }],
            },
          });
          return '';
        }
        options.onResponse({
          data: {
            choices: [{
              message: {
                content: 'done',
              },
            }],
          },
        });
        return 'done';
      },
    },
  });
  const tool = getChatToolDefinitions()
    .find((definition) => definition?.function?.name === 'generateRandomInteger');

  const result = await runtime.runChatCompletionWithToolLoop({
    requestOptions: {
      messages: [{ role: 'user', content: 'roll it' }],
      additionalPayload: {
        tools: [tool],
        tool_choice: 'auto',
      },
    },
    metadataLabel: 'random_integer_loop_test',
  });

  assert.strictEqual(result.aiResponse, 'done');
  assert.ok(seenRequestOptions[0].additionalPayload.tools);
  assert.ok(seenRequestOptions[1].additionalPayload.tools);
  assert.strictEqual(seenRequestOptions[2].additionalPayload.tools, undefined);
  assert.strictEqual(seenRequestOptions[2].additionalPayload.tool_choice, 'none');
});

test('generation prompt completions are wired to the random integer tool loop', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8',
  );

  assert.match(
    serverSource,
    /createChatToolRuntime[\s\S]{0,120}getChatToolDefinitions[\s\S]{0,120}require\('\.\/chat_tool_calls\.js'\);/,
  );
  assert.match(
    serverSource,
    /const GENERATION_RANDOM_TOOL_NAMES = new Set\(\[\s*'generateRandomInteger'\s*\]\);/,
  );
  assert.match(serverSource, /function getGenerationPromptToolDefinitions\(\)/);
  assert.match(serverSource, /async function runGenerationPromptCompletion\(/);
  assert.match(
    serverSource,
    /additionalPayload:\s*\{[\s\S]{0,300}tools:\s*getGenerationPromptToolDefinitions\(\)[\s\S]{0,120}tool_choice:\s*toolChoice/,
    'generation helper should expose tools through LLMClient additionalPayload',
  );
  assert.match(
    serverSource,
    /prefill:\s*null/,
    'generation helper should disable assistant prefill for tool-call requests',
  );

  const expectedGenerationLabels = [
    'region_generation',
    'location_generation',
    'npc_generation_single',
    'location_things_generation',
  ];

  for (const label of expectedGenerationLabels) {
    const pattern = new RegExp(
      `runGenerationPromptCompletion\\([\\s\\S]{0,800}metadataLabel:\\s*'${label}'`,
    );
    assert.match(serverSource, pattern, `${label} should use generation tool loop`);
  }

  assert.match(
    serverSource,
    /runGenerationPromptCompletion\([\s\S]{0,800}metadataLabel:\s*inventoryMetadataLabel/,
    'inventory item generation should use generation tool loop',
  );
  assert.match(
    serverSource,
    /runGenerationPromptCompletion\([\s\S]{0,800}metadataLabel:\s*generationMetadataLabel/,
    'named item generation should use generation tool loop',
  );
  assert.match(
    serverSource,
    /runGenerationPromptCompletion\([\s\S]{0,800}metadataLabel:\s*contentsMetadataLabel/,
    'container item generation should use generation tool loop',
  );
});

test('location thing generation retries strict response validation and does not swallow exhausted failures', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8',
  );
  const generationStart = serverSource.indexOf('async function generateLocationThingsForLocation');
  const generationEnd = serverSource.indexOf('\nfunction renderSkillsPrompt', generationStart);
  const locationGenerationStart = serverSource.indexOf('async function generateLocationFromPrompt');
  const locationGenerationEnd = serverSource.indexOf('\nfunction renderRegionEntrancePrompt', locationGenerationStart);

  assert.notStrictEqual(generationStart, -1);
  assert.notStrictEqual(generationEnd, -1);
  assert.notStrictEqual(locationGenerationStart, -1);
  assert.notStrictEqual(locationGenerationEnd, -1);

  const generationSource = serverSource.slice(generationStart, generationEnd);
  const locationGenerationSource = serverSource.slice(locationGenerationStart, locationGenerationEnd);
  assert.match(serverSource, /const LOCATION_THINGS_GENERATION_MAX_ATTEMPTS = 3;/);
  assert.match(generationSource, /const parsedItems = await withRetry\(async \(\) => \{/);
  assert.match(generationSource, /}, LOCATION_THINGS_GENERATION_MAX_ATTEMPTS\);/);
  assert.match(generationSource, /strictXml:\s*true/);
  assert.match(generationSource, /response contained no item or scenery entries/);
  assert.doesNotMatch(
    locationGenerationSource,
    /Failed to generate location things:[\s\S]{0,160}return \[\]/,
    'location expansion must propagate exhausted thing-generation failures',
  );
});
