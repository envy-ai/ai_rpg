const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseContainerOpenCheckPlan,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayStagedResult,
    parseRevisionDecision
} = require('../TinyBrainPromptParsers.js');
const { parsePlayerActionResolutionPlan } = require('../PlayerActionResolutionPlan.js');

test('blank optional selection leaves normalize like omission while conditional check meaning stays required', () => {
    const unopposed = '<containerOpenCheck><type>unopposed</type><reason>Locked</reason>'
        + '<skill>Lockpicking</skill><difficultyLevel>Hard</difficultyLevel></containerOpenCheck>';
    const withBlankAttribute = unopposed.replace('<difficultyLevel>', '<attribute>  </attribute><difficultyLevel>');
    assert.deepEqual(parseContainerOpenCheckPlan(withBlankAttribute).value, parseContainerOpenCheckPlan(unopposed).value);

    const opposed = '<containerOpenCheck><type>opposed</type><reason>Guard</reason><skill>Athletics</skill>'
        + '<attribute>N/A</attribute><opponent>Guard</opponent><opponentAttribute>Strength</opponentAttribute></containerOpenCheck>';
    const blankOpponentSkill = opposed.replace('<opponentAttribute>', '<opponentSkill> </opponentSkill><opponentAttribute>');
    assert.deepEqual(parseContainerOpenCheckPlan(blankOpponentSkill).value, parseContainerOpenCheckPlan(opposed).value);
    assert.throws(() => parseContainerOpenCheckPlan(unopposed.replace('<skill>Lockpicking</skill>', '<skill> </skill>')),
        /skill|attribute/i);
    assert.throws(() => parseContainerOpenCheckPlan(withBlankAttribute.replace('</containerOpenCheck>', '<attribute/></containerOpenCheck>')),
        /attribute/i);
});

test('blank while-away need value is a no-op equivalent to omission and N/A', () => {
    const base = '<characterUpdate><name>Mira</name><update>Rested.</update>'
        + '<needBarChanges><needBarEffect><needBarId>energy</needBarId></needBarEffect></needBarChanges></characterUpdate>';
    const blank = base.replace('</needBarEffect>', '<value> \n </value></needBarEffect>');
    const sentinel = base.replace('</needBarEffect>', '<value>N/A</value></needBarEffect>');
    assert.equal(parseWhileAwayCharacterUpdate(blank, 'Mira').value.name, 'Mira');
    const final = `<response><characterUpdates>${base}</characterUpdates></response>`;
    const stagedOptions = value => ({ characterUpdateXml: [value], arrivalUpdatesXml: '<characterUpdates/>', itemSceneryMovesXml: '<itemSceneryMoves/>' });
    assert.deepEqual(
        parseWhileYouWereAwayStagedResult(final, stagedOptions(blank)).value,
        parseWhileYouWereAwayStagedResult(final, stagedOptions(base)).value
    );
    assert.deepEqual(
        parseWhileYouWereAwayStagedResult(final, stagedOptions(blank)).value,
        parseWhileYouWereAwayStagedResult(final, stagedOptions(sentinel)).value
    );
    assert.throws(() => parseWhileAwayCharacterUpdate(base.replace('</needBarEffect>', '<value><nested/></value></needBarEffect>'), 'Mira'), /value|percentage/i);
    assert.throws(() => parseWhileAwayCharacterUpdate(blank.replace('</needBarEffect>', '<value>N/A</value></needBarEffect>'), 'Mira'), /value/i);
});

test('resolution plan blank optional scalar follows omission, while zero, false and required conditional values survive', () => {
    const base = '<resolutionPlan><check><type>unopposed</type><actor>player</actor><intent>Climb</intent>'
        + '<skill>Athletics</skill><difficulty>Hard</difficulty><circumstanceModifiers>'
        + '<modifier><amount>0</amount><reason>Level ground</reason></modifier></circumstanceModifiers></check></resolutionPlan>';
    const withEmptyAttribute = base.replace('<difficulty>', '<attribute> </attribute><difficulty>');
    const omitted = parsePlayerActionResolutionPlan(base).value;
    const blank = parsePlayerActionResolutionPlan(withEmptyAttribute).value;
    assert.deepEqual(blank, omitted);
    assert.equal(omitted[0].argumentsObject.circumstanceModifiers[0].amount, 0);
    const revisionFalse = parseRevisionDecision('<revisionDecision><revise>false</revise></revisionDecision>').value;
    assert.equal(revisionFalse.revise, false);

    assert.throws(() => parsePlayerActionResolutionPlan(base.replace('<amount>0</amount>', '<amount/>')), /amount/i);
});
