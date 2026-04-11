const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadRespecNpcSkillsForCharacter(overrides = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function respecNpcSkillsForCharacter(character, { timeoutScale = 1 } = {}) {');
    const end = source.indexOf('\nfunction applyNpcSkillAllocations', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate respecNpcSkillsForCharacter in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Error,
        Number,
        String,
        Map,
        console,
        ...overrides
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.respecNpcSkillsForCharacter = respecNpcSkillsForCharacter;`,
        context
    );

    return context.respecNpcSkillsForCharacter;
}

test('respecNpcSkillsForCharacter supports NPCs without a current location', async () => {
    const calls = {
        resetCount: 0
    };

    const respecNpcSkillsForCharacter = loadRespecNpcSkillsForCharacter({
        Location: {
            get: () => {
                throw new Error('Location.get should not be called when the NPC has no current location.');
            }
        },
        findRegionByLocationId: () => {
            throw new Error('findRegionByLocationId should not be called when the NPC has no current location.');
        },
        buildNpcGenerationSeedXml: (character, { location } = {}) => {
            calls.seedCharacter = character;
            calls.seedLocation = location;
            return '<response><npcs /></response>';
        },
        requestNpcSkillAssignments: async (options = {}) => {
            calls.requestOptions = options;
            return {
                assignments: new Map([
                    ['velska', {
                        name: 'Velska',
                        skills: [{ name: 'Scavenging', priority: 3 }]
                    }]
                ]),
                prompt: '<prompt />',
                response: '<response />'
            };
        },
        resolveAssignmentEntry: (assignments, name) => assignments.get(String(name).trim().toLowerCase()) || null,
        buildRegionShortDescriptionItem: () => {
            throw new Error('buildRegionShortDescriptionItem should not be called without a resolved region.');
        },
        captureSkillSnapshot: () => new Map([['Scavenging', 1]]),
        resetCharacterSkillsToBaseline: () => {
            calls.resetCount += 1;
        },
        computeNpcCreationProgressionBudget: () => ({
            skillPoints: 5,
            maxSkill: 4
        }),
        applyNpcSkillAllocations: (character, skills, budget) => {
            calls.applyCharacter = character;
            calls.applySkills = skills;
            calls.applyBudget = budget;
            return 5;
        },
        restoreCharacterSkillSnapshot: () => {
            calls.restoreCalled = true;
        }
    });

    const npc = {
        isNPC: true,
        name: 'Velska',
        level: 4,
        currentLocation: '',
        getSkills: () => new Map([['Scavenging', 6]])
    };

    const result = await respecNpcSkillsForCharacter(npc);

    assert.equal(calls.seedCharacter, npc);
    assert.equal(calls.seedLocation, null);
    assert.equal(calls.requestOptions.locationOverride, null);
    assert.equal(calls.requestOptions.currentRegion, null);
    assert.equal(calls.resetCount, 1);
    assert.equal(calls.applyCharacter, npc);
    assert.deepEqual(calls.applySkills, [{ name: 'Scavenging', priority: 3 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.applyBudget)), {
        points: 5,
        maxSkill: 4
    });
    assert.equal(calls.restoreCalled, undefined);
    assert.equal(result.spent, 5);
    assert.equal(result.level, 4);
    assert.equal(result.prompt, '<prompt />');
    assert.equal(result.response, '<response />');
});
