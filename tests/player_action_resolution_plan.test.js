const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');
const LLMClient = require('../LLMClient.js');
const { createChatToolRuntime } = require('../chat_tool_calls.js');
const TechniqueService = require('../TechniqueService.js');
const { receiptInvocation, resolveTechniqueAttemptIdentity } = require('../TechniquePrompt.js');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');

const {
    parsePlayerActionResolutionPlan,
    createResolutionPlanExecutionState,
    executePlayerActionResolutionPlan,
    formatPlayerActionResolutionResults,
    validatePlayerActionResolutionReferences
} = require('../PlayerActionResolutionPlan.js');
const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');

class MemoryLoader extends nunjucks.Loader {
    constructor(templates) {
        super();
        this.templates = templates;
    }

    getSource(name) {
        const source = this.templates[name];
        return typeof source === 'string' ? { src: source, path: name, noCache: true } : null;
    }
}

const modifier = (amount, reason) => `<modifier><amount>${amount}</amount><reason>${reason}</reason></modifier>`;

test('resolution plan accepts a unary plus on integer modifiers and retains integer validation', () => {
    const plan = amount => '<resolutionPlan><check><type>unopposed</type><actor>player</actor><intent>Climb</intent>'
        + '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Hard</difficulty>'
        + `<circumstanceModifiers>${modifier(amount, 'A running start')}</circumstanceModifiers></check></resolutionPlan>`;
    assert.equal(parsePlayerActionResolutionPlan(plan('+3')).value[0].argumentsObject.circumstanceModifiers[0].amount, 3);
    for (const invalid of ['+', '++3', '+-3', '3.5', '9007199254740992']) {
        assert.throws(() => parsePlayerActionResolutionPlan(plan(invalid)), /integer/i, invalid);
    }
});

function makeFourVariantPlan(intentPrefix) {
    return [
        '<resolutionPlan>',
        `<check><type>unopposed</type><actor>Tester</actor><intent>${intentPrefix}: climb</intent>`,
        '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Hard</difficulty><circumstanceModifiers/></check>',
        `<check><type>opposed</type><actor>Mira</actor><intent>${intentPrefix}: feint</intent>`,
        '<skill>Deception</skill><attribute>Charisma</attribute><opponent><name>Guard</name><skill>Perception</skill><attribute>Wisdom</attribute></opponent>',
        '<circumstanceModifiers/></check>',
        `<attack><type>single</type><intent>${intentPrefix}: strike</intent><attacker>Tester</attacker>`,
        '<attackerInfo><attackSkill>Swordplay</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
        '<ability>N/A</ability><weapon>Iron Sword</weapon><circumstanceModifiers/>',
        '<targets><target><name>Guard</name><defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>Parry</deflectSkill></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>3</damageEffectiveness></target></targets></attack>',
        `<attack><type>area</type><intent>${intentPrefix}: blast</intent><attacker>Tester</attacker>`,
        '<attackerInfo><attackSkill>Demolitions</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
        '<ability>Grenade</ability><weapon>Concussion Grenade</weapon><areaShape>blast</areaShape>',
        '<effectDescription>A concussive blast</effectDescription><circumstanceModifiers/>',
        '<targets><target><name>Guard</name><position>center</position>',
        '<defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>Parry</deflectSkill><toughnessAttribute>Constitution</toughnessAttribute></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>4</damageEffectiveness></target>',
        '<target><name>Scout</name><position>edge</position>',
        '<defenseInfo><evadeSkill>N/A</evadeSkill><deflectSkill>N/A</deflectSkill><toughnessAttribute>N/A</toughnessAttribute></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>2</damageEffectiveness></target></targets>',
        '<secondaryEffect><name>N/A</name><description>N/A</description><appliesOn>never</appliesOn></secondaryEffect></attack>',
        '</resolutionPlan>'
    ].join('');
}

test('resolution plan parser maps unopposed and opposed checks into canonical resolver calls', () => {
    const parsed = parsePlayerActionResolutionPlan([
        '<resolutionPlan>',
        '<check><type>unopposed</type><actor>player</actor><intent>Climb the wall</intent>',
        '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Hard</difficulty>',
        `<circumstanceModifiers>${modifier(1, 'A running start')}</circumstanceModifiers></check>`,
        '<check><type>opposed</type><actor>Mira</actor><intent>Feint past the guard</intent>',
        '<skill>Deception</skill><attribute>Charisma</attribute>',
        '<opponent><name>Gate Guard</name><skill>Perception</skill><attribute>Wisdom</attribute></opponent>',
        '<circumstanceModifiers/></check>',
        '</resolutionPlan>'
    ].join(''));

    assert.deepEqual(parsed.value, [
        {
            functionName: 'resolveSkillCheck',
            intent: 'Climb the wall',
            argumentsObject: {
                actor: 'player',
                reason: 'Climb the wall',
                skill: 'Athletics',
                attribute: 'Strength',
                difficultyLevel: 'Hard',
                circumstanceModifiers: [{ amount: 1, reason: 'A running start' }]
            }
        },
        {
            functionName: 'resolveOpposedSkillCheck',
            intent: 'Feint past the guard',
            argumentsObject: {
                actor: 'Mira',
                reason: 'Feint past the guard',
                skill: 'Deception',
                attribute: 'Charisma',
                opponent: 'Gate Guard',
                opponentSkill: 'Perception',
                opponentAttribute: 'Wisdom',
                circumstanceModifiers: []
            }
        }
    ]);
});

test('resolution plan parser maps single and area attacks while preserving repeated actions', () => {
    const single = [
        '<attack><type>single</type><intent>Strike the guard with the sword</intent><attacker>player</attacker>',
        '<attackerInfo><attackSkill>Swordplay</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
        '<ability>N/A</ability><weapon>Iron Sword</weapon>',
        `<circumstanceModifiers>${modifier(2, 'High ground')}</circumstanceModifiers>`,
        '<targets><target><name>Guard</name>',
        '<defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>Parry</deflectSkill></defenseInfo>',
        `<circumstanceModifiers>${modifier(-1, 'Distracted')}</circumstanceModifiers>`,
        '<damageEffectiveness>3</damageEffectiveness></target></targets></attack>'
    ].join('');
    const area = [
        '<attack><type>area</type><intent>Throw a grenade into the group</intent><attacker>player</attacker>',
        '<attackerInfo><attackSkill>Demolitions</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
        '<ability>Concussion Grenade</ability><weapon>Grenade</weapon>',
        '<areaShape>blast</areaShape><effectDescription>A concussive blast</effectDescription>',
        `<circumstanceModifiers>${modifier(1, 'Close range')}</circumstanceModifiers>`,
        '<targets>',
        '<target><name>Guard</name><position>center</position>',
        '<defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>N/A</deflectSkill><toughnessAttribute>Constitution</toughnessAttribute></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>4</damageEffectiveness></target>',
        '<target><name>Scout</name><position>edge</position>',
        '<defenseInfo><evadeSkill>N/A</evadeSkill><deflectSkill>N/A</deflectSkill><toughnessAttribute>Constitution</toughnessAttribute></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>2</damageEffectiveness></target>',
        '</targets><secondaryEffect><name>N/A</name><description>N/A</description><appliesOn>never</appliesOn></secondaryEffect></attack>'
    ].join('');
    const xml = `<resolutionPlan>${single}${single}${area}</resolutionPlan>`;
    const parsed = parsePlayerActionResolutionPlan(xml);

    assert.deepEqual(parsed.value.map(action => action.functionName), [
        'resolveAttack', 'resolveAttack', 'resolveAreaAttack'
    ]);
    assert.deepEqual(parsed.value.map(action => action.intent), [
        'Strike the guard with the sword',
        'Strike the guard with the sword',
        'Throw a grenade into the group'
    ]);
    assert.deepEqual(parsed.value[0].argumentsObject.circumstanceModifiers, {
        attackerCircumstanceModifier: [{ amount: 2, reason: 'High ground' }],
        defenderCircumstanceModifier: [{ amount: -1, reason: 'Distracted' }]
    });
    assert.equal(parsed.value[0].argumentsObject.defender, 'Guard');
    assert.deepEqual(parsed.value[1], parsed.value[0], 'repeated separate attacks remain distinct plan entries');
    assert.equal(parsed.value[2].argumentsObject.rollMode, 'sharedAttackRoll');
    assert.deepEqual(parsed.value[2].argumentsObject.targets.map(target => target.name), ['Guard', 'Scout']);
    assert.equal(parsed.normalizedResponse, xml);
});

test('resolution plan parser extracts the latest fenced root from surrounding commentary', () => {
    const xml = '<resolutionPlan><check><type>unopposed</type><actor>Tester</actor><intent>Climb</intent>'
        + '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Hard</difficulty>'
        + '<circumstanceModifiers/></check></resolutionPlan>';
    const response = 'I checked the `<resolutionPlan>` action details first.\n```xml\n'
        + xml + '\n```\nThe ``<resolutionPlan/>`` marker above is only inline documentation.';
    const parsed = parsePlayerActionResolutionPlan(response);

    assert.equal(parsed.value.length, 1);
    assert.equal(parsed.value[0].intent, 'Climb');
    assert.equal(parsed.normalizedResponse, xml);

    const earlierValidThenMalformedFinal = `${xml}\nAnother draft follows:\n<resolutionPlan><check>`;
    assert.throws(
        () => parsePlayerActionResolutionPlan(earlierValidThenMalformedFinal),
        /strictly|malformed/i,
        'a later malformed resolutionPlan must not fall back to the earlier complete plan'
    );

    const wrappedAttributeError = 'Plan notes.\n```xml\n' + xml.replace(
        '<actor>Tester</actor>', '<actor id="player">Tester</actor>'
    ) + '\n```\nDone.';
    assert.throws(
        () => parsePlayerActionResolutionPlan(wrappedAttributeError),
        /cannot have XML attributes/i,
        'comments and fences must not relax strict validation inside the selected XML root'
    );

    const wrappedInvalidField = `Plan notes.\n${xml.replace(
        '<difficulty>Hard</difficulty>', '<difficulty>Impossible</difficulty>'
    )}\nDone.`;
    assert.throws(
        () => parsePlayerActionResolutionPlan(wrappedInvalidField),
        /difficulty.*must be one of/i,
        'field semantics inside the extracted root remain strict'
    );
});

test('resolution plan parser accepts an empty plan and rejects malformed or ambiguous XML before execution', () => {
    assert.deepEqual(parsePlayerActionResolutionPlan('<resolutionPlan/>').value, []);

    const validCheck = '<check><type>unopposed</type><actor>player</actor><intent>Climb</intent>'
        + '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Hard</difficulty>'
        + '<circumstanceModifiers/></check>';
    assert.throws(
        () => parsePlayerActionResolutionPlan(`<resolutionPlan>${validCheck.replace('<actor>player</actor>', '<actor id="player">player</actor>')}</resolutionPlan>`),
        /cannot have XML attributes/i
    );
    assert.throws(
        () => parsePlayerActionResolutionPlan(`<resolutionPlan>${validCheck.replace('<difficulty>Hard</difficulty>', '<difficulty>Hard</difficulty><difficulty>Easy</difficulty>')}</resolutionPlan>`),
        /at most one <difficulty>/i
    );
    assert.throws(
        () => parsePlayerActionResolutionPlan(`<resolutionPlan>${validCheck}<check><type>unsupported</type></check></resolutionPlan>`),
        /must be a check of type/i
    );
    assert.throws(
        () => parsePlayerActionResolutionPlan('<resolutionPlan><check type="unopposed"/></resolutionPlan>'),
        /cannot have XML attributes/i
    );
    assert.throws(
        () => parsePlayerActionResolutionPlan('<resolutionPlan><check><type>unopposed</type>'),
        /strictly/i
    );
});

test('resolution receipts use model-facing mechanic labels and preserve full internal details', () => {
    const invocations = [
        {
            id: 'receipt-1', name: 'resolveSkillCheck', intent: 'Climb the wall',
            argumentsObject: { actor: 'Tester', skill: 'Athletics', difficultyLevel: 'Hard' },
            content: 'success\nTotal: 18'
        },
        {
            id: 'receipt-2', name: 'resolveOpposedSkillCheck', intent: 'Feint past the guard',
            argumentsObject: { actor: 'Tester', opponent: 'Guard', skill: 'Deception' },
            content: 'failure\nTester rolled 12; Guard rolled 15'
        },
        {
            id: 'receipt-3', name: 'resolveAttack', intent: 'Strike the guard',
            argumentsObject: { attacker: 'Tester', defender: 'Guard', weapon: 'Iron Sword' },
            content: 'hit\nDamage: 5'
        },
        {
            id: 'receipt-4', name: 'resolveAreaAttack', intent: 'Throw a grenade',
            argumentsObject: { attacker: 'Tester', targets: ['Guard', 'Scout'], rollMode: 'sharedAttackRoll' },
            content: 'Guard: hit\nScout: missed'
        }
    ];
    const originalInvocations = structuredClone(invocations);
    const formatted = formatPlayerActionResolutionResults(invocations);

    for (const [id, label, intent, content] of [
        ['receipt-1', 'unopposed check', 'Climb the wall', 'success\nTotal: 18'],
        ['receipt-2', 'opposed check', 'Feint past the guard', 'failure\nTester rolled 12; Guard rolled 15'],
        ['receipt-3', 'single-target attack', 'Strike the guard', 'hit\nDamage: 5'],
        ['receipt-4', 'area attack', 'Throw a grenade', 'Guard: hit\nScout: missed']
    ]) {
        assert.match(formatted, new RegExp(`Action ${id}: ${label}`));
        assert.match(formatted, new RegExp(`Intent: ${intent}`));
        assert.ok(formatted.includes(content));
    }
    assert.match(formatted, /Resolution details: \{"actor":"Tester"/);
    assert.doesNotMatch(formatted, /\bresolve(?:OpposedSkillCheck|SkillCheck|AreaAttack|Attack)\b/);
    assert.doesNotMatch(formatted, /\bArguments:/);
    assert.deepEqual(invocations, originalInvocations, 'formatting receipts must not mutate authoritative tool invocation records');
});

test('resolution plan executor validates the full batch before applying any action', async () => {
    const state = createResolutionPlanExecutionState('run-preflight');
    const executed = [];
    const actions = [
        { functionName: 'resolveAttack', argumentsObject: { attacker: 'player', defender: 'Guard' } },
        { functionName: 'resolveSkillCheck', argumentsObject: { actor: 'Missing NPC' } }
    ];

    await assert.rejects(
        executePlayerActionResolutionPlan(actions, {
            state,
            checkpointId: 'initial',
            validateAction(action) {
                if (action.argumentsObject.actor === 'Missing NPC') throw new Error('Actor "Missing NPC" is not present.');
            },
            async executeAction(call) {
                executed.push(call);
                return { content: 'Resolved.', metadata: { success: true } };
            }
        }),
        error => {
            assert.match(error.message, /Actor "Missing NPC" is not present/);
            assert.match(error.message, /remaining unexecuted resolution-plan suffix/);
            assert.equal(error.resolutionPlanPendingOnly, true);
            assert.deepEqual(error.completedResolutionInvocations, []);
            return true;
        }
    );
    assert.deepEqual(executed, [], 'the later invalid action must prevent earlier side effects');
});

test('actual reference validation rejects a later unknown skill before any resolution executes', async () => {
    const parsed = parsePlayerActionResolutionPlan([
        '<resolutionPlan>',
        '<attack><type>single</type><intent>Strike the guard</intent><attacker>Tester</attacker>',
        '<attackerInfo><attackSkill>Swordplay</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
        '<ability>N/A</ability><weapon>Iron Sword</weapon><circumstanceModifiers/>',
        '<targets><target><name>Guard</name><defenseInfo><evadeSkill>N/A</evadeSkill><deflectSkill>Parry</deflectSkill></defenseInfo>',
        '<circumstanceModifiers/><damageEffectiveness>3</damageEffectiveness></target></targets></attack>',
        '<check><type>unopposed</type><actor>Tester</actor><intent>Pick the lock</intent>',
        '<skill>Unknown Skill</skill><attribute>N/A</attribute><difficulty>Hard</difficulty>',
        '<circumstanceModifiers/></check>',
        '</resolutionPlan>'
    ].join(''));
    const actors = new Map([
        ['Tester', { id: 'player-1', isDead: false }],
        ['Guard', { id: 'npc-1', isDead: false }]
    ]);
    const skillNames = new Set(['Swordplay', 'Parry']);
    const attributeNames = new Set(['Strength']);
    const validation = {
        resolveActor: name => actors.get(name) || null,
        resolveSkillDefinition: name => skillNames.has(name) ? { name } : null,
        resolveAttributeKey: (_actor, name) => attributeNames.has(name) ? name : null,
        assertActorCanAttack() {}
    };

    assert.doesNotThrow(() => validatePlayerActionResolutionReferences(parsed.value[0], validation));
    assert.throws(
        () => validatePlayerActionResolutionReferences(parsed.value[1], validation),
        /unknown skill "Unknown Skill"/
    );
    const executed = [];
    const state = createResolutionPlanExecutionState('run-invalid-reference');
    await assert.rejects(
        executePlayerActionResolutionPlan(parsed.value, {
            state,
            checkpointId: 'initial',
            validateAction: action => validatePlayerActionResolutionReferences(action, validation),
            async executeAction(call) {
                executed.push(call);
                return { content: 'Resolved.', metadata: {} };
            }
        }),
        /unknown skill "Unknown Skill"/i
    );
    assert.deepEqual(executed, [], 'a semantically invalid later action blocks earlier mechanics');
});

test('actual reference validation permits N/A check selectors when the other selector is known', () => {
    const { value: [check] } = parsePlayerActionResolutionPlan(
        '<resolutionPlan><check><type>unopposed</type><actor>Tester</actor><intent>Push through</intent>'
        + '<skill>N/A</skill><attribute>Strength</attribute><difficulty>Hard</difficulty>'
        + '<circumstanceModifiers/></check></resolutionPlan>'
    );
    assert.doesNotThrow(() => validatePlayerActionResolutionReferences(check, {
        resolveActor: name => name === 'Tester' ? { id: 'player-1' } : null,
        resolveSkillDefinition: () => null,
        resolveAttributeKey: (_actor, name) => name === 'Strength' ? name : null,
        assertActorCanAttack() {}
    }));
});

test('actual reference validation rejects N/A attack mechanics but permits optional N/A defenses', () => {
    const { value } = parsePlayerActionResolutionPlan(makeFourVariantPlan('validation'));
    const attack = value.find(action => action.functionName === 'resolveAttack');
    const validReferences = {
        resolveActor: name => ({ id: name, isDead: false }),
        resolveSkillDefinition: name => name === 'N/A' ? null : { name },
        resolveAttributeKey: (_actor, name) => name === 'N/A' ? null : name,
        assertActorCanAttack() {}
    };
    assert.doesNotThrow(() => validatePlayerActionResolutionReferences(attack, validReferences));

    const missingAttackSkill = structuredClone(attack);
    missingAttackSkill.argumentsObject.attackerInfo.attackSkill = 'N/A';
    assert.throws(
        () => validatePlayerActionResolutionReferences(missingAttackSkill, validReferences),
        /planned attack requires both a known attackSkill and damageAttribute/i
    );
    const missingDamageAttribute = structuredClone(attack);
    missingDamageAttribute.argumentsObject.attackerInfo.damageAttribute = 'N/A';
    assert.throws(
        () => validatePlayerActionResolutionReferences(missingDamageAttribute, validReferences),
        /planned attack requires both a known attackSkill and damageAttribute/i
    );
});

test('TinyBrain runner executes three mixed resolution-plan beats and feeds authoritative results into later drafts', async () => {
    const endMarker = LLMClient.getBaseContextEndMarker();
    const environment = new nunjucks.Environment(new MemoryLoader({
        'wrapper.xml.njk': [
            '<template><systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Fixed game context. ', endMarker,
            '{{ __tinyBrainState.programStartMarker }}{% include "program.njk" %}',
            ']]></generationPrompt></template>'
        ].join(''),
        'program.njk': [
            'Draft one. {% llm_dummy_action as openingDraft %}',
            'Resolve opening draft: {% llmparse(\'player_action_resolution_plan\') as initialResolutions %}',
            'Use initial results {{ initialResolutions | dump }} while revising. {% llm_dummy_action as revisedDraft %}',
            'Resolve revised draft: {% llmparse(\'player_action_resolution_plan\') as draftResolutions %}',
            'Use revision results {{ draftResolutions | dump }} during the audit and final draft. {% llm_dummy_action as auditedDraft %}',
            'Resolve final draft: {% llmparse(\'player_action_resolution_plan\') as revisionResolutions %}',
            '{% llmresult(\'local_result\') %}'
        ].join(' ')
    }), { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const actorNames = ['Tester', 'Mira', 'Guard', 'Scout'];
    const actors = new Map(actorNames.map(name => [name, { id: name.toLowerCase(), isDead: false }]));
    const skills = new Set(['Athletics', 'Deception', 'Perception', 'Swordplay', 'Dodge', 'Parry', 'Demolitions']);
    const attributes = new Set(['Strength', 'Charisma', 'Wisdom', 'Constitution']);
    const validation = {
        resolveActor: name => actors.get(name) || null,
        resolveSkillDefinition: name => skills.has(name) ? { name } : null,
        resolveAttributeKey: (_actor, name) => attributes.has(name) ? name : null,
        assertActorCanAttack() {}
    };
    const executionState = createResolutionPlanExecutionState(renderState.runId);
    const effectCalls = [];
    const events = [];
    const logSections = [];
    const userDieOverrides = [];
    const forcedRollRequests = [];
    const actionResolution = {
        label: 'success',
        degree: 'success',
        success: true,
        roll: { die: 17, total: 21 },
        difficulty: { label: 'Hard', dc: 20 },
        skill: 'Athletics',
        attribute: 'Strength'
    };
    const toolRuntime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 2 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'tester', name: 'Tester', currentLocation: 'origin' }),
        createLocationFromEvent: async () => { throw new Error('unexpected location creation'); },
        createRegionStubFromEvent: async () => { throw new Error('unexpected region creation'); },
        generateItemsByNames: async () => [],
        ensureExitConnection() { throw new Error('unexpected exit creation'); },
        findRegionByLocationId: () => null,
        resolveAttack: async ({ attackEntry, dieRollOverride }) => {
            userDieOverrides.push({ functionName: 'resolveAttack', dieRollOverride });
            return {
                hit: true,
                damage: 8,
                application: {
                    targetId: 'guard',
                    targetName: attackEntry.defender,
                    damageApplied: 8,
                    maxHealthBefore: 100,
                    maxHealthAfter: 100,
                    endingHealth: 92,
                    healthLostPercent: 8,
                    remainingHealthPercent: 92
                },
                locationRefreshRequested: true,
                summary: { hit: true, attacker: { name: attackEntry.attacker }, defender: { name: attackEntry.defender }, damage: { total: 8, applied: 8 } }
            };
        },
        resolveAreaAttack: async ({ areaAttackEntry, dieRollOverride }) => {
            userDieOverrides.push({ functionName: 'resolveAreaAttack', dieRollOverride });
            return {
                hitCount: 1,
                targetCount: areaAttackEntry.targets.length,
                locationRefreshRequested: true,
                results: areaAttackEntry.targets.map((target, index) => ({
                    target: target.name,
                    hit: index === 0,
                    damageApplied: index === 0 ? 5 : 0,
                    remainingHealthPercent: index === 0 ? 95 : 100,
                    defeated: false
                }))
            };
        },
        resolvePlausibilityCheck: async ({ dieRollOverride }) => {
            userDieOverrides.push({ functionName: 'resolveSkillCheck', dieRollOverride });
            return { actionResolution };
        },
        resolveOpposedPlausibilityCheck: async ({ dieRollOverride }) => {
            userDieOverrides.push({ functionName: 'resolveOpposedSkillCheck', dieRollOverride });
            return { actionResolution };
        },
        LLMClient: { logPrompt() {}, formatMessagesForErrorLog: messages => JSON.stringify(messages) },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
    const providerPrompts = [];
    let planCount = 0;
    let planStage = 0;
    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: rendered => {
            const systemPrompt = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)?.[1];
            const generationPrompt = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)?.[1];
            if (!systemPrompt || !generationPrompt) throw new Error('Runner test prompt wrapper is malformed.');
            return { systemPrompt, generationPrompt };
        },
        retryAttempts: 1,
        metadataLabel: 'player_action',
        parsers: { player_action_resolution_plan: parsePlayerActionResolutionPlan },
        resultBuilders: {
            local_result({ assignments }) {
                return `<resolutionSummary>${assignments.initialResolutions.length},${assignments.draftResolutions.length},${assignments.revisionResolutions.length}</resolutionSummary>`;
            }
        },
        logPrompt(options) {
            if (options.append === true) logSections.push(...(options.sections || []));
            return options.filePath || '/test/logs/resolution-plan-runner.log';
        },
        async afterParse({ parsed, checkpoint, messages, appendLogSection }) {
            if (checkpoint.parserName !== 'player_action_resolution_plan') return null;
            const execution = await executePlayerActionResolutionPlan(parsed.value, {
                state: executionState,
                checkpointId: checkpoint.index,
                validateAction: action => validatePlayerActionResolutionReferences(action, validation),
                async executeAction(toolCall, { resultCache }) {
                    effectCalls.push(toolCall);
                    return toolRuntime.executeChatToolCall(toolCall, {
                        resultCache,
                        defaultActorName: 'Tester',
                        dieRollOverride: 17,
                        forcedSkillCheckRoll: async request => {
                            forcedRollRequests.push(request);
                            return 19;
                        }
                    });
                },
                onAction(event) { events.push(event); }
            });
            parsed.value = execution.invocations;
            const results = formatPlayerActionResolutionResults(execution.invocations);
            appendLogSection({ title: 'authoritative resolution results', content: results });
            const receipt = { role: 'user', content: `Authoritative completed mechanics:\n${results}` };
            return {
                conversationMessages: [...messages, receipt],
                retainedMessages: [{ key: 'player-action-resolutions', message: receipt }],
                toolInvocations: execution.invocations
            };
        },
        async complete({ messages, checkpoint, attempt }) {
            providerPrompts.push({ messages, checkpoint, attempt });
            let aiResponse = '';
            if (checkpoint.parserName === 'player_action_resolution_plan') {
                planCount += 1;
                if (attempt === 0) planStage += 1;
                aiResponse = planStage === 2 && attempt === 0
                    ? '<resolutionPlan><check><type>unopposed</type><actor>Tester</actor><intent>climb</intent><skill>Athletics</skill><attribute>Strength</attribute></check></resolutionPlan>'
                    : makeFourVariantPlan(`beat-${planStage}`);
            } else {
                aiResponse = `Draft ${checkpoint.index + 1}.`;
            }
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(result.aiResponse, '<resolutionSummary>4,4,4</resolutionSummary>');
    assert.equal(planCount, 4, 'three plan beats run, with one parser correction retry');
    assert.equal(effectCalls.length, 12);
    assert.equal(result.toolInvocations.length, 12);
    assert.equal(userDieOverrides.length, 12);
    assert.ok(userDieOverrides.filter(entry => entry.functionName.includes('Attack'))
        .every(entry => entry.dieRollOverride === 17), 'the integer die override reaches attack resolvers');
    assert.ok(userDieOverrides.filter(entry => entry.functionName.includes('SkillCheck'))
        .every(entry => entry.dieRollOverride === 19), 'interactive forced rolls take precedence for skill checks');
    assert.equal(forcedRollRequests.length, 6);
    assert.deepEqual(result.toolInvocations.map(invocation => invocation.name), Array(3).fill([
        'resolveSkillCheck', 'resolveOpposedSkillCheck', 'resolveAttack', 'resolveAreaAttack'
    ]).flat());
    assert.equal(events.length, 24);
    const resolutionLogs = logSections.filter(section => section.title === 'authoritative resolution results');
    assert.equal(resolutionLogs.length, 3);
    assert.ok(resolutionLogs.every(section => (
        /Action .*: (?:unopposed check|opposed check|single-target attack|area attack)/.test(section.content)
    )));
    assert.deepEqual(events.filter(event => event.phase === 'started').map(event => event.toolCall.id),
        result.toolInvocations.map(invocation => invocation.id));
    assert.ok(result.toolInvocations.filter(invocation => ['resolveAttack', 'resolveAreaAttack'].includes(invocation.name))
        .every(invocation => invocation.metadata.locationRefreshRequested === true));
    assert.ok(result.toolInvocations.filter(invocation => ['resolveSkillCheck', 'resolveOpposedSkillCheck'].includes(invocation.name))
        .every(invocation => invocation.metadata.actionResolution.label === 'success'));
    assert.ok(providerPrompts.some(({ messages, checkpoint }) => (
        checkpoint.parserName === 'player_action_resolution_plan'
        && messages.some(message => message.content.includes('requires <difficulty>'))
    )), 'the malformed plan must receive exact parser feedback on retry');

    for (const checkpoint of ['1', '3', '5']) {
        const resultMessage = providerPrompts.find(({ checkpoint: definition }) => (
            definition.parserName === 'player_action_resolution_plan' && String(definition.index) === checkpoint
        ));
        assert.ok(resultMessage);
    }
    const laterDraftPrompts = providerPrompts.filter(({ checkpoint }) => checkpoint.kind === 'dummy');
    assert.ok(laterDraftPrompts.some(({ messages }) => messages.some(message => (
        message.content.includes('Authoritative completed mechanics:')
        && message.content.includes('Action ')
        && message.content.includes('Intent: beat-1: climb')
        && message.content.includes('Damage: 8')
    ))));
    assert.ok(laterDraftPrompts.some(({ messages }) => messages.some(message => (
        message.content.includes('Authoritative completed mechanics:')
        && message.content.includes('Intent: beat-2: climb')
        && message.content.includes('Outcome guidance:')
    ))));
});

test('resolution plan executor retries only a known unexecuted suffix with stable ordinal IDs', async () => {
    const state = createResolutionPlanExecutionState('run-suffix');
    const first = { functionName: 'resolveAttack', argumentsObject: { attacker: 'player', defender: 'Guard' } };
    const second = { functionName: 'resolveOpposedSkillCheck', argumentsObject: { actor: 'Mira', opponent: 'Guard' } };
    const attempted = [];
    const completed = [];
    let executedCount = 0;
    const validateAction = async action => {
        if (action.functionName === second.functionName && executedCount > 0) {
            throw new Error('Guard is no longer present for the remaining check.');
        }
    };
    const executeAction = async call => {
        attempted.push(call);
        executedCount += 1;
        return { content: `receipt:${call.functionName}`, metadata: { status: 'success' } };
    };

    await assert.rejects(
        executePlayerActionResolutionPlan([first, second], {
            state,
            checkpointId: 'plan-1',
            validateAction,
            executeAction
        }),
        error => {
            completed.push(...error.completedResolutionInvocations);
            assert.equal(error.resolutionPlanPendingOnly, true);
            assert.match(error.message, /return only the remaining unexecuted resolution-plan suffix/i);
            assert.equal(error.completedResolutionInvocations.length, 1);
            assert.match(error.completedResolutionInvocations[0].id, /run-suffix:resolution:plan-1:0/);
            return true;
        }
    );

    const correctedSuffix = [{
        functionName: 'resolveOpposedSkillCheck',
        argumentsObject: { actor: 'Mira', opponent: 'Scout' }
    }];
    const result = await executePlayerActionResolutionPlan(correctedSuffix, {
        state,
        checkpointId: 'plan-1',
        validateAction: async () => {},
        executeAction
    });

    assert.equal(attempted.length, 2, 'only the first action and corrected remaining action execute');
    assert.match(attempted[0].id, /:0$/);
    assert.match(attempted[1].id, /:1$/);
    assert.notEqual(attempted[0].id, attempted[1].id);
    assert.deepEqual(
        result.invocations.map(invocation => invocation.argumentsObject.defender || invocation.argumentsObject.opponent),
        ['Guard', 'Scout']
    );
    assert.match(formatPlayerActionResolutionResults(result.invocations), /single-target attack[\s\S]*opposed check/);

    const repeated = await executePlayerActionResolutionPlan(correctedSuffix, {
        state,
        checkpointId: 'plan-1',
        validateAction: async () => { throw new Error('Completed receipts must not be revalidated or rerolled.'); },
        executeAction
    });
    assert.deepEqual(repeated.invocations, result.invocations);
    assert.equal(attempted.length, 2, 'retrying a completed checkpoint must not repeat effects');
});

test('identical resolution actions in separate ordinals execute separately and an indeterminate failure is fatal', async () => {
    const duplicate = { functionName: 'resolveSkillCheck', argumentsObject: { actor: 'player', reason: 'Open the latch' } };
    const state = createResolutionPlanExecutionState('run-duplicates');
    const executed = [];
    const result = await executePlayerActionResolutionPlan([duplicate, duplicate], {
        state,
        checkpointId: 'first-draft',
        validateAction: async () => {},
        async executeAction(call, { resultCache }) {
            executed.push({ call, resultCache });
            return { content: `roll-${executed.length}`, metadata: { status: 'success' } };
        }
    });
    assert.equal(executed.length, 2);
    assert.notEqual(executed[0].call.id, executed[1].call.id);
    assert.notEqual(executed[0].resultCache.roundKey, executed[1].resultCache.roundKey);
    assert.deepEqual(result.invocations.map(invocation => invocation.content), ['roll-1', 'roll-2']);

    const failedState = createResolutionPlanExecutionState('run-uncertain');
    let effectAttempts = 0;
    const lifecycleEvents = [];
    const indeterminate = [{ functionName: 'resolveAttack', argumentsObject: { attacker: 'player', defender: 'Guard' } }];
    const executeUncertain = async () => {
        effectAttempts += 1;
        throw new Error('Resolver failed after mutation began.');
    };
    await assert.rejects(
        executePlayerActionResolutionPlan(indeterminate, {
            state: failedState,
            checkpointId: 'draft',
            validateAction: async () => {},
            executeAction: executeUncertain,
            onAction: event => lifecycleEvents.push(event)
        }),
        error => {
            assert.equal(error.fatalTinyBrainExecution, true);
            assert.match(error.message, /effects cannot safely be replayed/);
            return true;
        }
    );
    await assert.rejects(
        executePlayerActionResolutionPlan(indeterminate, {
            state: failedState,
            checkpointId: 'draft',
            validateAction: async () => {},
            executeAction: executeUncertain
        }),
        /effects cannot safely be replayed/
    );
    assert.equal(effectAttempts, 1, 'indeterminate mechanics must never be retried automatically');
    assert.deepEqual(lifecycleEvents.map(event => event.phase), ['started', 'error']);
    assert.match(lifecycleEvents[1].error.message, /Resolver failed after mutation began/);
});

test('a failed completion notification retains its committed receipt and never reruns the resolver', async () => {
    const state = createResolutionPlanExecutionState('run-notification-failure');
    const actions = [{ functionName: 'resolveSkillCheck', argumentsObject: { actor: 'player', reason: 'Hold the bridge' } }];
    const lifecycleEvents = [];
    let effects = 0;
    const options = {
        state,
        checkpointId: 'initial',
        validateAction: async () => {},
        async executeAction() {
            effects += 1;
            return { content: 'Strength succeeded at 14.', metadata: { status: 'success' } };
        },
        async onAction(event) {
            lifecycleEvents.push(event);
            if (event.phase === 'completed') throw new Error('Could not publish completed result event.');
        }
    };

    await assert.rejects(executePlayerActionResolutionPlan(actions, options), error => {
        assert.equal(error.fatalTinyBrainExecution, true);
        assert.equal(error.completedResolutionInvocations.length, 1);
        assert.match(error.completedResolutionInvocations[0].content, /succeeded at 14/);
        assert.match(error.message, /effects cannot safely be replayed/);
        assert.match(error.cause.message, /Could not publish completed result event/);
        return true;
    });
    await assert.rejects(executePlayerActionResolutionPlan(actions, options), /effects cannot safely be replayed/);

    assert.equal(effects, 1);
    assert.deepEqual(lifecycleEvents.map(event => event.phase), ['started', 'completed', 'error']);
    assert.equal(lifecycleEvents[2].invocation.content, 'Strength succeeded at 14.');
});

test('ordered check, technique and attack plans use the real technique service and replay all receipts once', async () => {
    await withTechniqueWorld(async ({ player, target }) => {
        const definition = addDefinition('technique-plan-heal', mechanics({
            effects: [{ id: 'mend', kind: 'healing', amount: 3 }]
        }));
        learn(player, definition.id);
        player.setHealth(player.health - 8);
        const playerHealth = player.health;
        const attackXml = [
            '<attack><type>single</type><intent>Strike the target.</intent><attacker>Integration Player</attacker>',
            '<attackerInfo><attackSkill>Swordplay</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo>',
            '<ability>N/A</ability><weapon>Iron Sword</weapon><circumstanceModifiers/>',
            '<targets><target><name>Integration Target</name>',
            '<defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>Parry</deflectSkill></defenseInfo>',
            '<circumstanceModifiers/><damageEffectiveness>3</damageEffectiveness></target></targets></attack>'
        ].join('');
        const checkXml = '<check><type>unopposed</type><actor>Integration Player</actor><intent>Find an opening.</intent>'
            + '<skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>';
        const techniqueXml = `<technique><actor>${player.name}</actor><intent>Mend my wounds.</intent><techniqueId>${definition.id}</techniqueId><newAttempt>true</newAttempt><targets><targetId>${player.id}</targetId></targets></technique>`;
        const xml = `<resolutionPlan>${checkXml}${techniqueXml}${attackXml}</resolutionPlan>`;
        const actions = parsePlayerActionResolutionPlan(xml).value;
        assert.deepEqual(actions.map(action => action.functionName), ['resolveSkillCheck', 'useTechnique', 'resolveAttack']);
        assert.deepEqual(actions[1].argumentsObject, {
            actor: player.name,
            intent: 'Mend my wounds.',
            newAttempt: true,
            techniqueId: definition.id,
            targetIds: [player.id]
        });

        const state = createResolutionPlanExecutionState('integration-plan-run');
        const executions = [];
        const validateAction = async action => {
            if (action.functionName === 'useTechnique') {
                const actor = player;
                const reference = resolveTechniqueAttemptIdentity({ ...action.argumentsObject, actor, turnId: 'player-turn-plan-integration' });
                if (reference) return;
                action.argumentsObject.targetIds.forEach(id => assert.equal(id, player.id));
                TechniqueService.preview({ ...action.argumentsObject, actor });
            }
            validatePlayerActionResolutionReferences(action, {
                resolveActor: () => player,
                resolveSkillDefinition: () => true,
                resolveAttributeKey: () => true,
                assertActorCanAttack: () => player
            });
        };
        const executeAction = async call => {
            executions.push(call.functionName);
            if (call.functionName === 'useTechnique') {
                if (call.argumentsObject.operationId) {
                    const replay = TechniqueService.getReceipt(call.argumentsObject.operationId);
                    const invocation = receiptInvocation(replay, call.argumentsObject.intent);
                    return { content: invocation.content, metadata: invocation.metadata };
                }
                const receipt = await TechniqueService.execute({
                    ...call.argumentsObject,
                    actor: player,
                    operationId: call.id,
                    turnId: 'player-turn-plan-integration'
                });
                const invocation = receiptInvocation(receipt, call.argumentsObject.intent);
                return { content: invocation.content, metadata: invocation.metadata };
            }
            return { content: `${call.functionName} authoritative result.`, metadata: { status: 'success' } };
        };
        const result = await executePlayerActionResolutionPlan(actions, {
            state,
            checkpointId: 'mixed-actions',
            validateAction,
            executeAction
        });
        assert.deepEqual(executions, ['resolveSkillCheck', 'useTechnique', 'resolveAttack']);
        assert.equal(result.invocations[1].metadata.techniqueReceipt.committed, true);
        assert.equal(result.invocations[1].metadata.techniqueReceipt.turnId, 'player-turn-plan-integration');
        assert.equal(player.health, playerHealth + 3);
        assert.equal(TechniqueService.getReceiptsForTurn('player-turn-plan-integration').length, 1);
        assert.match(formatPlayerActionResolutionResults(result.invocations), /useTechnique|technique/i);

        const committedTechnique = result.invocations[1].metadata.techniqueReceipt;
        const referencePlan = parsePlayerActionResolutionPlan(
            `<resolutionPlan><technique><actor>${player.name}</actor><intent>Repeat the recorded mend result.</intent><techniqueId>${definition.id}</techniqueId><operationId>${committedTechnique.operationId}</operationId><targets><targetId>${player.id}</targetId></targets></technique></resolutionPlan>`
        ).value;
        const referenceResult = await executePlayerActionResolutionPlan(referencePlan, {
            state,
            checkpointId: 'reference-committed-technique',
            validateAction,
            executeAction
        });
        assert.equal(referenceResult.invocations[0].metadata.techniqueReceipt.operationId, committedTechnique.operationId);
        assert.equal(player.health, playerHealth + 3, 'an XML operationId returns its exact saved receipt without a second effect');
        assert.equal(TechniqueService.getReceiptsForTurn('player-turn-plan-integration').length, 1);

        const replay = await executePlayerActionResolutionPlan(actions, {
            state,
            checkpointId: 'mixed-actions',
            validateAction: async () => { throw new Error('A completed ordered plan must replay saved receipts without revalidation.'); },
            executeAction
        });
        assert.deepEqual(replay.invocations, result.invocations);
        assert.deepEqual(executions, ['resolveSkillCheck', 'useTechnique', 'resolveAttack', 'useTechnique']);
        assert.equal(player.health, playerHealth + 3, 'replaying the committed plan does not repeat the technique effect');
    });
});
