'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTechniqueSelections, resolveTechniqueSelection, renderSelectedTechniqueDetails } = require('../TechniqueSelectionContext.js');
const TechniqueService = require('../TechniqueService.js');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');
const effect = () => mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A protective ward.', duration: 5, maxHealthPercent: 10 } }] });

test('selection resolves only explicit known use or discover, rejects ambiguous/unknown choices, and renders selected facts', async () => {
    await withTechniqueWorld(async ({ player, npc }) => {
        const selected = addDefinition('technique-selection-a', effect(), { name: 'Quiet Ward', shortDescription: 'Shields a friend against hostile magic.', aliases: ['Still Ward'], description: 'SELECTED_DETAIL_SENTINEL' });
        const other = addDefinition('technique-selection-b', effect(), { name: 'Loud Ward', description: 'UNSELECTED_DETAIL_SENTINEL' });
        const catalog = addDefinition('technique-selection-c', effect(), { name: 'Known Unlearned', description: 'CATALOGUE_DETAIL_SENTINEL' });
        learn(player, selected.id); learn(player, other.id);
        const actors = [player, npc];
        const result = parseTechniqueSelections(`<techniqueSelections><selection><actor>${player.name}</actor><technique>Still Ward</technique></selection></techniqueSelections>`, { actors });
        assert.equal(result.value[0].techniqueId, selected.id);
        const details = renderSelectedTechniqueDetails(result.value, { actors });
        assert.match(details, /SELECTED_DETAIL_SENTINEL/);
        assert.doesNotMatch(details, /UNSELECTED_DETAIL_SENTINEL|CATALOGUE_DETAIL_SENTINEL/);
        assert.match(details, /<sources>/);
        assert.match(details, /<formulaVariables>/);
        assert.deepEqual(parseTechniqueSelections('<techniqueSelections/>', { actors }).value, []);
        assert.throws(() => parseTechniqueSelections(`<techniqueSelections><selection><actor>${player.id}</actor><technique>Unknown Art</technique></selection></techniqueSelections>`, { actors }), /not a known technique/i);
        assert.equal(resolveTechniqueSelection({ actor: 'the player', technique: selected.id, kind: '  ' }, { actors }).techniqueId, selected.id);
        assert.throws(() => resolveTechniqueSelection({ actor: player.id, technique: 'technique_999999', kind: 'discover' }, { actors }), /unknown or inaccessible canonical ID/i);
        const discover = resolveTechniqueSelection({ actor: player.id, technique: catalog.name, kind: 'discover' }, { actors });
        assert.equal(discover.techniqueId, catalog.id);
        assert.match(renderSelectedTechniqueDetails([discover], { actors }), /CATALOGUE_DETAIL_SENTINEL/);
        const novel = resolveTechniqueSelection({ actor: player.id, technique: 'New Fire Art', kind: 'discover' }, { actors });
        assert.equal(novel.techniqueId, null);
        assert.match(renderSelectedTechniqueDetails([novel], { actors }), /New Fire Art/);
        assert.throws(() => parseTechniqueSelections(`<techniqueSelections><selection><actor>${player.id}</actor><technique>${selected.id}</technique></selection><selection><actor>${player.id}</actor><technique>${selected.id}</technique></selection></techniqueSelections>`, { actors }), /duplicate/i);
        assert.throws(() => parseTechniqueSelections('<techniqueSelections><selection><actor>Unknown</actor><technique>Quiet Ward</technique></selection></techniqueSelections>', { actors }), /not in the supplied scene/i);
        const duplicate = { id: 'same-name', name: player.name, getAliases: () => [] };
        assert.throws(() => resolveTechniqueSelection({ actor: player.name, technique: selected.id }, { actors: [player, duplicate] }), /ambiguous/i);
        assert.throws(() => parseTechniqueSelections('<techniqueSelections><selection><actor><nested/></actor><technique>x</technique></selection></techniqueSelections>', { actors }), /actor/i);
    });
});

test('ambiguous aliases and stale actor selections fail with correction guidance', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const first = addDefinition('technique-ambiguous-a', effect(), { name: 'Ward One', aliases: ['shared ward'] });
        const second = addDefinition('technique-ambiguous-b', effect(), { name: 'Ward Two', aliases: ['shared ward'] });
        learn(player, first.id); learn(player, second.id);
        assert.throws(() => resolveTechniqueSelection({ actor: player.id, technique: 'shared ward' }, { actors: [player] }), /ambiguous.*canonical ID/i);
        const selection = resolveTechniqueSelection({ actor: player.id, technique: first.id }, { actors: [player] });
        assert.throws(() => renderSelectedTechniqueDetails([selection], { actors: [] }), /left the supplied scene/i);
        TechniqueService.reset();
        assert.throws(() => renderSelectedTechniqueDetails([selection], { actors: [player] }), /unknown|not a known|does not exist/i);
    });
});

test('lightweight summaries respect learned, equipped and status sources without calculating mechanics', async () => {
    await withTechniqueWorld(async ({ player, npc }) => {
        const learned = addDefinition('technique-summary-learned', effect(), { name: 'Learned Ward', shortDescription: 'Protects an ally with a ward.' });
        const equipped = addDefinition('technique-summary-equipped', effect(), { name: 'Equipment Ward', shortDescription: 'Projects a protective field from gear.' });
        const granted = addDefinition('technique-summary-status', effect(), { name: 'Status Ward', shortDescription: '' });
        learn(player, learned.id);
        player.getGear = () => ({ hand: { item: { techniqueGrants: [{ techniqueId: equipped.id, teaches: false }] } } });
        player.getStatusEffects = () => [{ duration: 5, techniqueGrants: [{ techniqueId: granted.id }] }];
        const original = TechniqueService.getPromptContext;
        TechniqueService.getPromptContext = () => { throw new Error('must not calculate full mechanics'); };
        try {
            const summaries = TechniqueService.getTechniqueSummaries([player, npc]);
            assert.deepEqual(new Set(summaries[player.id].map(value => value.name)), new Set(['Learned Ward', 'Equipment Ward', 'Status Ward']));
            assert.deepEqual(summaries[npc.id], []);
            assert.deepEqual(summaries[player.id].find(value => value.name === 'Status Ward'), { name: 'Status Ward', shortDescription: '' });
            assert.ok(summaries[player.id].every(value => Object.keys(value).sort().join(',') === 'name,shortDescription'));
        } finally { TechniqueService.getPromptContext = original; }
    });
});

test('standard event authoring selection uses the supplied origin roster, retries invalid selection and does not replay mechanics', async () => {
    const { actorsFromTechniqueContext, requestTechniqueAuthoringDetails } = require('../TechniqueSelectionContext.js');
    await withTechniqueWorld(async ({ player, npc, target }) => {
        const selected = addDefinition('technique-event-selected', effect(), { name: 'Event Ward', description: 'EVENT_SELECTED_DETAIL' });
        const other = addDefinition('technique-event-other', effect(), { name: 'event ward', description: 'EVENT_UNSELECTED_DETAIL' });
        learn(npc, selected.id); learn(npc, other.id);
        const baseContext = { currentPlayer: { id: player.id }, party: [], npcs: [{ id: npc.id }], techniqueSummaries: { [player.id]: [], [npc.id]: [] } };
        assert.deepEqual(actorsFromTechniqueContext(baseContext).map(value => value.id), [player.id, npc.id]);
        let calls = 0; const observed = [];
        const client = { chatCompletion: async options => { observed.push(options.messages); return ++calls === 1 ? `<techniqueSelections><selection><actor>${target.id}</actor><technique>${selected.id}</technique></selection></techniqueSelections>` : `<techniqueSelections><selection><actor>${npc.id}</actor><technique>${selected.id}</technique></selection></techniqueSelections>`; }, logPrompt() {} };
        const before = TechniqueService.toJSON({ includePresentation: false });
        const details = await requestTechniqueAuthoringDetails({ baseContext, textToCheck: 'Training at origin.', LLMClient: client, maxAttempts: 2 });
        assert.equal(calls, 2);
        assert.match(observed[0].map(message => message.content || '').join('\n'), /Event Ward \[technique-event-selected\]/);
        assert.match(observed[0].map(message => message.content || '').join('\n'), /event ward \[technique-event-other\]/);
        assert.match(observed[1].map(message => message.content || '').join('\n'), /not in the supplied scene/i);
        assert.match(details, /EVENT_SELECTED_DETAIL/);
        assert.doesNotMatch(details, /EVENT_UNSELECTED_DETAIL/);
        assert.deepEqual(TechniqueService.toJSON({ includePresentation: false }), before);
        const none = await requestTechniqueAuthoringDetails({ baseContext, textToCheck: 'Ordinary conversation.', LLMClient: { chatCompletion: async () => '<techniqueSelections/>', logPrompt() {} }, maxAttempts: 1 });
        assert.equal(none, '');
    });
});

test('multi-actor selected details share schema and policy while retaining per-source pins and blockers', async () => {
    await withTechniqueWorld(async ({ player, npc }) => {
        const selected = addDefinition('technique-shared-details', effect(), { name: 'Shared Ward' });
        learn(player, selected.id); learn(npc, selected.id);
        const actors = [player, npc];
        const selections = actors.map(actor => resolveTechniqueSelection({ actor: actor.id, technique: selected.id }, { actors }));
        const xml = renderSelectedTechniqueDetails(selections, { actors, purpose: 'authoring' });
        assert.equal((xml.match(/<formulaVariableSchema>/g) || []).length, 1);
        assert.equal((xml.match(/<balancePolicies>/g) || []).length, 1);
        assert.equal((xml.match(/<character>/g) || []).length, 2);
        assert.equal((xml.match(/<sourceId>learned:/g) || []).length, 2);
        assert.equal((xml.match(/<definitionRevision>1<\/definitionRevision>/g) || []).length, 2);
        assert.ok((xml.match(/<blockers>/g) || []).length >= 2);
        assert.ok((xml.match(/<costs>/g) || []).length >= 2);
    });
});

test('reserved player aliases reject when the player is absent even if an NPC shares the alias', async () => {
    await withTechniqueWorld(async ({ npc }) => {
        const definition = addDefinition('technique-alias-guard', effect(), { name: 'Alias Ward' });
        learn(npc, definition.id);
        npc.getAliases = () => ['player', 'the player', 'you'];
        for (const alias of ['player', 'the player', 'you']) {
            assert.throws(() => resolveTechniqueSelection({ actor: alias, technique: definition.id }, { actors: [npc] }), /not in the supplied scene/i, alias);
        }
    });
});

test('ambiguous actor repertoire displays canonical IDs and selection requires them for use', async () => {
    await withTechniqueWorld(async ({ player, npc }) => {
        const first = addDefinition('technique-dupe-a', effect(), { name: 'ICEBreaker Overload', shortDescription: 'First effect.' });
        const second = addDefinition('technique-dupe-b', effect(), { name: 'icebreaker overload', shortDescription: '' });
        const aliasTarget = addDefinition('technique-alias-target', effect(), { name: 'Grounding Pulse', aliases: ['  WARD ARC  '], shortDescription: 'Grounds current.' });
        const aliasName = addDefinition('technique-alias-name', effect(), { name: 'Ward Arc', shortDescription: 'Raises a ward.' });
        const shared = addDefinition('technique-unique', effect(), { name: 'Other Ward', shortDescription: 'Protects.' });
        for (const definition of [first, second, aliasTarget, aliasName, shared]) learn(player, definition.id);
        learn(npc, shared.id);
        // Repeat one identity across learned, gear and status; the union is still one row per ID.
        player.getGear = () => ({ hand: { item: { techniqueGrants: [{ techniqueId: first.id, teaches: false }] } } });
        player.getStatusEffects = () => [{ duration: 5, techniqueGrants: [{ techniqueId: first.id }] }];
        const original = TechniqueService.getPromptContext;
        TechniqueService.getPromptContext = () => { throw new Error('summary must not compute mechanics'); };
        try {
            const summaries = TechniqueService.getTechniqueSummaries([player, npc]);
            assert.equal(summaries[player.id].length, 5);
            const byName = Object.fromEntries(summaries[player.id].map(row => [row.name, row]));
            assert.equal(byName[first.name].techniqueId, first.id);
            assert.equal(byName[second.name].techniqueId, second.id);
            assert.equal(byName[aliasName.name].techniqueId, aliasName.id);
            assert.deepEqual(byName[aliasTarget.name], { name: aliasTarget.name, shortDescription: aliasTarget.shortDescription });
            assert.deepEqual(byName[shared.name], { name: shared.name, shortDescription: shared.shortDescription });
            assert.deepEqual(summaries[npc.id], [{ name: shared.name, shortDescription: shared.shortDescription }]);
        } finally { TechniqueService.getPromptContext = original; }
        for (const definition of [first, second]) {
            assert.equal(resolveTechniqueSelection({ actor: player.id, technique: definition.id, kind: 'use' }, { actors: [player, npc] }).techniqueId, definition.id);
        }
        assert.throws(() => resolveTechniqueSelection({ actor: player.id, technique: '  iceBREAKER overload  ', kind: 'use' }, { actors: [player, npc] }), /ambiguous.*canonical ID/i);
        assert.throws(() => resolveTechniqueSelection({ actor: player.id, technique: 'ward arc', kind: 'use' }, { actors: [player, npc] }), /ambiguous.*canonical ID/i);
        player.getAbilities = () => [{ name: 'Hydraulic Vent Burst' }];
        assert.throws(() => resolveTechniqueSelection({ actor: player.id, technique: 'Hydraulic Vent Burst', kind: 'use' }, { actors: [player, npc] }), /not a known technique/i);
        assert.equal(resolveTechniqueSelection({ actor: player.id, technique: 'New Field Art', kind: 'discover' }, { actors: [player, npc] }).techniqueId, null);
    });
});
