const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const ScheduledCommand = require('../slashcommands/scheduled.js');
const {
    initializeSlashCommands,
    getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function createScheduledEvent(overrides = {}) {
    return new ScheduledEvent({
        id: overrides.id,
        event: overrides.event || 'A long-running warning beacon starts blinking above the loading cranes, calling every dockworker who owes Ressa a favor back to the harbor yard.',
        regionId: overrides.regionId || 'region-harbor',
        regionName: overrides.regionName || 'Harbor District',
        locationId: overrides.locationId || 'loc-crane-yard',
        locationName: overrides.locationName || 'Crane Yard',
        targetWorldMinute: overrides.targetWorldMinute ?? 600,
        targetWorldTime: overrides.targetWorldTime || { dayIndex: 0, timeMinutes: 600 },
        createdAtWorldMinute: overrides.createdAtWorldMinute ?? 120,
        createdAtWorldTime: overrides.createdAtWorldTime || { dayIndex: 0, timeMinutes: 120 },
        status: overrides.status || 'pending',
        resolutionSummary: overrides.resolutionSummary || '',
        playerProse: overrides.playerProse || '',
        resolvedAtWorldMinute: overrides.resolvedAtWorldMinute ?? null,
        resolvedAtWorldTime: overrides.resolvedAtWorldTime || null,
        createdAt: overrides.createdAt || '2026-05-25T12:00:00.000Z',
        updatedAt: overrides.updatedAt || '2026-05-25T12:00:00.000Z'
    });
}

function createInteraction() {
    const replies = [];
    return {
        replies,
        reply: async (payload) => {
            replies.push(payload);
        }
    };
}

test('scheduled command is registered', () => {
    initializeSlashCommands();

    const command = getSlashCommandModule('scheduled');
    assert.ok(command, 'scheduled command should be registered');
});

test('scheduled command lists pending events in readable markdown', async () => {
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const previousCalendarDefinition = Globals.calendarDefinition;

    IdGenerator.reset();
    ScheduledEvent.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        time: {
            cycleLengthMinutes: 1440,
            tickMinutes: 15
        }
    };
    Globals.calendarDefinition = null;
    Globals.worldTime = { dayIndex: 0, timeMinutes: 540 };

    try {
        const later = createScheduledEvent({
            id: 'sevent_later',
            event: 'A second patrol arrives after the alarm, carrying a crate of sealed evidence that should not fit in a table cell without becoming unreadable.',
            targetWorldMinute: 720,
            targetWorldTime: { dayIndex: 0, timeMinutes: 720 },
            locationName: 'Evidence Lockup',
            locationId: 'loc-lockup'
        });
        const earlier = createScheduledEvent({
            id: 'sevent_earlier',
            targetWorldMinute: 600,
            targetWorldTime: { dayIndex: 0, timeMinutes: 600 }
        });
        const resolved = createScheduledEvent({
            id: 'sevent_resolved',
            status: 'resolved',
            event: 'This already happened and should not appear.',
            targetWorldMinute: 580,
            targetWorldTime: { dayIndex: 0, timeMinutes: 580 },
            resolvedAtWorldMinute: 590,
            resolvedAtWorldTime: { dayIndex: 0, timeMinutes: 590 },
            resolutionSummary: 'Resolved already.'
        });

        assert.ok(later);
        assert.ok(earlier);
        assert.ok(resolved);

        const interaction = createInteraction();
        await ScheduledCommand.execute(interaction, {});

        assert.equal(interaction.replies.length, 1);
        const reply = interaction.replies[0];
        assert.equal(reply.ephemeral, false);
        assert.match(reply.content, /^## Scheduled Events/m);
        assert.match(reply.content, /1\. `sevent_earlier`/);
        assert.match(reply.content, /2\. `sevent_later`/);
        assert.ok(reply.content.indexOf('`sevent_earlier`') < reply.content.indexOf('`sevent_later`'));
        assert.match(reply.content, /- Due: \*\*Sunday, January 1, Common Era 1, 10:00 AM\*\*/);
        assert.match(reply.content, /- In: \*\*1 hour\*\*/);
        assert.match(reply.content, /- Region: Harbor District \(`region-harbor`\)/);
        assert.match(reply.content, /- Location: Crane Yard \(`loc-crane-yard`\)/);
        assert.match(reply.content, /- Event:\n\s+A long-running warning beacon starts blinking/);
        assert.doesNotMatch(reply.content, /sevent_resolved/);
        assert.doesNotMatch(reply.content, /This already happened/);
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Globals.calendarDefinition = previousCalendarDefinition;
    }
});

test('scheduled command reports when there are no pending events', async () => {
    IdGenerator.reset();
    ScheduledEvent.clear();

    try {
        const interaction = createInteraction();
        await ScheduledCommand.execute(interaction, {});

        assert.equal(interaction.replies.length, 1);
        assert.deepEqual(interaction.replies[0], {
            content: 'No pending scheduled events.',
            ephemeral: false
        });
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});
