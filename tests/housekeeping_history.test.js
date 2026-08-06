const test = require('node:test');
const assert = require('node:assert/strict');

const {
    collectHousekeepingPlayerTurns,
    buildHousekeepingTurnHistory
} = require('../housekeeping_history.js');

function playerTurn(id, action, prose, eventText = null) {
    const entries = [
        { id, role: 'user', content: action },
        { id: `${id}-prose`, role: 'assistant', type: 'player-action', content: prose }
    ];
    if (eventText) {
        entries.push({
            id: `${id}-events`,
            role: 'assistant',
            type: 'event-summary',
            content: eventText,
            parentId: `${id}-prose`
        });
    }
    return entries;
}

test('housekeeping history groups player actions, prose, and event text by turn', () => {
    const history = [
        ...playerTurn('turn-1', 'Open the gate.', 'The gate groans open.', '📋 Events\n• 🚪 The gate opened.'),
        { id: 'turn-1-npc', role: 'assistant', type: 'npc-action', content: 'Mira steps through.' },
        { id: 'turn-1-status', role: 'assistant', type: 'status-summary', content: '🌀 Status\n• Mira is alert.' }
    ];

    assert.deepEqual(collectHousekeepingPlayerTurns(history), [{
        turnId: 'turn-1',
        playerAction: 'Open the gate.',
        prose: ['The gate groans open.', 'Mira steps through.'],
        eventText: ['📋 Events\n• 🚪 The gate opened.', '🌀 Status\n• Mira is alert.'],
        isSynthetic: false
    }]);
});

test('first housekeeping run uses only the configured interval worth of recent turns', () => {
    const history = [
        ...playerTurn('turn-1', 'First action.', 'First prose.'),
        ...playerTurn('turn-2', 'Second action.', 'Second prose.'),
        ...playerTurn('turn-3', 'Third action.', 'Third prose.')
    ];

    const result = buildHousekeepingTurnHistory(history, { interval: 2 });

    assert.equal(result.mode, 'initial-interval');
    assert.deepEqual(result.turns.map(turn => turn.turnId), ['turn-2', 'turn-3']);
    assert.equal(result.lastIncludedTurnId, 'turn-3');
});

test('later housekeeping runs include every player turn after the persisted boundary', () => {
    const history = [
        ...playerTurn('turn-1', 'First action.', 'First prose.'),
        ...playerTurn('turn-2', 'Second action.', 'Second prose.'),
        ...playerTurn('turn-3', 'Third action.', 'Third prose.')
    ];

    const result = buildHousekeepingTurnHistory(history, {
        lastRunTurnId: 'turn-1',
        interval: 1
    });

    assert.equal(result.mode, 'since-last-run');
    assert.deepEqual(result.turns.map(turn => turn.turnId), ['turn-2', 'turn-3']);
    assert.equal(result.lastIncludedTurnId, 'turn-3');
});

test('current turn supplements add finalized prose and events without duplicating history text', () => {
    const history = [
        ...playerTurn('turn-1', 'Wait here.', 'Rain drums on the roof.'),
        ...playerTurn('turn-2', 'Search the desk.', 'A brass key lies under the ledger.')
    ];

    const result = buildHousekeepingTurnHistory(history, {
        lastRunTurnId: 'turn-1',
        interval: 5,
        currentTurnId: 'turn-2',
        currentActionText: 'Search the desk.',
        currentProse: 'A brass key lies under the ledger.',
        currentEventText: '📋 Events – Current Turn\n• 🎒 Brass key was picked up.'
    });

    assert.equal(result.turns.length, 1);
    assert.deepEqual(result.turns[0], {
        turnId: 'turn-2',
        playerAction: 'Search the desk.',
        prose: ['A brass key lies under the ledger.'],
        eventText: ['📋 Events – Current Turn\n• 🎒 Brass key was picked up.'],
        isSynthetic: false
    });
    assert.equal(result.lastIncludedTurnId, 'turn-2');
});

test('current canonical prose replaces the stored player prose when hidden content differs', () => {
    const history = playerTurn(
        'turn-1',
        'Inspect the shrine.',
        'The shrine is cracked.<hidden>Secret author note.</hidden>'
    );

    const result = buildHousekeepingTurnHistory(history, {
        interval: 1,
        currentTurnId: 'turn-1',
        currentProse: 'The shrine is cracked.'
    });

    assert.deepEqual(result.turns[0].prose, ['The shrine is cracked.']);
});

test('current context matches the latest stored turn by content when no request id is available', () => {
    const history = [
        ...playerTurn('turn-1', 'Wait.', 'Nothing changes.'),
        ...playerTurn('turn-2', 'Check the window.', 'A rider approaches.<hidden>Known agent.</hidden>')
    ];

    const result = buildHousekeepingTurnHistory(history, {
        lastRunTurnId: 'turn-1',
        interval: 3,
        currentActionText: 'Check the window.',
        currentProse: 'A rider approaches.',
        currentEventText: '📋 Events – Current Turn\n• A rider arrived.'
    });

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].turnId, 'turn-2');
    assert.deepEqual(result.turns[0].prose, ['A rider approaches.']);
    assert.equal(result.turns[0].eventText.length, 1);
    assert.equal(result.lastIncludedTurnId, 'turn-2');
});

test('non-player prompt entries do not create housekeeping turns', () => {
    const history = [
        ...playerTurn('turn-1', 'Take watch.', 'The camp settles.'),
        { id: 'question-1', role: 'user', type: 'user-question', content: 'What time is it?' },
        { id: 'answer-1', role: 'assistant', type: 'storyteller-answer', content: 'It is midnight.' },
        { id: 'generic-1', role: 'user', type: 'user-generic-prompt', content: 'Rewrite this.' }
    ];

    const turns = collectHousekeepingPlayerTurns(history);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].turnId, 'turn-1');
    assert.deepEqual(turns[0].prose, ['The camp settles.']);
});

test('missing persisted housekeeping boundary fails loudly', () => {
    const history = playerTurn('turn-2', 'Continue.', 'The road continues.');

    assert.throws(
        () => buildHousekeepingTurnHistory(history, {
            lastRunTurnId: 'missing-turn',
            interval: 2
        }),
        /last housekeeping turn \(missing-turn\) is missing from chat history/i
    );
});

test('synthetic current context does not create an unresolvable persisted boundary', () => {
    const result = buildHousekeepingTurnHistory([], {
        interval: 3,
        currentTurnId: 'non-chat-request',
        currentProse: 'A background event changes the weather.',
        currentEventText: '📋 Events – Current Turn\n• Rain began.'
    });

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].isSynthetic, true);
    assert.equal(result.lastIncludedTurnId, null);
});
