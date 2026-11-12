const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Player = require('../Player.js');
const IdGenerator = require('../IdGenerator.js');
const Utils = require('../Utils.js');
const StatusEffect = require('../StatusEffect.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const { withResponseRetryFeedback } = require('../XmlRetryFeedback.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

function extractFunction(name) {
    let start = source.indexOf(`async function ${name}(`);
    if (start < 0) start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Expected production function ${name} to exist.`);
    const paramsStart = source.indexOf('(', start);
    let paramsDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        if (source[index] === '(') paramsDepth += 1;
        if (source[index] === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.ok(paramsEnd >= 0, `Expected ${name} parameters to close.`);
    const bodyStart = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Unable to find the end of ${name}.`);
}

function buildAbilityXml(abilities, { skill = '' } = {}) {
    const abilityXml = abilities.map(name => `<ability><name>${name}</name><description>${name} description</description><shortDescription>${name} short</shortDescription><type>Passive</type><level>2</level></ability>`).join('');
    const skillXml = skill ? `<skills><skill><name>${skill}</name><points>1</points></skill></skills>` : '';
    return `<npcs><npc><name>Rook</name><abilities>${abilityXml}</abilities>${skillXml}</npc></npcs>`;
}

function runFunctions(functionNames, context, expression) {
    vm.createContext(context);
    vm.runInContext(`${functionNames.map(extractFunction).join('\n')}\n${expression}`, context);
    return context;
}

test('NPC generation preflights faction and need-bar candidates within the bounded parse correction conversation', { concurrency: false }, async () => {
    const beforePlayerIds = IdGenerator.snapshotCounters().char || 0;
    const beforePlayerCount = Player.getAll().length;
    const responses = [
        '<npcs><npc><name>Rook</name><faction></faction></npc></npcs>',
        '<npcs><npc><name>Rook</name><faction>None</faction><startingNeeds><needBar><id>unknown_test_bar</id><startingLevel>40%</startingLevel></needBar></startingNeeds></npc></npcs>',
        '<npcs><npc><name>Rook</name><faction>None</faction></npc></npcs>'
    ];
    const requestMessages = [];
    const playerConstructionInputs = [];

    const parseNpcCandidateResponse = xml => {
        const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        const node = doc.getElementsByTagName('npc')[0];
        const text = tag => node.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
        const needNode = node.getElementsByTagName('needBar')[0];
        const needBars = needNode ? [{
            id: needNode.getElementsByTagName('id')[0]?.textContent?.trim() || '',
            percentage: needNode.getElementsByTagName('startingLevel')[0]?.textContent?.replace('%', '').trim() || ''
        }] : null;
        const npc = { name: text('name'), faction: text('faction'), needBars };
        playerConstructionInputs.push(npc);
        return { npcs: [npc] };
    };

    const context = runFunctions([
        'resolveFactionNameToId',
        'resolveGeneratedNpcStartingNeedBars',
        'validateGeneratedNpcConstructionCandidates',
        'runNpcGenerationPromptWithParseRetries'
    ], {
        console: { warn() {}, log() {} },
        Utils,
        Player,
        StatusEffect,
        Faction: { getByName: () => null },
        factions: new Map(),
        normalizeFactionNameForLookup: value => String(value || '').trim().toLowerCase(),
        getRegisteredPlayerEntityFields: () => [],
        getPlayerExtensionFieldInputsFromSource: () => ({}),
        PromptFailureReporter: {
            run: (_options, callback) => callback(),
            validationRetry() {}
        },
        resolveConfiguredPromptMaxAttempts: () => 3,
        config: { ai: { retryAttempts: 2 } },
        runPromptWithParseRetries,
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            requestMessages.push(requestOptions.messages.map(message => ({ ...message })));
            assert.equal(Player.getAll().length, beforePlayerCount);
            assert.equal(IdGenerator.snapshotCounters().char || 0, beforePlayerIds,
                'invalid NPC candidates do not allocate Player IDs before correction');
            return responses.shift();
        },
        LLMClient: {
            resolveEffectiveAiConfiguration: () => ({ aiConfig: { retryAttempts: 2 } }),
            logPrompt: () => '/tmp/npc-preflight-validation.log'
        },
        formatGenerationPromptMessageForLog: message => String(message.content || ''),
        parseResponse: parseNpcCandidateResponse
    }, 'this.runNpcGenerationPromptWithParseRetries = runNpcGenerationPromptWithParseRetries;');

    const result = await context.runNpcGenerationPromptWithParseRetries({
        messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'generate NPC' }],
        metadataLabel: 'location_npc_generation',
        responseRootTag: 'npcs',
        responseLabel: 'Location NPC generation',
        systemPrompt: 'system',
        parseResponse: context.parseResponse
    });

    assert.equal(result.attempts, 3);
    assert.equal(playerConstructionInputs.length, 3);
    assert.match(requestMessages[1].at(-1).content, /NPC faction for "Rook" is required/);
    assert.match(requestMessages[2].at(-1).content, /Unknown generated NPC starting need bar "unknown_test_bar"/);
    assert.equal(result.value.npcs[0].name, 'Rook');
    assert.equal(Player.getAll().length, beforePlayerCount);
    assert.equal(IdGenerator.snapshotCounters().char || 0, beforePlayerIds,
        'the retry helper returns a detached candidate; actor construction remains downstream of acceptance');
});

test('player ability options retry uniqueness and preserve partial accepted choices for the remaining count', { concurrency: false }, async () => {
    const retryCalls = [];
    const responses = [
        '<npcs><npc><name>Rook</name><abilities>',
        '<wrong><item>',
        buildAbilityXml(['Quick Step', 'quick step']),
        buildAbilityXml(['Quick Step']),
        buildAbilityXml(['Quick Step', 'Braced Guard']) + '\nDONE'
    ];
    const context = runFunctions([
        'normalizeAbilityNameForLookup',
        'getCharacterDeclinedAbilityNames',
        'ensureUniqueAbilityNames',
        'resolveAssignmentEntry',
        'parseNpcAbilityAssignments',
        'parseLevelUpAbilityResponse',
        'generatePlayerAbilityOptionsForLevel'
    ], {
        Utils,
        withResponseRetryFeedback,
        IdGenerator,
        normalizeActorNameForComparison: value => String(value || '').trim().toLowerCase(),
        config: { ai: { retryAttempts: 4 } },
        playerAbilitySelectionPromises: new Map(),
        PromptFailureReporter: {
            run: (_options, callback) => callback(),
            validationRetry() {}
        },
        PromptAuditLog: {
            runPrompt: (_options, callback) => callback(),
            runStage: (_options, callback) => callback(),
            setAttempt() {},
            recordFailure() {},
            acceptStage() {}
        },
        resolveConfiguredPromptMaxAttempts: () => 5,
        LLMClient: {
            resolveEffectiveAiConfiguration: () => ({ aiConfig: { retryAttempts: 4 } }),
            logPrompt() {}
        },
        requestLevelUpAbilityAssignmentsForCharacter: async request => {
            retryCalls.push(request);
            return {
                trimmedName: 'Rook',
                messages: [{ role: 'system', content: 'system' }, ...request.retryFeedback],
                response: responses.shift()
            };
        }
    }, 'this.generatePlayerAbilityOptionsForLevel = generatePlayerAbilityOptionsForLevel;');

    const options = await context.generatePlayerAbilityOptionsForLevel({
        id: 'char_ability_option_retry',
        name: 'Rook',
        isNPC: false,
        getDeclinedAbilityNames: () => []
    }, { targetLevel: 2, optionsToGenerate: 2 });

    assert.deepEqual(JSON.parse(JSON.stringify(options.map(option => option.name))), ['Quick Step', 'Braced Guard']);
    assert.deepEqual(JSON.parse(JSON.stringify(options.map(option => option.id))), ['ability_quick_step', 'ability_braced_guard']);
    assert.equal(retryCalls.length, 5);
    assert.match(retryCalls[1].retryFeedback.at(-1).content, /unclosed xml tag\(s\)/i);
    assert.equal((retryCalls[1].retryFeedback.at(-1).content.match(/\bDONE\b/g) || []).length, 1);
    assert.doesNotMatch(retryCalls[2].retryFeedback.at(-1).content, /\bDONE\b/, 'wrong root does not receive an unclosed expected-root cue');
    assert.match(retryCalls[3].retryFeedback.at(-1).content, /Duplicate ability "quick step"/);
    assert.doesNotMatch(retryCalls[3].retryFeedback.at(-1).content, /\bDONE\b/);
    assert.match(retryCalls[4].retryFeedback.at(-1).content, /accepted 1\. Generate 1 additional choices for level 2/);
    assert.match(retryCalls[4].retryFeedback.at(-1).content, /using new names absent from excludedAbilityNames and declinedAbilities/);
    assert.equal(retryCalls[4].extraTemplateFields.playerAbilitySelection.optionsToGenerate, 1);
    assert.ok(retryCalls[4].extraTemplateFields.playerAbilitySelection.excludedAbilityNames.includes('quick step'));
});

test('NPC level-up corrections reject unclosed XML and unknown progression targets before applying either mutation', { concurrency: false }, async () => {
    const retryCalls = [];
    const operations = [];
    const responses = [
        '<npcs><npc><name>Rook</name><abilities>',
        buildAbilityXml(['Quick Step'], { skill: 'Unknown Skill' }),
        buildAbilityXml(['Quick Step'], { skill: 'Stealth' }) + '\nDONE'
    ];
    const currentAbilities = [{ name: 'Existing Guard', description: 'Existing.', shortDescription: 'Existing', type: 'Passive', level: 1 }];
    const character = {
        id: 'char_npc_levelup_validation',
        name: 'Rook',
        isNPC: true,
        level: 2,
        getAbilities: () => currentAbilities.map(ability => ({ ...ability })),
        getAttributeNames: () => ['Agility'],
        getSkills: () => new Map([['Stealth', {}]]),
        setAbilities(next) {
            operations.push('setAbilities');
            currentAbilities.splice(0, currentAbilities.length, ...next.map(ability => ({ ...ability, id: ability.id || `ability-${ability.name}` })));
        }
    };
    const context = runFunctions([
        'normalizeAbilityNameForLookup',
        'ensureUniqueAbilityNames',
        'sortAbilitiesByLevelAndName',
        'resolveAssignmentEntry',
        'parseNpcAbilityAssignments',
        'parseNpcSkillAssignments',
        'parseLevelUpAbilityResponse',
        'generateLevelUpAbilitiesForCharacter'
    ], {
        Utils,
        withResponseRetryFeedback,
        Player: { getAvailableSkills: () => new Map([['Stealth', {}]]) },
        buildAttributePriorityLookup: () => new Map([['agility', 'Agility']]),
        getPointPoolFormulaRuntime: () => ({ normalizeVariableKey: value => String(value || '').trim().toLowerCase() }),
        normalizePriorityValue: value => Math.max(1, Math.min(3, Number.parseInt(value, 10) || 1)),
        normalizeActorNameForComparison: value => String(value || '').trim().toLowerCase(),
        config: { ai: { retryAttempts: 2 } },
        levelUpAbilityPromises: new Map(),
        PromptFailureReporter: {
            run: (_options, callback) => callback(),
            validationRetry() {}
        },
        PromptAuditLog: {
            runPrompt: (_options, callback) => callback(),
            runStage: (_options, callback) => callback(),
            setAttempt() {},
            recordFailure() {},
            acceptStage() {}
        },
        LLMClient: { logPrompt() {} },
        requestLevelUpAbilityAssignmentsForCharacter: async request => {
            retryCalls.push(request);
            return {
                trimmedName: 'Rook',
                priorLevel: 1,
                currentLevel: 2,
                messages: [{ role: 'system', content: 'system' }, ...request.retryFeedback],
                response: responses.shift()
            };
        },
        getCharacterAbilities: characterValue => characterValue.getAbilities(),
        applyNpcLevelUpProgressionAllocations: () => operations.push('progression'),
        authorNewAbilityAttachments: async () => operations.push('authorAttachments'),
        getActiveSettingSnapshot: () => ({}),
        console: { log() {}, warn() {}, debug() {} }
    }, 'this.generateLevelUpAbilitiesForCharacter = generateLevelUpAbilitiesForCharacter;');

    await context.generateLevelUpAbilitiesForCharacter(character, {
        previousLevel: 1,
        newLevel: 2,
        requireAbilityAddition: true
    });

    assert.equal(retryCalls.length, 3);
    assert.match(retryCalls[1].retryFeedback.at(-1).content, /unclosed xml tag\(s\)/i);
    assert.equal((retryCalls[1].retryFeedback.at(-1).content.match(/\bDONE\b/g) || []).length, 1);
    assert.match(retryCalls[2].retryFeedback.at(-1).content, /Unknown level-up skill "Unknown Skill"/);
    assert.doesNotMatch(retryCalls[2].retryFeedback.at(-1).content, /\bDONE\b/);
    assert.deepEqual(operations, ['setAbilities', 'authorAttachments', 'progression'], 'accepted abilities and progression apply once, after validation');
    assert.deepEqual(currentAbilities.map(ability => ability.name).sort(), ['Existing Guard', 'Quick Step']);
});
