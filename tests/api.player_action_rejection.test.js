const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, name) {
    const signature = `function ${name}(`;
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Unable to locate ${name} in api.js`);
    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `Unable to locate ${name} body in api.js`);

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to locate ${name} end in api.js`);
}

function loadPlayerActionXmlParser() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function sanitizeForXml(input) {');
    const end = source.indexOf('\n        function parseSupplementalStoryInfoResponse', start);
    assert.notEqual(start, -1, 'Unable to locate player action XML helpers in api.js');
    assert.notEqual(end, -1, 'Unable to locate player action XML helper end in api.js');

    const context = {
        Utils: require('../Utils.js'),
        console
    };

    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.parsePlayerActionProseFromXml = parsePlayerActionProseFromXml;
this.playerActionProseRegex = playerActionProseRegex;`,
        context
    );

    return context;
}

function loadContextExclusionHelper() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const functionSource = extractFunction(source, 'markChatEntryExcludedFromBaseContextHistory');
    const context = {};
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.markChatEntryExcludedFromBaseContextHistory = markChatEntryExcludedFromBaseContextHistory;`,
        context
    );
    return context.markChatEntryExcludedFromBaseContextHistory;
}

test('player action XML required regex accepts rejected responses', () => {
    const context = loadPlayerActionXmlParser();
    assert.match(
        '<rejected><!-- Please enter a complete action. --></rejected>',
        context.playerActionProseRegex
    );
});

test('player action XML parser extracts rejected reasons from comments', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<rejected><!-- Please enter a complete action. --></rejected>'
    );

    assert.equal(parsed.prose, '');
    assert.equal(parsed.travel, null);
    assert.equal(parsed.rejected?.reason, 'Please enter a complete action.');
});

test('player action XML parser extracts rejected reasons from text content', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<rejected>Please enter a complete action.</rejected>'
    );

    assert.equal(parsed.prose, '');
    assert.equal(parsed.travel, null);
    assert.equal(parsed.rejected?.reason, 'Please enter a complete action.');
});

test('player action XML parser ignores draft turnResult blocks before the final root', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml([
        '1. Draft:',
        '<turnResult><prose>Draft prose that should not be used.</prose></turnResult>',
        '2. Final:',
        '<turnResult><prose>Final prose.</prose><hidden>Keep this note.</hidden></turnResult>'
    ].join('\n'));

    assert.equal(parsed.prose, 'Final prose.<hidden>Keep this note.</hidden>');
    assert.equal(parsed.travel, null);
});

test('player action XML parser extracts turnResult timePassed without exposing it as prose', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<turnResult><prose>Final prose.</prose><timePassed><reasoning>A short exchange.</reasoning><duration>12 minutes</duration></timePassed><hidden>Keep this note.</hidden></turnResult>'
    );

    assert.equal(parsed.prose, 'Final prose.<hidden>Keep this note.</hidden>');
    assert.equal(parsed.travel, null);
    assert.equal(parsed.timePassedMinutes, 12);
});

test('player action XML parser preserves hidden notes inside prose child', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<turnResult><prose>Final prose.<hidden>Nested note.</hidden></prose><timePassed><reasoning>A short exchange.</reasoning><duration>1 minute</duration></timePassed></turnResult>'
    );

    assert.equal(parsed.prose, 'Final prose.<hidden>Nested note.</hidden>');
    assert.equal(parsed.travel, null);
    assert.equal(parsed.timePassedMinutes, 1);
});

test('player action XML parser requires turnResult prose child', async () => {
    const context = loadPlayerActionXmlParser();

    await assert.rejects(
        () => context.parsePlayerActionProseFromXml('<turnResult>Final prose.</turnResult>'),
        /<turnResult> must include a direct <prose> child/
    );
});

test('player action XML parser chooses final moveTurnResult after earlier draft prose XML', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml([
        '<turnResult><prose>Draft prose that should not be used.</prose></turnResult>',
        '<moveTurnResult>',
        '<originProse>Origin beat.</originProse>',
        '<destinationProse>Destination beat.</destinationProse>',
        '</moveTurnResult>'
    ].join('\n'));

    assert.equal(parsed.prose, 'Origin beat.\n\nDestination beat.');
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.travel)), {
        vehicle: null,
        vehicleTravelTime: null,
        vehicleDestination: null,
        playerDestination: null,
        playerDestinationTravelTime: null,
        originProse: 'Origin beat.',
        betweenProse: null,
        destinationProse: 'Destination beat.'
    });
});

test('player action XML parser preserves direct move-result hidden notes outside event prose', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<moveTurnResult>'
        + '<playerDestination><location>Market Gate</location><travelTime>5 minutes</travelTime></playerDestination>'
        + '<originProse><![CDATA[You leave the inn.]]></originProse>'
        + '<destinationProse><![CDATA[The market opens before you.]]></destinationProse>'
        + '<hidden><![CDATA[The gate guard noticed you.]]></hidden>'
        + '</moveTurnResult>'
    );

    assert.equal(
        parsed.prose,
        'You leave the inn.\n\nThe market opens before you.<hidden><![CDATA[The gate guard noticed you.]]></hidden>'
    );
    assert.equal(parsed.travel.originProse, 'You leave the inn.');
    assert.equal(parsed.travel.destinationProse, 'The market opens before you.');
    assert.ok(!parsed.travel.originProse.includes('gate guard'));
    assert.ok(!parsed.travel.destinationProse.includes('gate guard'));
});

test('player action XML parser extracts exact accompanying character names', async () => {
    const context = loadPlayerActionXmlParser();
    const parsed = await context.parsePlayerActionProseFromXml(
        '<moveTurnResult>'
        + '<playerDestination><location>Market Gate</location><travelTime>5 minutes</travelTime></playerDestination>'
        + '<accompanyingCharacters><name>Mira Vale</name><name>Tal Stone</name></accompanyingCharacters>'
        + '<destinationProse>The market opens before you.</destinationProse>'
        + '</moveTurnResult>'
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(parsed.travel.accompanyingCharacters)),
        ['Mira Vale', 'Tal Stone']
    );
});

test('player action XML parser rejects unexpected accompanying character fields', async () => {
    const context = loadPlayerActionXmlParser();

    await assert.rejects(
        context.parsePlayerActionProseFromXml(
            '<moveTurnResult>'
            + '<playerDestination><location>Market Gate</location><travelTime>5 minutes</travelTime></playerDestination>'
            + '<accompanyingCharacters><character>Mira Vale</character></accompanyingCharacters>'
            + '<destinationProse>The market opens before you.</destinationProse>'
            + '</moveTurnResult>'
        ),
        /may contain only <name> children/i
    );
});

test('context exclusion helper preserves metadata while excluding entry', () => {
    const markChatEntryExcludedFromBaseContextHistory = loadContextExclusionHelper();
    const entry = {
        metadata: {
            requestId: 'req-123'
        }
    };

    const result = markChatEntryExcludedFromBaseContextHistory(entry);

    assert.equal(result, entry);
    assert.equal(entry.metadata.requestId, 'req-123');
    assert.equal(entry.metadata.excludeFromBaseContextHistory, true);
    assert.equal(markChatEntryExcludedFromBaseContextHistory(null), null);
});

test('chat route aborts rejected player-action XML before normal response storage', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const parseIndex = source.indexOf('const parsedProse = await parsePlayerActionProseFromXml(aiResponse, { logJson: true });');
    assert.notEqual(parseIndex, -1, 'Unable to locate player-action XML parse call.');
    const branchIndex = source.indexOf('if (parsedProse.rejected)', parseIndex);
    assert.notEqual(branchIndex, -1, 'Unable to locate rejected player-action branch.');
    const slopIndex = source.indexOf('let slopRemovalInfo = null;', parseIndex);
    assert.notEqual(slopIndex, -1, 'Unable to locate slop removal block.');
    assert.ok(branchIndex < slopIndex, 'Rejected player-action branch must run before normal response storage.');

    const branch = source.slice(branchIndex, slopIndex);
    assert.match(branch, /return respondWithRejectedPlayerActionXml\(parsedProse, aiResponse\)/);

    const helperIndex = source.lastIndexOf('const respondWithRejectedPlayerActionXml =', parseIndex);
    assert.notEqual(helperIndex, -1, 'Unable to locate rejected player-action response helper.');
    const helperEnd = source.indexOf('//console.log("Player Prose Request Options:', helperIndex);
    assert.notEqual(helperEnd, -1, 'Unable to locate rejected player-action response helper end.');
    const helper = source.slice(helperIndex, helperEnd);
    assert.match(helper, /markChatEntryExcludedFromBaseContextHistory\(storedUserEntry\)/);
    assert.match(helper, /excludeFromBaseContextHistory:\s*true/);
    assert.match(helper, /return respond\(responseData\)/);
});

test('chat route rewrites same-location scheduled event interruptions before slop removal', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const parseIndex = source.indexOf('const parsedProse = await parsePlayerActionProseFromXml(aiResponse, { logJson: true });');
    assert.notEqual(parseIndex, -1, 'Unable to locate player-action XML parse call.');
    const rewriteIndex = source.indexOf('maybeRewritePlayerActionForScheduledEventInterruption', parseIndex);
    assert.notEqual(rewriteIndex, -1, 'Unable to locate scheduled-event interruption rewrite call.');
    const slopIndex = source.indexOf('let slopRemovalInfo = null;', parseIndex);
    assert.notEqual(slopIndex, -1, 'Unable to locate slop removal block.');
    assert.ok(rewriteIndex < slopIndex, 'Scheduled-event interruption rewrite must run before slop removal.');

    const routeSlice = source.slice(parseIndex, slopIndex);
    assert.match(routeSlice, /playerActionRemainingTimePassedMinutes/);
    assert.match(source, /metadataLabel:\s*'player_action_interruption_rewrite'/);
    assert.match(source, /suppressVisibleProse:\s*true/);
});
