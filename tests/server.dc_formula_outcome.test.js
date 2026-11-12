const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const SkillCheckValue = require('../SkillCheckValue.js');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');
const {
    normalizeDifficultyKey,
    resolveDifficultyDcFormulas
} = require('../utils/dc-formulas.js');
const {
    resolveOutcomeMarginFormulas,
    validateOutcomeMarginValues
} = require('../utils/outcome-margin-formulas.js');
const {
    resolveCriticalThresholdFormulas,
    validateCriticalThresholdValues
} = require('../utils/critical-threshold-formulas.js');

function loadActionOutcomeHelpers({ config, locationLevel, dieRoll }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function getDifficultyDcFormulaRuntime()');
    const end = source.indexOf('\nasync function runPlausibilityCheck', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate action outcome helpers in server.js');
    }

    const context = {
        Number,
        Set,
        Map,
        JSON,
        console,
        config,
        cachedDifficultyDcFormulaRuntime: null,
        cachedOutcomeMarginFormulaRuntime: null,
        cachedCriticalThresholdFormulaRuntime: null,
        FormulaEvaluator,
        SkillCheckValue,
        normalizeDifficultyKey,
        resolveDifficultyDcFormulas,
        resolveOutcomeMarginFormulas,
        validateOutcomeMarginValues,
        resolveCriticalThresholdFormulas,
        validateCriticalThresholdValues,
        currentPlayer: null,
        Location: {
            get: () => ({ baseLevel: locationLevel })
        },
        Player: {
            availableSkills: new Map()
        },
        diceModule: {
            rollDice: () => ({ total: dieRoll, detail: `1d20 (test: ${dieRoll})` })
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.resolveActionOutcome = resolveActionOutcome;
this.difficultyToDC = difficultyToDC;`,
        context
    );
    return context;
}

function makePlayer() {
    return {
        currentLocation: 'location-1',
        getAttributeNames: () => ['Dexterity'],
        getAttributeBonus: () => 0,
        getSkillValue: () => 0
    };
}

function makeConfig(overrides = {}) {
    return {
        formulas: {
            dc: {
                trivial: '0',
                easy: '10',
                medium: '15',
                hard: '20',
                very_hard: '25',
                legendary: '30',
                ...overrides
            },
            outcome_margins: {
                critical_success: '10',
                major_success: '6',
                success: '3',
                barely_succeeded: '0',
                critical_failure: '-10',
                major_failure: '-6',
                failure: '-3'
            },
            critical_thresholds: {
                normal: {
                    success: 16,
                    failure: 4
                },
                crafting: {
                    success: 19,
                    failure: 2
                }
            }
        }
    };
}

test('resolveActionOutcome treats a zero trivial DC as a real configured DC', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config: makeConfig(),
        locationLevel: 4,
        dieRoll: 1
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'trivial'
            }
        }
    });

    assert.equal(outcome.difficulty.dc, 0);
    assert.equal(outcome.roll.die, 1);
    assert.equal(outcome.degree, 'success');
});

test('resolveActionOutcome passes current location level into DC formulas', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config: makeConfig({ easy: 'level + 10' }),
        locationLevel: 4,
        dieRoll: 10
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.difficulty.dc, 14);
    assert.equal(outcome.margin, -4);
    assert.equal(outcome.degree, 'failure');
});

test('resolveActionOutcome uses configured outcome margins with current location level', () => {
    const config = makeConfig({ easy: '6' });
    config.formulas.outcome_margins.critical_success = 'level + 20';
    config.formulas.outcome_margins.major_success = 'level + 5';

    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config,
        locationLevel: 4,
        dieRoll: 16
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.margin, 10);
    assert.equal(outcome.degree, 'major_success');
});

test('resolveActionOutcome uses configured inclusive normal critical roll thresholds', () => {
    const config = makeConfig({ easy: '0' });
    config.formulas.critical_thresholds.normal.success = 17;

    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config,
        locationLevel: 4,
        dieRoll: 16
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.margin, 16);
    assert.equal(outcome.degree, 'major_success');
});

test('resolveActionOutcome rejects an opposed check against the acting character', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config: makeConfig(),
        locationLevel: 4,
        dieRoll: 20
    });
    const player = {
        ...makePlayer(),
        id: 'char-self',
        name: 'Rook'
    };

    assert.throws(() => resolveActionOutcome({
        player,
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'Opposed',
                opposedCheck: {
                    opponent: 'self',
                    opponentSkill: 'Perception',
                    opponentAttribute: 'Wisdom'
                }
            }
        }
    }), /actor and opponent resolve to the same character "Rook"/);
});

test('unopposed skill checks add actor level once for omitted, blank and N/A attributes', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({ config: makeConfig(), locationLevel: 4, dieRoll: 10 });
    const actor = { ...makePlayer(), id: 'actor', name: 'Rook', level: 4, getSkillValue: () => 4,
        getAttributeBonus: key => { assert.ok(key, 'a missing attribute must not be resolved as a real stat'); return 2; } };
    for (const attribute of [undefined, '', '   ', 'N/A', ' n/a ']) {
        const outcome = resolveActionOutcome({ player: actor, plausibility: { type: 'plausible', skillCheck: { skill: 'Stealth', attribute, difficulty: 'medium' } } });
        assert.equal(outcome.roll.skillValue, 4);
        assert.equal(outcome.roll.attributeBonus, 4);
        assert.equal(outcome.roll.attributeBonusSource, 'level');
        assert.equal(outcome.roll.total, 18);
        assert.equal(outcome.margin, 3);
        assert.equal(outcome.degree, 'success');
        assert.equal(outcome.attribute, null);
    }
});

test('opposed skill checks use each actor level independently when their attributes are absent', () => {
    const helpers = loadActionOutcomeHelpers({ config: makeConfig(), locationLevel: 4, dieRoll: 10 });
    const actor = { ...makePlayer(), id: 'actor', name: 'Rook', level: 4, getSkillValue: () => 4, getAttributeBonus: () => { throw new Error('missing actor attribute'); } };
    const opponent = { ...makePlayer(), id: 'opponent', name: 'Guard', level: 7, getSkillValue: () => 2, getAttributeBonus: () => { throw new Error('missing opponent attribute'); } };
    helpers.findActorByName = name => name === 'Guard' ? opponent : null;
    const outcome = helpers.resolveActionOutcome({ player: actor, dieRollOverride: 10, plausibility: { type: 'plausible', skillCheck: { skill: 'Stealth', attribute: '', difficulty: 'Opposed', opposedCheck: { opponent: 'Guard', opponentSkill: 'Perception', opponentAttribute: 'N/A' } } } });
    assert.equal(outcome.roll.total, 18);
    assert.equal(outcome.roll.opponentTotal, 19);
    assert.equal(outcome.roll.attributeBonus, 4);
    assert.equal(outcome.roll.opponentAttributeBonus, 7);
    assert.equal(outcome.roll.attributeBonusSource, 'level');
    assert.equal(outcome.roll.opponentAttributeBonusSource, 'level');
    assert.equal(outcome.margin, -1);
    assert.equal(outcome.degree, 'barely_failed');
    assert.equal(outcome.attribute, null);
    assert.equal(outcome.opponent.attribute, null);
});

test('specified attribute modifiers remain authoritative including zero and stat-only doubling', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({ config: makeConfig(), locationLevel: 4, dieRoll: 10 });
    const actor = { ...makePlayer(), id: 'actor', level: 9, getSkillValue: skill => skill === 'Stealth' ? 4 : NaN, getAttributeBonus: key => key === 'Dexterity' ? 0 : 3 };
    const named = resolveActionOutcome({ player: actor, plausibility: { type: 'plausible', skillCheck: { skill: 'Stealth', attribute: 'Dexterity', difficulty: 'medium' } } });
    assert.equal(named.roll.attributeBonusSource, undefined);
    assert.equal(named.roll.attributeBonus, 0); assert.equal(named.roll.total, 14); assert.equal(named.margin, -1);
    actor.getAttributeBonus = () => 3;
    const statOnly = resolveActionOutcome({ player: actor, plausibility: { type: 'plausible', skillCheck: { skill: '', attribute: 'Dexterity', difficulty: 'medium' } } });
    assert.equal(statOnly.roll.attributeBonus, 6); assert.equal(statOnly.roll.total, 16); assert.equal(statOnly.margin, 1);
});

test('ordinary and opposed checks apply status, ability, equipment and location skill modifiers once', async () => {
    await withTechniqueWorld(async ({ player, npc, location }) => {
        player.setSkillValue('Stealth', 10);
        npc.setSkillValue('Stealth', 4);
        player.setStatusEffects([{ name: 'Intrinsic', description: 'Intrinsic bonus.', duration: -1, skills: [{ skill: 'Stealth', modifier: 1 }] }]);
        player.setAbilities([{ id: 'skill_ability', name: 'Expert', description: 'A skill trait.', type: 'Passive', level: 1,
            statusEffects: [{ name: 'Ability', description: 'Ability bonus.', duration: -1, skills: [{ skill: 'Stealth', modifier: 2 }] }] }]);
        const originalInventory = player.getInventoryItems.bind(player);
        player.getInventoryItems = () => [...originalInventory(), { isEquipped: true, causeStatusEffectOnEquipper: { name: 'Equipment', skills: [{ skill: 'Stealth', modifier: 1 }] } }];
        location.setStatusEffects([{ name: 'Location', description: 'Location bonus.', duration: -1, skills: [{ skill: 'Stealth', modifier: 1, percentModifier: 20 }] }]);
        const helpers = loadActionOutcomeHelpers({ config: makeConfig(), locationLevel: 4, dieRoll: 10 });
        const ordinary = helpers.resolveActionOutcome({ player, plausibility: { type: 'plausible', skillCheck: { skill: 'Stealth', attribute: 'strength', difficulty: 'medium' } } });
        assert.equal(ordinary.roll.skillValue, 18);
        assert.equal(player.getSkillValue('Stealth'), 10);
        helpers.findActorByName = name => name === npc.name ? npc : null;
        const opposed = helpers.resolveActionOutcome({ player, dieRollOverride: 10, plausibility: { type: 'plausible', skillCheck: { skill: 'Stealth', attribute: 'strength', difficulty: 'Opposed', opposedCheck: { opponent: npc.name, opponentSkill: 'Stealth', opponentAttribute: 'strength' } } } });
        assert.equal(opposed.roll.skillValue, 18);
        assert.equal(opposed.roll.opponentSkillValue, 6);
        assert.equal(npc.getSkillValue('Stealth'), 4);
    });
});
