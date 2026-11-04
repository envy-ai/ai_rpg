const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const dir = path.join(__dirname, '..', 'schemas', 'xml');
const extensions = { playerFields: [], thingFields: [] };

test('every named production XML schema loads through the normal file-backed compiler', () => {
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.schema.xml'));
    assert.ok(files.length >= 35);
    for (const file of files) assert.ok(loadXmlGenerationSchema(file, { extensions }).name, file);
});

test('starting progression schemas accept representative empty and populated structured responses', () => {
    const fixtures = [
        ['skills.schema.xml', '<skills><skill><name>Medicine</name><description>Practical treatment.</description></skill></skills>'],
        ['faction-relationships.schema.xml', '<factionRelationships/>'],
        ['npc-abilities.schema.xml', '<npcs><npc><name>Agent</name><abilities/></npc></npcs>'],
        ['npc-aliases.schema.xml', '<npcs><npc><name>Agent</name><aliases/></npc></npcs>'],
        ['initial-faction-standings.schema.xml', '<initialFactionStandings><standing><factionId>faction_1</factionId><factionName>Wardens</factionName><reputation>0</reputation></standing></initialFactionStandings>']
    ];
    for (const [file, xml] of fixtures) assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema(file, { extensions }) }).inspect(xml), null, file);
});

test('ability assignment schema accepts omissions allowed by actual strict parser', () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseNpcAbilityAssignments(');
    const end = source.indexOf('\nfunction parseNpcAliasAssignments(', start);
    assert.ok(start >= 0 && end > start);
    const ctx = { Utils: require('../Utils.js'), console };
    vm.createContext(ctx); vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseNpcAbilityAssignments;`, ctx);
    const xml = '<npcs><npc><name>Agent</name><abilities><ability><name>Lookout</name></ability></abilities></npc></npcs>';
    assert.equal(ctx.parse(xml, { strict: true }).get('agent').abilities[0].description, '');
    assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('npc-abilities.schema.xml') }).inspect(xml), null);
});

test('calendar schema accepts actual parser-valid calendars without optional seasons', () => {
    const vm = require('node:vm'), Utils = require('../Utils.js'), Globals = require('../Globals.js');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function parseCalendarDefinitionXml('), end = source.indexOf('        function parseSeasonImageDescriptionsXml(', start);
    assert.ok(start >= 0 && end > start);
    const ctx = { Utils, sanitizeXmlForDom: value => value }; vm.createContext(ctx); vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseCalendarDefinitionXml;`, ctx);
    const xml = '<calendarDefinition><months><month><name>Dawn</name><lengthDays>30</lengthDays></month></months><weekdays><weekday>First</weekday></weekdays></calendarDefinition>';
    const previous = Globals.config; Globals.config = { ai: {} };
    try { assert.equal(ctx.parse(xml).seasons.length, 0); } finally { Globals.config = previous; }
    assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('calendar-definition.schema.xml') }).inspect(xml), null);
});

test('edited prose schema permits balanced hidden markup but not an unclosed nested element', () => {
    const schema = loadXmlGenerationSchema('edited-text.schema.xml');
    assert.equal(new XmlClosingTagGuard({ schema }).inspect('<editedText>Hello <hidden>secret</hidden> world.</editedText>'), null);
    assert.ok(new XmlClosingTagGuard({ schema }).inspect('<editedText>Hello <hidden>secret</editedText>'));
});
