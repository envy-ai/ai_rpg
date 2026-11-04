const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadXmlGenerationSchema, compileXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const fixtures = path.join(__dirname, 'fixtures', 'xml-generation-schema');

test('named schema files compile cardinality, nested references and named extensions', () => {
    const fragment = loadXmlGenerationSchema('extra.schema.xml', { baseDirectory: fixtures });
    const root = loadXmlGenerationSchema('roster.schema.xml', { baseDirectory: fixtures, extensions: { extraFields: [fragment] } });
    assert.equal(root.name, 'roster');
    const byName = Object.fromEntries(root.children.map(child => [child.name, child]));
    assert.deepEqual([byName.owner.min, byName.owner.max], [1, 1]);
    assert.deepEqual([byName.note.min, byName.note.max], [0, 1]);
    assert.deepEqual([byName.item.min, byName.item.max], [1, Infinity]);
    assert.deepEqual([byName.tag.min, byName.tag.max], [0, Infinity]);
    assert.deepEqual([byName.rarity.min, byName.rarity.max], [0, 1]);
    assert.deepEqual(byName.item.children.map(child => child.name), ['name', 'description']);
    assert.equal(byName.owner.description.trim(), 'Owner name');
});

test('schema compiler rejects invalid cardinality, duplicate child names and unresolved extensions', () => {
    for (const source of ['<root><x optional="maybe"/></root>', '<root><x/><x/></root>', '<root><extensions source="missing"/></root>']) {
        assert.throws(() => compileXmlGenerationSchema(source), undefined, source);
    }
});

test('file references must exist and match the named child', () => {
    assert.throws(() => compileXmlGenerationSchema('<root><item ref="missing.schema.xml"/></root>', { resolveReference: () => { throw new Error('missing schema'); } }), /missing schema/);
    assert.throws(() => compileXmlGenerationSchema('<root><other ref="item.schema.xml"/></root>', { resolveReference: () => loadXmlGenerationSchema('item.schema.xml', { baseDirectory: fixtures }) }), /name|root|other|reference/i);
    assert.throws(() => loadXmlGenerationSchema('cycle.schema.xml', { baseDirectory: fixtures }), /cycl/i);
    assert.throws(() => loadXmlGenerationSchema(path.join(fixtures, 'item.schema.xml'), { baseDirectory: fixtures }), /relative/i);
    assert.throws(() => loadXmlGenerationSchema('../../AGENTS.md', { baseDirectory: fixtures }));
});

test('bare cardinality flags do not rewrite field names or quoted description text', () => {
    const root = compileXmlGenerationSchema('<root><optional/><multiple/><note optional>mentions multiple and optional</note><entry multiple/></root>');
    assert.deepEqual(root.children.map(child => child.name), ['optional', 'multiple', 'note', 'entry']);
    assert.equal(root.children[2].description, 'mentions multiple and optional');
    assert.equal(root.children[2].min, 0);
    assert.equal(root.children[3].max, Infinity);
});

test('production batch and single-item schemas preserve empty-batch and exact-one contracts', () => {
    const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
    const { getThingGenerationSchemaExtensions } = require('../ThingGenerationSchema.js');
    const extensions = getThingGenerationSchemaExtensions({ registry: null });
    const batch = loadXmlGenerationSchema('items.schema.xml', { extensions });
    const single = loadXmlGenerationSchema('single-item.schema.xml', { extensions });
    assert.equal(new XmlClosingTagGuard({ schema: batch }).inspect('<items></items>'), null);
    assert.ok(new XmlClosingTagGuard({ schema: single }).inspect('<items></items>'));
    const one = '<items><item><name>N</name><description>D</description></item></items>';
    assert.equal(new XmlClosingTagGuard({ schema: single }).inspect(one), null);
    const two = '<items><item><name>N</name><description>D</description></item><item><name>M</name><description>D</description></item></items>';
    assert.ok(new XmlClosingTagGuard({ schema: single }).inspect(two));
});

test('enabled mod fields are loaded from named fragment files and omitted when disabled', () => {
    const ModExtensionRegistry = require('../ModExtensionRegistry.js');
    const { getThingGenerationSchemaExtensions } = require('../ThingGenerationSchema.js');
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({ modName: 'implants', entityType: 'thing', fieldName: 'implantSlot', type: 'string', exposeToXmlParser: true, xmlPrompt: { placeholder: 'Implant slot' } });
    const enabled = loadXmlGenerationSchema('item.schema.xml', { extensions: getThingGenerationSchemaExtensions({ registry }) });
    const disabled = loadXmlGenerationSchema('item.schema.xml', { extensions: getThingGenerationSchemaExtensions({ registry: new ModExtensionRegistry() }) });
    assert.ok(enabled.children.some(child => child.name === 'implantSlot'));
    assert.ok(!disabled.children.some(child => child.name === 'implantSlot'));
});

test('enabled modules fragment permits empty and repeated slots with required type', () => {
    const ModExtensionRegistry = require('../ModExtensionRegistry.js');
    const { getThingGenerationSchemaExtensions } = require('../ThingGenerationSchema.js');
    const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({ modName: 'modules', entityType: 'thing', fieldName: 'moduleSlots', type: 'array', exposeToXmlParser: true, xmlPrompt: { placeholder: 'slots', collection: { itemTagName: 'moduleSlot', fields: [{ fieldName: 'type', tagName: 'type', type: 'string', required: true }, { fieldName: 'label', tagName: 'label', type: 'string', required: false }] } } });
    const enabled = loadXmlGenerationSchema('item.schema.xml', { extensions: getThingGenerationSchemaExtensions({ registry }) });
    const disabled = loadXmlGenerationSchema('item.schema.xml', { extensions: getThingGenerationSchemaExtensions({ registry: new ModExtensionRegistry() }) });
    const prefix = '<item><name>x</name><description>y</description>';
    const slots = [ '<moduleSlots/>', '<moduleSlots><moduleSlot><type>a</type></moduleSlot><moduleSlot><label>L</label><type>b</type></moduleSlot></moduleSlots>' ];
    for (const content of slots) assert.equal(new XmlClosingTagGuard({ schema: enabled }).inspect(prefix + content + '</item>'), null);
    assert.ok(new XmlClosingTagGuard({ schema: enabled }).inspect(prefix + '<moduleSlots><moduleSlot><label>L</label></moduleSlot></moduleSlots></item>'));
    assert.ok(new XmlClosingTagGuard({ schema: disabled }).inspect(prefix + slots[0] + '</item>'));
});
