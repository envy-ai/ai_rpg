const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    collectPlayerActionAccompanyingCharacters,
    collectPlayerActionHiddenContestContext,
    movePlayerActionAccompanyingCharacters,
    normalizePlayerActionAccompanyingCharacterSelection,
    resolvePreResolvedPlayerActionHiddenContestToolCall
} = require('../PlayerActionCompanions.js');

function makeLocation(id, npcIds = []) {
    return {
        id,
        npcIds: [...npcIds],
        addNpcId(npcId) {
            if (!this.npcIds.includes(npcId)) {
                this.npcIds.push(npcId);
            }
        },
        removeNpcId(npcId) {
            this.npcIds = this.npcIds.filter(candidate => candidate !== npcId);
        }
    };
}

function makeNpc(id, name, currentLocation, overrides = {}) {
    return {
        id,
        name,
        currentLocation,
        isNPC: true,
        isDead: false,
        setLocation(location) {
            this.currentLocation = typeof location === 'string' ? location : location?.id || null;
        },
        ...overrides
    };
}

test('player-action companion candidates include living party and origin NPCs only', () => {
    const origin = makeLocation('origin', ['local', 'dead']);
    const player = {
        id: 'player',
        getPartyMembers: () => ['party']
    };
    const players = new Map([
        ['player', { id: 'player', name: 'Hero', isNPC: false }],
        ['party', makeNpc('party', 'Mira Vale', null, { aliases: new Set(['Mira']) })],
        ['local', makeNpc('local', 'Tal Stone', 'origin')],
        ['dead', makeNpc('dead', 'Old Bones', 'origin', { isDead: true })],
        ['remote', makeNpc('remote', 'Far Scout', 'remote')]
    ]);

    assert.deepEqual(
        collectPlayerActionAccompanyingCharacters({ currentPlayer: player, location: origin, players }),
        [
            { name: 'Mira Vale', aliases: ['Mira'] },
            { name: 'Tal Stone', aliases: [] }
        ]
    );
});

test('player-action hidden-contest context preserves visibility and aliases for local living NPCs', () => {
    const origin = makeLocation('origin', ['hidden', 'visible', 'dead']);
    const player = {
        id: 'player',
        name: 'Hero',
        isNPC: false,
        aliases: new Set(['Captain']),
        getPartyMembers: () => ['party']
    };
    const players = new Map([
        ['player', player],
        ['party', makeNpc('party', 'Party Scout', null, { hiddenFromPlayer: false })],
        ['hidden', makeNpc('hidden', 'Veiled Scout', 'origin', {
            aliases: new Set(['Whisper']),
            hiddenFromPlayer: true
        })],
        ['visible', makeNpc('visible', 'Loud Decoy', 'origin', { hiddenFromPlayer: false })],
        ['dead', makeNpc('dead', 'Old Bones', 'origin', { isDead: true })]
    ]);

    assert.deepEqual(
        collectPlayerActionHiddenContestContext({ currentPlayer: player, location: origin, players }),
        {
            player: {
                id: 'player',
                name: 'Hero',
                aliases: ['Captain'],
                isNPC: false,
                hiddenFromPlayer: false
            },
            npcs: [
                {
                    id: 'party',
                    name: 'Party Scout',
                    aliases: [],
                    isNPC: true,
                    hiddenFromPlayer: false
                },
                {
                    id: 'hidden',
                    name: 'Veiled Scout',
                    aliases: ['Whisper'],
                    isNPC: true,
                    hiddenFromPlayer: true
                },
                {
                    id: 'visible',
                    name: 'Loud Decoy',
                    aliases: [],
                    isNPC: true,
                    hiddenFromPlayer: false
                }
            ]
        }
    );
});

test('pre-resolved hidden contests satisfy semantically matching opposed-check calls', () => {
    const player = {
        id: 'player',
        name: 'Hero',
        isNPC: false,
        aliases: new Set(['Captain'])
    };
    const scout = makeNpc('scout', 'Veiled Scout', 'origin', {
        aliases: new Set(['Whisper'])
    });
    const players = new Map([
        [player.id, player],
        [scout.id, scout]
    ]);
    const resolution = {
        label: 'major success',
        degree: 'major_success',
        success: true,
        skill: 'Perception',
        attribute: 'Wisdom',
        opponent: {
            id: scout.id,
            name: scout.name,
            skill: 'Stealth',
            attribute: 'Dexterity'
        },
        roll: { die: 20 }
    };
    const hiddenNpcChecks = [{
        action: 'reveal_hidden_npc',
        actorId: player.id,
        actorName: player.name,
        opponentId: scout.id,
        opponentName: scout.name,
        resolution
    }];

    const matched = resolvePreResolvedPlayerActionHiddenContestToolCall({
        name: 'resolveOpposedSkillCheck',
        argumentsObject: {
            actor: 'Captain',
            skill: 'perception',
            attribute: 'wisdom',
            opponent: 'Whisper',
            opponentSkill: 'stealth',
            opponentAttribute: 'dexterity'
        }
    }, {
        hiddenNpcChecks,
        currentPlayer: player,
        players
    });

    assert.equal(matched.content, 'major success');
    assert.equal(matched.metadata.preResolvedHiddenNpcCheck, true);
    assert.equal(matched.metadata.suppressCheckResultsRecord, true);
    assert.equal(matched.metadata.cached, true);
    assert.deepEqual(matched.metadata.actionResolution, resolution);
    assert.notEqual(matched.metadata.actionResolution, resolution);
    assert.equal(resolvePreResolvedPlayerActionHiddenContestToolCall({
        name: 'resolveOpposedSkillCheck',
        argumentsObject: {
            actor: 'Hero',
            skill: 'Investigation',
            attribute: 'intelligence',
            opponent: 'Whisper',
            opponentSkill: 'Stealth',
            opponentAttribute: 'dexterity'
        }
    }, {
        hiddenNpcChecks,
        currentPlayer: player,
        players
    }), null);
});

test('pre-resolved hidden contests infer an omitted actor only when the mechanics identify one contest', () => {
    const player = { id: 'player', name: 'Hero', isNPC: false };
    const decoy = makeNpc('decoy', 'Loud Decoy', 'origin');
    const secondDecoy = makeNpc('decoy-2', 'Second Decoy', 'origin');
    const players = new Map([
        [player.id, player],
        [decoy.id, decoy],
        [secondDecoy.id, secondDecoy]
    ]);
    const makeCheck = actor => ({
        action: 'hide_visible_npc',
        actorId: actor.id,
        actorName: actor.name,
        opponentId: player.id,
        opponentName: player.name,
        resolution: {
            label: 'success',
            success: true,
            skill: 'Stealth',
            attribute: 'Dexterity',
            opponent: {
                id: player.id,
                name: player.name,
                skill: 'Perception',
                attribute: 'Wisdom'
            }
        }
    });
    const argumentsObject = {
        skill: 'Stealth',
        attribute: 'Dexterity',
        opponent: 'the player',
        opponentSkill: 'Perception',
        opponentAttribute: 'Wisdom'
    };

    const matched = resolvePreResolvedPlayerActionHiddenContestToolCall({
        functionName: 'resolveOpposedSkillCheck',
        argumentsObject
    }, {
        hiddenNpcChecks: [makeCheck(decoy)],
        currentPlayer: player,
        players
    });
    assert.equal(matched.metadata.actor, 'Loud Decoy');

    assert.throws(
        () => resolvePreResolvedPlayerActionHiddenContestToolCall({
            functionName: 'resolveOpposedSkillCheck',
            argumentsObject
        }, {
            hiddenNpcChecks: [makeCheck(decoy), makeCheck(secondDecoy)],
            currentPlayer: player,
            players
        }),
        /provide an explicit actor to disambiguate/i
    );
});

test('player-action companion movement relocates party and non-party characters without changing membership', () => {
    const origin = makeLocation('origin', ['local', 'party']);
    const destination = makeLocation('destination');
    const party = makeNpc('party', 'Mira Vale', 'origin', { aliases: new Set(['Mira']) });
    const local = makeNpc('local', 'Tal Stone', 'origin');
    const currentPlayer = {
        id: 'player',
        getPartyMembers: () => ['party']
    };
    const players = new Map([
        ['player', { id: 'player', name: 'Hero', isNPC: false }],
        ['party', party],
        ['local', local]
    ]);
    const gameLocations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);

    const moved = movePlayerActionAccompanyingCharacters({
        characterNames: ['Mira', 'Tal Stone'],
        currentPlayer,
        originLocation: origin,
        destinationLocation: destination,
        players,
        gameLocations
    });

    assert.deepEqual(moved, ['Mira Vale', 'Tal Stone']);
    assert.equal(party.currentLocation, null);
    assert.equal(local.currentLocation, destination.id);
    assert.deepEqual(origin.npcIds, []);
    assert.deepEqual(destination.npcIds, ['local']);
    assert.deepEqual(currentPlayer.getPartyMembers(), ['party']);
});

test('player-action companion movement rejects unknown or unavailable characters before mutation', () => {
    const origin = makeLocation('origin', ['local']);
    const destination = makeLocation('destination');
    const local = makeNpc('local', 'Tal Stone', 'remote');
    const currentPlayer = { id: 'player', getPartyMembers: () => [] };
    const players = new Map([['local', local]]);
    const gameLocations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);

    assert.throws(
        () => movePlayerActionAccompanyingCharacters({
            characterNames: ['Unknown Guide'],
            currentPlayer,
            originLocation: origin,
            destinationLocation: destination,
            players,
            gameLocations
        }),
        /allowed exact character name or alias/i
    );
    assert.throws(
        () => movePlayerActionAccompanyingCharacters({
            characterNames: ['Tal Stone'],
            currentPlayer,
            originLocation: origin,
            destinationLocation: destination,
            players,
            gameLocations
        }),
        /not present at the movement origin/i
    );
    assert.equal(local.currentLocation, 'remote');
    assert.deepEqual(origin.npcIds, ['local']);
    assert.deepEqual(destination.npcIds, []);
});

test('shared aliases do not block candidate collection and are rejected only when selected', () => {
    const origin = makeLocation('origin', ['ash', 'frost']);
    const destination = makeLocation('destination');
    const ash = makeNpc('ash', 'QA Ash Beetle', 'origin', { aliases: ['Beetle'] });
    const frost = makeNpc('frost', 'QA Frost Beetle', 'origin', { aliases: ['Beetle'] });
    const currentPlayer = { id: 'player', getPartyMembers: () => [] };
    const players = new Map([
        ['ash', ash],
        ['frost', frost]
    ]);
    const gameLocations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);

    const candidates = collectPlayerActionAccompanyingCharacters({
        currentPlayer,
        location: origin,
        players
    });
    assert.deepEqual(candidates, [
        { name: 'QA Ash Beetle', aliases: ['Beetle'] },
        { name: 'QA Frost Beetle', aliases: ['Beetle'] }
    ]);
    assert.deepEqual(
        normalizePlayerActionAccompanyingCharacterSelection(['QA Ash Beetle'], candidates),
        ['QA Ash Beetle']
    );
    assert.throws(
        () => movePlayerActionAccompanyingCharacters({
            characterNames: ['Beetle'],
            currentPlayer,
            originLocation: origin,
            destinationLocation: destination,
            players,
            gameLocations
        }),
        /identifier "Beetle" is ambiguous between "QA Ash Beetle" and "QA Frost Beetle"/i
    );
    assert.equal(ash.currentLocation, 'origin');
    assert.equal(frost.currentLocation, 'origin');
    assert.deepEqual(origin.npcIds, ['ash', 'frost']);
    assert.deepEqual(destination.npcIds, []);
});

test('deferred direct and fast-travel paths carry companion selections into movement endpoints', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const chatSource = fs.readFileSync(require.resolve('../public/js/chat.js'), 'utf8');
    const viewSource = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');

    assert.match(
        apiSource,
        /responseData\.accompanyingCharacters = moveTurnResultPayload\.accompanyingCharacters\.slice\(\)/
    );
    assert.match(
        apiSource,
        /app\.post\('\/api\/player\/move'[\s\S]*?movePlayerActionAccompanyingCharacters\(\{[\s\S]*?characterNames: accompanyingCharacters/
    );
    assert.match(
        apiSource,
        /app\.post\('\/api\/npcs\/:id\/teleport'[\s\S]*?movePlayerActionAccompanyingCharacters\(\{[\s\S]*?characterNames: accompanyingCharacters/
    );
    assert.match(chatSource, /return responsePayload;/);
    assert.match(chatSource, /return this\.submitChatMessage\(message,/);
    assert.match(
        viewSource,
        /performDirectMove\(exit\.destination, destinationName, \{ accompanyingCharacters \}\)/
    );
    assert.match(
        viewSource,
        /teleportNpcToLocation\(playerRecord, destinationId, \{[\s\S]*?accompanyingCharacters/
    );
});
