const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('combat NPC turns can run when regular NPC turns are disabled', () => {
    assert.equal(defaultConfig.npc_turns?.enabled, false);
    assert.equal(defaultConfig.combat_npc_turns?.enabled, true);

    const npcTurnConfigBlock = extractBlock(
        apiSource,
        'let skipNpcTurns = Boolean(isForcedEventAction);',
        "stream.status('npc_turns:pending'"
    );
    const combatConfigBlock = extractBlock(
        npcTurnConfigBlock,
        'if (Globals.isInCombat()) {',
        'console.log(`NPC turns config:'
    );

    assert.match(
        combatConfigBlock,
        /takeNpcTurns\s*=\s*Globals\.config\.combat_npc_turns\?\.enabled\s*!==\s*false/
    );

    const combatEnabledIndex = npcTurnConfigBlock.indexOf('takeNpcTurns = Globals.config.combat_npc_turns?.enabled !== false');
    const playerMovedGateIndex = npcTurnConfigBlock.indexOf('const playerMovedThisTurn = Boolean(Globals.processedMove);');
    const enabledGateIndex = npcTurnConfigBlock.indexOf('if (!takeNpcTurns)', playerMovedGateIndex);
    assert.ok(combatEnabledIndex !== -1, 'combat branch must set takeNpcTurns from combat_npc_turns.enabled');
    assert.ok(playerMovedGateIndex !== -1, 'player movement gate not found');
    assert.ok(enabledGateIndex !== -1, 'NPC-turn enabled gate not found');
    assert.ok(combatEnabledIndex < enabledGateIndex, 'combat enabled flag must be applied before the shared enabled gate');
});

test('TinyBrain NPC turns pre-resolve attacks before staged narration', () => {
    const npcAttackBlock = extractBlock(
        apiSource,
        'let attackCheck = null;',
        'const attackOutcome = attackContext?.outcome || null;'
    );

    assert.match(
        npcAttackBlock,
        /tinyBrainNpcActionEnabled\s*=\s*isTinyBrainPromptEnabled\(Globals\.config\?\.ai,\s*'npc_action'\)/
    );
    assert.match(
        npcAttackBlock,
        /shouldPreResolveNpcAttack\s*=\s*Globals\.config\?\.use_legacy_prompt_checks\s*===\s*true\s*\|\|\s*tinyBrainNpcActionEnabled/
    );
    assert.match(npcAttackBlock, /if \(shouldPreResolveNpcAttack\) \{/);
    assert.match(npcAttackBlock, /attackCheck\s*=\s*await runAttackCheckPrompt\(/);
    assert.match(npcAttackBlock, /allowWhenLegacyChecksDisabled:\s*tinyBrainNpcActionEnabled/);
    assert.match(npcAttackBlock, /attackContext\s*=\s*buildAttackContextForActor\(/);
});
