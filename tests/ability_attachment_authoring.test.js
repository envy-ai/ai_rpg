'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LLMClient = require('../LLMClient.js');
const Globals = require('../Globals.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const TechniqueService = require('../TechniqueService.js');
const { generateAbilityAttachmentDraft, parseAbilityAttachmentDraft, authorNewAbilityAttachments } = require('../AbilityAttachmentAuthoring.js');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');

const ability = { id: 'sturdy', name: 'Sturdy Frame', description: 'Maximum health increases by twenty percent.', type: 'Passive', level: 1 };
const effect = { name: 'Sturdy Frame', description: 'Increased maximum health.', duration: -1, maxHealthPercent: 20, attributes: [], skills: [], techniqueEntries: [] };
const statusXml = '<statusEffect><name>Sturdy Frame</name><description>Increased maximum health.</description><duration>-1</duration><attributes/><skills/><maxHealthPercent>20</maxHealthPercent><techniqueEntries/></statusEffect>';
const response = statusEffects => `<abilityAttachments><statusEffects>${statusEffects}</statusEffects></abilityAttachments>`;
const textStatus = content => `<statusEffect><name>Sturdy Frame</name><description>Increased maximum health.</description><duration>-1</duration><attributes/><skills/><maxHealthPercent>${content}</maxHealthPercent><techniqueEntries/></statusEffect>`;
function mockLlm(responses, { onCompletion = null } = {}) {
    const previous = { completion: LLMClient.chatCompletion, log: LLMClient.logPrompt };
    const calls = [], logs = [];
    LLMClient.chatCompletion = async options => { calls.push(options); onCompletion?.(options); const value = responses.shift(); if (value instanceof Error) throw value; return value; };
    LLMClient.logPrompt = async entry => { logs.push(entry); };
    return { calls, logs, restore: () => { LLMClient.chatCompletion = previous.completion; LLMClient.logPrompt = previous.log; } };
}

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
            response('<statusEffect><name>Ward</name><description>Bad boolean.</description><duration>-1</duration><techniqueEntries><techniqueEntry><candidate><unique>yes</unique></candidate></techniqueEntry></techniqueEntries></statusEffect>')
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
          <techniqueEntries>
            <techniqueEntry><techniqueId>known-ward</techniqueId><definitionRevision>1</definitionRevision></techniqueEntry>
            <techniqueEntry>
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
              </candidate>
              <candidateDiscipline><name>Wardcraft</name><description>Defensive ward practices.</description><accessRequirements/><publicAccess>false</publicAccess></candidateDiscipline>
            </techniqueEntry>
            <techniqueEntry><candidate>
              <disciplineId>discipline-integration</disciplineId><name>Attached Mend</name><description>A restorative practice.</description><semanticKey>attached-mend</semanticKey><aliases/><unique>false</unique>
              <revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check>
                <recipe><recipeId>standard-healing</recipeId><skillName>Spellcasting</skillName><attributeName>Intelligence</attributeName><resourceProfileId>mana</resourceProfileId><effectId>restore</effectId></recipe>
              </revision></revisions>
            </candidate></techniqueEntry>
          </techniqueEntries>
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
        const candidateStatus = '<statusEffect><name>Ward</name><description>Grants a technique.</description><duration>-1</duration><attributes/><skills/><techniqueEntries><techniqueEntry><candidate><name>Uncommitted Ward</name><description>Fixture.</description><semanticKey>uncommitted-ward</semanticKey><disciplineId>discipline-integration</disciplineId><aliases/><unique>false</unique><revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>self</kind><allowDead>false</allowDead></target><check><kind>automatic</kind></check><costs/><effects><effect><id>ward</id><kind>buff</kind><status><name>Ward</name><description>A fixture ward.</description><duration>5</duration><attributes><attribute><attribute>Strength</attribute><modifier>1</modifier></attribute></attributes></status></effect></effects></revision></revisions></candidate></techniqueEntry></techniqueEntries></statusEffect>';
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
            <attributes><attribute><attribute>Strength</attribute><modifier>-1</modifier></attribute></attributes><skills/><techniqueEntries/>
          </statusEffect>
          <statusEffect><name>Hex Access</name><description>Grants the invoked weakening hex.</description><duration>-1</duration>
            <attributes/><skills/><techniqueEntries><techniqueEntry><candidate>
              <disciplineId>discipline-integration</disciplineId><name>Weakening Hex</name><description>Weakens a chosen target.</description><semanticKey>weakening-hex</semanticKey><aliases/><unique>false</unique>
              <revisions><revision><revision>1</revision><acquisitionRequirements/><useRequirements/><target><kind>single</kind><allowDead>false</allowDead></target><check><kind>skill</kind><skill>Spellcasting</skill><difficulty>Easy</difficulty></check><costs/>
                <effects><effect><id>weaken</id><kind>debuff</kind><status><name>Weakened</name><description>Temporarily weakened.</description><duration>1</duration>
                  <attributes><attribute><attribute>Strength</attribute><modifier>-2</modifier></attribute></attributes><skills/>
                </status><stacking>refresh</stacking><refreshPolicy>replace</refreshPolicy></effect></effects>
              </revision></revisions>
            </candidate></techniqueEntry></techniqueEntries>
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
