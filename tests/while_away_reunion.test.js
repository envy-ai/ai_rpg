const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { TinyBrainPromptRunner, TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { parseAllowedCharacterSelection, parseWhileAwayArrivalUpdate } = require('../TinyBrainPromptParsers.js');
const { buildWhileYouWereAwayResult } = require('../TinyBrainResultBuilders.js');

const arrival = '<characterUpdate><name>Tangle_Fang</name><needBarChanges/><travelDestination>HERE</travelDestination><update>Tangle_Fang arrived.</update></characterUpdate>';

test('arrival selection and per-character parser reject invalid names, duplicates and missing fields', () => {
    assert.deepEqual(parseAllowedCharacterSelection('<selectedCharacters/>', ['Tangle_Fang'], 0, 1).value, []);
    assert.deepEqual(parseAllowedCharacterSelection('<selectedCharacters><name>Tangle_Fang</name></selectedCharacters>', ['Tangle_Fang'], 0, 1).value, ['Tangle_Fang']);
    for (const response of ['<selectedCharacters><name>Unknown</name></selectedCharacters>', '<selectedCharacters><name>Party</name></selectedCharacters>', '<selectedCharacters><name>Listed</name></selectedCharacters>', '<selectedCharacters><name>Tangle_Fang</name><name>Tangle_Fang</name></selectedCharacters>']) {
        assert.throws(() => parseAllowedCharacterSelection(response, ['Tangle_Fang'], 0, 2));
    }
    assert.equal(parseWhileAwayArrivalUpdate(arrival, 'Tangle_Fang').value.name, 'Tangle_Fang');
    for (const invalid of [arrival.replace('Tangle_Fang</name>', 'Other</name>'), arrival.replace('HERE', 'elsewhere'), arrival.replace('<update>Tangle_Fang arrived.</update>', ''), arrival.replace('<needBarChanges/>', '')]) {
        assert.throws(() => parseWhileAwayArrivalUpdate(invalid, 'Tangle_Fang'));
    }
});

async function runSelected(selection) {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false, throwOnUndefined: false });
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const state = TinyBrainPromptRunner.createRenderState();
    const context = { whileYouWereAwayNpcs: [], whileAwayArrivalCandidateNames: ['Tangle_Fang'], whileAwayArrivalCandidates: [{ id: 'npc_1', name: 'Tangle_Fang' }], whileAwayVisibleProseRequired: false, __tinyBrainState: state };
    const template = '_includes/while-you-were-away.tinybrain.njk';
    const initial = state.programStartMarker + env.render(template, context);
    const calls = [];
    const runner = new TinyBrainPromptRunner({ promptEnv: env, parseXMLTemplate: generationPrompt => ({ systemPrompt: 'system', generationPrompt }), retryAttempts: 0, toolDefinitions: [], metadataLabel: 'while_you_were_away', resultBuilders: { while_away_result: buildWhileYouWereAwayResult }, logPrompt: () => path.join(__dirname, '..', 'tmp', 'wywa-reunion-mocked.log'), complete: async ({ messages, checkpoint }) => {
        calls.push(checkpoint.parserName || checkpoint.kind);
        let response;
        switch (checkpoint.parserName) {
            case 'allowed_character_selection': response = selection ? '<selectedCharacters><name>Tangle_Fang</name></selectedCharacters>' : '<selectedCharacters/>'; break;
            case 'while_away_arrival_update':
                assert.match(messages.at(-1).content, /<name>Tangle_Fang<\/name>/);
                assert.match(messages.at(-1).content, /<travelDestination>HERE<\/travelDestination>/);
                assert.match(messages.at(-1).content, /<needBarChanges>/);
                assert.match(messages.at(-1).content, /<update>/);
                response = arrival; break;
            case 'exact_xml_root': response = '<itemSceneryMoves/>'; break;
            case 'player_action_optional_prose': response = 'N/A'; break;
            default: response = 'Consider the arrival.';
        }
        return { aiResponse: response, conversationMessages: [...messages, { role: 'assistant', content: response }], toolInvocations: [] };
    } });
    const result = await runner.run({ initialRenderedTemplate: initial, templateContext: context, renderState: state, programTemplateName: template });
    return { result, calls };
}

test('staged selection renders a self-contained update and assembles it locally; none skips update', async () => {
    const selected = await runSelected(true);
    assert.equal(selected.calls.filter(name => name === 'while_away_arrival_update').length, 1);
    assert.match(selected.result.aiResponse, /<name>Tangle_Fang<\/name>/);
    assert.match(selected.result.aiResponse, /<travelDestination>HERE<\/travelDestination>/);
    assert.equal(selected.calls.length, 5);
    const none = await runSelected(false);
    assert.equal(none.calls.filter(name => name === 'while_away_arrival_update').length, 0);
    assert.doesNotMatch(none.result.aiResponse, /Tangle_Fang/);
    assert.equal(none.calls.length, 4);
});

test('standard prompt supplies complete HERE arrival schema with no listed NPCs', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false });
    const rendered = env.render('_includes/while-you-were-away.njk', { whileYouWereAwayNpcs: [], whileAwayVisibleProseRequired: false });
    assert.match(rendered, /<name>Exact existing arriving character name<\/name>/);
    assert.match(rendered, /<needBarChanges>/);
    assert.match(rendered, /<travelDestination>HERE<\/travelDestination>/);
    assert.match(rendered, /<update>/);
});

test('builder rejects missing, duplicated, or unselected arrival updates', () => {
    const selection = { checkpoint: { parserName: 'allowed_character_selection', target: 'whileAwayArrivalNames' }, value: ['Tangle_Fang'] };
    const update = { checkpoint: { parserName: 'while_away_arrival_update' }, value: parseWhileAwayArrivalUpdate(arrival, 'Tangle_Fang').value };
    const tail = [{ checkpoint: { parserName: 'exact_xml_root', parserArgs: ['itemSceneryMoves'] }, value: '<itemSceneryMoves/>' }, { checkpoint: { parserName: 'player_action_optional_prose' }, value: null }];
    const templateContext = { whileYouWereAwayNpcs: [], whileAwayArrivalCandidateNames: ['Tangle_Fang'] };
    assert.throws(() => buildWhileYouWereAwayResult({ checkpointValues: [selection, ...tail], templateContext }), /match every selected name/);
    assert.throws(() => buildWhileYouWereAwayResult({ checkpointValues: [selection, update, update, ...tail], templateContext }), /match every selected name/);
    assert.throws(() => buildWhileYouWereAwayResult({ checkpointValues: [{ ...selection, value: [] }, update, ...tail], templateContext }), /match every selected name/);
});
