const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const {
  resolveInitialFactionStandingBounds,
  parseInitialFactionStandingsXml,
  applyInitialFactionStandings
} = require('../InitialFactionStandings.js');

const factions = [
  { id: 'faction_1', name: 'Glass Wardens' },
  { id: 'faction_2', name: 'Ash Choir' }
];

function response(first = '-20', second = '0') {
  return `<initialFactionStandings>
    <standing><factionId>faction_1</factionId><factionName>Glass Wardens</factionName><reputation>${first}</reputation></standing>
    <standing><factionId>faction_2</factionId><factionName>Ash Choir</factionName><reputation>${second}</reputation></standing>
  </initialFactionStandings>`;
}

test('strictly parses one bounded integer standing for every exact faction identity', () => {
  const parsed = parseInitialFactionStandingsXml(response('-80', '20'), { factions });
  assert.deepEqual(Object.fromEntries(parsed), {
    faction_1: -80,
    faction_2: 20
  });

  assert.throws(
    () => parseInitialFactionStandingsXml(response('-81', '0'), { factions }),
    /Glass Wardens.*integer from -80 to 20/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response('-2.5', '0'), { factions }),
    /Glass Wardens.*integer from -80 to 20/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response('-20', '+0'), { factions }),
    /Ash Choir.*integer from -80 to 20/
  );
});

test('rejects missing, duplicate, unknown, and mismatched faction entries', () => {
  assert.throws(
    () => parseInitialFactionStandingsXml(
      '<initialFactionStandings><standing><factionId>faction_1</factionId><factionName>Glass Wardens</factionName><reputation>0</reputation></standing></initialFactionStandings>',
      { factions }
    ),
    /missing "Ash Choir" \(faction_2\)/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace('faction_2', 'faction_1'), { factions }),
    /duplicate entry for faction id "faction_1"/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace('faction_2', 'faction_999'), { factions }),
    /unknown faction id "faction_999"/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace('Ash Choir', 'Ash Chorus'), { factions }),
    /does not match id "faction_2"/
  );
});

test('rejects duplicate and unexpected direct fields inside a standing entry', () => {
  assert.throws(
    () => parseInitialFactionStandingsXml(
      response().replace('<reputation>-20</reputation>', '<reputation>-20</reputation><reputation>-10</reputation>'),
      { factions }
    ),
    /exactly one <reputation> element; found 2/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(
      response().replace('<reputation>-20</reputation>', '<reputation>-20</reputation><reason>Because.</reason>'),
      { factions }
    ),
    /unexpected <reason> element/
  );
});

test('rejects non-whitespace text and CDATA directly under the root', () => {
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace(
      '<initialFactionStandings>',
      '<initialFactionStandings>unexpected prose'
    ), { factions }),
    /unexpected direct text content outside <standing> elements/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace(
      '<initialFactionStandings>',
      '<initialFactionStandings><![CDATA[unexpected prose]]>'
    ), { factions }),
    /unexpected direct CDATA content outside <standing> elements/
  );
});

test('rejects non-whitespace text and CDATA directly inside a standing entry', () => {
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace(
      '<standing><factionId>faction_1</factionId>',
      '<standing>unexpected prose<factionId>faction_1</factionId>'
    ), { factions }),
    /unexpected direct text content outside its required fields/
  );
  assert.throws(
    () => parseInitialFactionStandingsXml(response().replace(
      '<standing><factionId>faction_1</factionId>',
      '<standing><![CDATA[unexpected prose]]><factionId>faction_1</factionId>'
    ), { factions }),
    /unexpected direct CDATA content outside its required fields/
  );
});

test('rejects faction rosters with names duplicated case-insensitively', () => {
  assert.throws(
    () => parseInitialFactionStandingsXml(response(), {
      factions: [
        { id: 'faction_1', name: 'Glass Wardens' },
        { id: 'faction_2', name: 'glass wardens' }
      ]
    }),
    /duplicate faction name "glass wardens"/
  );
});

test('validates atomically and preserves standings that already exist', () => {
  let state = { faction_1: -7, unrelated: 12 };
  let writes = 0;
  const player = {
    getFactionStandings: () => ({ ...state }),
    setFactionStandings: next => {
      writes += 1;
      state = { ...next };
    }
  };
  const generated = new Map([
    ['faction_1', -60],
    ['faction_2', -40]
  ]);

  const result = applyInitialFactionStandings({ player, factions, standings: generated });
  assert.equal(writes, 1);
  assert.deepEqual(state, { faction_1: -7, faction_2: -40, unrelated: 12 });
  assert.deepEqual(result.applied, { faction_2: -40 });

  writes = 0;
  assert.throws(
    () => applyInitialFactionStandings({
      player,
      factions,
      standings: new Map([['faction_1', -10], ['faction_2', 21]])
    }),
    /Ash Choir.*integer from -80 to 20/
  );
  assert.equal(writes, 0);
  assert.deepEqual(state, { faction_1: -7, faction_2: -40, unrelated: 12 });
});

test('resolves configurable bounds strictly', () => {
  assert.deepEqual(resolveInitialFactionStandingBounds({}), { min: -80, max: 20 });
  assert.deepEqual(
    resolveInitialFactionStandingBounds({ factions: { starting_reputation: { min: -15, max: 8 } } }),
    { min: -15, max: 8 }
  );
  assert.throws(
    () => resolveInitialFactionStandingBounds({ factions: { starting_reputation: { min: '-80', max: 20 } } }),
    /min must be a finite integer/
  );
  assert.throws(
    () => resolveInitialFactionStandingBounds({ factions: { starting_reputation: { min: 5, max: 4 } } }),
    /min must be less than or equal to max/
  );
});

test('default config and config editor expose the initial standing bounds', () => {
  const root = path.join(__dirname, '..');
  const config = yaml.load(fs.readFileSync(path.join(root, 'config.default.yaml'), 'utf8'));
  assert.deepEqual(config.factions.starting_reputation, { min: -80, max: 20 });
  const configView = fs.readFileSync(path.join(root, 'views', 'config.njk'), 'utf8');
  assert.match(configView, /name="factions\.starting_reputation\.min::int"/);
  assert.match(configView, /name="factions\.starting_reputation\.max::int"/);
});
