const test = require('node:test');
const assert = require('node:assert/strict');

const LLMClient = require('../LLMClient.js');
const { generateInitialFactionStandings } = require('../server.js');

function createPlayer(existing = {}) {
  let standings = { ...existing };
  return {
    class: 'Grave Warden',
    race: 'Orc',
    description: 'A former border guard known for protecting refugees.',
    getFactionStandings: () => ({ ...standings }),
    setFactionStandings: value => { standings = { ...value }; }
  };
}

test('new-game standing generation retries with exact validation feedback, logs attempts, and applies atomically', async () => {
  const originalCompletion = LLMClient.chatCompletion;
  const originalLogPrompt = LLMClient.logPrompt;
  const completionCalls = [];
  const logs = [];
  const replies = [
    '<initialFactionStandings><standing><factionId>faction_1</factionId><factionName>Glass Wardens</factionName><reputation>-81</reputation></standing></initialFactionStandings>',
    '<initialFactionStandings><standing><factionId>faction_1</factionId><factionName>Glass Wardens</factionName><reputation>20</reputation></standing></initialFactionStandings>'
  ];
  LLMClient.chatCompletion = async options => {
    completionCalls.push(options);
    return replies.shift();
  };
  LLMClient.logPrompt = entry => logs.push(entry);

  try {
    const player = createPlayer();
    const result = await generateInitialFactionStandings({
      player,
      factions: [{
        id: 'faction_1',
        name: 'Glass Wardens',
        shortDescription: 'Protectors of the glass frontier.',
        description: 'They guard settlements against raiders.',
        homeRegionName: 'Glass March',
        tags: ['guards'],
        goals: ['Protect civilians'],
        assets: [{ name: 'Border Keeps', description: 'Publicly known forts.' }],
        violenceLevel: 5,
        relations: { hidden_secret: { status: 'hostile', notes: 'Secret scheme.' } }
      }]
    });

    assert.equal(result.attempts, 2);
    assert.deepEqual(player.getFactionStandings(), { faction_1: 20 });
    assert.equal(completionCalls.length, 2);
    assert.equal(completionCalls[0].metadataLabel, 'initial_faction_standings_generation');
    assert.equal(completionCalls[0].expectedXmlRootTag, 'initialFactionStandings');
    const firstPrompt = completionCalls[0].messages.map(message => message.content).join('\n');
    assert.match(firstPrompt, /Grave Warden/);
    assert.match(firstPrompt, /Orc/);
    assert.match(firstPrompt, /protecting refugees/);
    assert.match(firstPrompt, /Glass Wardens/);
    assert.doesNotMatch(firstPrompt, /violenceLevel|Secret scheme/);
    assert.match(
      completionCalls[1].messages.at(-1).content,
      /Glass Wardens.*<reputation> must be an integer from -80 to 20/
    );
    assert.equal(logs.length, 2);
    assert.match(logs[0].sections[0].content, /rejected.*integer from -80 to 20/);
    assert.match(logs[1].sections[0].content, /accepted/);
  } finally {
    LLMClient.chatCompletion = originalCompletion;
    LLMClient.logPrompt = originalLogPrompt;
  }
});

test('zero factions skip completion and do not mutate the player', async () => {
  const originalCompletion = LLMClient.chatCompletion;
  let called = false;
  LLMClient.chatCompletion = async () => {
    called = true;
    throw new Error('should not be called');
  };
  try {
    const player = createPlayer({ retained: -3 });
    const result = await generateInitialFactionStandings({ player, factions: [] });
    assert.equal(called, false);
    assert.equal(result.attempts, 0);
    assert.deepEqual(player.getFactionStandings(), { retained: -3 });
  } finally {
    LLMClient.chatCompletion = originalCompletion;
  }
});
