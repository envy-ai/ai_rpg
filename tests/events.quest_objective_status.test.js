const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

test('parseQuestObjectiveStatusXml keeps statusReason on completed objectives', () => {
    const previousDeps = Events._deps;
    const previousConfig = Globals.config;

    try {
        Globals.config = {};
        Events._deps = {
            ...(previousDeps || {}),
            currentPlayer: {
                getQuestByIndex(index) {
                    if (index === 0) {
                        return {
                            id: 'quest-ledger',
                            name: 'Recover the Ledger'
                        };
                    }
                    return null;
                }
            }
        };

        const parsed = Events.parseQuestObjectiveStatusXml(`
<quests>
  <quest>
    <index>1</index>
    <objectives>
      <objective>
        <index>1</index>
        <statusReason>ledger was handed to the magistrate</statusReason>
        <completed>true</completed>
      </objective>
      <objective>
        <index>2</index>
        <statusReason>player only discussed the next step</statusReason>
        <completed>false</completed>
      </objective>
    </objectives>
  </quest>
</quests>`);

        assert.deepEqual(parsed, [
            {
                quest: 'Recover the Ledger',
                questId: 'quest-ledger',
                questIndex: 1,
                objectiveIndex: 1,
                statusReason: 'ledger was handed to the magistrate'
            }
        ]);
    } finally {
        Events._deps = previousDeps;
        Globals.config = previousConfig;
    }
});

test('mergeQuestOutcomesIntoStructured keeps quest objective reason in parsed and raw output', () => {
    const structured = {};

    Events.mergeQuestOutcomesIntoStructured(structured, {
        questObjectivesCompleted: [
            {
                questId: 'quest-ledger',
                questName: 'Recover the Ledger',
                objectiveIndex: 0,
                objectiveNumber: 1,
                objectiveDescription: 'Return the ledger to the magistrate',
                reason: 'ledger was handed to the magistrate',
                questCompleted: false,
                questJustCompleted: false
            }
        ]
    });

    assert.equal(structured.parsed.completed_quest_objective.length, 1);
    assert.equal(
        structured.parsed.completed_quest_objective[0].reason,
        'ledger was handed to the magistrate'
    );
    assert.equal(
        structured.rawEntries.completed_quest_objective,
        'Recover the Ledger → Return the ledger to the magistrate (ledger was handed to the magistrate)'
    );
});
