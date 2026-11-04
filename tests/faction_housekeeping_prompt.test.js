const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');
const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');
const {
    FACTION_HOUSEKEEPING_SECTIONS,
    parseFactionHousekeepingSection,
    parseFactionHousekeepingProposal,
    buildFactionHousekeepingProposal
} = require('../FactionHousekeepingPrompt.js');

function context() {
    return {
        intendedTone: 'Hope amid danger',
        currentSituation: 'A win & a loss <both stand>.',
        objectives: [{ id: 'objective_1', description: 'Open the road.' }],
        threads: [{ id: 'thread_1', description: 'The blocked road.' }],
        factions: [{ id: 'faction_1', description: 'Bridge keepers; tolls fund repairs.' }],
        pendingDevelopments: [{
            reference: 'development_1', threadId: 'thread_1', commitment: 'committed',
            exposure: 'pending', description: 'Repair help is already on its way.'
        }],
        publicPassages: [{ reference: 'passage_1', text: 'The bridge closes at dusk.' }],
        deadlines: [{
            reference: 'deadline_1', threadId: 'thread_1', description: 'Dusk closure.',
            publicPassageReferences: ['passage_1']
        }, {
            reference: 'deadline_2', threadId: 'thread_1', description: 'Private internal clock.',
            publicPassageReferences: []
        }],
        knownFacts: [{ reference: 'fact_1', visibility: 'private', description: 'Help is coming.' }]
    };
}

function render(tinyBrain) {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(
        path.join(__dirname, '..', 'prompts'), { noCache: true }
    ), { autoescape: false, throwOnUndefined: true });
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        factionHousekeeping: context(), factionHousekeepingTinyBrain: tinyBrain,
        __tinyBrainState: renderState
    };
    return {
        rendered: env.render('faction-housekeeping.xml.njk', templateContext),
        renderState,
        templateContext,
        env
    };
}

function section(name, entries = '') {
    return `<${name}><assessment>No additional development is needed.</assessment><entries>${entries}</entries></${name}>`;
}

test('standard and TinyBrain worksheets share nine ordered questions and policy guidance', () => {
    const standard = render(false).rendered;
    const staged = render(true);
    assert.doesNotThrow(() => Utils.parseXmlDocumentStrict(standard, 'text/xml'));
    assert.doesNotThrow(() => Utils.parseXmlDocumentStrict(staged.rendered, 'text/xml'));
    assert.equal(staged.renderState.checkpoints.length, 10);
    assert.deepEqual(staged.renderState.checkpoints.slice(0, 9).map(item => item.parserName),
        Array(9).fill('faction_housekeeping_section'));
    assert.deepEqual(staged.renderState.checkpoints.slice(0, 9).map(item => item.parserArgs[0]),
        FACTION_HOUSEKEEPING_SECTIONS);
    assert.equal(staged.renderState.checkpoints[9].parserName, 'faction_housekeeping_proposal');
    assert.deepEqual(staged.renderState.checkpoints[9].parserArgs[0], context().factions);
    assert.equal(staged.renderState.resultMarkers[0].builderName, 'faction_housekeeping_proposal');
    const steps = [
        'Inspect pending developments FIRST', 'Assess awareness separately',
        'Identify organizations meaningfully', 'Characterize contextual roles',
        'Decide whether future support', 'consider existing factions first',
        'Propose a new faction only', 'Propose only justified future attempts',
        'Review the worksheet for continuity'
    ];
    let standardPosition = -1;
    let stagedPosition = -1;
    for (const step of steps) {
        const nextStandard = standard.indexOf(step);
        const nextStaged = staged.rendered.indexOf(step);
        assert.ok(nextStandard > standardPosition, step);
        assert.ok(nextStaged > stagedPosition, step);
        standardPosition = nextStandard;
        stagedPosition = nextStaged;
    }
    for (const source of [standard, staged.rendered]) {
        assert.match(source, /Only a deadline already communicated to the player/);
        assert.match(source, /hidden internal clock cannot bypass/);
        assert.match(source, /long travel or sleep does not authorize/);
        assert.match(source, /acknowledgment, quest acceptance, or a comprehension score/);
        assert.match(source, /Do not retroactively assign a faction/);
        assert.match(source, /committed unseen help and threats/);
        assert.match(source, /An individual member's personal agenda alone/);
        assert.match(source, /Pure evil is valid/);
        assert.match(source, /Do not make tool calls/);
        assert.match(source, /Final synthesis: consolidate the nine reasoning steps/);
        assert.match(source, /<newFactions>/);
        assert.match(source, /<factionPlans>/);
        assert.doesNotMatch(source, /<maxTokens\b|\{% llm_dummy_action/);
    }
});

test('context escapes XML text and keeps public evidence separate from hidden clocks', () => {
    const source = render(false).rendered;
    assert.match(source, /A win &amp; a loss &lt;both stand&gt;\./);
    assert.match(source, /<commitment>committed<\/commitment><exposure>pending<\/exposure>/);
    assert.match(source, /<publicPassageReferences><reference>passage_1<\/reference><\/publicPassageReferences>/);
    assert.match(source, /Private internal clock\.<\/description><publicPassageReferences><\/publicPassageReferences>/);
    assert.match(source, /<visibility>private<\/visibility>/);
});

function plan(factionRef = 'faction_1') {
    return `<factionPlan><factionRef>${factionRef}</factionRef><role>Gatekeeper and ally.</role>`
        + '<plan>Keep the bridge usable for objective_1; repair help is already committed.</plan>'
        + '<nextSteps><step>Expose the arriving repair crew on thread_1 before adding another discretionary development.</step></nextSteps>'
        + '<awarenessConstraints>Await meaningful public context; passage_1 already communicates dusk closure.</awarenessConstraints></factionPlan>';
}

function proposal(plans = plan(), newFactions = '') {
    return `<factionHousekeepingProposal><newFactions>${newFactions}</newFactions>`
        + `<factionPlans>${plans}</factionPlans></factionHousekeepingProposal>`;
}

test('worksheet rejects independent invalid entries together', () => {
    const invalid = section('awareness', '<entry><finding/><recommendation>Wait</recommendation></entry>'
        + '<entry><finding>Observe</finding><recommendation/></entry>');
    assert.throws(() => parseFactionHousekeepingSection(invalid, 'awareness'), error => {
        assert.match(error.message, /finding/);
        assert.match(error.message, /recommendation/);
        assert.ok(error.issues?.length >= 2, error.message);
        return true;
    });
});

test('final synthesis returns only compact plans, shared by standard parsing and staged completion', () => {
    const checkpointValues = FACTION_HOUSEKEEPING_SECTIONS.map(name => ({
        value: parseFactionHousekeepingSection(section(name), name).value
    }));
    const finalXml = proposal();
    checkpointValues.push({ value: parseFactionHousekeepingProposal(finalXml, context().factions).value });
    const final = buildFactionHousekeepingProposal({
        checkpointValues, templateContext: { factionHousekeeping: context() }
    });
    assert.equal(final, finalXml);
    assert.doesNotMatch(final, /pendingDevelopments|continuityCheck|<assessment>/);
    assert.equal(parseFactionHousekeepingProposal(final, ['faction_1']).proposal.factionPlans[0].factionRef,
        'faction_1');
    assert.throws(() => buildFactionHousekeepingProposal({ checkpointValues: [] }), /final synthesis/);
    assert.throws(() => parseFactionHousekeepingProposal(
        final.replace('<newFactions>', '<newFactions><extra/>'), ['faction_1']
    ), /invalid list content.*Use only <faction>/);
});

test('mocked runner completes ten stages using fixed wrapper context and bare program rerenders', async () => {
    const { rendered, renderState, templateContext, env } = render(true);
    // Parse the outer wrapper once. Rerenders are the bare staged include, not XML wrappers.
    const outer = Utils.parseXmlDocumentStrict(rendered, 'text/xml');
    const systemPrompt = outer.getElementsByTagName('systemPrompt')[0].textContent.trim();
    const generationPrompt = outer.getElementsByTagName('generationPrompt')[0].textContent;
    const finalXml = proposal();
    let completionCount = 0;
    let stageIndex = 0;
    const rejectedXml = '<pendingDevelopments><assessment>One</assessment><assessment>Two</assessment><entries/></pendingDevelopments>';
    const runner = new TinyBrainPromptRunner({
        promptEnv: env,
        parseXMLTemplate: program => ({ systemPrompt, generationPrompt: program }),
        retryAttempts: 1,
        toolDefinitions: [],
        metadataLabel: 'faction_housekeeping',
        logPrefix: 'faction_housekeeping_mocked',
        parsers: {
            faction_housekeeping_section: parseFactionHousekeepingSection,
            faction_housekeeping_proposal: parseFactionHousekeepingProposal
        },
        resultBuilders: { faction_housekeeping_proposal: buildFactionHousekeepingProposal },
        logPrompt: options => options.filePath || path.join(__dirname, '..', 'tmp', 'faction-housekeeping-mocked.log'),
        complete: async ({ messages, checkpoint, attempt }) => {
            assert.ok(completionCount < 11, 'local terminal result must not request an extra completion');
            assert.equal(messages[0].content, systemPrompt);
            assert.doesNotMatch(messages.at(-1).content, /<\/generationPrompt>|<\/template>/);
            assert.equal(checkpoint.parserName, stageIndex < 9
                ? 'faction_housekeeping_section' : 'faction_housekeeping_proposal');
            let aiResponse;
            if (stageIndex === 0 && attempt === 0) {
                aiResponse = rejectedXml;
            } else {
                if (stageIndex === 0 && attempt === 1) {
                    assert.equal(Object.keys(renderState.completedCheckpoints).length, 0,
                        'the rejected worksheet must not be accepted as a checkpoint');
                    assert.ok(messages.some(message => message.role === 'assistant' && message.content === rejectedXml),
                        'the rejected XML is retained in its correction conversation');
                    assert.match(messages.at(-1).content, /pendingDevelopments\/assessment is duplicated\. Keep exactly one <assessment> field\./);
                }
                aiResponse = stageIndex < 9 ? section(FACTION_HOUSEKEEPING_SECTIONS[stageIndex]) : finalXml;
                stageIndex += 1;
            }
            completionCount += 1;
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });
    const result = await runner.run({
        initialRenderedTemplate: generationPrompt,
        templateContext,
        renderState,
        programTemplateName: '_includes/faction-housekeeping.tinybrain.njk'
    });
    assert.equal(completionCount, 11);
    assert.equal(result.aiResponse, finalXml);
    assert.doesNotMatch(result.aiResponse, /<assessment>|<\/template>|pendingDevelopments/);
    assert.equal(Object.keys(renderState.completedCheckpoints).length, 10);
});

test('uniquely named fields and full-proposal sections may arrive in a different order', () => {
    const reordered = '<awareness><entries/><assessment>No additional exposure is needed.</assessment></awareness>';
    assert.equal(parseFactionHousekeepingSection(reordered, 'awareness').value, reordered);
    const full = `<factionHousekeepingProposal><factionPlans>${plan()}</factionPlans><newFactions/></factionHousekeepingProposal>`;
    assert.equal(parseFactionHousekeepingProposal(full, ['faction_1']).value, full);
});

test('compact result accepts matching new faction concepts and empty lists', () => {
    const newFaction = '<faction><localRef>draft:river-patron</localRef><name>River Patrons</name>'
        + '<concept>Local ferrymen fund a crossing to keep trade moving; their barges fill the missing access role.</concept></faction>';
    const result = parseFactionHousekeepingProposal(proposal(plan('draft:river-patron'), newFaction));
    assert.equal(result.proposal.newFactions[0].localRef, 'draft:river-patron');
    assert.equal(result.proposal.factionPlans[0].nextSteps.length, 1);
    assert.deepEqual(parseFactionHousekeepingProposal(proposal('')).proposal,
        { newFactions: [], factionPlans: [] });
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan('faction_unknown'))), /factionRef .*unknown/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan('draft:missing'))), /factionRef .*unknown/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal('', newFaction)), /matching factionPlan/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan('draft:river-patron'), newFaction.repeat(2))),
        /is duplicate or conflicts/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan().repeat(2)), ['faction_1']), /factionRef .* is duplicated/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan().replace(/<step>.*?<\/step>/, '')), ['faction_1']),
        /nextSteps .*is empty.*Add at least one <step>/i);
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan(), newFaction.replace('draft:river-patron', 'faction_2')), ['faction_1']),
        /invalid draft reference.*Use draft:label/i);
});

test('malformed or schema-invalid section throws locally and a corrected response can be accepted', () => {
    const validEntry = '<entry><references><reference>thread_1</reference></references>'
        + '<finding>Existing unseen help already addresses this need.</finding>'
        + '<recommendation>Retain the commitment; propose no equivalent help.</recommendation></entry>';
    assert.doesNotThrow(() => parseFactionHousekeepingSection(section('awareness', validEntry), 'awareness'));
    for (const invalid of [
        '<awareness><assessment>Open',
        section('roles'),
        '<awareness><assessment>OK</assessment><assessment>Duplicate</assessment><entries/></awareness>',
        section('awareness', validEntry.replace('<finding>', '<finding><nested/>')),
        section('awareness', validEntry.replace('thread_1', '')),
        section('awareness').replace('<entries>', '<entries>plain list'),
        section('awareness').replace('<awareness>', '<awareness applied="true">')
    ]) {
        assert.throws(() => parseFactionHousekeepingSection(invalid, 'awareness'));
    }
    assert.equal(parseFactionHousekeepingSection(section('awareness'), 'awareness').value,
        section('awareness'));
    assert.throws(
        () => parseFactionHousekeepingSection('<awareness><entries/></awareness>', 'awareness'),
        /awareness\/assessment is missing\. Add exactly one <assessment> field\./i
    );
    assert.throws(
        () => parseFactionHousekeepingSection('<awareness><assessment>OK</assessment><assessment>Again</assessment><entries/></awareness>', 'awareness'),
        /awareness\/assessment is duplicated\. Keep exactly one <assessment> field\./i
    );
    assert.throws(
        () => parseFactionHousekeepingSection('<awareness><assessment>OK</assessment><bogus/></awareness>', 'awareness'),
        /awareness\/bogus is unexpected\. Remove it; allowed fields are <assessment>, <entries>\./i
    );
});

test('prompt parsing helper remains pure while TinyBrain family is registered', () => {
    const helper = fs.readFileSync(path.join(__dirname, '..', 'FactionHousekeepingPrompt.js'), 'utf8');
    assert.doesNotMatch(helper, /chatCompletion|logPrompt|createFaction|ScheduledEvent|Globals|setInterval/);
    const families = fs.readFileSync(path.join(__dirname, '..', 'TinyBrainPromptFamilies.js'), 'utf8');
    assert.match(families, /faction_housekeeping: '_includes\/faction-housekeeping\.tinybrain\.njk'/);
});

test('optional worksheet lists and proposal sections may be omitted without accepting invalid required fields', () => {
    assert.doesNotThrow(() => parseFactionHousekeepingSection('<awareness><assessment>No action.</assessment></awareness>', 'awareness'));
    assert.doesNotThrow(() => parseFactionHousekeepingSection('<awareness><assessment>No action.</assessment><entries><entry><finding>None</finding><recommendation>Wait</recommendation></entry></entries></awareness>', 'awareness'));
    assert.deepEqual(parseFactionHousekeepingProposal('<factionHousekeepingProposal/>').proposal, { newFactions: [], factionPlans: [] });
    assert.throws(() => parseFactionHousekeepingProposal(proposal(plan().replace(/<nextSteps>[\s\S]*?<\/nextSteps>/, '')), ['faction_1']), /nextSteps/i);
    assert.throws(() => parseFactionHousekeepingProposal('<factionHousekeepingProposal><newFactions/><newFactions/></factionHousekeepingProposal>'), /newFactions/i);
});
