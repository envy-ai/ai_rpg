const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const slice = (from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `missing ${from}`);
    return source.slice(start, end);
};

function load() {
    const sandbox = { currentPlayer: { id: 'player_1' }, currentTurnToken: 'turn_1', chatHistory: [] };
    vm.createContext(sandbox);
    vm.runInContext(`${slice('let baseContextWorldIndexCache', '\n// In-memory player storage')}
${slice('function getBaseContextTurnKey()', '\nfunction sanitizeImportantMemories')}
this.freeze = freezeBaseContextWorldIndex;`, sandbox);
    return sandbox;
}

test('the NPC index and world outline stay fixed for the rest of a player turn and refresh on the next turn', () => {
    const sandbox = load();
    const before = { allNpcs: [{ name: 'Ada' }], worldOutline: { regions: ['Harbor'] } };
    const afterGeneration = { allNpcs: [{ name: 'Ada' }, { name: 'Port_Prowler' }], worldOutline: { regions: ['Harbor', 'Museum'] } };

    assert.equal(sandbox.freeze(before), before);
    // NPCs and locations generated mid-turn must not change the cached prefix.
    assert.equal(sandbox.freeze(afterGeneration), before);

    sandbox.currentTurnToken = 'turn_2';
    assert.equal(sandbox.freeze(afterGeneration), afterGeneration);
});
