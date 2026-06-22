const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const Tracker = require('../Tracker.js');
const IdGenerator = require('../IdGenerator.js');

function captureConsoleError(callback) {
    const originalError = console.error;
    const messages = [];
    console.error = (...args) => {
        messages.push(args.map((arg) => (
            typeof arg === 'string' ? arg : JSON.stringify(arg)
        )).join(' '));
    };
    try {
        const result = callback(messages);
        return { result, messages };
    } finally {
        console.error = originalError;
    }
}

test('XML trackerUpdates parses valid entries and skips malformed entries', () => {
    const previousConfig = Globals.config;
    Globals.config = { trackers: { short_string_max_words: 4 } };

    try {
    const { result: parsed, messages } = captureConsoleError(() => Events._parseXmlEventCheckResponse(`
<events>
  <trackerUpdates>
    <trackerUpdate>
      <trackerName>Gate Stability</trackerName>
      <type>percentage</type>
      <action>update</action>
      <newValue>45</newValue>
      <reason>The gate destabilized.</reason>
    </trackerUpdate>
    <trackerUpdate>
      <trackerName>Oracle Mood</trackerName>
      <type>short_string</type>
      <action>update</action>
      <newValue>deeply worried tonight now</newValue>
      <reason>The oracle saw the omen.</reason>
    </trackerUpdate>
    <trackerUpdate>
      <trackerName>Oracle Mood</trackerName>
      <type>short_string</type>
      <action>update</action>
      <newValue>one two three four five</newValue>
      <reason>Five words should exceed the configured default.</reason>
    </trackerUpdate>
    <trackerUpdate>
      <type>percentage</type>
      <action>update</action>
      <newValue>50%</newValue>
      <reason>Missing tracker name should be skipped.</reason>
    </trackerUpdate>
  </trackerUpdates>
</events>
`));

    assert.deepEqual(parsed.structured.parsed.tracker_updates, [
        {
            trackerName: 'Gate Stability',
            type: 'percentage',
            action: 'update',
            newValue: '45%',
            reason: 'The gate destabilized.'
        },
        {
            trackerName: 'Oracle Mood',
            type: 'short_string',
            action: 'update',
            newValue: 'deeply worried tonight now',
            reason: 'The oracle saw the omen.'
        }
    ]);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /tracker_updates/i);
    } finally {
        Globals.config = previousConfig;
    }
});

test('omitted trackerUpdates block produces no tracker update entries', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <currency><amount>3</amount></currency>
</events>
`);

    assert.equal(parsed.structured.parsed.tracker_updates, undefined);
});

test('legacy tracker_updates parser normalizes percentages and skips bad entries', () => {
    const previousConfig = Globals.config;
    Globals.config = { trackers: { short_string_max_words: 4 } };

    try {
    const parser = Events._buildParsers().tracker_updates;
    const { result, messages } = captureConsoleError(() => parser([
        'Gate Stability → percentage → update → 45 → The gate destabilized.',
        'Oracle Mood → short_string → update → deeply worried tonight now → The oracle saw the omen.',
        'Oracle Mood → short_string → update → one two three four five → Five words should exceed the configured default.',
        'Gate Stability → percentage → remove → The gate closed.',
        'Broken Entry → percentage → noop → 10 → Invalid action.'
    ].join(' | ')));

    assert.deepEqual(result, [
        {
            trackerName: 'Gate Stability',
            type: 'percentage',
            action: 'update',
            newValue: '45%',
            reason: 'The gate destabilized.'
        },
        {
            trackerName: 'Oracle Mood',
            type: 'short_string',
            action: 'update',
            newValue: 'deeply worried tonight now',
            reason: 'The oracle saw the omen.'
        },
        {
            trackerName: 'Gate Stability',
            type: 'percentage',
            action: 'remove',
            reason: 'The gate closed.'
        }
    ]);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /tracker_updates/i);
    } finally {
        Globals.config = previousConfig;
    }
});

test('tracker_updates handler applies valid mutations and logs per-entry failures', async () => {
    Tracker.clear();
    IdGenerator.reset();

    const existing = new Tracker({
        name: 'Gate Stability',
        type: 'percentage',
        value: '60%',
        hiddenFromPlayer: false,
        lastUpdatedWorldMinute: 0,
        description: 'Track the stability of the gate.'
    });
    const removable = new Tracker({
        name: 'Alarm State',
        type: 'short_string',
        value: 'armed',
        hiddenFromPlayer: false,
        lastUpdatedWorldMinute: 0,
        description: 'Track the alarm state.'
    });

    const handler = Events._buildHandlers().tracker_updates;
    const context = {};
    const worldMinute = Globals.getTotalWorldMinutes();
    const { messages } = captureConsoleError(() => handler.call(Events, [
        {
            trackerName: 'Gate Stability',
            type: 'percentage',
            action: 'update',
            newValue: '45',
            reason: 'The gate destabilized.'
        },
        {
            trackerName: 'Keys Found',
            type: 'x_out_of_total',
            action: 'add',
            newValue: '1/3',
            reason: 'The first vault key was found.'
        },
        {
            trackerName: 'Supply Shuttle Arrival',
            type: 'countdown',
            action: 'add',
            newValue: '2 days, 3 hours',
            reason: 'The shuttle arrival deadline is now known.'
        },
        {
            trackerName: 'Alarm State',
            type: 'short_string',
            action: 'remove',
            reason: 'The alarm stopped mattering.'
        },
        {
            trackerName: 'Missing Tracker',
            type: 'numerical_count',
            action: 'update',
            newValue: '2',
            reason: 'This should fail without blocking the other updates.'
        }
    ], context));

    assert.equal(existing.value, '45%');
    assert.equal(existing.lastUpdatedWorldMinute, worldMinute);
    const added = Tracker.findByNameOrKey('Keys Found')[0];
    assert.ok(added);
    assert.equal(added.value, '1/3');
    assert.equal(added.lastUpdatedWorldMinute, worldMinute);
    assert.equal(added.description, 'The first vault key was found.');
    const countdown = Tracker.findByNameOrKey('Supply Shuttle Arrival')[0];
    assert.ok(countdown);
    assert.equal(countdown.value, '2 days, 3 hours');
    assert.equal(countdown.countdownUntilWorldMinute, worldMinute + 3060);
    assert.equal(Tracker.getById(removable.id), null);
    assert.deepEqual(context.trackerUpdates.map((entry) => entry.action), ['update', 'add', 'add', 'remove']);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /tracker_updates/i);
});
