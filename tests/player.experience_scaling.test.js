const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function resetPlayerState() {
    Player.clearRuntimeRegistries();
}

test('level 1 gameplay XP awards are unchanged', () => {
    const previousConfig = Globals.config;

    resetPlayerState();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const player = new Player({
            id: 'xp-scaling-level-1',
            name: 'Level One',
            level: 1
        });

        player.addExperience(120);

        assert.ok(Math.abs(player.experience - (40 / 3)) < 1e-9);
        assert.equal(player.level, 2);
    } finally {
        Globals.config = previousConfig;
        resetPlayerState();
    }
});

test('gameplay XP awards above level 1 are divided by level over two', () => {
    const previousConfig = Globals.config;

    resetPlayerState();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const player = new Player({
            id: 'xp-scaling-level-4',
            name: 'Veteran',
            level: 4
        });

        player.addExperience(80);

        assert.equal(player.experience, 40);
        assert.equal(player.level, 4);
    } finally {
        Globals.config = previousConfig;
        resetPlayerState();
    }
});

test('raw XP awards bypass level-based scaling', () => {
    const previousConfig = Globals.config;

    resetPlayerState();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const player = new Player({
            id: 'xp-scaling-raw',
            name: 'Exact Grant',
            level: 4
        });

        player.addRawExperience(80);

        assert.equal(player.experience, 80);
        assert.equal(player.level, 4);
    } finally {
        Globals.config = previousConfig;
        resetPlayerState();
    }
});

test('party XP sharing uses the original gameplay award before each recipient applies their own level divisor', () => {
    const previousConfig = Globals.config;

    resetPlayerState();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const leader = new Player({
            id: 'xp-scaling-party-leader',
            name: 'Leader',
            level: 4
        });
        const member = new Player({
            id: 'xp-scaling-party-member',
            name: 'Member',
            level: 4,
            isNPC: true
        });

        leader.addPartyMember(member.id);
        leader.addExperience(100);

        assert.equal(leader.experience, 50);
        assert.equal(member.experience, 50);
    } finally {
        Globals.config = previousConfig;
        resetPlayerState();
    }
});
