const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Utils = require('../Utils.js');
const Globals = require('../Globals.js');

Globals.config = { strictXMLParsing: false };

const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');

function extractFunction(startNeedle, endNeedle) {
    const start = apiSource.indexOf(startNeedle);
    const end = apiSource.indexOf(endNeedle, start);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return apiSource.slice(start, end);
}

function loadAttackCheckParser() {
    const functionSource = extractFunction(
        '        function parseAttackCheckResponse(responseText, { expectedAttackerNames = [] } = {}) {',
        '\n        async function runAttackCheckPrompt('
    );
    const context = {
        Utils,
        sanitizeForXml(input) {
            return `<root>${input}</root>`
                .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
                .replace(/<\s*br\s*>/gi, '<br/>')
                .replace(/<\s*hr\s*>/gi, '<hr/>');
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}\nthis.parseAttackCheckResponse = parseAttackCheckResponse;`,
        context
    );
    return context.parseAttackCheckResponse;
}

const validAttack = ({ attacker = 'QA Shieldhand', defender = 'QA Ash Beetle' } = {}) => `<attack>
  <attacker>${attacker}</attacker>
  <defender>${defender}</defender>
  <attackerInfo>
    <attackSkill>Melee Combat</attackSkill>
    <damageAttribute>strength</damageAttribute>
  </attackerInfo>
  <defenderInfo>
    <evadeSkill>Stealth</evadeSkill>
    <deflectSkill>N/A</deflectSkill>
  </defenderInfo>
  <ability>Iron Ward</ability>
  <weapon>Iron Shield</weapon>
  <circumstanceModifiers>
    <attackerCircumstanceModifier><amount>0</amount><reason>N/A</reason></attackerCircumstanceModifier>
    <defenderCircumstanceModifier><amount>0</amount><reason>N/A</reason></defenderCircumstanceModifier>
  </circumstanceModifiers>
  <damageEffectiveness>3</damageEffectiveness>
</attack>`;

test('attack-check parser accepts one mechanically complete attack', () => {
    const parse = loadAttackCheckParser();
    const result = parse(validAttack(), { expectedAttackerNames: ['QA Shieldhand'] });

    assert.equal(result.hasAttack, true);
    assert.equal(result.attacks.length, 1);
    assert.equal(result.attacks[0].attacker, 'QA Shieldhand');
    assert.equal(result.attacks[0].defender, 'QA Ash Beetle');
    assert.equal(result.attacks[0].damageEffectiveness, 3);
});

test('attack-check parser accepts multiple mechanically complete attack blocks', () => {
    const parse = loadAttackCheckParser();
    const result = parse(`${validAttack()}\n${validAttack({ defender: 'QA Frost Beetle' })}`, {
        expectedAttackerNames: ['QA Shieldhand']
    });

    assert.equal(result.attacks.length, 2);
    assert.deepEqual(
        Array.from(result.attacks, attack => attack.defender),
        ['QA Ash Beetle', 'QA Frost Beetle']
    );
});

test('attack-check parser rejects a different attacker and non-integral effectiveness', () => {
    const parse = loadAttackCheckParser();

    assert.throws(
        () => parse(validAttack({ attacker: 'QA Ash Beetle' }), {
            expectedAttackerNames: ['QA Shieldhand']
        }),
        /does not match the acting character/
    );
    assert.throws(
        () => parse(validAttack().replace('<damageEffectiveness>3</damageEffectiveness>', '<damageEffectiveness>3.5</damageEffectiveness>'), {
            expectedAttackerNames: ['QA Shieldhand']
        }),
        /integer from 1 through 5/
    );
});

function loadRunAttackCheckPrompt({ responses, retryAttempts = 2 }) {
    const functionSource = extractFunction(
        '        async function runAttackCheckPrompt({',
        '\n        async function runAttackPrecheck('
    );
    const parseAttackCheckResponse = loadAttackCheckParser();
    const calls = [];
    const logs = [];
    const context = {
        Globals: {
            config: {
                use_legacy_prompt_checks: false,
                plausibility_checks: { enabled: true },
                ai: { retryAttempts }
            }
        },
        currentPlayer: { name: 'Tester' },
        runAttackPrecheck: async () => true,
        prepareBasePromptContext: async () => ({}),
        promptEnv: {
            render() {
                return '<rendered/>';
            }
        },
        parseXMLTemplate() {
            return { systemPrompt: 'system', generationPrompt: 'generation' };
        },
        parseAttackCheckResponse,
        LLMClient: {
            async chatCompletion(options) {
                calls.push(options);
                return responses[Math.min(calls.length - 1, responses.length - 1)];
            },
            logPrompt(entry) {
                logs.push(entry);
            }
        },
        Events: {
            escapeHtml(value) {
                return value;
            }
        },
        console: {
            info() {},
            warn() {},
            debug() {}
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}\nthis.runAttackCheckPrompt = runAttackCheckPrompt;`,
        context
    );
    return {
        runAttackCheckPrompt: context.runAttackCheckPrompt,
        calls,
        logs
    };
}

test('TinyBrain NPC attack check retries parser failures with corrective context', async () => {
    const wrongAttacker = validAttack({ attacker: 'QA Ash Beetle' });
    const runtime = loadRunAttackCheckPrompt({ responses: [wrongAttacker, validAttack()] });

    const result = await runtime.runAttackCheckPrompt({
        actionText: 'QA Shieldhand attacks the beetles.',
        characterName: 'QA Shieldhand',
        allowWhenLegacyChecksDisabled: true
    });

    assert.equal(runtime.calls.length, 2);
    assert.equal(runtime.logs.length, 2);
    assert.equal(runtime.calls[0].messages.length, 2);
    assert.equal(runtime.calls[1].messages.length, 4);
    assert.match(runtime.calls[1].messages[3].content, /failed structured validation/);
    assert.equal(result.structured.attacks.length, 1);
    assert.equal(result.structured.attacks[0].defender, 'QA Ash Beetle');
});

test('TinyBrain NPC attack check fails explicitly after parser retries are exhausted', async () => {
    const wrongAttacker = validAttack({ attacker: 'QA Ash Beetle' });
    const runtime = loadRunAttackCheckPrompt({ responses: [wrongAttacker], retryAttempts: 1 });

    await assert.rejects(
        runtime.runAttackCheckPrompt({
            actionText: 'QA Shieldhand attacks the beetles.',
            characterName: 'QA Shieldhand',
            allowWhenLegacyChecksDisabled: true
        }),
        /remained invalid after 2 attempts/
    );
    assert.equal(runtime.calls.length, 2);
});
