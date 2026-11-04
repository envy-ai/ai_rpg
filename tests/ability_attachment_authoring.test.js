'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LLMClient = require('../LLMClient.js');
const Globals = require('../Globals.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const TechniqueService = require('../TechniqueService.js');
const { generateAbilityAttachmentDraft, parseAbilityAttachmentDraft, authorNewAbilityAttachments } = require('../AbilityAttachmentAuthoring.js');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { parseTechniqueXmlValue, writeTechniqueXmlValue, attachmentSchema, candidateSchema, disciplineSchema } = require('../TechniqueXml.js');
const Technique = require('../Technique.js');

const ability = { id: 'sturdy', name: 'Sturdy Frame', description: 'Maximum health increases by twenty percent.', type: 'Passive', level: 1 };
const effect = { name: 'Sturdy Frame', description: 'Increased maximum health.', duration: -1, maxHealthPercent: 20, attributes: [], skills: [], techniqueEntries: [] };
const statusXml = '<statusEffect><name>Sturdy Frame</name><description>Increased maximum health.</description><duration>-1</duration><attributes/><skills/><maxHealthPercent>20</maxHealthPercent><disciplines/></statusEffect>';
const response = statusEffects => `<abilityAttachments><statusEffects>${statusEffects}</statusEffects></abilityAttachments>`;
const textStatus = content => `<statusEffect><name>Sturdy Frame</name><description>Increased maximum health.</description><duration>-1</duration><attributes/><skills/><maxHealthPercent>${content}</maxHealthPercent><disciplines/></statusEffect>`;
function mockLlm(responses, { onCompletion = null } = {}) {
    const previous = { completion: LLMClient.chatCompletion, log: LLMClient.logPrompt };
    const calls = [], logs = [];
    LLMClient.chatCompletion = async options => { calls.push(options); onCompletion?.(options); const value = responses.shift(); if (value instanceof Error) throw value; return value; };
    LLMClient.logPrompt = async entry => { logs.push(entry); };
    return { calls, logs, restore: () => { LLMClient.chatCompletion = previous.completion; LLMClient.logPrompt = previous.log; } };
}

const statusContexts = [
    {
        name: 'ability attachment', schema: attachmentSchema,
        wrap: fields => response(`<statusEffect>${fields}</statusEffect>`),
        status: value => value.statusEffects[0]
    },
    {
        name: 'technique effect', schema: candidateSchema,
        wrap: fields => `<candidate><revisions><revision><effects><effect><status>${fields}</status></effect></effects></revision></revisions></candidate>`,
        status: value => value.revisions[0].effects[0].status
    }
];

test('optional maxHealthPercent XML empties match omission without losing numeric values or technique formulas', () => {
    for (const context of statusContexts) {
        const parse = fields => parseTechniqueXmlValue(new DOMParser().parseFromString(context.wrap(fields), 'text/xml').documentElement, context.schema, context.name);
        const omitted = parse('');
        for (const empty of ['<maxHealthPercent/>', '<maxHealthPercent></maxHealthPercent>', '<maxHealthPercent> \n\t </maxHealthPercent>']) {
            const parsed = parse(empty);
            assert.deepEqual(parsed, omitted, context.name);
            assert.equal(Object.hasOwn(context.status(parsed), 'maxHealthPercent'), false, context.name);
        }
        const values = [['0', 0], ['-12.5', -12.5], ['+2e1', 20]];
        if (context.schema === candidateSchema) values.push(['<formula>level</formula>', { formula: 'level' }]);
        for (const [text, expected] of values) {
            const parsed = parse(`<maxHealthPercent>${text}</maxHealthPercent>`);
            assert.deepEqual(context.status(parsed).maxHealthPercent, expected, context.name);
            const document = new DOMParser().parseFromString(context.wrap(''), 'text/xml');
            writeTechniqueXmlValue(document.documentElement, parsed, context.schema);
            const serialized = new XMLSerializer().serializeToString(document);
            assert.deepEqual(parseTechniqueXmlValue(new DOMParser().parseFromString(serialized, 'text/xml').documentElement, context.schema, context.name), parsed, context.name);
        }
    }
});

test('optional maxHealthPercent XML still rejects invalid values, structure and duplicates; required fields stay strict', () => {
    for (const context of statusContexts) {
        for (const invalid of [
            '<maxHealthPercent>NaN</maxHealthPercent>',
            '<maxHealthPercent>Infinity</maxHealthPercent>',
            '<maxHealthPercent>10 percent</maxHealthPercent>',
            '<maxHealthPercent unit="percent"/>',
            '<maxHealthPercent><unknown/></maxHealthPercent>',
            '<maxHealthPercent/><maxHealthPercent>10</maxHealthPercent>',
            '<maxHealthPercent>10</maxHealthPercent><maxHealthPercent/>',
            '<maxHealthPercent/><maxHealthPercent/>',
            '<duration/>',
            '<attributes><attribute><attribute/><modifier>1</modifier></attribute></attributes>'
        ]) {
            assert.throws(() => parseTechniqueXmlValue(new DOMParser().parseFromString(context.wrap(invalid), 'text/xml').documentElement, context.schema, context.name), undefined, `${context.name}: ${invalid}`);
        }
    }
});

function parseTypedXml(xml, schema = candidateSchema) {
    return parseTechniqueXmlValue(new DOMParser().parseFromString(xml, 'text/xml').documentElement, schema, 'fixture');
}

test('optional and conditional technique XML leaves share omission semantics across authoring contracts', () => {
    // Every self-closing element in these fixtures is an optional leaf, not an object/list wrapper.
    const fixtures = [
        [candidateSchema, `<candidate><id/><disciplineId/><name>Ward</name><description>A practiced ward.</description><semanticKey>ward</semanticKey><unique/>
          <provenance><kind>training</kind><reason>Practice.</reason><sourceId/><private/><worldMinute/><operationId/></provenance>
          <revisions><revision><revision/>
            <acquisitionRequirements><requirement><kind>alive</kind><id/><name/><minimum/><present/></requirement></acquisitionRequirements>
            <target><kind>self</kind><allowDead/></target>
            <check><kind>automatic</kind><skill/><attribute/><difficulty/><opposedSkill/><opposedAttribute/><attackType/><damageType/><defense/><description/></check>
            <costs><cost><resource>health</resource><needId/><direction/><amount><formula>rank</formula><bindings><binding><variable>rank</variable><kind>level</kind><name/></binding></bindings></amount></cost></costs>
            <effects><effect><id>ward</id><kind>buff</kind><amount/><damageMode/><stacking/><refreshPolicy/><potency/>
              <status><name>Ward</name><description>A temporary ward.</description><duration>5</duration>
                <attributes><attribute><attribute>Strength</attribute><modifier>1</modifier><percentModifier/></attribute></attributes>
                <skills><skill><skill>Spellcasting</skill><modifier/><percentModifier>10</percentModifier></skill></skills>
                <maxHealthPercent/><techniqueGrants><techniqueGrant><id/><techniqueId>known</techniqueId><definitionRevision>1</definitionRevision></techniqueGrant></techniqueGrants>
              </status>
            </effect></effects>
          </revision></revisions></candidate>`],
        [candidateSchema, '<candidate><revisions><revision><recipe><kind/><recipeId/><skillName/><attributeName/><resourceProfileId/><effectId/></recipe></revision></revisions></candidate>'],
        [disciplineSchema, '<candidateDiscipline><id/><name>Wardcraft</name><description>Defensive practices.</description><publicAccess/></candidateDiscipline>'],
        [attachmentSchema, response('<statusEffect><name/><description>Practice.</description><duration>-1</duration><attributes><attribute><attribute>Strength</attribute><modifier>1</modifier><percentModifier/></attribute></attributes><skills><skill><skill>Spellcasting</skill><modifier/><percentModifier>10</percentModifier></skill></skills><disciplines><discipline><disciplineId>known-discipline</disciplineId><techniques><technique><techniqueId/><definitionRevision/></technique></techniques></discipline></disciplines></statusEffect>')]
    ];
    for (const [schema, xml] of fixtures) {
        const parsed = parseTypedXml(xml, schema);
        assert.deepEqual(parsed, parseTypedXml(xml.replace(/<[A-Za-z]+\/>/g, ''), schema));
        const document = new DOMParser().parseFromString(xml, 'text/xml');
        writeTechniqueXmlValue(document.documentElement, parsed, schema);
        assert.deepEqual(parseTypedXml(new XMLSerializer().serializeToString(document), schema), parsed);
    }
});

test('optional technique leaves preserve explicit zero and false and still reject malformed values and duplicates', () => {
    const parsed = parseTypedXml(`<candidate><unique>false</unique><provenance><private>false</private><worldMinute>0</worldMinute></provenance><revisions><revision>
      <acquisitionRequirements><requirement><kind>level</kind><minimum>0</minimum><present>false</present></requirement></acquisitionRequirements>
      <target><allowDead>false</allowDead></target><effects><effect><potency>0</potency><status><attributes><attribute><modifier>0</modifier><percentModifier>0</percentModifier></attribute></attributes></status></effect></effects>
    </revision></revisions></candidate>`);
    assert.equal(parsed.unique, false);
    assert.deepEqual(parsed.provenance, { private: false, worldMinute: 0 });
    const revision = parsed.revisions[0];
    assert.deepEqual(revision.acquisitionRequirements, [{ kind: 'level', minimum: 0, present: false }]);
    assert.equal(revision.target.allowDead, false);
    assert.equal(revision.effects[0].potency, 0);
    assert.deepEqual(revision.effects[0].status.attributes, [{ modifier: 0, percentModifier: 0 }]);
    assert.equal(parseTypedXml('<candidateDiscipline><publicAccess>false</publicAccess></candidateDiscipline>', disciplineSchema).publicAccess, false);
    for (const xml of [
        '<candidate><unique>yes</unique></candidate>',
        '<candidate><unique flag="true"/></candidate>',
        '<candidate><id><unknown/></id></candidate>',
        '<candidate><unique/><unique>false</unique></candidate>',
        '<candidate><id/><id>duplicate</id></candidate>',
        '<candidate><revisions><revision><revision>NaN</revision></revision></revisions></candidate>',
        '<candidate><revisions><revision><effects><effect><potency>Infinity</potency></effect></effects></revision></revisions></candidate>',
        '<candidate><name/></candidate>',
        '<candidate><revisions><revision><check><kind/></check></revision></revisions></candidate>',
        '<candidate><revisions><revision><effects><effect><status><techniqueGrants><techniqueGrant><techniqueId/></techniqueGrant></techniqueGrants></status></effect></effects></revision></revisions></candidate>',
        '<candidate><revisions><revision><effects><effect><amount><formula/></amount></effect></effects></revision></revisions></candidate>',
        '<candidate><revisions><revision><balance><policy><digest/></policy></balance></revision></revisions></candidate>'
    ]) assert.throws(() => parseTypedXml(xml), undefined, xml);
    assert.deepEqual(parseTypedXml('<candidate><provenance/><revisions><revision><check/><recipe/><costs/><failureCosts/><effects/></revision></revisions></candidate>'), {
        provenance: {}, revisions: [{ revision: 1, check: {}, recipe: {}, costs: [], failureCosts: [], effects: [] }]
    }, 'empty objects and lists retain their existing meaning');
});

test('conditional requirements still fail domain validation when XML empties omit required values', () => {
    const parseRevision = fields => parseTypedXml(`<candidate><revisions><revision>${fields}</revision></revisions></candidate>`).revisions[0];
    for (const [xml, pattern] of [
        ['<check><kind>skill</kind><skill/><difficulty>Medium</difficulty></check>', /skill is required/],
        ['<check><kind>skill</kind><skill>Spellcasting</skill><difficulty/></check>', /difficulty is required/],
        ['<check><kind>opposed</kind><skill>Spellcasting</skill><opposedSkill/></check>', /opposedSkill is required/]
    ]) assert.throws(() => Technique.normalizeCheck(parseRevision(xml).check), pattern);
    assert.throws(() => Technique.normalizeCosts(parseRevision('<costs><cost><resource>need</resource><needId/><amount>1</amount></cost></costs>').costs), /needId/);
    for (const [fields, pattern] of [
        ['<kind>skill</kind><name/><minimum>1</minimum>', /name/],
        ['<kind>level</kind><minimum/>', /minimum/],
        ['<kind>technique</kind><id/>', /id/]
    ]) assert.throws(() => Technique.normalizeRequirements(parseRevision(`<useRequirements><requirement>${fields}</requirement></useRequirements>`).useRequirements), pattern);
    const status = fields => parseRevision(`<effects><effect><status><name>Ward</name><description>Practice.</description><duration>5</duration>${fields}</status></effect></effects>`).effects[0].status;
    assert.throws(() => Technique.normalizeStatus(status('<maxHealthPercent/>'), 'status'), /needs a mechanical modifier or technique grant/);
    assert.throws(() => Technique.normalizeStatus(status('<attributes><attribute><attribute>Strength</attribute><modifier/><percentModifier/></attribute></attributes>'), 'status'), /needs a modifier/);
    const formula = kind => parseRevision(`<costs><cost><amount><formula>rank</formula><bindings><binding><variable>rank</variable><kind>${kind}</kind><name/></binding></bindings></amount></cost></costs>`).costs[0].amount;
    assert.deepEqual(Technique.normalizeAmount(formula('level')).bindings, { rank: { kind: 'level' } });
    assert.throws(() => Technique.normalizeAmount(formula('skill')), /name/);
    assert.throws(() => require('../TechniqueBalancePolicy.js').validateAuthoringRecipeProposal(parseRevision('<recipe><kind/><recipeId/></recipe>').recipe), /recipe.kind/);
    for (const kind of ['damage', 'healing']) {
        const fields = `<check><kind>skill</kind><skill>Spellcasting</skill><difficulty>Medium</difficulty></check><effects><effect><id>effect</id><kind>${kind}</kind><amount/><damageMode>technique</damageMode></effect></effects>`;
        if (kind === 'healing') {
            assert.throws(() => Technique.normalizeRevision(parseRevision(fields.replace('<damageMode>technique</damageMode>', ''))), /amount/);
        } else {
            assert.throws(() => Technique.normalizeRevision(parseRevision(fields)), /amount/);
            assert.throws(() => Technique.normalizeRevision(parseRevision(fields.replace('<amount/>', '<amount>1</amount>').replace('<damageMode>technique</damageMode>', '<damageMode/>'))), /damageMode/);
        }
    }
});

test('strict XML parser rejects malformed structure, server identities and unsupported effects without state mutation', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setAbilities([ability]);
        const actorBefore = player.getAbilities(), worldBefore = TechniqueService.toJSON();
        for (const [index, invalid] of [
            '<abilityAttachments><statusEffects><statusEffect></statusEffects></abilityAttachments>',
            response('[{"name":"legacy JSON payload"}]'),
            response('<statusEffect><id>forged</id><duration>-1</duration></statusEffect>'),
            response(statusXml.replace('<duration>-1</duration>', '<duration>4</duration>')),
            response('<statusEffect><name>Ward</name><description>Unsupported grant field.</description><duration>-1</duration><techniqueGrants/></statusEffect>'),
            response('<statusEffect><name>Ward</name><description>Unsupported need field.</description><duration>-1</duration><needBars><needBar><name>Health</name><delta>1</delta></needBar></needBars></statusEffect>'),
            response(`${statusXml}<statusEffect/>`),
            response('<statusEffect><name>A</name><name>B</name><duration>-1</duration></statusEffect>'),
            response('<statusEffect duration="-1"><name>Ward</name></statusEffect>'),
            response(textStatus('NaN')),
            response('<statusEffect><name>Ward</name><description>Bad boolean.</description><duration>-1</duration><disciplines><discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><candidate><name>Ward</name><description>A ward.</description><semanticKey>ward</semanticKey><unique>yes</unique></candidate></technique></techniques></discipline></disciplines></statusEffect>')
        ].entries()) {
            assert.throws(() => parseAbilityAttachmentDraft(invalid, { actor: player, abilityId: 'sturdy' }), undefined, `invalid XML fixture ${index} should be rejected`);
        }
        assert.deepEqual(player.getAbilities(), actorBefore);
        assert.deepEqual(TechniqueService.toJSON(), worldBefore);
    });
});

test('invalid XML receives usable correction feedback and logs; accepted output stays detached', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability]);
        const before = player.getAbilities(), world = TechniqueService.toJSON();
        const mock = mockLlm([response(textStatus('not-a-number')), response(statusXml)]);
        try {
            const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { retryAttempts: 1 } } });
            assert.deepEqual(result.draft.statusEffects, [effect]);
            assert.equal(mock.calls.length, 2);
            assert.match(JSON.stringify(mock.calls[1].messages), /Ability attachment validation failed/);
            assert.match(JSON.stringify(mock.calls[1].messages), /maxHealthPercent.*finite|finite.*maxHealthPercent/i);
            assert.match(mock.calls[0].messages[0].content, /<statusEffect>/);
            assert.doesNotMatch(mock.calls[0].messages[1].content, /XML-escaped strict JSON array|JSON must be XML-escaped/i);
            assert.equal(mock.logs.length, 2);
            assert.deepEqual(player.getAbilities(), before);
            assert.deepEqual(TechniqueService.toJSON(), world);
        } finally { mock.restore(); }
        const cancelled = new Error('Cancelled fixture request');
        const cancelMock = mockLlm([cancelled]);
        try { await assert.rejects(generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { retryAttempts: 1 } } }), error => error === cancelled); }
        finally { cancelMock.restore(); }
        assert.equal(cancelMock.calls.length, 1);
        assert.deepEqual(player.getAbilities(), before);
        assert.deepEqual(TechniqueService.toJSON(), world);
    });
});

test('domain and typed attachment failures give actionable retry feedback while preserving the rejected XML', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability]);
        const candidate = ({ discipline = '<disciplineId>discipline-integration</disciplineId>', check = '<check><kind>automatic</kind></check>', costs = null, effect = null, recipe = '' } = {}) => `<discipline>${discipline}<techniques><technique><candidate><name>Retry Candidate</name><description>A fixture candidate.</description><semanticKey>retry-candidate</semanticKey><aliases/><unique>false</unique><revisions><revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind></target>${check}${recipe}${costs ?? (recipe ? '' : '<costs/>')}${effect ?? (recipe ? '' : '<effects/>')}</revision></revisions></candidate></technique></techniques></discipline>`;
        const wrapEntry = contents => response(`<statusEffect><name>Grant</name><description>Grants one technique.</description><duration>-1</duration><disciplines>${contents}</disciplines></statusEffect>`);
        const scenarios = [
            {
                name: 'missing candidate discipline',
                rejected: wrapEntry(candidate({ discipline: '' })),
                hint: /disciplineId|parent|new discipline/i
            },
            {
                name: 'catalogue reference and candidate supplied together',
                setup() {
                    const { addDefinition, mechanics } = require('./helpers/techniqueIntegrationFixtures.js');
                    addDefinition('retry-known-technique', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 5, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] }));
                },
                rejected: wrapEntry(`<discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><techniqueId>retry-known-technique</techniqueId>${candidate().match(/<candidate>[\s\S]*<\/candidate>/)[0]}</technique></techniques></discipline>`),
                hint: /provide exactly one techniqueId or candidate|reference known mechanics by ID/i
            },
            {
                name: 'candidate and proposed discipline IDs disagree',
                rejected: wrapEntry(`<discipline><name>Retry Practice</name><description>A fixture practice.</description><accessRequirements/><techniques><technique><candidate><name>Retry Candidate</name><description>A fixture candidate.</description><semanticKey>retry-candidate</semanticKey><disciplineId>nested-parent</disciplineId><revisions/></candidate></technique></techniques></discipline>`),
                hint: /candidate.*disciplineId|enclosing discipline/i
            },
            {
                name: 'temporary outer status',
                rejected: response(textStatus('20').replace('<duration>-1</duration>', '<duration>5</duration>')),
                hint: /must be permanent|duration to -1|granted technique effect/i
            },
            {
                name: 'outer need bars',
                rejected: response('<statusEffect><name>Grant</name><description>Invalid outer need drift.</description><duration>-1</duration><needBars><needBar><name>hunger</name><delta>1</delta></needBar></needBars></statusEffect>'),
                hint: /cannot contain per-minute need bars|remove outer needBars|technique effect\.status\.needBars/i
            },
            {
                name: 'harmful effect inheriting a non-harmful automatic check',
                rejected: wrapEntry(candidate({ effect: '<effects><effect><id>hit</id><kind>damage</kind><amount>1</amount><damageMode>technique</damageMode></effect></effects>' })),
                hint: /inherited from revision\.check|harmful effects require attack\/opposed\/skill checks|valid per-effect override/i
            },
            {
                name: 'incompatible semantic recipe and canonical recipe ID',
                rejected: wrapEntry(candidate({ recipe: '<recipe><kind>healing</kind><recipeId>standard-damage</recipeId><skillName>Spellcasting</skillName><attributeName>Intelligence</attributeName><resourceProfileId>mana</resourceProfileId></recipe>' })),
                hint: /conflicts with recipe\.recipeId|match healing with standard-healing/i
            },
            {
                name: 'recipe selector outside actor resource context',
                rejected: wrapEntry(candidate({ recipe: '<recipe><kind>healing</kind><skillName>Spellcasting</skillName><attributeName>Intelligence</attributeName><resourceProfileId>invented-pool</resourceProfileId></recipe>' })),
                hint: /resource|eligible|selector|offered facts\/resources/i
            },
            {
                name: 'unknown formula variable in a candidate effect',
                rejected: wrapEntry(candidate({ check: '<check><kind>skill</kind><skill>Spellcasting</skill><difficulty>Easy</difficulty></check>', effect: '<effects><effect><id>hit</id><kind>damage</kind><damageMode>technique</damageMode><amount><formula>mystery_power</formula></amount></effect></effects>' })),
                hint: /unknown formula variable|formulaVariables key|actor.*formula/i
            },
            {
                name: 'malformed numeric modifier',
                rejected: response(textStatus('not-a-number')),
                hint: /finite|numeric|number/i
            }
        ];

        for (const scenario of scenarios) {
            scenario.setup?.();
            const beforeActor = player.getAbilities(), beforeWorld = TechniqueService.toJSON();
            const mock = mockLlm([scenario.rejected, response('')]);
            try {
                const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { retryAttempts: 1 } } });
                assert.deepEqual(result.draft, { statusEffects: [] }, scenario.name);
                assert.equal(mock.calls.length, 2, `${scenario.name}: one correction attempt is available`);
                const retry = mock.calls[1].messages;
                assert.equal(retry.at(-2).role, 'assistant', `${scenario.name}: rejected XML remains in retry context`);
                assert.equal(retry.at(-2).content, scenario.rejected, `${scenario.name}: retry preserves the exact rejected XML`);
                assert.equal(retry.at(-1).role, 'user');
                assert.match(retry.at(-1).content, /Ability attachment validation failed/i);
                assert.match(retry.at(-1).content, scenario.hint, `${scenario.name}: retry includes a concise repair direction`);
                assert.match(retry.at(-1).content, /No catalogue or actor changes were applied/i);
                assert.equal(mock.logs.length, 2, `${scenario.name}: each completion is logged`);
                assert.deepEqual(player.getAbilities(), beforeActor, `${scenario.name}: rejected response does not mutate actor`);
                assert.deepEqual(TechniqueService.toJSON(), beforeWorld, `${scenario.name}: rejected response does not mutate catalogue`);
            } finally { mock.restore(); }
        }
    }, { includeMana: true });
});

test('terminal Reiko-like ability authoring reports one failure after seven completions and six corrections', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability]);
        const previousHub = Globals.realtimeHub;
        const events = [];
        Globals.realtimeHub = { emit(_room, type, payload) { if (type === 'prompt_failed') events.push(payload); } };
        const mock = mockLlm(Array.from({ length: 7 }, () => response(textStatus('bad-number'))), {
            onCompletion: options => PromptFailureReporter.transportAttempt(options.metadataLabel)
        });
        try {
            await assert.rejects(generateAbilityAttachmentDraft({
                actor: player,
                abilityId: 'sturdy',
                config: { ai: { retryAttempts: 6 } }
            }), /failed to parse after 7 attempts/i);
            assert.equal(mock.calls.length, 7);
            assert.equal(mock.logs.length, 7);
            assert.equal(events.length, 1);
            assert.equal(events[0].metadataLabel, 'ability_attachments');
            assert.equal(events[0].kind, 'parse_retry');
            assert.equal(events[0].transportAttempts, 7);
            assert.equal(events[0].validationRetries, 6);
            assert.match(events[0].stack, /maxHealthPercent.*finite|finite.*maxHealthPercent/i);
        } finally {
            mock.restore();
            Globals.realtimeHub = previousHub;
        }
    });
});

test('new player and NPC abilities accept authored permanent effects', async () => {
    await withTechniqueWorld(async ({ player, npc }) => {
        for (const actor of [player, npc]) {
            actor.setAbilities([ability]);
            const before = actor.maxHealth;
            const mock = mockLlm([response(statusXml)]);
            try { await authorNewAbilityAttachments({ actor, abilityIds: ['sturdy'], config: { ai: { retryAttempts: 0 } } }); }
            finally { mock.restore(); }
            assert.equal(actor.getAbilities()[0].statusEffects[0].maxHealthPercent, 20);
            assert.equal(actor.maxHealth, before * 1.2);
        }
    });
});

test('XML authoring accepts mixed modifiers and validates a nested candidate before returning a detached draft', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setLevel(3);
        player.setSkillValue('Spellcasting', 3);
        player.setAbilities([ability]);
        const { addDefinition, mechanics } = require('./helpers/techniqueIntegrationFixtures.js');
        addDefinition('known-ward', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        const xml = response(`<statusEffect>
          <name>Sturdy Frame</name><description>Increased health and technique knowledge.</description><duration>-1</duration>
          <attributes><attribute><attribute>Strength</attribute><modifier>-2</modifier><percentModifier>10</percentModifier></attribute></attributes>
          <skills><skill><skill>Spellcasting</skill><modifier>1</modifier><percentModifier>-5</percentModifier></skill></skills>
          <maxHealthPercent>20</maxHealthPercent>
          <disciplines>
            <discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><techniqueId>known-ward</techniqueId></technique></techniques></discipline>
            <discipline><name>Wardcraft</name><description>Defensive ward practices.</description><accessRequirements/><publicAccess>false</publicAccess><techniques><technique>
              <candidate>
                <name>Attached Ward</name><description>A defensive practice.</description><semanticKey>attached-ward</semanticKey>
                <aliases/><unique>false</unique><revisions><revision><revision>1</revision>
                  <acquisitionRequirements><requirement><kind>skill</kind><name>Spellcasting</name><minimum>1</minimum></requirement></acquisitionRequirements>
                  <useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check>
                  <costs><cost><resource>need</resource><needId>mana</needId><direction>decrease</direction><amount>1</amount></cost></costs><effects>
                    <effect><id>ward</id><kind>buff</kind><status><name>Ward</name><description>Strengthens the user.</description><duration>5</duration>
                      <attributes><attribute><attribute>Strength</attribute><modifier><formula>level</formula></modifier></attribute></attributes>
                    </status><stacking>refresh</stacking><refreshPolicy>replace</refreshPolicy><potency>1</potency></effect>
                  </effects>
                </revision></revisions>
              </candidate></technique></techniques></discipline>
            <discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><candidate>
              <name>Attached Mend</name><description>A restorative practice.</description><semanticKey>attached-mend</semanticKey><aliases/><unique>false</unique>
              <revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check>
                <recipe><recipeId>standard-healing</recipeId><skillName>Spellcasting</skillName><attributeName>Intelligence</attributeName><resourceProfileId>mana</resourceProfileId><effectId>restore</effectId></recipe>
              </revision></revisions>
            </candidate></technique></techniques></discipline>
          </disciplines>
        </statusEffect>`);
        const beforeActor = player.getAbilities(), beforeWorld = TechniqueService.toJSON();
        const mock = mockLlm([xml]);
        try {
            const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { retryAttempts: 0 } } });
            assert.equal(result.draft.statusEffects[0].duration, -1);
            assert.equal(result.draft.statusEffects[0].maxHealthPercent, 20);
            assert.deepEqual(result.draft.statusEffects[0].attributes, [{ attribute: 'Strength', modifier: -2, percentModifier: 10 }]);
            assert.deepEqual(result.draft.statusEffects[0].skills, [{ skill: 'Spellcasting', modifier: 1, percentModifier: -5 }]);
            assert.equal(result.draft.statusEffects[0].techniqueEntries[0].techniqueId, 'known-ward');
            const candidate = result.draft.statusEffects[0].techniqueEntries[1].candidate;
            assert.equal(candidate.name, 'Attached Ward');
            assert.equal(candidate.revisions[0].acquisitionRequirements[0].kind, 'skill');
            assert.equal(candidate.revisions[0].costs[0].needId, 'mana');
            assert.equal(candidate.revisions[0].effects[0].status.attributes[0].modifier.formula, 'level');
            assert.equal(result.draft.statusEffects[0].techniqueEntries[1].candidateDiscipline.name, 'Wardcraft');
            const healing = result.draft.statusEffects[0].techniqueEntries[2].candidate;
            assert.equal(healing.revisions[0].recipe.resourceProfileId, 'mana');
            assert.equal(healing.revisions[0].recipe.skillName, 'Spellcasting');
            assert.deepEqual(player.getAbilities(), beforeActor);
            assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
        } finally { mock.restore(); }
    }, { includeMana: true });
});

test('empty XML statusEffects is accepted as an explicit no-op draft', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability]);
        const mock = mockLlm([response('')]);
        try {
            const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { retryAttempts: 0 } } });
            assert.deepEqual(result.draft, { statusEffects: [] });
        } finally { mock.restore(); }
    });
});

test('batch authoring leaves every ability and the technique catalogue unchanged until all XML drafts are accepted', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability, { ...ability, id: 'second', name: 'Second' }]);
        const beforeActor = player.getAbilities(), beforeWorld = TechniqueService.toJSON();
        const candidateStatus = '<statusEffect><name>Ward</name><description>Grants a technique.</description><duration>-1</duration><attributes/><skills/><disciplines><discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><candidate><name>Uncommitted Ward</name><description>Fixture.</description><semanticKey>uncommitted-ward</semanticKey><aliases/><unique>false</unique><revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check><costs/><effects><effect><id>ward</id><kind>buff</kind><status><name>Ward</name><description>A fixture ward.</description><duration>5</duration><attributes><attribute><attribute>Strength</attribute><modifier>1</modifier></attribute></attributes></status></effect></effects></revision></revisions></candidate></technique></techniques></discipline></disciplines></statusEffect>';
        const mock = mockLlm([response(candidateStatus), response(textStatus('bad-number'))]);
        try {
            await assert.rejects(authorNewAbilityAttachments({ actor: player, abilityIds: ['sturdy', 'second'], config: { ai: { retryAttempts: 0 } } }), /maxHealthPercent|number|finite/i);
            assert.deepEqual(player.getAbilities(), beforeActor);
            assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
            assert.equal(mock.calls.length, 2);
        } finally { mock.restore(); }
    });
});

test('NPC generation entrypoint authors newly assigned abilities and surfaces the original failure', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const begin = source.indexOf('async function initializeGeneratedNpcAbilityAttachments(');
    const end = source.indexOf('\nfunction isGeneratedNpcAbilityAttachmentError', begin);
    assert.ok(begin >= 0 && end > begin);
    const entrypoint = new Function('getCharacterAbilities', 'authorNewAbilityAttachments', 'config', 'getActiveSettingSnapshot', `${source.slice(begin, end)}; return initializeGeneratedNpcAbilityAttachments;`)(actor => actor.getAbilities(), authorNewAbilityAttachments, { ai: { retryAttempts: 0 } }, () => ({}));
    await withTechniqueWorld(async ({ npc }) => {
        npc.setAbilities([ability]);
        const mock = mockLlm([response(statusXml)]);
        try { await entrypoint([npc]); } finally { mock.restore(); }
        assert.equal(npc.getAbilities()[0].statusEffects[0].maxHealthPercent, 20);
        npc.setAbilities([{ ...ability, id: 'second' }]);
        const failure = new Error('Fixture cancelled');
        const failed = mockLlm([failure]);
        try { await assert.rejects(entrypoint([npc]), error => error.code === 'NPC_ABILITY_ATTACHMENT_FAILED' && error.cause === failure && /Fixture cancelled/.test(error.stack)); }
        finally { failed.restore(); }
    });
});

test('pending ability authoring sees full actor context without installing the offered ability during an asynchronous prompt', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const owned = { ...ability, id: 'owned', name: 'Existing Talent' };
        player.setAbilities([owned]);
        const beforeActor = player.getAbilities(), beforeWorld = TechniqueService.toJSON();
        const mock = mockLlm([response(statusXml)], { onCompletion: () => {
            assert.deepEqual(player.getAbilities(), beforeActor);
            assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
        } });
        try {
            const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: ability.id, pendingAbility: ability, config: { ai: { retryAttempts: 0 } } });
            assert.deepEqual({ ...result.draft.statusEffects[0], id: undefined }, { ...effect, id: undefined });
            assert.ok(result.draft.statusEffects[0].id);
            assert.match(JSON.stringify(mock.calls[0].messages), /Sturdy Frame/);
            assert.match(JSON.stringify(mock.calls[0].messages), /Existing Talent/);
            assert.deepEqual(player.getAbilities(), beforeActor);
            assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
        } finally { mock.restore(); }
    });
});

test('pending authoring shares actor and world prompt prefix while each ability task omits artwork', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const first = { ...ability, imageId: 'private-image-one', imagePrompt: 'first artwork prompt' };
        const second = { ...ability, id: 'second', name: 'Second Talent', imageId: 'private-image-two', imagePrompt: 'second artwork prompt' };
        const mock = mockLlm([response(''), response('')]);
        try {
            for (const choice of [first, second]) {
                await generateAbilityAttachmentDraft({ actor: player, abilityId: choice.id, pendingAbility: choice, setting: { name: 'Fixture Realm' }, config: { ai: { retryAttempts: 0 } } });
            }
            const [one, two] = mock.calls.map(call => call.messages);
            assert.equal(one.length, 3);
            assert.deepEqual(one.map(message => message.role), ['system', 'user', 'user']);
            assert.equal(one[0].content, two[0].content);
            assert.equal(one[1].content, two[1].content);
            assert.notEqual(one[2].content, two[2].content);
            assert.match(one[1].content, /Integration Player/);
            assert.match(one[1].content, /Fixture Realm/);
            assert.match(one[1].content, /Integration Discipline/);
            assert.match(one[2].content, /Sturdy Frame/);
            assert.match(two[2].content, /Second Talent/);
            assert.doesNotMatch(one[2].content + two[2].content, /imageId|imagePrompt|private-image|artwork prompt/);
            assert.match(one[2].content, /<abilityAttachments>/);
        } finally { mock.restore(); }
    });
});

test('shared prompt and detached XML represent a permanent drawback separately from an activated target debuff', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const hybrid = { ...ability, name: 'Burdened Hex', description: 'The bearer is always weaker, and can invoke a brief weakening hex on another character.' };
        player.setSkillValue('Spellcasting', 3);
        player.setAbilities([hybrid]);
        const xml = response(`
          <statusEffect><name>Burden</name><description>The bearer is always weaker.</description><duration>-1</duration>
            <attributes><attribute><attribute>Strength</attribute><modifier>-1</modifier></attribute></attributes><skills/><disciplines/>
          </statusEffect>
          <statusEffect><name>Hex Access</name><description>Grants the invoked weakening hex.</description><duration>-1</duration>
            <attributes/><skills/><disciplines><discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><candidate>
              <name>Weakening Hex</name><description>Weakens a chosen target.</description><semanticKey>weakening-hex</semanticKey><aliases/><unique>false</unique>
              <revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>single</kind><allowDead>false</allowDead></target><check><kind>skill</kind><skill>Spellcasting</skill><difficulty>Easy</difficulty></check><costs/>
                <effects><effect><id>weaken</id><kind>debuff</kind><status><name>Weakened</name><description>Temporarily weakened.</description><duration>1</duration>
                  <attributes><attribute><attribute>Strength</attribute><modifier>-2</modifier></attribute></attributes><skills/>
                </status><stacking>refresh</stacking><refreshPolicy>replace</refreshPolicy></effect></effects>
              </revision></revisions>
            </candidate></technique></techniques></discipline></disciplines>
          </statusEffect>`);
        const beforeActor = player.getAbilities(), beforeWorld = TechniqueService.toJSON();
        const mock = mockLlm([xml, xml]);
        try {
            const drafts = [];
            for (const tinybrain of [false, true]) {
                drafts.push((await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { tinybrain, retryAttempts: 0 } } })).draft);
            }
            assert.equal(mock.calls.length, 2);
            const instructions = mock.calls.map(call => call.messages.map(message => message.content).join('\n'));
            assert.equal(instructions[0], instructions[1], 'standard and TinyBrain use the same shared authoring prompt');
            assert.match(instructions[0], /permanent[\s\S]*bearer/i);
            assert.match(instructions[0], /(?:activated|invoked|active)[\s\S]*(?:technique|status)/i);
            for (const draft of drafts) {
                const [burden, carrier] = draft.statusEffects;
                assert.deepEqual(burden.attributes, [{ attribute: 'Strength', modifier: -1 }]);
                assert.deepEqual(carrier.attributes, []);
                assert.deepEqual(carrier.skills, []);
                const revision = carrier.techniqueEntries[0].candidate.revisions[0];
                assert.equal(revision.target.kind, 'single');
                assert.equal(revision.effects[0].kind, 'debuff');
                assert.equal(revision.effects[0].status.duration, 1);
                assert.deepEqual(revision.effects[0].status.attributes, [{ attribute: 'Strength', modifier: -2 }]);
            }
            assert.deepEqual(player.getAbilities(), beforeActor);
            assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
        } finally { mock.restore(); }
    });
});

test('omitted attachment list is the same empty draft as an explicit empty list', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setAbilities([ability]);
        const parse = xml => parseAbilityAttachmentDraft(xml, { actor: player, abilityId: 'sturdy' });
        assert.deepEqual(parse('<abilityAttachments/>'), parse('<abilityAttachments><statusEffects/></abilityAttachments>'));
        assert.throws(() => parse('<abilityAttachments><statusEffects/><statusEffects/></abilityAttachments>'), /statusEffects/i);
    });
});

test('pending standard damage freezes singleton resource selection before a second profile appears', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const Balance = require('../TechniqueBalancePolicy.js');
        const { authorNewAbilityAttachments } = require('../AbilityAttachmentAuthoring.js');
        player.setSkillValue('Spellcasting', 3);
        const choice = { ...ability, id: 'pending-strike', name: 'Pending Strike' };
        player.setPendingAbilityOptionsForLevel(1, [choice]);
        const xml = response('<statusEffect><name>Strike Access</name><description>Grants an attack.</description><duration>-1</duration><disciplines><discipline><disciplineId>discipline-integration</disciplineId><techniques><technique><candidate><name>Arcane Strike</name><description>A practiced strike.</description><semanticKey>arcane-strike</semanticKey><revisions><revision><target><kind>single</kind><allowDead>false</allowDead></target><check><kind>skill</kind><skill>Spellcasting</skill><difficulty>Medium</difficulty></check><recipe><kind>damage</kind><skillName>Spellcasting</skillName><attributeName>intelligence</attributeName></recipe></revision></revisions></candidate></technique></techniques></discipline></disciplines></statusEffect>');
        const mock = mockLlm([xml]);
        try {
            const { draft } = await generateAbilityAttachmentDraft({ actor: player, abilityId: choice.id, pendingAbility: choice, config: { ai: { retryAttempts: 0 } } });
            const selected = draft.statusEffects[0].techniqueEntries[0].candidate.revisions[0].recipe;
            assert.equal(selected.recipeId, 'standard-damage'); assert.equal(selected.resourceProfileId, 'mana');
            player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: choice.id, draft }]);
            const config = structuredClone(Balance.DEFAULT_POLICY);
            config.resourceProfiles.other_mana = { ...config.resourceProfiles.mana };
            Globals.config.techniques = { ...(Globals.config.techniques || {}), balance: config };
            player.setAbilities([choice]);
            await authorNewAbilityAttachments({ actor: player, abilityIds: [choice.id], draftsByAbilityId: { [choice.id]: draft } });
            const definition = TechniqueService.toJSON().definitions.find(entry => entry.name === 'Arcane Strike');
            assert.equal(definition.revisions[0].balance.selections.resourceProfileId, 'mana');
            assert.equal(mock.calls.length, 1);
        } finally { mock.restore(); }
    }, { includeMana: true });
});

test('multiple typed sibling problems reach the correction together without applying a partial draft', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setAbilities([ability]);
        const before = player.getAbilities();
        const catalogueBefore = TechniqueService.toJSON();
        const invalid = response('<statusEffect><name>Ward</name><description>A ward.</description><duration>bad</duration><maxHealthPercent>NaN</maxHealthPercent><attributes><attribute><attribute>Strength</attribute><modifier>bad</modifier><percentModifier>wrong</percentModifier></attribute></attributes></statusEffect><statusEffect><name>Other</name><description>Another ward.</description><duration>wrong</duration></statusEffect>');
        assert.throws(() => parseAbilityAttachmentDraft(invalid, { actor: player, abilityId: 'sturdy' }), error => {
            assert.match(error.message, /duration/);
            assert.match(error.message, /maxHealthPercent/);
            assert.match(error.message, /modifier/);
            assert.match(error.message, /percentModifier/);
            assert.ok(error.issues.length >= 5);
            return true;
        });
        assert.deepEqual(player.getAbilities(), before);
        assert.deepEqual(TechniqueService.toJSON(), catalogueBefore);
        for (const tinybrain of [false, true]) {
          const mock = mockLlm([invalid, response(statusXml)]);
          try {
            const result = await generateAbilityAttachmentDraft({ actor: player, abilityId: 'sturdy', config: { ai: { tinybrain, retryAttempts: 1 } } });
            assert.deepEqual(result.draft.statusEffects, [effect]);
            const feedback = mock.calls[1].messages.at(-1).content;
            assert.match(feedback, /1[.)][\s\S]*2[.)][\s\S]*3[.)]/);
            assert.match(feedback, /duration/);
            assert.match(feedback, /maxHealthPercent/);
            assert.match(feedback, /modifier/);
            assert.match(feedback, /percentModifier/);
            assert.match(feedback, /5[.)]/);
            assert.match(feedback, /complete/i);
            assert.deepEqual(player.getAbilities(), before);
            assert.deepEqual(TechniqueService.toJSON(), catalogueBefore);
          } finally { mock.restore(); }
        }
    });
});
