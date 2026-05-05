const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

test('alter NPC XML parser captures aiNotes from returned personality block', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    try {
        const parsed = Events._parseCharacterAlterXml(`
<npc>
  <name>Stone Goblin</name>
  <description>A goblin half-set into stone.</description>
  <shortDescription>Petrified goblin</shortDescription>
  <personality>
    <type>Defensive survivor</type>
    <traits>anxious</traits>
    <notes>Still remembers the curse.</notes>
    <aiNotes>Stone Goblin freezes when threatened and flees from spellcasters.</aiNotes>
  </personality>
</npc>`);

        assert.ok(parsed);
        assert.equal(parsed.aiNotes, 'Stone Goblin freezes when threatened and flees from spellcasters.');
        assert.equal(parsed.personality.aiNotes, 'Stone Goblin freezes when threatened and flees from spellcasters.');
    } finally {
        Globals.config = previousConfig;
    }
});

test('alter NPC XML parser captures top-level aiNotes', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: true };
    try {
        const parsed = Events._parseCharacterAlterXml(`
<npc>
  <name>Watch Captain</name>
  <description>A captain watching the gate.</description>
  <shortDescription>Alert captain</shortDescription>
  <aiNotes>Watch Captain calls reinforcements if the gate is attacked.</aiNotes>
</npc>`);

        assert.ok(parsed);
        assert.equal(parsed.aiNotes, 'Watch Captain calls reinforcements if the gate is attacked.');
    } finally {
        Globals.config = previousConfig;
    }
});
