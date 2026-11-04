const test = require('node:test');
const assert = require('node:assert/strict');
const { parseContainerOpenCheckPlan, parseSceneSummaryEntry, parseLocationModificationNarrativeResult, parseWhileAwayCharacterUpdate, parseWhileYouWereAwayResult, parseScheduledEventToolPlan } = require('../TinyBrainPromptParsers.js');

test('container plan accepts omitted optional fields but still requires meaningful check and outcome', () => {
    const base = '<containerOpenCheck><type>unopposed</type><reason>Locked</reason><skill>Lockpicking</skill><difficultyLevel>Hard</difficultyLevel></containerOpenCheck>';
    const omitted = parseContainerOpenCheckPlan(base).value;
    const explicit = parseContainerOpenCheckPlan(base.replace('<difficultyLevel>', '<attribute>N/A</attribute><circumstanceModifiers/><difficultyLevel>')).value;
    assert.deepEqual(omitted, explicit);
    assert.throws(() => parseContainerOpenCheckPlan(base.replace('<skill>Lockpicking</skill>', '')), /skill|attribute/i);
    assert.throws(() => parseContainerOpenCheckPlan(base.replace('<difficultyLevel>Hard</difficultyLevel>', '')), /difficultyLevel/i);
    assert.throws(() => parseContainerOpenCheckPlan(base.replace('</containerOpenCheck>', '<circumstanceModifiers/><circumstanceModifiers/></containerOpenCheck>')), /circumstanceModifiers/i);
    const opposed = '<containerOpenCheck><type>opposed</type><reason>Guard</reason><skill>Athletics</skill><opponent>Guard</opponent><opponentAttribute>Strength</opponentAttribute></containerOpenCheck>';
    assert.equal(parseContainerOpenCheckPlan(opposed).value.argumentsObject.opponentSkill, 'N/A');
    assert.throws(() => parseContainerOpenCheckPlan(opposed.replace('<opponentAttribute>Strength</opponentAttribute>', '')), /opponent.*skill|opponent.*attribute/i);
});

test('scene details and location extra effect may be omitted while summary and duration remain required', () => {
    const scene = '<scene><index>1</index><summary>They met.</summary></scene>';
    assert.deepEqual(parseSceneSummaryEntry(scene, 1, 1).value.details, parseSceneSummaryEntry(scene.replace('</scene>', '<details/></scene>'), 1, 1).value.details);
    assert.throws(() => parseSceneSummaryEntry(scene.replace('<summary>They met.</summary>', ''), 1, 1), /summary/i);
    assert.throws(() => parseSceneSummaryEntry(scene.replace('</scene>', '<details/><details/></scene>'), 1, 1), /details/i);
    const result = '<result><description>A new door.</description><timePassed><duration>2 minutes</duration></timePassed></result>';
    assert.doesNotThrow(() => parseLocationModificationNarrativeResult(result));
    assert.doesNotThrow(() => parseLocationModificationNarrativeResult(result.replace('</result>', '<otherEffectDescription/></result>')));
    assert.throws(() => parseLocationModificationNarrativeResult(result.replace('<description>A new door.</description>', '')), /description/i);
    assert.throws(() => parseLocationModificationNarrativeResult(result.replace('</result>', '<otherEffectDescription/><otherEffectDescription/></result>')), /otherEffectDescription/i);
});

test('while-away optional containers and need values may be omitted without accepting invalid updates', () => {
    for (const xml of ['<response/>', '<response><characterUpdates/><itemSceneryMoves/></response>']) assert.doesNotThrow(() => parseWhileYouWereAwayResult(xml));
    const update = '<characterUpdate><name>Mira</name><update>Rested.</update></characterUpdate>';
    assert.doesNotThrow(() => parseWhileAwayCharacterUpdate(update, 'Mira'));
    assert.doesNotThrow(() => parseWhileAwayCharacterUpdate(update.replace('</characterUpdate>', '<needBarChanges><needBarEffect><needBarId>energy</needBarId></needBarEffect></needBarChanges></characterUpdate>'), 'Mira'));
    assert.throws(() => parseWhileAwayCharacterUpdate(update.replace('<update>Rested.</update>', ''), 'Mira'), /update/i);
    assert.throws(() => parseWhileAwayCharacterUpdate(update.replace('</characterUpdate>', '<needBarChanges/><needBarChanges/></characterUpdate>'), 'Mira'), /needBarChanges/i);
    assert.throws(() => parseWhileAwayCharacterUpdate(update.replace('</characterUpdate>', '<needBarChanges><needBarEffect><needBarId>energy</needBarId><value>potato</value></needBarEffect></needBarChanges></characterUpdate>'), 'Mira'), /percentage/i);
});

test('scheduled tool plan omission is equivalent to empty lists without weakening entries', () => {
    const args = ['The bell rings.', []];
    const omitted = parseScheduledEventToolPlan('<toolPlan/>', ...args).value;
    const empty = parseScheduledEventToolPlan('<toolPlan><directUpdates/><otherTools/></toolPlan>', ...args).value;
    assert.deepEqual(omitted, empty);
    assert.throws(() => parseScheduledEventToolPlan('<toolPlan><directUpdates/><directUpdates/></toolPlan>', ...args), /directUpdates/i);
    assert.throws(() => parseScheduledEventToolPlan('<toolPlan><directUpdates><update/></directUpdates></toolPlan>', ...args), /objectType/i);
});

test('staged while-away comparison treats missing and N/A no-op effects as equal but rejects numeric drift', () => {
    const { parseWhileYouWereAwayStagedResult } = require('../TinyBrainPromptParsers.js');
    const update = '<characterUpdate><name>Mira</name><update>Rested.</update></characterUpdate>';
    const explicit = update.replace('</characterUpdate>', '<needBarChanges><needBarEffect><needBarId>energy</needBarId><value>N/A</value></needBarEffect></needBarChanges></characterUpdate>');
    const final = `<response><characterUpdates>${update}</characterUpdates></response>`;
    const options = { characterUpdateXml: [explicit], arrivalUpdatesXml: '<characterUpdates/>', itemSceneryMovesXml: '<itemSceneryMoves/>' };
    assert.doesNotThrow(() => parseWhileYouWereAwayStagedResult(final, options));
    assert.doesNotThrow(() => parseWhileYouWereAwayStagedResult(final, { ...options, characterUpdateXml: [explicit.replace('<value>N/A</value>', '')] }));
    assert.throws(() => parseWhileYouWereAwayStagedResult(final, { ...options, characterUpdateXml: [explicit.replace('N/A', '60')] }), /match|changed|drift/i);
});
