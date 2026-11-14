'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../Utils.js');
const TechniqueService = require('../TechniqueService.js');
const { parseTechniqueDisciplineGroupXml, flattenTechniqueDisciplineGroups, writeTechniqueXmlValue, techniqueChangeSchema, disciplineGroupSchema } = require('../TechniqueXml.js');
const TechniqueEvents = require('../TechniqueEvents.js');
const { parseStartingTechniques } = require('../StartingTechniques.js');
const { withTechniqueWorld, mechanics, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');

const parseGroup = (xml, options) => {
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    return parseTechniqueDisciplineGroupXml(document.documentElement, options);
};

const childCandidate = name => ({
    name,
    description: `${name} is a carefully practiced action.`,
    semanticKey: name.toLowerCase().replaceAll(' ', '-'),
    revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' } }]
});

function eventXml(value) {
    const document = new DOMImplementation().createDocument(null, 'techniqueChange', null);
    writeTechniqueXmlValue(document.documentElement, value, techniqueChangeSchema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

function groupXml(value) {
    const document = new DOMImplementation().createDocument(null, 'discipline', null);
    writeTechniqueXmlValue(document.documentElement, value, disciplineGroupSchema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

test('discipline groups resolve their parent before children and return canonical flat entry DTOs', async () => {
    await withTechniqueWorld(async () => {
        const known = addDefinition('technique-group-known', mechanics({ effects: [{ id: 'guard', kind: 'buff', status: { name: 'Guard', description: 'A ward.', duration: 2, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] }), { disciplineId: 'discipline-integration' });
        const existing = parseGroup(`<discipline><disciplineId>${known.disciplineId}</disciplineId><techniques><technique><techniqueId>${known.id}</techniqueId></technique></techniques></discipline>`);
        assert.equal(existing.disciplineId, known.disciplineId);
        assert.deepEqual(existing.techniques, [{ techniqueId: known.id }]);

        const novel = parseGroup('<discipline><name>Field Medicine</name><description>Practical treatment and restoration.</description><accessRequirements/><publicAccess>false</publicAccess><techniques><technique><candidate><name>Field Mend</name><description>Restore a practiced ally.</description><semanticKey>field-mend</semanticKey><revisions><revision><target><kind>self</kind></target><check><kind>automatic</kind></check></revision></revisions></candidate></technique></techniques></discipline>');
        assert.equal(novel.disciplineId, 'discipline_field_medicine');
        assert.equal(novel.candidateDiscipline.name, 'Field Medicine');
        assert.equal(novel.techniques[0].candidate.name, 'Field Mend');
        assert.equal(Object.hasOwn(novel.techniques[0].candidate, 'disciplineId'), false);
        assert.deepEqual(Object.keys(novel.techniques[0]), ['candidate', 'candidateDiscipline']);
    });
});

test('discipline groups reject invalid parent branches, unknown references, and children belonging to another discipline', async () => {
    await withTechniqueWorld(async () => {
        const known = addDefinition('technique-group-known', mechanics({ effects: [{ id: 'guard', kind: 'buff', status: { name: 'Guard', description: 'A ward.', duration: 2, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] }), { disciplineId: 'discipline-integration' });
        assert.throws(() => parseGroup('<discipline><disciplineId>missing-discipline</disciplineId><techniques><technique><candidate/></technique></techniques></discipline>'), /Unknown discipline missing-discipline.*Available discipline IDs/s);
        assert.throws(() => parseGroup(`<discipline><disciplineId>${known.disciplineId}</disciplineId><name>Conflict</name><techniques><technique><techniqueId>${known.id}</techniqueId></technique></techniques></discipline>`), /existing disciplineId cannot accompany new/);
        assert.throws(() => parseGroup('<discipline><name>New Practice</name><description>A practice.</description><accessRequirements/><techniques><technique><techniqueId>unknown-technique</techniqueId></technique></techniques></discipline>'), /unknown technique unknown-technique.*Available technique IDs/s);
        TechniqueService.addDiscipline({ id: 'discipline-other', name: 'Other Practice', description: 'A distinct practice.', accessRequirements: [], publicAccess: true });
        const other = addDefinition('technique-group-other', mechanics({ effects: [{ id: 'guard', kind: 'buff', status: { name: 'Guard', description: 'A ward.', duration: 2, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] }), { disciplineId: 'discipline-other' });
        assert.throws(() => parseGroup(`<discipline><disciplineId>${known.disciplineId}</disciplineId><techniques><technique><techniqueId>${other.id}</techniqueId></technique></techniques></discipline>`), /belongs to discipline discipline-other, not discipline-integration/);
        assert.throws(() => parseGroup('<discipline><name>New Practice</name><description>A practice.</description><techniques><technique><techniqueId>x</techniqueId><candidate/></technique></techniques></discipline>'), /exactly one techniqueId or candidate/);
    });
});

test('repeated new parent titles coalesce to the first canonical discipline metadata in encounter order', async () => {
    await withTechniqueWorld(async () => {
        const stagedDisciplines = TechniqueService.getDisciplines();
        const groups = [
            { name: 'Wayfinding Arts', description: 'The first canonical description.', accessRequirements: [], publicAccess: false, techniques: [{ candidate: childCandidate('Find the Path') }] },
            { name: 'Wayfinding--Arts', description: 'Conflicting repeated metadata is ignored.', accessRequirements: [], publicAccess: true, techniques: [{ candidate: childCandidate('Mark a Route') }] },
            { disciplineId: 'discipline_wayfinding_arts', techniques: [{ candidate: childCandidate('Read the Trail') }] }
        ];
        const flattened = flattenTechniqueDisciplineGroups(groups, { disciplines: stagedDisciplines });
        assert.deepEqual(flattened.map(entry => entry.candidate.name), ['Find the Path', 'Mark a Route', 'Read the Trail']);
        assert.deepEqual(flattened.map(entry => entry.candidateDiscipline?.id ?? entry.candidate.disciplineId), Array(3).fill('discipline_wayfinding_arts'));
        assert.equal(stagedDisciplines.find(entry => entry.id === 'discipline_wayfinding_arts').description, 'The first canonical description.');
        assert.equal(stagedDisciplines.find(entry => entry.id === 'discipline_wayfinding_arts').publicAccess, false);
    });
});

test('discipline group XML remains strict about attributes, duplicate fields, nested JSON, and extra candidate discipline fields', async () => {
    await withTechniqueWorld(async () => {
        const group = '<discipline><name>Field Practice</name><description>Practice.</description><accessRequirements/><techniques><technique><candidate><name>Practice A</name><description>Action.</description><semanticKey>practice-a</semanticKey><revisions><revision><target><kind>self</kind></target><check><kind>automatic</kind></check></revision></revisions></candidate></technique></techniques></discipline>';
        for (const invalid of [
            group.replace('<discipline>', '<discipline unexpected="x">'),
            group.replace('<name>Field Practice</name>', '<name>Field Practice</name><name>Duplicate</name>'),
            group.replace('<accessRequirements/>', '<accessRequirements>{}</accessRequirements>'),
            group.replace('<semanticKey>practice-a</semanticKey>', '<semanticKey>practice-a</semanticKey><disciplineId>wrong-parent</disciplineId>'),
            group.replace('<techniques>', '<extra/><techniques>')
        ]) assert.throws(() => parseGroup(invalid), undefined, invalid);
    });
});

test('discipline header empty text is omitted only on existing or repeated canonical parents', async () => {
    await withTechniqueWorld(async () => {
        const existing = TechniqueService.getDisciplines()[0];
        const baseline = parseGroup(`<discipline><disciplineId>${existing.id}</disciplineId><techniques><technique><candidate><name>Existing parent action</name><description>A new action.</description><semanticKey>existing-parent-action</semanticKey></candidate></technique></techniques></discipline>`);
        for (const fields of [
            '',
            '<name/>',
            '<name></name>',
            '<name> \n\t </name>',
            '<description/>',
            '<description></description>',
            '<description> \n\t </description>',
            '<name/><description/>',
            '<name> \n </name><description> \t </description>'
        ]) {
            const parsed = parseGroup(`<discipline><disciplineId>${existing.id}</disciplineId>${fields}<techniques><technique><candidate><name>Existing parent action</name><description>A new action.</description><semanticKey>existing-parent-action</semanticKey></candidate></technique></techniques></discipline>`);
            assert.deepEqual(parsed, baseline, `existing ID header fields: ${fields || '(omitted)'}`);
        }

        const canonical = parseGroup(`<discipline><name>${existing.name}</name><description>${existing.description}</description><accessRequirements/><publicAccess>${existing.publicAccess}</publicAccess><techniques><technique><candidate><name>Repeated parent action</name><description>A new action.</description><semanticKey>repeated-parent-action</semanticKey></candidate></technique></techniques></discipline>`);
        for (const emptyDescription of ['<description/>', '<description></description>', '<description> \n\t </description>']) {
            const repeated = parseGroup(`<discipline><name>${existing.name}</name>${emptyDescription}<techniques><technique><candidate><name>Repeated parent action</name><description>A new action.</description><semanticKey>repeated-parent-action</semanticKey></candidate></technique></techniques></discipline>`);
            assert.equal(repeated.disciplineId, canonical.disciplineId);
            assert.deepEqual(repeated.candidateDiscipline, canonical.candidateDiscipline, 'empty repeated metadata reuses the first canonical parent record');
        }

        for (const invalid of [
            '<discipline><name/><description>A genuinely new parent.</description><techniques><technique><candidate/></technique></techniques></discipline>',
            '<discipline><name>A genuinely new parent</name><description/><techniques><technique><candidate/></technique></techniques></discipline>',
            `<discipline><disciplineId>${existing.id}</disciplineId><name>Conflicting nonempty title</name><techniques><technique><candidate/></technique></techniques></discipline>`,
            `<discipline><disciplineId>${existing.id}</disciplineId><name>${existing.name}</name><name>${existing.name}</name><techniques><technique><candidate/></technique></techniques></discipline>`,
            `<discipline><disciplineId>${existing.id}</disciplineId><description>${existing.description}</description><description>${existing.description}</description><techniques><technique><candidate/></technique></techniques></discipline>`,
            `<discipline><disciplineId>${existing.id}</disciplineId><name unit="x"/><techniques><technique><candidate/></technique></techniques></discipline>`,
            `<discipline><disciplineId>${existing.id}</disciplineId><name><nested/></name><techniques><technique><candidate/></technique></techniques></discipline>`
        ]) assert.throws(() => parseGroup(invalid), undefined, invalid);
    });
});

test('group optional leaves preserve zero, false, and formula values while empty leaves mean omission', async () => {
    await withTechniqueWorld(async () => {
        const parsed = parseGroup('<discipline><name>Skirmishing</name><description>A mobile combat tradition.</description><accessRequirements><requirement><kind>skill</kind><name>Athletics</name><minimum>0</minimum><present>false</present></requirement></accessRequirements><publicAccess>false</publicAccess><techniques><technique><candidate><name>Measured Step</name><description>Move with care.</description><semanticKey>measured-step</semanticKey><revisions><revision><target><kind>self</kind><allowDead/></target><check><kind>automatic</kind></check><effects><effect><id>step</id><kind>buff</kind><status><name>Poise</name><description>Controlled balance.</description><duration>2</duration><attributes><attribute><attribute>Strength</attribute><modifier><formula>max(1, level)</formula></modifier></attribute></attributes></status></effect></effects></revision></revisions></candidate></technique></techniques></discipline>');
        assert.equal(parsed.candidateDiscipline.publicAccess, false);
        assert.deepEqual(parsed.candidateDiscipline.accessRequirements, [{ kind: 'skill', name: 'Athletics', minimum: 0, present: false }]);
        assert.equal(Object.hasOwn(parsed.techniques[0].candidate.revisions[0].target, 'allowDead'), false);
        assert.deepEqual(parsed.techniques[0].candidate.revisions[0].effects[0].status.attributes[0].modifier, { formula: 'max(1, level)' });
        assert.equal(TechniqueService.getDisciplines().some(discipline => discipline.id === parsed.disciplineId), false, 'parsing a new group does not commit its parent');
    });
});

test('authored event XML reparses to the same reserved identity and receipt, including after parent rename', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const xml = eventXml({
            kind: 'learn', actorId: player.id,
            provenance: { kind: 'discovery', reason: 'Repeated observation of one technique.' },
            discipline: {
                name: 'Stonecraft', description: 'Disciplined shaping and warding in stone.',
                accessRequirements: [], publicAccess: true,
                techniques: [{ candidate: {
                    ...childCandidate('Granite Guard'),
                    revisions: [mechanics({ effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Granite Guard', description: 'A practiced stone ward.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 1 }], skills: [], needBars: [] } }] })]
                } }]
            }
        });
        const parse = () => TechniqueEvents.parseChangeXml(Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement);
        const first = parse();
        const pendingReparse = parse();
        assert.equal(pendingReparse.techniqueId, first.techniqueId, 'an accepted XML retry reuses the engine-reserved candidate ID before apply');
        assert.equal(first.candidate.id, first.techniqueId);
        assert.equal(first.provenance.operationId.startsWith('event-technique-authored:'), true);
        const firstReceipt = TechniqueEvents.applyChange(first, {});
        const savedDefinitions = TechniqueService.getDefinitions().length;
        const savedDisciplines = TechniqueService.getDisciplines().length;
        const committedState = TechniqueService.toJSON();
        TechniqueService.hydrate(committedState);

        const expected = TechniqueService.getDisciplineEditContext(player);
        const canonical = expected.disciplines.find(value => value.id === first.candidate.disciplineId);
        TechniqueService.editDisciplines({
            actor: player,
            edits: [{ id: canonical.id, name: 'Stone Warding', description: canonical.description }],
            accessIds: expected.disciplineAccess.map(value => value.disciplineId),
            expected
        });

        const replayCommand = parse();
        assert.equal(replayCommand.techniqueId, first.techniqueId);
        assert.equal(replayCommand.candidate, undefined);
        assert.equal(replayCommand.provenance.operationId, first.provenance.operationId);
        const replayReceipt = TechniqueEvents.applyChange(replayCommand, {});
        assert.equal(replayReceipt.operationId, firstReceipt.operationId);
        assert.equal(TechniqueService.getDefinitions().length, savedDefinitions);
        assert.equal(TechniqueService.getDisciplines().length, savedDisciplines);
        assert.equal(player.techniques.filter(entry => entry.techniqueId === first.techniqueId).length, 1);
        assert.equal(TechniqueService.toJSON().receipts.filter(receipt => receipt.operationId === firstReceipt.operationId).length, 1);
    });
});

test('standard starting authoring accepts repeated grouped parents, then a staged canonical ID, preserving order', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const makeCandidate = name => ({
            ...childCandidate(name), aliases: [],
            revisions: [mechanics({ effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: `${name} stance`, description: 'A concise defensive stance.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 1 }], skills: [], needBars: [] } }] })]
        });
        const xml = [
            groupXml({ name: 'Wayfinding Arts', description: 'Canonical first description.', accessRequirements: [], publicAccess: true, techniques: [{ candidate: makeCandidate('Find the Path') }] }),
            groupXml({ name: 'Wayfinding--Arts', description: 'Later conflicting metadata.', accessRequirements: [], publicAccess: false, techniques: [{ candidate: makeCandidate('Mark a Route') }] }),
            groupXml({ disciplineId: 'discipline_wayfinding_arts', techniques: [{ candidate: makeCandidate('Read the Trail') }] })
        ].join('');
        const parsed = parseStartingTechniques(`<startingTechniques><actor><actorId>${player.id}</actorId><disciplines>${xml}</disciplines></actor></startingTechniques>`, { actors: [player] });
        const entries = parsed.get(player.id);
        assert.deepEqual(entries.map(entry => entry.candidate.name), ['Find the Path', 'Mark a Route', 'Read the Trail']);
        assert.deepEqual(entries.map(entry => entry.candidate.disciplineId), Array(3).fill('discipline_wayfinding_arts'));
        const firstMetadata = entries.find(entry => entry.candidateDiscipline)?.candidateDiscipline;
        assert.equal(firstMetadata.description, 'Canonical first description.');
        assert.equal(firstMetadata.publicAccess, true);
        assert.equal(TechniqueService.getDisciplines().some(discipline => discipline.id === 'discipline_wayfinding_arts'), false, 'starting parsing leaves catalogue state detached until the batch is accepted');
    });
});

test('an unresolved parent does not produce dependent child catalogue errors', async () => {
    await withTechniqueWorld(async () => {
        const before = TechniqueService.toJSON();
        assert.throws(() => parseGroup('<discipline><disciplineId>missing-parent</disciplineId><techniques><technique><techniqueId>missing-child</techniqueId></technique></techniques></discipline>'), error => {
            assert.match(error.message, /missing-parent/);
            assert.doesNotMatch(error.message, /unknown technique missing-child/i);
            return true;
        });
        assert.deepEqual(TechniqueService.toJSON(), before);
    });
});

test('group entry errors identify their exact containing paths', async () => {
    await withTechniqueWorld(async () => {
        assert.throws(() => flattenTechniqueDisciplineGroups([
            { disciplineId: 'discipline-integration', techniques: [{ techniqueId: 'missing-one' }, { techniqueId: 'missing-two' }] }
        ], { path: 'statusEffects[2].disciplines' }), error => {
            assert.match(error.message, /statusEffects\[2\]\.disciplines\[0\]\.techniques\[0\]\.techniqueId/);
            assert.match(error.message, /statusEffects\[2\]\.disciplines\[0\]\.techniques\[1\]\.techniqueId/);
            return true;
        });
    });
});
