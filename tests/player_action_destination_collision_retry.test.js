const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');
const { TinyBrainPromptRunner, TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { parsePlayerActionDestinationDecision } = require('../TinyBrainPromptParsers.js');

class MemoryLoader extends nunjucks.Loader {
    constructor(program = null) { super(); this.program = program; }
    getSource(name) {
        const templates = {
            'wrapper.xml.njk': '<template><systemPrompt><![CDATA[Test]]></systemPrompt><generationPrompt><![CDATA[{{ __tinyBrainState.programStartMarker }}{% include "program.njk" %}]]></generationPrompt></template>',
            'program.njk': this.program || "Resolve action. {% llm_dummy_action as action %}Choose destination. {% llmparse('collision_decision') as decision %}Finish {{ decision.decision }}."
        };
        return templates[name] ? { src: templates[name], path: name, noCache: true } : null;
    }
}

function parseTemplate(rendered) {
    const system = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generation = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    return { systemPrompt: system[1], generationPrompt: generation[1] };
}

for (const [label, corrected, expected] of [
    ['region entry', '<playerDestination><decision>travel</decision><region>Old Harbor</region></playerDestination>', 'travel'],
    ['distinct location', '<playerDestination><decision>travel</decision><location>Harbor Gate</location><region>Old Harbor</region></playerDestination>', 'travel'],
    ['stay', '<playerDestination><decision>stay</decision></playerDestination>', 'stay']
]) {
    test(`destination collision retries locally and accepts ${label} without repeating prior work`, async () => {
        const environment = new nunjucks.Environment(new MemoryLoader(), { autoescape: false });
        environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const calls = [];
        const regions = [{ id: 'region_1', name: 'Old Harbor', locationIds: [] }];
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 1,
            parsers: { collision_decision: response => parsePlayerActionDestinationDecision(response, { locations: [], regions, pendingRegionStubs: [] }) },
            logPrompt: options => options.filePath || '/test/logs/destination-retry.log',
            async complete({ messages, attempt }) {
                calls.push({ messages, attempt });
                if (calls.length === 1) {
                    const aiResponse = 'Action resolved once.';
                    return { aiResponse, conversationMessages: [...messages,
                        { role: 'assistant', content: '', tool_calls: [{ id: 'roll_1', type: 'function', function: { name: 'roll', arguments: '{}' } }] },
                        { role: 'tool', tool_call_id: 'roll_1', name: 'roll', content: 'Roll result: 17' },
                        { role: 'assistant', content: aiResponse }], toolInvocations: [{ id: 'roll_1', name: 'roll', metadata: {} }] };
                }
                if (calls.length === 3) {
                    assert.equal(attempt, 1);
                    assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Roll result: 17'));
                    assert.match(messages.at(-1).content, /region/i);
                    assert.match(messages.at(-1).content, /different location/i);
                    assert.match(messages.at(-1).content, /stay/i);
                }
                const aiResponse = calls.length === 2
                    ? '<playerDestination><decision>travel</decision><location> old harbor </location><region>Other Region</region></playerDestination>'
                    : calls.length === 3 ? corrected : 'Done.';
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        const result = await runner.run({ initialRenderedTemplate: environment.render('wrapper.xml.njk', templateContext), templateContext, renderState, programTemplateName: 'program.njk' });
        assert.equal(calls.length, 4);
        assert.match(calls[3].messages.at(-1).content, new RegExp(`Finish ${expected}`));
        assert.equal(result.toolInvocations.length, 1);
    });
}

test('same-name location and region decision keeps the region-entry interpretation', () => {
    const result = parsePlayerActionDestinationDecision(
        '<playerDestination><decision>travel</decision><location>Old Harbor</location><region>old harbor</region></playerDestination>',
        { locations: [], regions: [{ id: 'r1', name: 'Old Harbor', locationIds: [] }], pendingRegionStubs: [] }
    );
    assert.equal(result.value.decision, 'travel');
});

test('vehicle destination collision is rejected before anchoring its fixed route', () => {
    const Region = require('../Region.js');
    const { parsePlayerActionVehicleDestination } = require('../TinyBrainPromptParsers.js');
    Region.clear();
    try {
        new Region({ id: 'r_vehicle_collision', name: 'Old Harbor', description: 'A harbor.' });
        const retryState = {};
        const vehicle = { vehicleInfo: { destinations: ['stop'] }, allowedDestinations: [] };
        assert.throws(() => parsePlayerActionVehicleDestination('Location: old harbor\nRegion: Elsewhere', vehicle, { retryState }), error => {
            assert.equal(error.code, 'location_region_name_conflict');
            assert.match(error.message, /choose that region or a different destination/i);
            assert.ok(error.cause);
            return true;
        });
        assert.deepEqual(retryState, {});
    } finally {
        Region.clear();
    }
});


for (const [label, corrected, expected] of [
    ['different location', '<playerDestination><decision>travel</decision><location>Upper Gallery</location><region>Gear Bazaar Interior</region></playerDestination>', 'travel'],
    ['stay', '<playerDestination><decision>stay</decision></playerDestination>', 'stay']
]) {
    test(`same-location decision retries to ${label} without rerunning draft or resolved action`, async () => {
        const Region = require('../Region.js');
        const Location = require('../Location.js');
        Region.clear(); Location.clear();
        try {
            new Region({ id: 'region_gear_bazaar', name: 'Gear Bazaar Interior', description: 'Interior.' });
            new Location({ id: 'loc_service_elevator_bay', name: 'Service Elevator Bay', description: 'An elevator bay.', regionId: 'region_gear_bazaar' });
            new Location({ id: 'loc_upper_gallery', name: 'Upper Gallery', description: 'A gallery.', regionId: 'region_gear_bazaar' });
            const program = "Draft. {% llmparse('draft') as draft %}Resolve action. {% llm_dummy_action as action %}Choose destination. {% llmparse('player_action_destination_decision', destinationOptions) as decision %}Finish {{ decision.decision }}.";
            const environment = new nunjucks.Environment(new MemoryLoader(program), { autoescape: false });
            environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
            const renderState = TinyBrainPromptRunner.createRenderState();
            const templateContext = { __tinyBrainState: renderState, destinationOptions: { originLocationId: 'loc_service_elevator_bay' } };
            const calls = [];
            const runner = new TinyBrainPromptRunner({
                promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 1,
                parsers: { draft: response => ({ value: response }) },
                logPrompt: options => options.filePath || '/test/logs/destination-same-origin-retry.log',
                async complete({ messages, checkpoint, attempt }) {
                    calls.push({ messages, checkpoint, attempt });
                    let aiResponse;
                    if (checkpoint.parserName === 'draft') aiResponse = 'Prior draft, kept once.';
                    else if (checkpoint.parserName === 'player_action_destination_decision') {
                        aiResponse = attempt === 0
                            ? '<playerDestination><decision>travel</decision><location>service elevator bay</location><region>GEAR BAZAAR INTERIOR</region></playerDestination>'
                            : corrected;
                        if (attempt === 1) {
                            assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Roll result: 17'));
                            assert.match(messages.at(-1).content, /current|already|same/i);
                            assert.match(messages.at(-1).content, /stay|different/i);
                        }
                    } else if (checkpoint.kind === 'dummy') {
                        aiResponse = 'Action resolved once.';
                        return { aiResponse, conversationMessages: [...messages,
                            { role: 'assistant', content: '', tool_calls: [{ id: 'roll_1', type: 'function', function: { name: 'roll', arguments: '{}' } }] },
                            { role: 'tool', tool_call_id: 'roll_1', name: 'roll', content: 'Roll result: 17' },
                            { role: 'assistant', content: aiResponse }], toolInvocations: [{ id: 'roll_1', name: 'roll', metadata: {} }] };
                    } else aiResponse = 'Done.';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }
            });
            const result = await runner.run({ initialRenderedTemplate: environment.render('wrapper.xml.njk', templateContext), templateContext, renderState, programTemplateName: 'program.njk' });
            assert.equal(calls.filter(call => call.checkpoint.parserName === 'draft').length, 1);
            assert.equal(calls.filter(call => call.checkpoint.kind === 'dummy').length, 1);
            assert.equal(calls.filter(call => call.checkpoint.parserName === 'player_action_destination_decision').length, 2);
            assert.match(calls.at(-1).messages.at(-1).content, new RegExp(`Finish ${expected}`));
            assert.equal(result.toolInvocations.length, 1);
            assert.equal(result.toolInvocations[0].id, 'roll_1');
        } finally { Location.clear(); Region.clear(); }
    });
}
