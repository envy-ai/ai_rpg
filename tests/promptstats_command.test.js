const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    initializeSlashCommands,
    getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function makeTempBaseDir(label) {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, `${label}-`));
}

function installPromptStatsConfig(baseDir) {
    Globals.baseDir = baseDir;
    Globals.config = {
        prompt_progress: {
            character_targets: {
                player_action: 5000,
                region_generation: 20000,
                location_generation: 10000,
                'inventory_generation_*': 5000
            }
        }
    };
}

function createInteraction(argsText = '') {
    const replies = [];
    return {
        argsText,
        replies,
        reply: async (payload) => {
            replies.push(payload);
        }
    };
}

test('promptstats command is registered', () => {
    initializeSlashCommands();

    const command = getSlashCommandModule('promptstats');
    assert.ok(command, 'promptstats command should be registered');
});

test('promptstats command shows a markdown table of prompt output character averages', async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('promptstats-command-table');
    installPromptStatsConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        LLMClient.recordPromptOutputCharacters('player_action', 100);
        LLMClient.recordPromptOutputCharacters('player_action', 300);
        LLMClient.recordPromptOutputCharacters('location_generation', 50);
        LLMClient.recordPromptOutputCharacters('inventory_generation_Barkeep', 80);
        LLMClient.recordPromptOutputCharacters('inventory_generation_Guard Captain', 120);

        initializeSlashCommands();
        const command = getSlashCommandModule('promptstats');
        assert.ok(command, 'promptstats command should be registered');

        const interaction = createInteraction();
        await command.execute(interaction, {});

        assert.equal(interaction.replies.length, 1);
        const reply = interaction.replies[0];
        assert.equal(reply.ephemeral, false);
        assert.match(reply.content, /^## Prompt Output Character Stats/m);
        assert.match(reply.content, /\| Prompt \| Runs \| Average Output Characters \| Last Output Characters \|/);
        assert.match(reply.content, /\| inventory_generation \| 2 \| 100 \| 120 \|/);
        assert.doesNotMatch(reply.content, /inventory_generation_barkeep/);
        assert.match(reply.content, /\| location_generation \| 1 \| 50 \| 50 \|/);
        assert.match(reply.content, /\| player_action \| 2 \| 200 \| 300 \|/);
        assert.match(reply.content, /\| region_generation \| 0 \| null \| null \|/);
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('promptstats clear removes all stored prompt output character averages', async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('promptstats-command-clear');
    installPromptStatsConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    try {
        LLMClient.recordPromptOutputCharacters('player_action', 100);
        LLMClient.recordPromptOutputCharacters('location_generation', 50);

        initializeSlashCommands();
        const command = getSlashCommandModule('promptstats');
        assert.ok(command, 'promptstats command should be registered');

        const interaction = createInteraction('clear');
        await command.execute(interaction, { action: 'clear' });

        assert.equal(interaction.replies.length, 1);
        assert.equal(interaction.replies[0].ephemeral, false);
        assert.match(interaction.replies[0].content, /Cleared prompt output character averages for 2 prompts\./);

        assert.equal(LLMClient.getPromptOutputCharacterStats('player_action').runs, 0);
        assert.equal(LLMClient.getPromptOutputCharacterStats('location_generation').averageOutputCharacters, null);
    } finally {
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});
